from fastapi import APIRouter
from app.api.books import router as books_router
from app.api.my_books import router as my_books_router
from app.api.shelves import router as shelves_router
from app.api.sync import router as sync_router

api_router = APIRouter()
api_router.include_router(books_router)
api_router.include_router(my_books_router)
api_router.include_router(shelves_router)
api_router.include_router(sync_router)

__all__ = ["api_router"]
