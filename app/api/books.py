from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models import Book
from app.schemas import BookCreate, BookResponse, ISBNLookupRequest
from app.services import BookLookupService

router = APIRouter(prefix="/api", tags=["Books"])

@router.post("/isbn/lookup")
def lookup_isbn(payload: ISBNLookupRequest, db: Session = Depends(get_db)):
    """
    ISBN 解析鏈端點：
    1. 先查本地 DB (books 表)
    2. 若找不到則啟動三民書局 / OpenLibrary / Google Books 降級解析
    """
    clean_isbn = BookLookupService.clean_isbn(payload.isbn)
    if not clean_isbn:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ISBN 格式不正確"
        )

    # 1. 查本地資料庫
    existing = db.query(Book).filter(
        (Book.isbn13 == clean_isbn) | (Book.isbn10 == clean_isbn) | (Book.ean == clean_isbn)
    ).first()

    if existing:
        return {
            "found_in": "local_database",
            "book": BookResponse.model_validate(existing)
        }

    # 2. 外部解析鏈查詢
    external_data = BookLookupService.lookup(clean_isbn)
    if not external_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"查無 ISBN [{clean_isbn}] 之書目資訊，請手動建立"
        )

    return {
        "found_in": "external_lookup",
        "book": external_data
    }

@router.get("/books/{book_id}", response_model=BookResponse)
def get_book(book_id: int, db: Session = Depends(get_db)):
    """取得特定書籍詳細資訊"""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="書籍不存在")
    return book

@router.post("/books", response_model=BookResponse, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreate, db: Session = Depends(get_db)):
    """手動建立全域書目"""
    # 檢查是否已存在相同的 ISBN
    if payload.isbn13:
        exist = db.query(Book).filter(Book.isbn13 == payload.isbn13).first()
        if exist:
            return exist

    new_book = Book(**payload.model_dump())
    db.add(new_book)
    db.commit()
    db.refresh(new_book)
    return new_book
