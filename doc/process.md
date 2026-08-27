這是一個非常關鍵的好問題！

簡單直接的答案是：**在日常寫程式與開發階段，你完全「不需要」處在 NAS 的區網內，也不需要一直開著 NAS！**

---

### 最舒服的開發流程分兩大階段：

```text
【階段一：Mac 本機自由開發】（在咖啡廳、出差、客廳隨處可寫）
  ├── 本地執行 FastAPI + 測試用 SQLite（零設定、不需連 NAS）
  ├── 寫 UI、相機掃描條碼、ISBN 解析、PWA 離線快取
  └── 用瀏覽器打開 http://localhost:8000 即時看到畫面與修改
          │
          │ 功能都調校完成、確認滿意
          ▼
【階段二：切換至 Windows 匯入與部署至 NAS】（回家連上家裡 Wi-Fi）
  ├── 在 Windows 上透過 Git 拉取最新程式碼
  ├── 設定 .env 指向 NAS MariaDB 10
  ├── 執行匯入腳本：一鍵把 404 筆舊藏書灌入 NAS
  ├── 透過 SMB 將 373 張封面圖放入 NAS 的 covers 目錄
  └── 在 DS920+ Container Manager 啟動容器，手機加入主畫面收工！
```

---

### 為什麼開發時不用連 NAS？（架構上的巧妙設計）

我們後端使用 **SQLAlchemy ORM**，它具備「資料庫抽換能力」：

1. **在外開發時（Mac 本機）**：
   * `.env` 只要填 `DB_TYPE=sqlite`，它就會在專案目錄下自動生一個 `local_dev.db` 檔案。
   * 就算在完全沒網路的環境，你也能順順地測試新增書籍、刪除書架、測試相機掃描、調整手機版排版。
2. **在家部署時（Windows ➔ NAS）**：
   * 在 Windows 上的 `.env` 設定 `DB_TYPE=mariadb` 與 `DB_HOST=192.168.x.x`（NAS IP）。
   * 程式碼**一字不改**，自動無縫對接 NAS 的 MariaDB 10。

---

### 跨平台操作指南（Mac 開發 ➔ Windows 匯入部署）

1. **第一步（在 Mac 上開發）**：
   * 建立 FastAPI 骨架、SQLite 本機測試、PWA 離線網頁與條碼掃描鏡頭。
   * 以 `material/個人圖書資料庫.csv` 做本機 SQLite 模擬匯入驗證。
2. **第二步（在 Windows 上一鍵匯入 NAS）**：
   * 打開 Windows 終端機（PowerShell），執行：
     ```powershell
     uv run scripts/import_legacy_csv.py
     ```
   * 腳本內建 `utf-8` 強制編碼與 `pathlib.Path`，在 Windows 上絕不亂碼。
3. **第三步（複製書封圖檔）**：
   * Windows 檔案總管直接連線 NAS 網路資料夾（`\\192.168.x.x\docker\book-storage\covers`），把 `material/book_cover/` 內的圖檔複製過去。
4. **第四步（啟動 DS920+ 容器）**：
   * 在 Synology Container Manager 點擊「啟動專案」或執行 `docker-compose up -d`。
   * 手機連上家中 Wi-Fi，打開 `http://192.168.x.x:8000` 點「加到主畫面」，大功告成！