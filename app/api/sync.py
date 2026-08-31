from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models import Book, Shelf
from app.services import CSVImporterService

def get_taipei_now_iso():
    return datetime.now(timezone(timedelta(hours=8))).isoformat()

router = APIRouter(prefix="/api", tags=["Sync & Maintenance"])

@router.get("/sync/dump")
def dump_all_data(db: Session = Depends(get_db)):
    """
    匯出所有藏書與書架資料 (含 UUID)，供手機端 IndexedDB 進行全量離線快取初始化
    """
    books = (
        db.query(Book)
        .outerjoin(Book.shelf)
        .options(joinedload(Book.shelf))
        .order_by(Book.created_at.desc(), Book.id.desc())
        .all()
    )
    shelves = db.query(Shelf).filter(Shelf.is_archived == False).all()

    items = []
    for b in books:
        items.append({
            "id": b.id,
            "uuid": b.uuid,
            "title": b.title,
            "subtitle": b.subtitle or "",
            "author": b.author_display or "",
            "publisher": b.publisher or "",
            "publication_date": b.publication_date or "",
            "isbn13": b.isbn13 or "",
            "isbn10": b.isbn10 or "",
            "ean": b.ean or "",
            "cover_url": b.cover_url or "",
            "description": b.description or "",
            "category": b.category or "",
            "shelf_id": b.shelf_id,
            "shelf_uuid": b.shelf.uuid if b.shelf else None,
            "shelf_name": b.shelf.name if b.shelf else "未分類",
            "status": b.status or "unread",
            "rating": b.rating,
            "notes": b.notes or "",
            "purchase_date": str(b.purchase_date) if b.purchase_date else None,
            "purchase_price": float(b.purchase_price) if b.purchase_price else None,
            "purchase_place": b.purchase_place or "",
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "updated_at": b.updated_at.isoformat() if b.updated_at else get_taipei_now_iso()
        })

    return {
        "sync_version": int(datetime.now(timezone(timedelta(hours=8))).timestamp()),
        "generated_at": get_taipei_now_iso(),
        "total_books": len(items),
        "shelves": [
            {"id": s.id, "uuid": s.uuid, "name": s.name, "sort_order": s.sort_order}
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
