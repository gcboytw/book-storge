from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.services.export_service import ExportService

router = APIRouter(prefix="/api/export", tags=["Export"])

@router.get("/zip", summary="匯出全站藏書 CSV 與封面圖檔 ZIP 壓縮包")
def export_books_zip(db: Session = Depends(get_db)):
    """
    將所有個人藏書匯出為 CSV 檔，連同書封圖檔一起打包成 ZIP 檔下載
    """
    timestamp = ExportService.get_taipei_now_str()
    filename = f"book_storage_backup_{timestamp}.zip"
    zip_buffer = ExportService.generate_backup_zip(db)

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Expose-Headers": "Content-Disposition"
    }

    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers=headers
    )
