import io
import csv
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from sqlalchemy.orm import Session, joinedload
from app.core.config import settings
from app.models import Book, Shelf

class ExportService:
    @staticmethod
    def get_taipei_now_str() -> str:
        now = datetime.now(timezone(timedelta(hours=8)))
        return now.strftime("%Y%m%d_%H%M%S")

    @classmethod
    def generate_backup_zip(cls, db: Session) -> io.BytesIO:
        """
        將藏書資料匯出為 CSV，並連同所有使用的封面圖片打包為 ZIP 檔案。
        """
        # 1. 查詢所有藏書 (含關聯的 Shelf)
        books = (
            db.query(Book)
            .outerjoin(Book.shelf)
            .options(joinedload(Book.shelf))
            .order_by(Book.created_at.desc(), Book.id.desc())
            .all()
        )

        # 2. 準備 CSV 欄位
        csv_headers = [
            "UUID",
            "Title",
            "Subtitle",
            "Author",
            "Author (Last)",
            "Publisher",
            "Date Published",
            "Year Published",
            "Number of Pages",
            "ISBN",
            "ISBN10",
            "EAN",
            "書封",
            "分類",
            "所屬書架",
            "Summary",
            "備忘筆記",
            "加入時間",
            "最後更新"
        ]

        csv_buffer = io.StringIO()
        csv_buffer.write("\ufeff")
        writer = csv.writer(csv_buffer)
        writer.writerow(csv_headers)

        zip_buffer = io.BytesIO()
        added_cover_files: set[str] = set()

        with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for b in books:
                shelf_name = b.shelf.name if b.shelf else (b.category or "")
                
                # 處理書封路徑與圖檔打包
                cover_csv_value = ""
                if b.cover_url:
                    if b.cover_url.startswith("/static/covers/"):
                        filename = b.cover_url.replace("/static/covers/", "").strip()
                        cover_csv_value = f"book_cover/{filename}"

                        cover_path = settings.COVERS_DIR / filename
                        if not cover_path.exists():
                            cover_path = settings.MATERIAL_DIR / "book_cover" / filename

                        if cover_path.exists() and filename not in added_cover_files:
                            zip_file.write(cover_path, arcname=f"book_cover/{filename}")
                            added_cover_files.add(filename)
                    else:
                        cover_csv_value = b.cover_url

                created_str = b.created_at.strftime("%Y-%m-%d %H:%M:%S") if b.created_at else ""
                updated_str = b.updated_at.strftime("%Y-%m-%d %H:%M:%S") if b.updated_at else ""

                writer.writerow([
                    b.uuid or "",
                    b.title or "",
                    b.subtitle or "",
                    b.author_display or "",
                    b.author_last or "",
                    b.publisher or "",
                    b.publication_date or "",
                    b.publication_year or "",
                    b.pages or "",
                    b.isbn13 or "",
                    b.isbn10 or "",
                    b.ean or "",
                    cover_csv_value,
                    b.category or "",
                    shelf_name,
                    b.description or "",
                    b.notes or "",
                    created_str,
                    updated_str
                ])

            # 將 CSV 內容寫入 zip 根目錄
            csv_bytes = csv_buffer.getvalue().encode("utf-8-sig")
            zip_file.writestr("books_export.csv", csv_bytes)

        zip_buffer.seek(0)
        return zip_buffer
