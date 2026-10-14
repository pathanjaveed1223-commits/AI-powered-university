from __future__ import annotations

from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.rag_service import RAGService

service = RAGService()

app = FastAPI(title=settings.app_name, version=settings.app_version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ModelSelectionRequest(BaseModel):
    model_name: str = Field(..., min_length=2)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)
    conversation_id: str | None = None
    model_name: str | None = None


class StudyToolRequest(BaseModel):
    tool_name: str = Field(..., min_length=2)
    topic: str = Field(..., min_length=1)
    extra_context: str | None = None
    model_name: str | None = None


class RenameConversationRequest(BaseModel):
    title: str = Field(..., min_length=1)


@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> dict[str, Any]:
    documents = service.list_documents(db)
    return {
        "app_name": settings.app_name,
        "status": "ok",
        "ollama": service.ping_ollama(),
        "selected_model": service.get_selected_model(db),
        "documents_count": len(documents),
        "indexed_chunks": sum(doc["chunk_count"] for doc in documents),
    }


@app.get("/api/models")
def get_models(db: Session = Depends(get_db)) -> dict[str, Any]:
    ollama_status = service.ping_ollama()
    installed = ollama_status.get("models", [])
    return {
        "models": installed or [settings.default_model, settings.fallback_model],
        "selected_model": service.get_selected_model(db),
        "ollama_status": ollama_status,
    }


@app.post("/api/models/select")
def select_model(payload: ModelSelectionRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    installed = service.ping_ollama().get("models", [])
    if installed and payload.model_name not in installed:
        raise HTTPException(status_code=400, detail=f"Model '{payload.model_name}' is not installed locally.")
    model_name = service.set_selected_model(db, payload.model_name)
    return {"message": "Model updated.", "selected_model": model_name}


@app.get("/api/documents")
def list_documents(db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"documents": service.list_documents(db)}


@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    content = await file.read()
    try:
        return service.upload_document(db, file.filename or "unknown.docx", content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}") from exc


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        service.delete_document(db, document_id)
        return {"message": "Document deleted successfully."}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/conversations")
def list_conversations(db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"conversations": service.list_conversations(db)}


@app.post("/api/conversations")
def create_conversation(db: Session = Depends(get_db)) -> dict[str, Any]:
    return service.create_conversation(db)


@app.patch("/api/conversations/{conversation_id}")
def rename_conversation(conversation_id: str, payload: RenameConversationRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        return service.rename_conversation(db, conversation_id, payload.title)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        service.delete_conversation(db, conversation_id)
        return {"message": "Conversation deleted."}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/conversations/{conversation_id}/messages")
def get_messages(conversation_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    return {"messages": service.list_messages(db, conversation_id)}


@app.post("/api/chat/query")
def chat_query(payload: ChatRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    try:
        conversation_id = payload.conversation_id
        if conversation_id:
            service.append_message(db, conversation_id, "user", payload.question, {"type": "question"})
        response = service.ask_question(db, payload.question, conversation_id=conversation_id, model_name=payload.model_name)
        if conversation_id:
            service.append_message(db, conversation_id, "assistant", response["answer"], {"citations": response.get("citations", [])})
        return response
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/study-tools/generate")
def generate_study_tool(payload: StudyToolRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    text = payload.extra_context or payload.topic
    try:
        return service.generate_study_tool(db, payload.tool_name, text, model_name=payload.model_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "UniMind AI backend is running."}
