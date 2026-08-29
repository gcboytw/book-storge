已---
created: 2026-08-24
updated: 2026-08-24
---

# 個人藏書管理 Web App 專案規格說明書

## 1. 專案目標與架構

建立供個人使用的跨裝置藏書管理 Web App，主要管理中文書籍，尤其以台灣出版品為核心。

**核心流程**：手機掃描 ISBN → 查詢本地書目 → 查不到時呼叫書目解析鏈（三民書局 / OpenLibrary / Google Books 降級查詢）→ 建立書目 → 加入個人收藏。
**多裝置共用與離線能力**：手機、平板、電腦透過家裡 Wi-Fi 連線至 Synology NAS（DS920+）的中央 Server；同時手機端具備 PWA 離線快取能力，出門在外無需連網亦可秒查個人藏書。

### 技術棧

- **前端**：HTML5、CSS、Vanilla JavaScript、PWA（Service Worker + IndexedDB 離線快照）。
- **後端**：Python + FastAPI。
- **套件與環境管理**：uv（`uv run`、`uv add`、`uv sync`）。
- **資料庫**：Synology DS920+ 現有 MariaDB 10。
- **ORM**：SQLAlchemy 2.x。
- **Schema 驗證**：Pydantic。
- **ISBN 掃描**：優先使用瀏覽器原生 `BarcodeDetector` API，不支援時降級使用 ZXing。
- **書目來源解析鏈**：
  1. 第一順位：三民書局 / 繁中出版品索引端點（全臺覆蓋率最高、即時完整、免 Key）。
  2. 第二順位：OpenLibrary API（全球開源、免 Key）。
  3. 第三順位：Google Books API（支援 `GOOGLE_BOOKS_API_KEY` 避免 429 限制）。
  4. 第四順位：使用者手動輸入。
- **部署環境**：Synology DS920+ Container Manager（Docker），純內網（LAN-Only）運行。

### 核心原則

1. **Web-first、Responsive-first**：以手機操作體驗為優先設計，並自適應平板與桌面螢幕。
2. **純內網安全（LAN-Only）**：NAS 不對外暴露 Port、無需開放公網，安全性 100%。
3. **Local-First 離線查書**：在家連線 Wi-Fi 時將藏書同步至手機 `IndexedDB`，出門在書店時可無網路秒查「是否已買過」。
4. **ISBN 為查詢鍵**：ISBN 作為全域書目資料的檢索鍵，與個人收藏狀態（已讀/想讀/書架）分離。
5. **書目查詢結果本地快取**：任何自外部取得的書目資料均快取至 NAS `books` 表，避免重複請求外部網站。
6. **第一版精準完成核心功能**：不引入過度複雜框架，保持程式碼輕量易維護。

---

## 2. 資料模型

### 2.1 `books`：全域書目資料（完全對齊 CSV 欄位）

- `id`: BIGINT PK, Auto-increment
- `isbn13`: VARCHAR(20), nullable, Indexed（ISBN 13 碼）
- `isbn10`: VARCHAR(20), nullable, Indexed（ISBN 10 碼）
- `ean`: VARCHAR(30), nullable, Indexed（EAN 商品/特刊條碼）
- `title`: VARCHAR(500), NOT NULL, Indexed（書名 Title）
- `subtitle`: VARCHAR(500), nullable（副書名 / 原文書名 Subtitle）
- `author_display`: VARCHAR(500), nullable（作者 Author）
- `author_last`: VARCHAR(255), nullable（外文作者排序姓名 Author (Last)）
- `publisher`: VARCHAR(255), nullable, Indexed（出版社 Publisher）
- `publication_date`: VARCHAR(50), nullable（出版日期 Date Published）
- `publication_year`: VARCHAR(10), nullable（出版年份 Year Published）
- `pages`: VARCHAR(50), nullable（頁數 Number of Pages）
- `description`: TEXT, nullable（大意簡介 Summary）
- `category`: VARCHAR(255), nullable（分類，對應書架/標籤）
- `cover_url`: VARCHAR(1000), nullable（書封圖檔路徑）
- `metadata_source`: VARCHAR(50)（例如 `CSV_Import`、`Sanmin_TW`、`Manual`）
- `created_at`, `updated_at`: DATETIME

### 2.2 `authors`：作者資料

- `id`: BIGINT PK, Auto-increment
- `name`: VARCHAR(255), NOT NULL
- `normalized_name`: VARCHAR(255), Indexed
- `created_at`, `updated_at`: DATETIME

### 2.3 `book_authors`：書籍作者關聯

