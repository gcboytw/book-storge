import csv
import shutil
import urllib.parse
from pathlib import Path
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models import Book, Author, BookAuthor, Shelf, MyBook

class CSVImporterService:
    @staticmethod
    def clean_text(val: str | None) -> str | None:
        if val is None:
            return None
        cleaned = val.strip()
        return cleaned if cleaned else None

    @classmethod
    def sync_local_covers(cls, source_dir: Path, target_dir: Path) -> dict[str, str]:
        """
        複製本地封面圖檔至 static/covers 目錄，並建立 {識別碼/檔名: 靜態路徑} 的映射字典
        """
        target_dir.mkdir(parents=True, exist_ok=True)
        cover_map: dict[str, str] = {}

        if not source_dir.exists():
            return cover_map

        for file_path in source_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]:
                dest_path = target_dir / file_path.name
                if not dest_path.exists():
                    shutil.copy2(file_path, dest_path)
                
                web_path = f"/static/covers/{file_path.name}"
                # 記錄完整檔名
                cover_map[file_path.name] = web_path
                # 記錄以 ISBN/條碼開頭的 key
                prefix = file_path.name.split("-")[0].strip()
                if prefix:
                    cover_map[prefix] = web_path

        return cover_map

    @classmethod
    def import_legacy_csv(cls, db: Session, csv_path: Path | None = None) -> dict:
        """
        將「個人圖書資料庫.csv」404 筆書目匯入資料庫
        """
        if csv_path is None:
            csv_path = settings.MATERIAL_DIR / "個人圖書資料庫.csv"

        if not csv_path.exists():
            raise FileNotFoundError(f"找不到 CSV 檔案：{csv_path}")

        # 1. 預先同步封面圖檔
        cover_map = cls.sync_local_covers(
            source_dir=settings.MATERIAL_DIR / "book_cover",
            target_dir=settings.COVERS_DIR
        )

        # 2. 預載/建立現有書架
        shelves_cache: dict[str, Shelf] = {
            s.name: s for s in db.query(Shelf).all()
        }

        # 3. 讀取 CSV
        created_books = 0
        updated_books = 0
        created_shelves = 0

        with open(csv_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                title = cls.clean_text(row.get("Title"))
                if not title:
                    continue

                subtitle = cls.clean_text(row.get("Subtitle"))
                author = cls.clean_text(row.get("Author"))
                author_last = cls.clean_text(row.get("Author (Last"))
                publisher = cls.clean_text(row.get("Publisher"))
                date_published = cls.clean_text(row.get("Date Published"))
                year_published = cls.clean_text(row.get("Year Published"))
                summary = cls.clean_text(row.get("Summary"))
                pages = cls.clean_text(row.get("Number of Pages"))
                isbn_raw = cls.clean_text(row.get("ISBN"))
                ean_raw = cls.clean_text(row.get("EAN"))
                cover_raw = cls.clean_text(row.get("書封"))
                category = cls.clean_text(row.get("分類"))

                # 處理 ISBN
                isbn13 = None
                isbn10 = None
                if isbn_raw:
                    clean_isbn = "".join(c for c in isbn_raw if c.isdigit() or c.upper() == 'X')
                    if len(clean_isbn) == 13:
                        isbn13 = clean_isbn
                    elif len(clean_isbn) == 10:
                        isbn10 = clean_isbn
                    else:
                        isbn13 = clean_isbn

                ean = ean_raw

                # 尋找書封對應
                cover_url = cover_raw
                # 優先檢查本地圖檔
                if isbn13 and isbn13 in cover_map:
                    cover_url = cover_map[isbn13]
                elif isbn10 and isbn10 in cover_map:
                    cover_url = cover_map[isbn10]
                elif ean and ean.replace("-", "") in cover_map:
                    cover_url = cover_map[ean.replace("-", "")]
                elif cover_raw:
                    # 解析 Ragic 檔名以對應本地檔
                    # 例: https://ap13.ragic.com/sims/file.jsp?a=gcboytw&f=AsThaw5ggC%404717702093280.jpg
                    unquoted = urllib.parse.unquote(cover_raw)
                    if "@" in unquoted:
                        raw_filename = unquoted.split("@")[-1]
                        if raw_filename in cover_map:
                            cover_url = cover_map[raw_filename]

                # 建立或取得書架
                shelf_id = None
                if category:
                    if category not in shelves_cache:
                        new_shelf = Shelf(name=category, sort_order=len(shelves_cache) + 1)
                        db.add(new_shelf)
                        db.flush()
                        shelves_cache[category] = new_shelf
                        created_shelves += 1
                    shelf_id = shelves_cache[category].id

                # 檢查 Book 是否已存在（以 isbn13, isbn10, ean 或 title+author 判斷）
                existing_book = None
                if isbn13:
                    existing_book = db.query(Book).filter(Book.isbn13 == isbn13).first()
                if not existing_book and isbn10:
                    existing_book = db.query(Book).filter(Book.isbn10 == isbn10).first()
                if not existing_book and ean:
                    existing_book = db.query(Book).filter(Book.ean == ean).first()
                if not existing_book:
                    existing_book = db.query(Book).filter(
                        Book.title == title,
                        Book.author_display == author
                    ).first()

                if not existing_book:
                    book = Book(
                        isbn13=isbn13,
                        isbn10=isbn10,
                        ean=ean,
                        title=title,
                        subtitle=subtitle,
                        author_display=author,
                        author_last=author_last,
                        publisher=publisher,
                        publication_date=date_published or year_published,
                        publication_year=year_published,
                        pages=pages,
                        description=summary,
                        category=category,
                        cover_url=cover_url,
                        metadata_source="CSV_Import"
                    )
                    db.add(book)
                    db.flush()
                    created_books += 1
                else:
                    book = existing_book
                    # 更新可能補足的資料
                    if not book.cover_url and cover_url:
                        book.cover_url = cover_url
                    if not book.description and summary:
                        book.description = summary
                    updated_books += 1

                # 建立 MyBook 關聯
                existing_my_book = db.query(MyBook).filter(MyBook.book_id == book.id).first()
                if not existing_my_book:
                    my_book = MyBook(
                        book_id=book.id,
                        shelf_id=shelf_id,
                        status="unread"
                    )
                    db.add(my_book)

        db.commit()

        return {
            "total_processed": created_books + updated_books,
            "created_books": created_books,
            "updated_books": updated_books,
            "created_shelves": created_shelves,
            "covers_mapped": len(cover_map)
        }
