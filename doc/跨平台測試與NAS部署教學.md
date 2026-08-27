# 📚 個人藏書庫：Windows 本機測試與 Synology NAS 部署完整教學

本教學分為兩大部分：
1. **Windows 平台本機快速建置與測試**（含一鍵建立資料庫）
2. **本機測試完成後，部署至 Synology NAS 並將資料灌入**

---

## 💻 第一部分：Windows 平台本機測試

### Q: Windows 上 `git clone` 下來後，資料庫裡面有資料嗎？
> **說明**：
> 為了保持 Git 倉庫乾淨與避免二進位檔衝突，SQLite 資料庫檔（`*.db`）預設被 `.gitignore` 忽略，因此剛 clone 下來時**不會自帶 `.db` 檔案**。  
> 但專案內已完整包含所有 404 筆書籍的 `material/個人圖書資料庫.csv`、全部歷史封面圖檔 `material/book_cover/`，以及自動化匯入腳本。**只需執行 1 個指令，就能在 1 秒內自動建好資料庫並灌入所有資料！**

---

### Windows 本機測試 4 步驟

#### 1. 複製專案庫
開啟 Windows Terminal 或 PowerShell：
```powershell
git clone https://github.com/gcboytw/book-storge.git
cd book-storge
```

#### 2. 安裝環境與依賴套件（使用 uv）
確保 Windows 已安裝 [uv](https://docs.astral.sh/uv/)（若未安裝，可在 PowerShell 執行 `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`）：
```powershell
uv sync
```

#### 3. 一鍵建立本地資料庫並灌入 404 本藏書
執行以下指令，系統會自動在根目錄建立 `local_dev.db` 並將 CSV 書目、分類書架與本地封面同步好：
```powershell
uv run scripts/import_legacy_csv.py
```
> **看到輸出**：`🎉 大功告成！新增書目: 371 筆、建立書架: 6 個...` 即代表本機資料庫已就緒。

#### 4. 啟動本機伺服器
```powershell
uv run uvicorn app.main:app --reload --port 8000
```
開啟瀏覽器前往：[http://localhost:8000](http://localhost:8000) 即可開始測試：
- 測試 50 本分頁與回到頁首功能
- 測試右上角深淺色切換
- 測試點擊右下角「✍️」輸入 ISBN `9786267156841` 查詢三民書局書目
- 測試點開書籍詳細視窗替換書封

---

## 🚀 第二部分：將系統與資料部署到 Synology NAS

當您在 Windows 上測試確認一切滿意後，可依下列步驟將專案與資料部署到 Synology NAS（群暉）。

---

### 方案 A：使用 Synology MariaDB 10（推薦，標準資料庫模式）

#### 步驟 1：在 Synology NAS 準備資料庫
1. 開啟 DSM ➔ 套件中心 ➔ 安裝 **MariaDB 10** 與 **phpMyAdmin**（或使用外部資料庫工具）。
2. 在 MariaDB 中新增一個資料庫，名稱設為 `book_storage`，編碼選擇 `utf8mb4_unicode_ci`。

#### 步驟 2：將專案上傳至 NAS
您可以透過以下任一方式將專案放上 NAS：
* **方式 1 (推薦)**：SSH 登入 NAS，直接在 Docker 目錄 clone：
  ```bash
  cd /volume1/docker
  git clone https://github.com/gcboytw/book-storge.git book-storage
  cd book-storage
  ```
* **方式 2**：透過 DSM「File Station」，在 `docker/` 資料夾下建立 `book-storage` 資料夾，並把專案檔案上傳進去。

#### 步驟 3：設定 NAS 環境變數 (`.env`)
在 NAS 的專案目錄下複製 `.env.example` 為 `.env`：
```bash
cp .env.example .env
```
編輯 `.env`（可透過 DSM 文字編輯器或 nano）：
```ini
# 改為 MariaDB 模式
DB_TYPE=mariadb
DB_HOST=192.168.1.xxx       # 填寫 NAS 的區域網路 IP
DB_PORT=3306
DB_USER=root               # 或您建立的專用帳號
DB_PASSWORD=your_password  # 資料庫密碼
DB_NAME=book_storage

APP_ENV=production
APP_PORT=8000
HOST=0.0.0.0
```

#### 步驟 4：啟動 Docker 容器
在專案目錄下透過 SSH 執行（或在 Synology **Container Manager** 中建立專案）：
```bash
docker-compose up -d --build
```

#### 步驟 5：將歷史資料一鍵灌入 NAS MariaDB
容器啟動後，只要執行以下指令，系統就會連線至 NAS MariaDB 自動建表並灌入 404 本書籍：
```bash
docker-compose exec app uv run scripts/import_legacy_csv.py
```
> 也可以直接透過網頁端或 API 觸發：對 `http://NAS_IP:8000/api/import/csv` 發送 POST 請求，即可自動完成匯入。

---

### 方案 B：使用 SQLite 輕量模式（免開 MariaDB）

如果您不想在 NAS 安裝與維護 MariaDB，也可以直接沿用 SQLite：

1. NAS 上的 `.env` 維持 `DB_TYPE=sqlite`。
2. 啟動容器：`docker-compose up -d --build`。
3. 執行資料灌入指令：
   ```bash
   docker-compose exec app uv run scripts/import_legacy_csv.py
   ```
   或者直接把 Windows 本機生成的 `local_dev.db` 與 `app/static/covers/` 資料夾直接複製貼到 NAS 的專案目錄中！

---

## 🌐 第三部分：手機隨身存取與同步建議

1. **區網內存取**：
   - 手機連上家中 Wi-Fi，用 Safari / Chrome 開啟 `http://NAS_IP:8000`。
   - 點擊瀏覽器的「**加入主畫面**（Add to Home Screen）」，就會變成一個全螢幕、無網址列的手機 App。
2. **外出存取（遠端連線）**：
   - 可在 Synology 控制台設定 **反向代理（Reverse Proxy）**，將外網域名（如 `https://books.yourname.synology.me`）指向本地 `http://localhost:8000`。
   - 或使用 **Tailscale** 虛擬區域網路，在外出時開 VPN 直接連回 NAS。

---

## 🛠️ 常用維護指令速查表

| 情境 | 指令 |
| :--- | :--- |
| **Windows 本機安裝依賴** | `uv sync` |
| **Windows 本機一鍵灌入資料** | `uv run scripts/import_legacy_csv.py` |
| **Windows 本機啟動測試** | `uv run uvicorn app.main:app --reload --port 8000` |
| **NAS 啟動容器** | `docker-compose up -d --build` |
| **NAS 停止容器** | `docker-compose down` |
| **NAS 容器內灌入資料** | `docker-compose exec app uv run scripts/import_legacy_csv.py` |
| **查看 NAS 容器即時日誌** | `docker-compose logs -f app` |