- `book_id`: BIGINT FK (`books.id`)
- `author_id`: BIGINT FK (`authors.id`)
- `role`: VARCHAR(50)（作者、編者、譯者、繪者等）
- `sort_order`: INT, default 0

### 2.4 `my_books`：個人藏書收藏

- `id`: BIGINT PK, Auto-increment
- `book_id`: BIGINT FK (`books.id`), Indexed
- `status`: VARCHAR(30), default 'unread'（`unread` 未讀、`reading` 閱讀中、`read` 已讀、`abandoned` 棄讀）
- `shelf_id`: BIGINT FK (`shelves.id`), nullable, Indexed
- `purchase_date`: DATE, nullable
- `purchase_price`: DECIMAL(10, 2), nullable
- `purchase_place`: VARCHAR(255), nullable
- `condition`: VARCHAR(50), nullable（全新、良好、泛黃、損壞等）
- `rating`: INT, nullable（1–5 星）
- `notes`: TEXT, nullable（個人筆記/心得）
- `created_at`, `updated_at`: DATETIME

### 2.5 `shelves`：書架管理

- `id`: BIGINT PK, Auto-increment
- `name`: VARCHAR(100), NOT NULL
- `description`: TEXT, nullable
- `sort_order`: INT, default 0
- `is_archived`: BOOLEAN, default FALSE
- `created_at`, `updated_at`: DATETIME

### 2.6 `tags` 與 `my_book_tags`：個人自訂標籤（可選）

- `tags(id, name, color, created_at)`
- `my_book_tags(my_book_id, tag_id)`

---

## 3. ISBN 查詢與書目解析架構

### 查詢降級流程

```text
手機相機掃描 ISBN / 手動輸入
          ↓
ISBN 正規化（去除空格與破折號，校驗碼檢查）
          ↓
[1] 查詢 NAS 本地資料庫 (books.isbn13 / isbn10)
    ├── 找到 → 直接回傳書籍資料，供使用者確認加入收藏
    └── 找不到 ↓
[2] 呼叫後端書目解析鏈 (fetch_books_tw)
    ├── 順位 1: 三民書局 / 繁中出版品索引（99% 繁中新書即時命中）
    ├── 順位 2: OpenLibrary API（開源無限制）
    ├── 順位 3: Google Books API（備援）
    └── 均無結果 → 回傳 404，前端切換為「手動建立書目」
          ↓
取得書目資訊後，寫入 NAS books 表做本地快取
          ↓
使用者填寫閱讀狀態/書架，建立 my_books 收藏紀錄
```

---

## 4. 前端與 PWA 離線同步機制

### 4.1 雙模式運作原則

1. **線上模式（在家連 Wi-Fi）**：
   * 完整功能：相機條碼掃描、自動外部查詢、新增書籍、編輯書架、修改評分與筆記。
   * 自動同步：每次開啟 App 或完成編輯時，後端吐出最新藏書版本號，前端自動將最新清單增量寫入手機 `IndexedDB`。
2. **離線模式（出門在外 / 書店現場）**：
   * 讀取手機本地 `IndexedDB`：秒開書籍清單、支援關鍵字即時搜尋（書名、作者、ISBN、出版社）。
   * 介面標示「離線檢索模式」，使用者可隨時查驗家中是否已有此書，避免重複購書。

### 4.2 PWA 設定
* `manifest.json`：設定 App 名稱、圖示、`display: standalone`、主題色。
* `sw.js` (Service Worker)：快取 HTML、CSS、JS 靜態資源，確保無網路下頁面可秒開。

---

## 5. API 介面設計

### 5.1 書籍與 ISBN
* `POST /api/isbn/lookup`：輸入 `{"isbn": "..."}`，先查本地 DB，若無則啟動解析鏈抓取並回傳。
* `GET  /api/books/{id}`：取得特定書籍詳細出版資訊。
* `POST /api/books`：手動建立新書目。

### 5.2 我的收藏（My Books）
* `GET    /api/my-books`：取得個人收藏列表（支援狀態、書架、關鍵字篩選；支援 `updated_after` 增量同步）。
* `GET    /api/my-books/{id}`：取得特定收藏詳細（含筆記、價格、閱讀狀態）。
* `POST   /api/my-books`：加入收藏（關聯 `book_id`、指定書架、狀態）。
* `PATCH  /api/my-books/{id}`：更新閱讀狀態、評分、心得、書架。
* `DELETE /api/my-books/{id}`：移出收藏（保留 `books` 書目快取）。

### 5.3 書架（Shelves）
* `GET    /api/shelves`：取得所有書架與各書架藏書數量。
* `POST   /api/shelves`：新增書架。
* `PATCH  /api/shelves/{id}`：編輯書架名稱/排序/封存。
* `DELETE /api/shelves/{id}`：刪除書架。

