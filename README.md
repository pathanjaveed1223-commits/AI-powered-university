# UniMind AI

UniMind AI is a local-first university learning assistant. Upload course notes, ask questions grounded in those materials, and generate study aids using locally hosted models.

## Features

- Upload PDF, DOCX, TXT, and Markdown files for indexing.
- Retrieve relevant passages with local sentence-transformer embeddings and ChromaDB.
- Ask questions and receive answers with source filenames and excerpts.
- Create and revisit chat conversations stored in SQLite.
- Generate summaries, explanations, revision questions, quizzes, flashcards, practice tests, topic explorations, and study plans.
- Check and select installed Ollama models from the settings page.
- Use a responsive React interface with a dashboard and document library.

## Requirements

- Python 3.10 or newer
- Node.js and npm
- [Ollama](https://ollama.com/) running locally
- An installed Ollama model: `qwen3:4b` (default) or `qwen2.5:3b`

Install a model yourself in a terminal if needed; the application does not download Ollama models automatically:

```powershell
ollama pull qwen3:4b
```

The embedding model (`sentence-transformers/all-MiniLM-L6-v2`) runs locally. Its first use may download the model files from Hugging Face; subsequent use can run from the local cache.

## Run locally on Windows

### 1. Start Ollama

Start the Ollama application or service and confirm the selected model is installed:

```powershell
ollama list
```

### 2. Start the backend

From the project root:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

On first startup, the embedding model may need to download. If it cannot be loaded, the API reports an embedding-model error when document indexing is attempted.

The backend listens on [http://localhost:8001](http://localhost:8001). Interactive API documentation is at [http://localhost:8001/docs](http://localhost:8001/docs).

### 3. Start the frontend

In a second terminal, from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Use the app

1. Open **Documents** and upload one or more course files. Each file is limited to 10 MB.
2. Open **AI Study Chat** and ask a question about your materials.
3. Review the returned sources and excerpts alongside the answer.
4. Visit **Study Tools** to generate revision materials based on indexed content.
5. Change the installed Ollama model in **Settings**.

If the documents do not provide relevant evidence, the assistant is designed to say so rather than invent a document-grounded answer.

## Configuration

Backend settings can be overridden with environment variables or values in `backend/.env`. Available settings include:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP API address |
| `DEFAULT_MODEL` | `qwen3:4b` | Default chat model |
| `FALLBACK_MODEL` | `qwen2.5:3b` | Alternative model shown when Ollama is unavailable |
| `MAX_FILE_SIZE_MB` | `10` | Maximum upload size |
| `CHUNK_SIZE` | `800` | Document chunk size in characters |
| `CHUNK_OVERLAP` | `120` | Overlap between document chunks |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Local embedding model |
| `CHROMA_COLLECTION_NAME` | `unimind_documents` | ChromaDB collection |
| `DATABASE_URL` | SQLite database under `backend/data` | SQLAlchemy database URL |
| `BACKEND_PORT` | `8001` | Backend port setting |

The frontend API base URL is currently configured in `frontend/src/App.tsx` as `http://localhost:8001/api`.

## Data and privacy

SQLite and persistent ChromaDB data are stored under `backend/data/`. That directory is ignored by Git. Documents, chats, embeddings, and prompts are processed by the local backend and Ollama; the embedding model may be downloaded once during setup if it is not cached. Do not expose the development server to untrusted networks.

## API overview

- `GET /api/health` — application, Ollama, and indexing status
- `GET /api/models` — installed or configured model choices
- `POST /api/models/select` — select a model
- `GET /api/documents` — list indexed documents
- `POST /api/documents/upload` — upload and index a document
- `DELETE /api/documents/{document_id}` — remove a document and its vectors
- `GET`, `POST /api/conversations` — list or create conversations
- `PATCH`, `DELETE /api/conversations/{conversation_id}` — rename or delete a conversation
- `GET /api/conversations/{conversation_id}/messages` — retrieve conversation messages
- `POST /api/chat/query` — ask a question using retrieved context
- `POST /api/study-tools/generate` — generate a study aid from retrieved context

## Tests and production build

Run backend tests:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Build the frontend:

```powershell
cd frontend
npm run build
```
