根據 [spec.md](file:///Users/mac4/Documents/google-code/book-storge/spec.md) 的規格與我們討論的「Mac 自由開發 + Synology 容器部署 + PWA 離線」架構，推薦建立一套**模組清晰、輕量且標準**的專案架構：

---

### 推薦檔案架構樹

```text
book-storge/
├── app/
│   ├── main.py               # FastAPI 啟動入口（掛載 API 路由與 PWA 靜態前端）
│   │
│   ├── core/                 # 核心設定
│   │   ├── config.py         # 讀取 .env（自動判斷 SQLite 或 MariaDB）
│   │   └── database.py       # SQLAlchemy 引擎與 Session 依賴注入
│   │
│   ├── models/               # SQLAlchemy 資料庫模型（對應 spec 2.1~2.5）
│   │   ├── book.py           # Book, Author, BookAuthor（全域書目）
│   │   ├── my_book.py        # MyBook（個人藏書、閱讀狀態、評分、筆記）
│   │   └── shelf.py          # Shelf（書架分類）
│   │
│   ├── schemas/              # Pydantic API 請求與回應資料格式驗證
│   │   ├── book.py           # 書目查詢/新增的 Schema
│   │   ├── my_book.py        # 藏書更新、篩選的 Schema
│   │   └── shelf.py          # 書架 CRUD Schema
│   │
│   ├── services/             # 核心商業邏輯模組
│   │   ├── book_lookup.py    # 書目解析鏈（直接封裝已驗證的 fetch_books_tw.py 邏輯）
│   │   └── csv_importer.py   # CSV 匯入服務（404 筆書目 + 373 張書封圖檔對應）
│   │
│   ├── api/                  # RESTful API 端點（對應 spec 第 5 節）
│   │   ├── books.py          # /api/books, /api/isbn/lookup
│   │   ├── my_books.py       # /api/my-books (收藏清單、修改狀態、筆記)
│   │   ├── shelves.py        # /api/shelves (書架列表、新增/排序)
│   │   └── sync.py           # /api/sync/dump (提供手機端 IndexedDB 離線初始化)
│   │
│   └── static/               # PWA 靜態前端資源（直接由 FastAPI 託管）
│       ├── index.html        # 單一 SPA 頁面（手機/平板/桌面自適應）
│       ├── css/
│       │   └── style.css     # 精美深淺色質感 UI
│       ├── js/
│       │   ├── app.js        # 主畫面渲染、切換分頁、書本卡片
│       │   ├── scanner.js    # 相機條碼掃描（原生 BarcodeDetector + fallback）
│       │   └── db_offline.js # 手機 IndexedDB 本地快取與 0 延遲離線搜尋
│       ├── covers/           # 本地書籍封面存放目錄（由 NAS 直接輸出圖片）
│       ├── manifest.json     # PWA 手機主畫面圖示與安裝設定
│       └── sw.js             # Service Worker 離線快取機制
│
├── scripts/                  # 工具腳本
│   └── import_legacy_csv.py  # 一鍵將「material/個人圖書資料庫.csv」灌入資料庫（支援 Windows / Mac）
│
├── material/                 # 原始素材備份
│   ├── 個人圖書資料庫.csv
│   └── book_cover/
│
├── .env.example              # 設定檔範本
├── .env                      # 本機開發 / NAS 連線設定（不進 git）
├── .gitattributes            # 強制換行符號為 LF（確保 Windows/Mac/Docker 容器相容）
├── pyproject.toml            # uv 套件管理
├── Dockerfile                # DS920+ 容器鏡像打包
└── docker-compose.yml        # DS920+ Container Manager 一鍵部署設定
```

---

### 這個架構的 4 大優勢

1. **單一容器完整搞定（All-in-One Container）**：
   * FastAPI 不只提供後端 API，還直接把 `app/static/` 當成 PWA 網站託管。
   * 不需要另外在 NAS 裝 Nginx 或 Web Station，DS920+ 只要跑這 1 個容器就包含「後端 + 前端 + 離線 PWA」。
2. **前後端不分家，除錯超快**：
   * 在 Mac 上輸入 `uv run uvicorn app.main:app --reload`，改 HTML、CSS 或 Python 存檔瞬間瀏覽器自動更新。
3. **商業邏輯與資料庫高度解耦**：
   * `book_lookup.py` 專注於 ISBN 外部抓取（直接承襲已測試成功的 `fetch_books_tw.py` 模組）。
   * `csv_importer.py` 專注於處理既有素材（使用 `pathlib.Path` 與 `utf-8` 編碼，跨 Windows/Mac 皆可順暢執行）。
   * `core/database.py` 負責一鍵切換 SQLite / MariaDB。
4. **跨平台無縫銜接（Mac 開發 ➔ Windows 部署）**：
   * 加入 `.gitattributes` 防止 Windows 自動將換行轉為 CRLF 影響 Docker 容器。
   * 使用 `uv` 抹平 Mac 與 Windows 虛擬環境指令差異。