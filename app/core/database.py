from pathlib import Path
from typing import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from app.core.config import settings, BASE_DIR

# 根據 SQLite 或 MariaDB 自動設定 engine 參數
connect_args = {}
if settings.DB_TYPE.lower() == "sqlite":
    connect_args["check_same_thread"] = False
    db_file_path = Path(settings.SQLITE_DB_PATH)
    if not db_file_path.is_absolute():
        db_file_path = (BASE_DIR / db_file_path).resolve()
    db_file_path.parent.mkdir(parents=True, exist_ok=True)

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
    """初始化資料庫表格與自動結構遷移"""
    # 確保所有 models 被載入
    import app.models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _migrate_schema()

def _migrate_schema() -> None:
    """自動補齊新舊版本資料庫欄位差（解決 no such column: books.shelf_id 問題）"""
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "books" in inspector.get_table_names():
        columns = [col["name"] for col in inspector.get_columns("books")]
        new_cols = [
            ("shelf_id", "INTEGER"),
            ("status", "VARCHAR(30) DEFAULT 'unread'"),
            ("purchase_date", "DATE"),
            ("purchase_price", "NUMERIC(10, 2)"),
            ("purchase_place", "VARCHAR(255)"),
            ("condition", "VARCHAR(50)"),
            ("rating", "INTEGER"),
            ("notes", "TEXT")
        ]
        with engine.begin() as conn:
            for col_name, col_type in new_cols:
                if col_name not in columns:
                    try:
                        conn.execute(text(f"ALTER TABLE books ADD COLUMN {col_name} {col_type}"))
                        print(f"[DB Migration] 成功補齊欄位: books.{col_name}")
                    except Exception as e:
                        print(f"[DB Migration] 補齊欄位 books.{col_name} 略過: {e}")

            # 若資料庫中殘留舊版 my_books 表，自動將書架與狀態資料搬遷至 books 表
            if "my_books" in inspector.get_table_names():
                try:
                    conn.execute(text("""
                        UPDATE books 
                        SET 
                            shelf_id = (SELECT shelf_id FROM my_books WHERE my_books.book_id = books.id LIMIT 1),
                            status = COALESCE((SELECT status FROM my_books WHERE my_books.book_id = books.id LIMIT 1), 'unread'),
                            notes = (SELECT notes FROM my_books WHERE my_books.book_id = books.id LIMIT 1),
                            rating = (SELECT rating FROM my_books WHERE my_books.book_id = books.id LIMIT 1),
                            purchase_date = (SELECT purchase_date FROM my_books WHERE my_books.book_id = books.id LIMIT 1),
                            purchase_price = (SELECT purchase_price FROM my_books WHERE my_books.book_id = books.id LIMIT 1),
                            purchase_place = (SELECT purchase_place FROM my_books WHERE my_books.book_id = books.id LIMIT 1),
                            condition = (SELECT condition FROM my_books WHERE my_books.book_id = books.id LIMIT 1)
                        WHERE EXISTS (SELECT 1 FROM my_books WHERE my_books.book_id = books.id)
                          AND (shelf_id IS NULL OR shelf_id = 0)
                    """))
                    print("[DB Migration] 成功將舊版 my_books 資料同步至 books")
                except Exception as e:
                    print(f"[DB Migration] 舊版 my_books 資料同步略過: {e}")
