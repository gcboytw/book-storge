from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from app.core.config import settings

# 根據 SQLite 或 MariaDB 自動設定 engine 參數
connect_args = {}
if settings.DB_TYPE.lower() == "sqlite":
    connect_args["check_same_thread"] = False

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args=connect_args,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    """FastAPI 依賴注入 Session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db() -> None:
    """初始化資料庫表格"""
    # 確保所有 models 被載入
    import app.models  # noqa: F401
    Base.metadata.create_all(bind=engine)
