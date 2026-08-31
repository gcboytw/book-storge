import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from app.core.config import settings
from app.core.database import get_db
from app.models import Book, Shelf
from app.schemas import BookCreate, BookUpdate, BookResponse, ISBNLookupRequest
from app.services import BookLookupService

def get_taipei_now():
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)

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
    existing = db.query(Book).options(joinedload(Book.shelf)).filter(
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

@router.get("/books", response_model=list[BookResponse])
def list_books(
    status_filter: str | None = Query(None, alias="status", description="篩選狀態"),
    shelf_id: int | None = Query(None, description="篩選書架 ID (0 表示未分類)"),
    q: str | None = Query(None, description="關鍵字搜尋 (書名、作者、ISBN、出版社、筆記)"),
    updated_after: datetime | None = Query(None, description="增量同步更新時間"),
    db: Session = Depends(get_db)
):
    """取得藏書清單 (依建立時間新->舊排序)"""
    query = db.query(Book).outerjoin(Book.shelf).options(joinedload(Book.shelf))

    if status_filter:
        query = query.filter(Book.status == status_filter)

    if shelf_id is not None:
        if shelf_id == 0:
            query = query.filter(Book.shelf_id == None)
        else:
            query = query.filter(Book.shelf_id == shelf_id)

    if updated_after:
        query = query.filter(Book.updated_at >= updated_after)

    if q:
        search = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Book.title.ilike(search),
                Book.subtitle.ilike(search),
                Book.author_display.ilike(search),
                Book.publisher.ilike(search),
                Book.isbn13.ilike(search),
                Book.isbn10.ilike(search),
                Book.ean.ilike(search),
                Book.notes.ilike(search)
            )
        )

    return query.order_by(Book.created_at.desc(), Book.id.desc()).all()

@router.get("/books/{book_id}", response_model=BookResponse)
def get_book(book_id: int, db: Session = Depends(get_db)):
    """取得特定藏書詳細資訊"""
    book = db.query(Book).options(joinedload(Book.shelf)).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")
    return book

@router.post("/books", response_model=BookResponse, status_code=status.HTTP_201_CREATED)
def create_book(payload: BookCreate, db: Session = Depends(get_db)):
    """新增藏書 (若封面為外部網路圖片自動下載至伺服器存檔)"""
    # 檢查是否已存在相同的 ISBN
    if payload.isbn13:
        exist = db.query(Book).filter(Book.isbn13 == payload.isbn13).first()
        if exist:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ISBN [{payload.isbn13}] 的書籍已存在於藏書清單中囉！"
            )

    data = payload.model_dump(exclude_unset=True)

    # 外部網路封面自動下載
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

    return db.query(Book).options(joinedload(Book.shelf)).filter(Book.id == new_book.id).first()

@router.patch("/books/{book_id}", response_model=BookResponse)
def update_book(book_id: int, payload: BookUpdate, db: Session = Depends(get_db)):
    """更新藏書資料、心得筆記、書架或替換封面"""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")

    old_cover = book.cover_url
    update_data = payload.model_dump(exclude_unset=True)

    if "cover_url" in update_data and update_data["cover_url"]:
        if update_data["cover_url"].startswith("http"):
            update_data["cover_url"] = BookLookupService.download_and_save_cover(
                update_data["cover_url"],
                book.isbn13 or book.uuid or str(book.id)
            )

    for key, value in update_data.items():
        setattr(book, key, value)

    book.updated_at = get_taipei_now()
    db.commit()
    db.refresh(book)

    # 若舊書封圖檔已更換且不再使用，清理舊實體檔案
    if old_cover and old_cover != book.cover_url:
        other_using_old = db.query(Book).filter(Book.cover_url == old_cover).first()
        if not other_using_old:
            BookLookupService.delete_cover_file(old_cover)

    return db.query(Book).options(joinedload(Book.shelf)).filter(Book.id == book.id).first()

@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int, db: Session = Depends(get_db)):
    """移出個人藏書並自動清理本機書封檔案"""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")

    cover_url = book.cover_url
    db.delete(book)
    db.commit()

    # 清理本地書封
    if cover_url:
        other_using = db.query(Book).filter(Book.cover_url == cover_url).first()
        if not other_using:
            BookLookupService.delete_cover_file(cover_url)

    return None

@router.post("/books/{book_id}/cover", response_model=BookResponse)
async def upload_book_cover(
    book_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """直接上傳本機圖檔替換書籍封面"""
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")

    old_cover = book.cover_url

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
    book.updated_at = get_taipei_now()
    db.commit()
    db.refresh(book)

    if old_cover and old_cover != book.cover_url:
        other_using_old = db.query(Book).filter(Book.cover_url == old_cover).first()
        if not other_using_old:
            BookLookupService.delete_cover_file(old_cover)

    return db.query(Book).options(joinedload(Book.shelf)).filter(Book.id == book.id).first()
