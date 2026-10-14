from __future__ import annotations

import hashlib
import io
from datetime import datetime
from pathlib import Path
from typing import Any

import chromadb
import fitz
import httpx
from docx import Document as DocxDocument
from sentence_transformers import SentenceTransformer

from app.config import CHROMA_PATH, settings
from app.database import ConversationRecord, DocumentRecord, MessageRecord, get_setting, set_setting


class RAGService:
    def __init__(self) -> None:
        self.collection_name = settings.chroma_collection_name
        CHROMA_PATH.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(CHROMA_PATH))
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        self.embedding_model = None
        self.embedding_error = None
        try:
            self.embedding_model = SentenceTransformer(settings.embedding_model)
        except Exception as exc:  # pragma: no cover - environment dependent
            self.embedding_error = str(exc)

    def _text_to_hash(self, value: bytes) -> str:
        return hashlib.sha256(value).hexdigest()

    def sanitize_text(self, text: str) -> str:
        return " ".join(text.split())

    def extract_text(self, filename: str, file_bytes: bytes) -> str:
        extension = Path(filename).suffix.lower()
        if extension == ".pdf":
            try:
                pdf = fitz.open(stream=file_bytes, filetype="pdf")
                pages = []
                for page in pdf:
                    text = page.get_text("text")
                    if text:
                        pages.append(text)
                return "\n\n".join(pages)
            except Exception as exc:  # pragma: no cover
                raise ValueError(f"Unable to read PDF: {exc}") from exc

        if extension == ".docx":
            try:
                document = DocxDocument(io.BytesIO(file_bytes))
                paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
                return "\n".join(paragraphs)
            except Exception as exc:  # pragma: no cover
                raise ValueError(f"Unable to read DOCX: {exc}") from exc

        if extension in {".txt", ".md"}:
            try:
                return file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                return file_bytes.decode("utf-8", errors="replace")

        raise ValueError(f"Unsupported file type: {extension}")

    def split_text(self, text: str, chunk_size: int | None = None, overlap: int | None = None) -> list[str]:
        chunk_size = chunk_size or settings.chunk_size
        overlap = overlap or settings.chunk_overlap
        if not text or len(text) <= chunk_size:
            return [text] if text else []

        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            chunk = text[start:end]
            chunks.append(chunk.strip())
            if end == len(text):
                break
            start += max(1, chunk_size - overlap)
        return [chunk for chunk in chunks if chunk]

    def list_documents(self, db) -> list[dict[str, Any]]:
        documents = db.query(DocumentRecord).order_by(DocumentRecord.uploaded_at.desc()).all()
        return [
            {
                "id": doc.id,
                "filename": doc.filename,
                "type": doc.document_type,
                "size": doc.size_bytes,
                "uploaded_at": doc.uploaded_at.isoformat() if doc.uploaded_at else None,
                "status": doc.status,
                "error_message": doc.error_message,
                "chunk_count": doc.chunk_count,
            }
            for doc in documents
        ]

    def ping_ollama(self) -> dict[str, Any]:
        try:
            response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=8)
            response.raise_for_status()
            payload = response.json()
            models = [model.get("name") for model in payload.get("models", [])]
            return {"ok": True, "base_url": settings.ollama_base_url, "models": models}
        except Exception as exc:  # pragma: no cover - environment dependent
            return {"ok": False, "base_url": settings.ollama_base_url, "error": str(exc)}

    def get_selected_model(self, db) -> str:
        selected = get_setting(db, "selected_model") or settings.default_model
        return selected

    def set_selected_model(self, db, model_name: str) -> str:
        set_setting(db, "selected_model", model_name)
        return model_name

    def upload_document(self, db, file_name: str, file_bytes: bytes) -> dict[str, Any]:
        extension = Path(file_name).suffix.lower()
        if extension not in {".pdf", ".docx", ".txt", ".md"}:
            raise ValueError("Unsupported file type. Use PDF, DOCX, TXT, or Markdown files.")
        if len(file_bytes) > settings.max_file_size_mb * 1024 * 1024:
            raise ValueError(f"File exceeds the {settings.max_file_size_mb}MB limit.")

        source_hash = self._text_to_hash(file_bytes)
        existing = db.query(DocumentRecord).filter(DocumentRecord.source_hash == source_hash).first()
        if existing is not None:
            return {
                "id": existing.id,
                "filename": existing.filename,
                "status": "already_exists",
                "duplicate": True,
                "chunk_count": existing.chunk_count,
            }

        document_id = hashlib.sha256(f"{file_name}-{datetime.utcnow().isoformat()}".encode()).hexdigest()[:12]
        text = self.extract_text(file_name, file_bytes)
        cleaned = self.sanitize_text(text)
        if not cleaned:
            raise ValueError("The uploaded document is empty or unreadable.")

        chunks = self.split_text(cleaned)
        if self.embedding_model is None:
            raise ValueError(
                "The embedding model could not be loaded. Check your local sentence-transformers installation and try again."
            )
        embeddings = self.embedding_model.encode(chunks, convert_to_numpy=True, normalize_embeddings=True)

        ids = [f"{document_id}-{index}" for index in range(len(chunks))]
        metadatas = [{
            "document_id": document_id,
            "filename": file_name,
            "chunk_index": index,
            "source_hash": source_hash,
        } for index in range(len(chunks))]

        self.collection.add(
            documents=chunks,
            embeddings=embeddings.tolist(),
            metadatas=metadatas,
            ids=ids,
        )

        record = DocumentRecord(
            id=document_id,
            filename=file_name,
            document_type=extension.replace(".", "").upper(),
            size_bytes=len(file_bytes),
            uploaded_at=datetime.utcnow(),
            indexed_at=datetime.utcnow(),
            status="indexed",
            chunk_count=len(chunks),
            source_hash=source_hash,
        )
        db.add(record)
        db.commit()
        return {
            "id": record.id,
            "filename": record.filename,
            "status": "indexed",
            "duplicate": False,
            "chunk_count": len(chunks),
        }

    def delete_document(self, db, document_id: str) -> None:
        record = db.query(DocumentRecord).filter(DocumentRecord.id == document_id).first()
        if not record:
            raise ValueError("Document not found.")
        self.collection.delete(where={"document_id": document_id})
        db.delete(record)
        db.commit()

    def generate_embedding(self, text: str) -> list[float]:
        if self.embedding_model is None:
            raise ValueError(self.embedding_error or "Embedding model failed to initialize.")
        vector = self.embedding_model.encode([text], convert_to_numpy=True, normalize_embeddings=True)
        return vector[0].tolist()

    def ask_question(self, db, question: str, conversation_id: str | None = None, model_name: str | None = None) -> dict[str, Any]:
        model_name = model_name or self.get_selected_model(db) or settings.default_model
        if not question or not question.strip():
            raise ValueError("Please provide a question.")

        if self.collection.count() == 0:
            return {
                "answer": "I could not find any relevant uploaded study material. Please upload a document and ask again.",
                "citations": [],
                "sources": [],
                "grounded": False,
                "model": model_name,
            }

        query_vector = self.generate_embedding(question)
        search_results = self.collection.query(
            query_embeddings=[query_vector],
            n_results=5,
            include=["documents", "metadatas", "distances"],
        )
        items = list(zip(
            search_results.get("documents", [[]])[0],
            search_results.get("metadatas", [[]])[0],
            search_results.get("distances", [[]])[0],
        ))

        filtered = []
        for document, metadata, distance in items:
            score = 1 - distance if isinstance(distance, (int, float)) else 0.75
            if score >= 0.25:
                filtered.append({"text": document, "metadata": metadata, "score": round(score, 4)})

        if not filtered:
            return {
                "answer": "The uploaded material does not appear to contain enough evidence for that question. Please ask about a topic covered in your documents or upload additional notes.",
                "citations": [],
                "sources": [],
                "grounded": False,
                "model": model_name,
            }

        context = "\n\n".join(
            f"Source: {item['metadata'].get('filename', 'unknown')}\n{item['text']}" for item in filtered
        )

        prompt = (
            "You are UniMind AI, a helpful university learning assistant. Use only the provided context below to answer the student question. "
            "If the context does not contain enough evidence, say so clearly and do not invent facts.\n\n"
            f"Context:\n{context}\n\nQuestion:\n{question}\n\nAnswer in clear educational language with headings, bullets, and concise explanations. "
            "Cite the source filenames in a 'Sources' section."
        )

        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": model_name,
                "stream": False,
                "messages": [{"role": "user", "content": prompt}],
                "options": {"temperature": 0.3},
            },
            timeout=120,
        )
        if response.status_code >= 400:
            raise RuntimeError(response.text)

        payload = response.json()
        answer = payload.get("message", {}).get("content", "No answer generated.")

        citations = []
        source_map = {}
        for item in filtered:
            filename = item["metadata"].get("filename", "unknown")
            source_map.setdefault(filename, {"filename": filename, "excerpt": item["text"][:220]})
            citations.append({
                "filename": filename,
                "score": item["score"],
                "excerpt": item["text"][:220],
            })

        return {
            "answer": answer,
            "citations": citations,
            "sources": list(source_map.values()),
            "grounded": True,
            "model": model_name,
        }

    def generate_study_tool(self, db, tool_name: str, prompt: str, model_name: str | None = None) -> dict[str, Any]:
        tool_labels = {
            "summarize": "Summarize the uploaded notes in a clear academic overview with key concepts, supporting points, and brief takeaways.",
            "explain": "Explain this concept in beginner-friendly language with examples and simplified steps.",
            "exam": "Generate revision notes and important exam-style questions based on the uploaded material.",
            "quiz": "Generate a quiz with multiple-choice questions, correct answers, and brief explanations grounded in the provided content.",
            "flashcards": "Create study flashcards with Q&A pairs based on the concept in the uploaded material.",
            "practice": "Design a short practice test with several questions and answer keys based on the course material.",
            "topic": "Explain the topic, identify prerequisites, and suggest related subtopics.",
            "plan": "Generate a personalized study plan with manageable sessions, priorities, and milestones.",
        }
        tool_instruction = tool_labels.get(tool_name, "Provide a useful academic study response grounded in the uploaded resources.")
        combined = f"{tool_instruction}\n\n{prompt}"
        return self.ask_question(db, combined, model_name=model_name)

    def list_conversations(self, db) -> list[dict[str, Any]]:
        conversations = db.query(ConversationRecord).order_by(ConversationRecord.updated_at.desc()).all()
        output = []
        for item in conversations:
            output.append({
                "id": item.id,
                "title": item.title,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            })
        return output

    def create_conversation(self, db, title: str | None = None) -> dict[str, Any]:
        import uuid

        conversation = ConversationRecord(
            id=str(uuid.uuid4()),
            title=title or "New chat",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(conversation)
        db.commit()
        return {"id": conversation.id, "title": conversation.title}

    def rename_conversation(self, db, conversation_id: str, title: str) -> dict[str, Any]:
        item = db.query(ConversationRecord).filter(ConversationRecord.id == conversation_id).first()
        if not item:
            raise ValueError("Conversation not found.")
        item.title = title or item.title
        item.updated_at = datetime.utcnow()
        db.commit()
        return {"id": item.id, "title": item.title}

    def delete_conversation(self, db, conversation_id: str) -> None:
        messages = db.query(MessageRecord).filter(MessageRecord.conversation_id == conversation_id).all()
        for message in messages:
            db.delete(message)
        conversation = db.query(ConversationRecord).filter(ConversationRecord.id == conversation_id).first()
        if conversation:
            db.delete(conversation)
        db.commit()

    def list_messages(self, db, conversation_id: str) -> list[dict[str, Any]]:
        rows = db.query(MessageRecord).filter(MessageRecord.conversation_id == conversation_id).order_by(MessageRecord.created_at.asc()).all()
        result = []
        for row in rows:
            result.append({
                "id": row.id,
                "role": row.role,
                "content": row.content,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "metadata": row.metadata_json or {},
            })
        return result

    def append_message(self, db, conversation_id: str, role: str, content: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        import uuid

        conversation = db.query(ConversationRecord).filter(ConversationRecord.id == conversation_id).first()
        if not conversation:
            raise ValueError("Conversation not found.")

        message = MessageRecord(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            role=role,
            content=content,
            created_at=datetime.utcnow(),
            metadata_json=metadata or {},
        )
        db.add(message)
        conversation.updated_at = datetime.utcnow()
        db.commit()
        return {
            "id": message.id,
            "conversation_id": conversation_id,
            "role": role,
            "content": content,
            "created_at": message.created_at.isoformat(),
        }
