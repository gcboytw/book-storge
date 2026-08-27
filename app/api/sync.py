from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models import MyBook, Shelf
from app.services import CSVImporterService

router = APIRouter(prefix="/api", tags=["Sync & Maintenance"])

@router.get("/sync/dump")
def dump_all_data(db: Session = Depends(get_db)):
    """
    匯出所有藏書與書架資料，供手機端 IndexedDB 進行全量離線快取初始化
    """
    my_books = (
        db.query(MyBook)
        .options(joinedload(MyBook.book), joinedload(MyBook.shelf))
        .order_by(MyBook.created_at.desc(), MyBook.id.desc())
        .all()
    )
    shelves = db.query(Shelf).filter(Shelf.is_archived == False).all()

    items = []
    for mb in my_books:
        b = mb.book
        items.append({
            "my_book_id": mb.id,
            "book_id": mb.book_id,
            "title": b.title if b else "",
            "subtitle": b.subtitle if b else "",
            "author": b.author_display if b else "",
            "publisher": b.publisher if b else "",
            "publication_date": b.publication_date if b else "",
            "isbn13": b.isbn13 if b else "",
            "isbn10": b.isbn10 if b else "",
            "ean": b.ean if b else "",
            "cover_url": b.cover_url if b else "",
            "description": b.description if b else "",
            "category": b.category if b else "",
            "shelf_id": mb.shelf_id,
            "shelf_name": mb.shelf.name if mb.shelf else "未分類",
            "status": mb.status,
            "rating": mb.rating,
            "notes": mb.notes,
            "purchase_date": str(mb.purchase_date) if mb.purchase_date else None,
            "purchase_price": float(mb.purchase_price) if mb.purchase_price else None,
            "purchase_place": mb.purchase_place,
            "created_at": mb.created_at.isoformat() if mb.created_at else None,
            "updated_at": mb.updated_at.isoformat() if mb.updated_at else datetime.utcnow().isoformat()
        })

    return {
        "sync_version": int(datetime.utcnow().timestamp()),
        "generated_at": datetime.utcnow().isoformat(),
        "total_books": len(items),
        "shelves": [
            {"id": s.id, "name": s.name, "sort_order": s.sort_order}
            for s in shelves
        ],
        "books": items
    }

@router.post("/import/csv")
def trigger_csv_import(db: Session = Depends(get_db)):
    """手動觸發 legacy CSV 匯入"""
    result = CSVImporterService.import_legacy_csv(db)
    return {
        "status": "success",
        "result": result
    }
