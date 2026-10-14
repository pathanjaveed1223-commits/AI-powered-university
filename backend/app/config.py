from __future__ import annotations

from pathlib import Path
from typing import Final

from pydantic_settings import BaseSettings

BASE_DIR: Final[Path] = Path(__file__).resolve().parent.parent
DATA_DIR: Final[Path] = BASE_DIR / "data"
DB_PATH: Final[Path] = DATA_DIR / "unimind.db"
CHROMA_PATH: Final[Path] = DATA_DIR / "chroma"


class Settings(BaseSettings):
    app_name: str = "UniMind AI"
    app_version: str = "0.1.0"
    environment: str = "development"
    backend_host: str = "0.0.0.0"
    backend_port: int = 8001
    debug: bool = False
    max_file_size_mb: int = 10
    default_model: str = "qwen3:4b"
    fallback_model: str = "qwen2.5:3b"
    ollama_base_url: str = "http://localhost:11434"
    chroma_collection_name: str = "unimind_documents"
    chunk_size: int = 800
    chunk_overlap: int = 120
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    database_url: str = f"sqlite:///{DB_PATH}"
    cors_origins: str = "*"

    class Config:
        env_file = BASE_DIR / ".env"
        extra = "ignore"


settings = Settings()
