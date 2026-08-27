import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent

class Settings(BaseSettings):
    # 資料庫連線模式: "sqlite" 或 "mariadb"
    DB_TYPE: str = "sqlite"
    SQLITE_DB_PATH: str = "./local_dev.db"

    # MariaDB 連線參數
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "book_storage"

    # 外部 API
    GOOGLE_BOOKS_API_KEY: str | None = None

    # App 設定
    APP_ENV: str = "development"
    APP_PORT: int = 8000
    HOST: str = "0.0.0.0"

    # 目錄路徑設定
    STATIC_DIR: Path = BASE_DIR / "app" / "static"
    COVERS_DIR: Path = BASE_DIR / "app" / "static" / "covers"
    MATERIAL_DIR: Path = BASE_DIR / "material"

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def database_url(self) -> str:
        if self.DB_TYPE.lower() == "mariadb":
            # 使用 PyMySQL 連線 MariaDB 10
            return (
                f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}"
                f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
            )
        else:
            # 預設 SQLite 本機資料庫
            db_path = Path(self.SQLITE_DB_PATH)
            if not db_path.is_absolute():
                db_path = BASE_DIR / db_path
            return f"sqlite:///{db_path}"

settings = Settings()
