# 📚 個人藏書庫 (Book Storage)

一個為繁體中文出版品量身打造的**跨裝置個人藏書管理與離線檢索 PWA 系統**。

支援「**Mac 本機自由開發 ➔ Synology NAS 容器部署 ➔ 手機 PWA 離線檢索**」工作流。無論是在家連線 NAS 整理書架，或是在書店現場無網路秒查「家裡是否買過」，都能輕鬆搞定。

---

## ✨ 核心特色

1. **三層 ISBN 智慧解析鏈**：手機條碼一掃，自動依序反查「三民書局 ➔ OpenLibrary ➔ Google Books」，繁中新書命中率極高，自動帶入封面、書名、作者與出版社。
2. **Local-First 離線檢索**：採用 PWA 與 IndexedDB 技術，連線時自動同步中央資料庫快照，離線在書店無網路時亦可 0 延遲全文搜尋個人藏書。
3. **資料庫雙模無縫切換**：
   - **在外開發**：使用 SQLite（免網路、零設定、隨處寫 code）。
   - **在家部署**：一鍵切換 Synology MariaDB 10（資料庫安全集中管理）。
4. **極簡全功能單一容器**：FastAPI 同時提供後端 RESTful API 並託管前端 PWA 靜態資源，DS920+ 僅需跑單一容器即可。
5. **舊平台無痛搬遷**：內建跨平台匯入工具，一鍵匯入既有 CSV 藏書清單並自動對應 370+ 張本機封面圖檔。

---

## 📂 專案檔案架構

```text
book-storge/
├── app/
│   ├── main.py               # FastAPI 啟動入口（API 路由與 PWA 靜態前端託管）
│   │
│   ├── core/                 # 核心設定
│   │   ├── config.py         # 讀取 .env（自動切換 SQLite / MariaDB）
│   │   └── database.py       # SQLAlchemy 連線引擎與 Session 依賴注入
│   │
│   ├── models/               # SQLAlchemy 資料庫模型
│   │   ├── book.py           # Book, Author, BookAuthor（全域書目）
│   │   ├── my_book.py        # MyBook（個人藏書、閱讀狀態、評分、心得）
│   │   └── shelf.py          # Shelf（書架分類）
│   │
│   ├── schemas/              # Pydantic 請求與回應資料格式驗證
│   │   ├── book.py           # 書目查詢 / 新增 Schema
│   │   ├── my_book.py        # 藏書更新 / 篩選 Schema
│   │   └── shelf.py          # 書架 CRUD Schema
│   │
│   ├── services/             # 核心商業邏輯模組
│   │   ├── book_lookup.py    # 三層 ISBN 外部書目解析鏈
│   │   └── csv_importer.py   # CSV 匯入服務（404 筆書目 + 書封對應）
│   │
│   ├── api/                  # RESTful API 端點
│   │   ├── books.py          # /api/isbn/lookup, /api/books
│   │   ├── my_books.py       # /api/my-books (收藏清單、閱讀狀態、筆記)
│   │   ├── shelves.py        # /api/shelves (書架列表、新增、編輯)
│   │   └── sync.py           # /api/sync/dump (提供 IndexedDB 離線快取初始化)
│   │
│   └── static/               # PWA 靜態前端資源
│       ├── index.html        # 單一 SPA 頁面（手機 / 平板 / 桌面自適應）
│       ├── css/
│       │   └── style.css     # 質感深淺色主題 UI
│       ├── js/
│       │   ├── app.js        # 主畫面渲染、搜尋、分類、卡片互動
│       │   ├── scanner.js    # 相機條碼掃描（原生 BarcodeDetector）
│       │   └── db_offline.js # 手機 IndexedDB 離線快取與本地檢索
│       ├── covers/           # 本地書籍封面圖片目錄
│       ├── manifest.json     # PWA 手機主畫面圖示與安裝設定
│       └── sw.js             # Service Worker 離線快取機制
│
├── scripts/                  # 工具腳本
│   └── import_legacy_csv.py  # 一鍵匯入舊 CSV 藏書工具
│
├── material/                 # 原始素材庫
│   ├── 個人圖書資料庫.csv       # 舊藏書資料
│   └── book_cover/           # 原始書籍封面圖檔
│
├── .env.example              # 設定檔範本
├── .env                      # 本機開發 / NAS 連線設定（不進版控）
├── .gitattributes            # 強制換行符號為 LF
├── pyproject.toml            # uv 套件管理設定
├── Dockerfile                # DS920+ 容器鏡像打包
└── docker-compose.yml        # DS920+ Container Manager 一鍵部署設定
```

---

## 🚀 快速上手指南（Mac 本機開發）

專案預設使用 **[uv](https://docs.astral.sh/uv/)** 作為 Python 環境與套件管理工具。

### 1. 安裝相依套件

在專案目錄下執行以下指令，`uv` 會自動建立虛擬環境並安裝所有依賴：

```bash
uv sync
```

### 2. 環境變數設定

複製範本建立 `.env`（預設已設為 SQLite 本機模式）：

```bash
cp .env.example .env
```

`.env` 預設內容：

```ini
DB_TYPE=sqlite
SQLITE_DB_PATH=./local_dev.db
APP_PORT=8000
```

### 3. 一鍵匯入既有藏書資料庫

執行匯入工具，將 `material/個人圖書資料庫.csv` 與封面圖檔寫入本地 SQLite：

```bash
uv run scripts/import_legacy_csv.py
```

### 4. 啟動本機開發伺服器

```bash
uv run uvicorn app.main:app --reload --port 8000
```

啟動後即可在瀏覽器打開：

- 📱 **Web App 首頁**：[http://localhost:8000](http://localhost:8000)
- 📑 **Swagger API 文件**：[http://localhost:8000/docs](http://localhost:8000/docs)
- 🩺 **健康檢查**：[http://localhost:8000/health](http://localhost:8000/health)

---

## 📲 手機 PWA 安裝與離線使用

1. **同 Wi-Fi 手機連線**：
   啟動伺服器時改用 `--host 0.0.0.0`：
   
   ```bash
   uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

2. 手機 Safari 打開 `http://<你的Mac或NAS的IP>:8000`。

3. 點擊瀏覽器下方的「**分享按鈕 ➔ 加入主畫面**」。

4. 之後出門無網路時，點擊主畫面圖示打開 App，即可在 IndexedDB 本地離線庫秒查所有藏書！

---

## 🐳 Synology DS920+ 容器部署

在家中 NAS 部署時，只需簡單兩步：

### 1. 修改 `.env` 連線 MariaDB 10

```ini
DB_TYPE=mariadb
DB_HOST=192.168.1.100       # NAS 的區網 IP
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=book_storage
```

### 2. 在 NAS 上啟動容器

將專案檔案放置於 NAS（例如 `/volume1/docker/book-storage`），在 Synology **Container Manager** 中建立專案，或透過 SSH 執行：

```bash
docker-compose up -d --build
```

---

## 🛠️ 常用指令速查

| 操作               | 指令                                                          |
|:---------------- |:----------------------------------------------------------- |
| **安裝 / 同步套件**    | `uv sync`                                                   |
| **新增 Python 套件** | `uv add <package_name>`                                     |
| **啟動熱重載伺服器**     | `uv run uvicorn app.main:app --reload --port 8000`          |
| **手機區網下測試**     | `uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000` |
| **匯入既有 CSV 書目**  | `uv run scripts/import_legacy_csv.py`                       |
| **測試單一 ISBN 爬取** | `uv run python fetch_books_tw.py 9789867848871`             |