### 5.4 系統與健康檢查
* `GET /health`：回傳 `{"status": "ok", "db": true}`。
* `GET /api/sync/dump`：匯出所有藏書資料供手機端離線 IndexedDB 全量初始化。
* `POST /api/import/csv`：匯入 Ragic / 舊平台書籍 CSV 檔案。

---

## 6. 舊資料庫匯入對應（material/個人圖書資料庫.csv）

針對已有的 404 筆既有藏書 CSV 資料，欄位自動對應映射規則如下：

| CSV 欄位名稱 | 範例 | 系統對應欄位 | 說明 |
| :--- | :--- | :--- | :--- |
| `Title` | 占星全書-增訂版 | `books.title` | 書籍名稱 |
| `Subtitle` | Tuesdays with Morrie | `books.subtitle` | 副書名 / 英文原名 |
| `Author` | 米奇．艾爾邦 | `books.author_display` | 作者顯示名稱 |
| `Author (Last` | Steinbeck, John | `authors.normalized_name` | 外文作者排序姓名 |
| `Publisher` | 大塊文化 | `books.publisher` | 出版社 |
| `Date Published` | 2016/04/09 | `books.publication_date` | 完整出版日期 |
| `Year Published` | 2016 | `books.publication_date` | 若無完整日期則以此補足 |
| `Summary` | 全臺70萬人... | `books.description` | 內容大意簡介 |
| `Number of Pages` | 464 | `books.pages` | 總頁數 |
| `ISBN` | 9789867848871 | `books.isbn13` / `isbn10` | 依長度分配為 ISBN13 或 ISBN10 |
| `EAN` | 4-717702-093280 | `books.ean` | 特刊/雜誌之 471 條碼 |
| `書封` | `https://ap13.ragic.com/...` | `books.cover_url` | 書封圖片網址 |
| `分類` | 謀殺專門店、阿嘉莎系列 | `shelves.name` / `tags` | 自動建立對應書架與標籤歸檔 |

---

## 7. 部署架構（Synology DS920+）

```text
[家中裝置]
iPhone / iPad / Mac
  │ (Wi-Fi 區網 http://192.168.x.x:8000)
  ▼
[Synology DS920+]
  ├── Container Manager (Docker)
  │     └── [book-storage 容器] (FastAPI + PWA 靜態前端)
  │              │
  │              ▼ (localhost:3306)
  └── Synology 原生 MariaDB 10 套件
```

* **安全策略**：
  * 純內網運行，路由器無須開對外 Port。
  * 資料庫帳密透過 `.env` 注入容器，不寫死於程式碼中。

---

## 7. 開發階段規劃

### Phase 1：專案基底與資料庫連線
* 初始化 FastAPI + SQLAlchemy 2.x + MariaDB 10 + Alembic。
* 設定 `.env`、`Dockerfile`、`docker-compose.yml`。
* 完成 `/health` 端點驗證。

### Phase 2：書目查詢模組整入
* 將驗證完成的 `fetch_books_tw.py` 封裝為後端服務 (`BookLookupService`)。
* 完成 `/api/isbn/lookup` 端點。

### Phase 3：收藏與書架 CRUD API
* 完成 `books`、`my_books`、`shelves` 之完整 RESTful API。

### Phase 4：Responsive 前端介面
* 首頁、書籍清單、書籍詳細頁、書架分頁。
* 手機相機條碼掃描（BarcodeDetector + fallback）。

### Phase 5：PWA 與 IndexedDB 離線庫
* 實作 Service Worker 快取前端檔案。
* 實作 IndexedDB 本地資料同步與離線搜尋功能。

### Phase 6：Synology DS920+ 容器部署驗收
* 於 Container Manager 部署容器並驗收 iPhone、Mac 跨裝置操作與離線功能。

### Phase 7：手機 App 離線優先與手動雙向同步架構 (Offline-First Two-Way Sync)
* **核心理念**：平時完全離線秒查、回到家按一個按鈕手動雙向同步。
* **技術規格**：
  * 全面使用 UUID 作為客戶端與伺服器端的唯一對齊識別碼，避免自增整數 ID 撞號。
  * 手機端維護本地離線資料庫（IndexedDB）與待同步隊列（Outbox Queue：新增、修改、軟刪除標記）。
  * 畫面提供「🔄 立即同步」按鈕，主動推送 Outbox 異動至 NAS，並拉取 NAS 增量更新（`updated_at > last_sync_time`）。
  * 衝突解決採「最後寫入者為準（Last-Write-Wins）」與「軟刪除（Soft Delete）」機制。

