import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models import Book
from app.schemas import BookCreate, BookUpdate, BookResponse, ISBNLookupRequest
from app.services import BookLookupService

router = APIRouter(prefix="/api", tags=["Books"])

@router.post("/isbn/lookup")
def lookup_isbn(payload: ISBNLookupRequest, db: Session = Depends(get_db)):
    """
    ISBN 解析鏈端點：
    1. 先查本地 DB (books 表)
    2. 若找不到則啟動三民書局站內搜尋 / OpenLibrary / Google Books 降級解析
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

    # 2. 外部解析鏈查詢 (三民站內優先)
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
    """手動建立全域書目 (自動下載外部網路封面圖至伺服器存檔)"""
    # 檢查是否已存在相同的 ISBN
    if payload.isbn13:
        exist = db.query(Book).filter(Book.isbn13 == payload.isbn13).first()
        if exist:
            return exist

    data = payload.model_dump(exclude_unset=True)
    
    # 若封面是外部網路圖片，自動下載儲存至本地 static/covers/
    if data.get("cover_url") and data["cover_url"].startswith("http"):
        data["cover_url"] = BookLookupService.download_and_save_cover(
            data["cover_url"],
            payload.isbn13 or payload.isbn10 or str(uuid.uuid4())[:8]
        )

    if not data.get("uuid"):
        data["uuid"] = str(uuid.uuid4())

    new_book = Book(**data)
    db.add(new_book)
    db.commit()
    db.refresh(new_book)
    return new_book

@router.patch("/books/{book_id}", response_model=BookResponse)
def update_book(book_id: int, payload: BookUpdate, db: Session = Depends(get_db)):
    """更新書籍資訊（可替換封面網址，自動下載至伺服器）"""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="書籍不存在")

    update_data = payload.model_dump(exclude_unset=True)

    if "cover_url" in update_data and update_data["cover_url"]:
        if update_data["cover_url"].startswith("http"):
            update_data["cover_url"] = BookLookupService.download_and_save_cover(
                update_data["cover_url"],
                book.isbn13 or book.uuid or str(book.id)
            )

    for key, value in update_data.items():
        setattr(book, key, value)

    db.commit()
    db.refresh(book)
    return book

@router.post("/books/{book_id}/cover", response_model=BookResponse)
async def upload_book_cover(
    book_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """直接上傳本機圖檔替換書籍封面"""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="書籍不存在")

    # 確保副檔名
    ext = Path(file.filename or "").suffix.lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        ext = ".jpg"

    key = book.isbn13 or book.uuid or f"book_{book.id}"
    filename = f"{key}_{int(uuid.uuid4().hex[:6], 16)}{ext}"
    target_path = settings.COVERS_DIR / filename
    settings.COVERS_DIR.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    with open(target_path, "wb") as f:
        f.write(content)

    book.cover_url = f"/static/covers/{filename}"
    db.commit()
    db.refresh(book)
    return book
