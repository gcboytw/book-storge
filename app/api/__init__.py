from fastapi import APIRouter
from app.api.books import router as books_router
from app.api.shelves import router as shelves_router
from app.api.sync import router as sync_router
from app.api.export import router as export_router

api_router = APIRouter()
api_router.include_router(books_router)
api_router.include_router(shelves_router)
api_router.include_router(sync_router)
api_router.include_router(export_router)

__all__ = ["api_router"]
