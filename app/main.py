import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text
from app.core.config import settings
from app.core.database import init_db, engine
from app.api import api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 啟動時自動初始化資料表與靜態目錄
    init_db()
    settings.COVERS_DIR.mkdir(parents=True, exist_ok=True)
    yield

app = FastAPI(
    title="個人藏書管理系統 (Book Storage)",
    version="1.0.0",
    description="跨裝置個人藏書管理與離線 PWA 系統",
    lifespan=lifespan
)

# 掛載 API 路由
app.include_router(api_router)

# 健康檢查端點
@app.get("/health", tags=["Health"])
def health_check():
    db_ok = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            db_ok = True
    except Exception as e:
        db_ok = False

    return {
        "status": "ok" if db_ok else "error",
        "db": db_ok,
        "db_type": settings.DB_TYPE,
        "app_env": settings.APP_ENV
    }

# 掛載靜態資源 (PWA 前端 + 本地書封圖檔)
if settings.STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(settings.STATIC_DIR)), name="static")

@app.get("/")
def serve_index():
    """首頁託管 PWA SPA"""
    index_path = settings.STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "Book Storage API running. Please place static files in app/static."}
