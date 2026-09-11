from typing import Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models import Book, Shelf, DeletedRecord
from app.schemas import SyncUpRequest, SyncUpResponse, SyncDownResponse
from app.services import CSVImporterService

def get_taipei_now_iso():
    return datetime.now(timezone(timedelta(hours=8))).isoformat()

def parse_iso_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        cleaned = dt_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is not None:
            taipei_tz = timezone(timedelta(hours=8))
            dt = dt.astimezone(taipei_tz).replace(tzinfo=None)
        return dt
    except Exception:
        return None

def serialize_book_for_sync(b: Book) -> dict:
    return {
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
    }

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

    items = [serialize_book_for_sync(b) for b in books]

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

@router.post("/sync/up", response_model=SyncUpResponse)
def sync_push_changes(payload: SyncUpRequest, db: Session = Depends(get_db)):
    """
    接收手機客戶端推送的離線增量異動 (Push)，採用 Last-Write-Wins (LWW) 規則覆蓋更新
    """
    processed = 0
    now_dt = datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)

    for item in payload.changes:
        if not item.uuid:
            continue

        action = (item.action or "").lower()
        client_dt = parse_iso_datetime(item.updated_at) or now_dt
        data = item.data or {}

        existing_book = db.query(Book).filter(Book.uuid == item.uuid).first()

        if action == "delete":
            if existing_book:
                db.add(DeletedRecord(uuid=existing_book.uuid, deleted_at=client_dt))
                db.delete(existing_book)
            else:
                db.add(DeletedRecord(uuid=item.uuid, deleted_at=client_dt))
            processed += 1

        elif action in ["create", "update"]:
            if existing_book:
                # Last-Write-Wins: 若手機端的更新時間晚於或等於資料庫紀錄，才覆蓋
                if existing_book.updated_at is None or client_dt >= existing_book.updated_at:
                    if "title" in data and data["title"]:
                        existing_book.title = data["title"]
                    if "subtitle" in data:
                        existing_book.subtitle = data["subtitle"]
                    if "author" in data or "author_display" in data:
                        existing_book.author_display = data.get("author") or data.get("author_display")
                    if "publisher" in data:
                        existing_book.publisher = data["publisher"]
                    if "publication_date" in data:
                        existing_book.publication_date = data["publication_date"]
                    if "isbn13" in data:
                        existing_book.isbn13 = data["isbn13"]
                    if "isbn10" in data:
                        existing_book.isbn10 = data["isbn10"]
                    if "ean" in data:
                        existing_book.ean = data["ean"]
                    if "cover_url" in data:
                        existing_book.cover_url = data["cover_url"]
                    if "description" in data:
                        existing_book.description = data["description"]
                    if "category" in data:
                        existing_book.category = data["category"]
                    if "status" in data:
                        existing_book.status = data["status"]
                    if "rating" in data:
                        existing_book.rating = data["rating"]
                    if "notes" in data:
                        existing_book.notes = data["notes"]
                    if "shelf_id" in data:
                        existing_book.shelf_id = data["shelf_id"]
                    existing_book.updated_at = client_dt
                processed += 1
            else:
                # 建立新紀錄
                new_book = Book(
                    uuid=item.uuid,
                    title=data.get("title", "未命名書籍"),
                    subtitle=data.get("subtitle", ""),
                    author_display=data.get("author") or data.get("author_display", ""),
                    publisher=data.get("publisher", ""),
                    publication_date=data.get("publication_date", ""),
                    isbn13=data.get("isbn13", ""),
                    isbn10=data.get("isbn10", ""),
                    ean=data.get("ean", ""),
                    cover_url=data.get("cover_url", ""),
                    description=data.get("description", ""),
                    category=data.get("category", ""),
                    shelf_id=data.get("shelf_id"),
                    status=data.get("status", "unread"),
                    rating=data.get("rating"),
                    notes=data.get("notes", ""),
                    created_at=parse_iso_datetime(data.get("created_at")) or client_dt,
                    updated_at=client_dt
                )
                db.add(new_book)
                processed += 1

    db.commit()

    return SyncUpResponse(
        status="success",
        processed_count=processed,
        server_time=get_taipei_now_iso()
    )

@router.get("/sync/down", response_model=SyncDownResponse)
def sync_pull_changes(last_sync_time: Optional[str] = Query(None), db: Session = Depends(get_db)):
    """
    下發自上次同步時間 (last_sync_time) 以來的增量更新與已刪除清單 (Pull)
    """
    since_dt = parse_iso_datetime(last_sync_time)

    query = db.query(Book).outerjoin(Book.shelf).options(joinedload(Book.shelf))
    if since_dt:
        query = query.filter(Book.updated_at > since_dt)

    updated_books = query.all()
    updates = [serialize_book_for_sync(b) for b in updated_books]

    deleted_uuids = []
    if since_dt:
        del_records = db.query(DeletedRecord).filter(DeletedRecord.deleted_at > since_dt).all()
        deleted_uuids = [r.uuid for r in del_records]

    return SyncDownResponse(
        server_time=get_taipei_now_iso(),
        updates=updates,
        deleted_uuids=deleted_uuids,
        total_updates=len(updates),
        total_deleted=len(deleted_uuids)
    )

@router.post("/import/csv")
def trigger_csv_import(db: Session = Depends(get_db)):
    """手動觸發 legacy CSV 匯入"""
    result = CSVImporterService.import_legacy_csv(db)
    return {
        "status": "success",
        "result": result
    }
