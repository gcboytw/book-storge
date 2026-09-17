from typing import Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from app.core.database import get_db
from app.models import Book, Shelf, DeletedRecord
from app.schemas import SyncUpRequest, SyncUpResponse, SyncDownResponse
from app.services import CSVImporterService, BookLookupService

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

def try_enrich_book(book: Book, raw_isbn: Optional[str] = None):
    """
    若書籍處於待補全狀態（書名為 [待補全]、未命名書籍或缺少封面/作者），
    且具備有效 ISBN，自動調用外部爬蟲鏈（三民/Google/OpenLibrary）補全資料並下載封面。
    """
    isbn_to_lookup = raw_isbn or book.isbn13 or book.isbn10 or book.ean
    if not isbn_to_lookup:
        return

    # 判斷是否需要補全
    needs_enrichment = (
        not book.title
        or book.title.startswith("[待補全]")
        or book.title.startswith("ISBN:")
        or book.title == "未命名書籍"
        or not book.cover_url
        or not book.author_display
    )

    if not needs_enrichment:
        return

    clean_isbn = BookLookupService.clean_isbn(isbn_to_lookup)
    if not clean_isbn:
        return

    try:
        print(f"[SyncAutoEnrich] 正在背景為離線入庫書籍 [{clean_isbn}] 查詢三民/外部書目資料...")
        external_data = BookLookupService.lookup(clean_isbn)
        if external_data:
            if external_data.get("title"):
                book.title = external_data["title"]
            if external_data.get("author_display"):
                book.author_display = external_data["author_display"]
            if external_data.get("publisher"):
                book.publisher = external_data["publisher"]
            if external_data.get("publication_date"):
                book.publication_date = external_data["publication_date"]
            if external_data.get("description"):
                book.description = external_data["description"]
            if external_data.get("category"):
                book.category = external_data["category"]
            if external_data.get("cover_url"):
                if external_data["cover_url"].startswith("http"):
                    local_cover = BookLookupService.download_and_save_cover(
                        external_data["cover_url"], clean_isbn
                    )
                    book.cover_url = local_cover
                else:
                    book.cover_url = external_data["cover_url"]
            # 更新時間以確保 pull (down) 時會被當作最新異動拉回手機
            book.updated_at = datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)
            print(f"[SyncAutoEnrich] ✅ 已成功補全書籍 [{clean_isbn}]：《{book.title}》")
    except Exception as enrich_err:
        print(f"[SyncAutoEnrich] ⚠️ 補全書籍 [{clean_isbn}] 過程異常: {enrich_err}")

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
        "shelf_name": b.shelf.name if b.shelf else None,
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
                cover_to_delete = existing_book.cover_url
                db.add(DeletedRecord(uuid=existing_book.uuid, deleted_at=client_dt))
                db.delete(existing_book)
                # 若該書籍具有本地封面檔案，且資料庫無其他書籍共用該檔案，清理實體檔案
                if cover_to_delete:
                    other_using = db.query(Book).filter(Book.cover_url == cover_to_delete, Book.uuid != existing_book.uuid).first()
                    if not other_using:
                        BookLookupService.delete_cover_file(cover_to_delete)
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
                        new_cover = data["cover_url"]
                        if new_cover and new_cover.startswith("http"):
                            new_cover = BookLookupService.download_and_save_cover(
                                new_cover,
                                data.get("isbn13") or data.get("isbn10") or existing_book.isbn13 or existing_book.isbn10 or existing_book.uuid
                            )
                        if existing_book.cover_url and existing_book.cover_url != new_cover:
                            old_cover = existing_book.cover_url
                            other_using_old = db.query(Book).filter(Book.cover_url == old_cover, Book.uuid != existing_book.uuid).first()
                            if not other_using_old:
                                BookLookupService.delete_cover_file(old_cover)
                        existing_book.cover_url = new_cover
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
                try_enrich_book(existing_book, data.get("isbn13") or data.get("isbn10"))
                processed += 1
            else:
                # 檢查是否已存在相同 ISBN (避免離線重複新增產生雙胞胎)
                isbn_candidate = data.get("isbn13") or data.get("isbn10") or data.get("ean")
                clean_isbn_val = BookLookupService.clean_isbn(isbn_candidate) if isbn_candidate else None
                dup_book = None
                if clean_isbn_val:
                    dup_book = db.query(Book).filter(
                        (Book.isbn13 == clean_isbn_val) |
                        (Book.isbn10 == clean_isbn_val) |
                        (Book.ean == clean_isbn_val)
                    ).first()

                if dup_book:
                    # 資料庫已有此書，智慧合併欄位，避免重複建立第二本
                    if data.get("notes") and not dup_book.notes:
                        dup_book.notes = data["notes"]
                    if data.get("shelf_id") and not dup_book.shelf_id:
                        dup_book.shelf_id = data["shelf_id"]
                    dup_book.updated_at = client_dt
                    processed += 1
                else:
                    # 建立新紀錄，若封面為遠端網址則自動下載落地
                    cover_url = data.get("cover_url", "")
                    if cover_url and cover_url.startswith("http"):
                        cover_url = BookLookupService.download_and_save_cover(
                            cover_url,
                            clean_isbn_val or item.uuid
                        )

                    new_book = Book(
                        uuid=item.uuid,
                        title=data.get("title", "未命名書籍"),
                        subtitle=data.get("subtitle", ""),
                        author_display=data.get("author") or data.get("author_display", ""),
                        publisher=data.get("publisher", ""),
                        publication_date=data.get("publication_date", ""),
                        isbn13=clean_isbn_val if (clean_isbn_val and len(clean_isbn_val) == 13) else (data.get("isbn13") or ""),
                        isbn10=clean_isbn_val if (clean_isbn_val and len(clean_isbn_val) == 10) else (data.get("isbn10") or ""),
                        ean=data.get("ean", ""),
                        cover_url=cover_url,
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
                    try_enrich_book(new_book, clean_isbn_val or data.get("isbn13") or data.get("isbn10"))
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
