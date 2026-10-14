from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

DB_PATH = settings.database_url.replace("sqlite:///", "")
engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class DocumentRecord(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    filename = Column(String, nullable=False)
    document_type = Column(String, nullable=False)
    size_bytes = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="queued")
    error_message = Column(Text, nullable=True)
    chunk_count = Column(Integer, default=0)
    source_hash = Column(String, nullable=True)
    indexed_at = Column(DateTime, nullable=True)


class ConversationRecord(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True)
    title = Column(String, default="New chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class MessageRecord(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, nullable=False)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    metadata_json = Column(JSON, default=dict)


class SettingRecord(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)


def get_db():
    db = session_local()
    try:
        yield db
    finally:
        db.close()


def set_setting(db: Any, key: str, value: str) -> None:
    record = db.query(SettingRecord).filter(SettingRecord.key == key).first()
    if record is None:
        db.add(SettingRecord(key=key, value=value))
    else:
        record.value = value
        record.updated_at = datetime.utcnow()
    db.commit()


def get_setting(db: Any, key: str, default: str | None = None) -> str | None:
    record = db.query(SettingRecord).filter(SettingRecord.key == key).first()
    return record.value if record else default
