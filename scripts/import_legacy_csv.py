#!/usr/bin/env python3
"""
一鍵匯入 Material 舊藏書資料庫腳本 (跨平台 Mac / Windows 相容)
執行指令: uv run scripts/import_legacy_csv.py
"""

import sys
from pathlib import Path

# 將專案根目錄加入 sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from app.core.config import settings
from app.core.database import SessionLocal, init_db
from app.services.csv_importer import CSVImporterService

def main():
    print("=" * 60)
    print(" 📚 個人藏書管理系統 - 舊資料庫一鍵匯入工具")
    print("=" * 60)
    print(f"[*] 目前資料庫模式: {settings.DB_TYPE.upper()}")
    if settings.DB_TYPE.lower() == "mariadb":
        print(f"[*] 連線目標: {settings.DB_USER}@{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}")
    else:
        print(f"[*] SQLite 檔案路徑: {settings.database_url}")

    # 1. 確保資料表已建立
    print("\n[1/3] 初始化資料表結構...")
    init_db()
    print("      ✓ 資料表檢查/建立完成")

    # 2. 執行匯入
    csv_file = settings.MATERIAL_DIR / "個人圖書資料庫.csv"
    print(f"\n[2/3] 正在讀取並解析 CSV: {csv_file.name} ...")
    
    db = SessionLocal()
    try:
        result = CSVImporterService.import_legacy_csv(db, csv_path=csv_file)
        
        print("\n[3/3] 匯入作業完成！統計結果：")
        print(f"      - 處理筆數: {result['total_processed']} 筆")
        print(f"      - 新增書目: {result['created_books']} 筆")
        print(f"      - 更新書目: {result['updated_books']} 筆")
        print(f"      - 建立書架: {result['created_shelves']} 個")
        print(f"      - 同步書封圖檔: {result['covers_mapped']} 個")
        print("\n🎉 大功告成！你可以啟動服務查看藏書清單：")
        print("   uv run uvicorn app.main:app --reload --port 8000\n")
    except Exception as e:
        print(f"\n❌ 匯入過程發生錯誤: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
