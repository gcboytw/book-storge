from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from app.core.database import get_db
from app.models import MyBook, Book, Shelf
from app.schemas import MyBookCreate, MyBookUpdate, MyBookResponse, BookCreate

router = APIRouter(prefix="/api/my-books", tags=["MyBooks"])

@router.get("", response_model=list[MyBookResponse])
def list_my_books(
    status: str | None = Query(None, description="篩選狀態: unread, reading, read, abandoned"),
    shelf_id: int | None = Query(None, description="篩選書架 ID"),
    q: str | None = Query(None, description="關鍵字搜尋 (書名、作者、ISBN、出版社)"),
    updated_after: datetime | None = Query(None, description="增量同步更新時間"),
    db: Session = Depends(get_db)
):
    """取得個人藏書清單"""
    query = (
        db.query(MyBook)
        .join(MyBook.book)
        .outerjoin(MyBook.shelf)
        .options(joinedload(MyBook.book), joinedload(MyBook.shelf))
    )

    if status:
        query = query.filter(MyBook.status == status)

    if shelf_id is not None:
        if shelf_id == 0:
            query = query.filter(MyBook.shelf_id == None)
        else:
            query = query.filter(MyBook.shelf_id == shelf_id)

    if updated_after:
        query = query.filter(
            or_(
                MyBook.updated_at >= updated_after,
                Book.updated_at >= updated_after
            )
        )

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
                MyBook.notes.ilike(search)
            )
        )

    return query.order_by(MyBook.created_at.desc(), MyBook.id.desc()).all()

@router.get("/{my_book_id}", response_model=MyBookResponse)
def get_my_book(my_book_id: int, db: Session = Depends(get_db)):
    """取得個人特定藏書詳細資料"""
    item = (
        db.query(MyBook)
        .options(joinedload(MyBook.book), joinedload(MyBook.shelf))
        .filter(MyBook.id == my_book_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")
    return item

@router.post("", response_model=MyBookResponse, status_code=status.HTTP_201_CREATED)
def add_to_my_books(payload: MyBookCreate, db: Session = Depends(get_db)):
    """加入個人藏書"""
    book = db.query(Book).filter(Book.id == payload.book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="指定書籍不存在")

    existing = db.query(MyBook).filter(MyBook.book_id == payload.book_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="這本書已經在你的藏書清單中囉！")

    new_item = MyBook(**payload.model_dump())
    db.add(new_item)
    db.commit()
    db.refresh(new_item)

    return (
        db.query(MyBook)
        .options(joinedload(MyBook.book), joinedload(MyBook.shelf))
        .filter(MyBook.id == new_item.id)
        .first()
    )

@router.patch("/{my_book_id}", response_model=MyBookResponse)
def update_my_book(my_book_id: int, payload: MyBookUpdate, db: Session = Depends(get_db)):
    """更新藏書狀態、評分、心得、書架"""
    item = db.query(MyBook).filter(MyBook.id == my_book_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)

    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)

    return (
        db.query(MyBook)
        .options(joinedload(MyBook.book), joinedload(MyBook.shelf))
        .filter(MyBook.id == item.id)
        .first()
    )

@router.delete("/{my_book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_book(my_book_id: int, db: Session = Depends(get_db)):
    """移出個人藏書（保留全域 books 資料）"""
    item = db.query(MyBook).filter(MyBook.id == my_book_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="藏書紀錄不存在")

    db.delete(item)
    db.commit()
    return None
