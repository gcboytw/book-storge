# Synology Docker 更新維護指南：何時 Build？何時 Restart？

本文檔詳細說明藏書管理系統（Book Storage）在 Synology NAS 的 Docker 環境下，修改程式碼或檔案後，**何時需要重新建置（Build）**、**何時只需重新啟動（Restart）**、以及**何時完全不需重啟（即時生效）**的完整判斷準則與操作流程。

---

## 🧭 一張表秒懂更新規則

判斷的核心黃金準則：**「看修改的檔案有沒有在 `docker-compose.yml` 的 `volumes`（磁碟掛載）清單中」**。

| 修改的內容與檔案路徑                                                                      | 是否需要 Build？                                      | 是否需要 Restart？                                | 處理方式與原因                                                                   |
|:------------------------------------------------------------------------------- |:------------------------------------------------:|:--------------------------------------------:|:------------------------------------------------------------------------- |
| **Python 後端程式碼**<br>(`app/api/`, `app/services/`, `app/core/`, `app/models/` 等) | **✅ 必須 Build**<br>`docker compose up -d --build` | 自動重啟                                         | **程式碼被封裝在 Image 內部**。<br>修改 NAS 資料夾檔案，容器內部並不會自動同步，必須透過重新 Build 把新代碼寫入映像檔。 |
| **前端靜態檔案**<br>(`app/static/js/app.js`, `index.html`, `style.css`)               | **✅ 必須 Build**<br>`docker compose up -d --build` | 自動重啟                                         | 前端代碼亦在 Image 內。<br>Build 完後瀏覽器通常需要按 `Ctrl + F5`（清除快取）才看得到新畫面。             |
| **套件依賴清單**<br>(`pyproject.toml`, `uv.lock`, `Dockerfile`)                       | **✅ 必須 Build**<br>`docker compose up -d --build` | 自動重啟                                         | 新增或移除 Python 套件時，Docker 需要在建置階段執行 `uv sync` 下載安裝。                         |
| **環境變數設定檔**<br>(NAS 專案目錄下的 `.env`)                                              | ❌ 不需要 Build                                      | **✅ 需要 Restart**<br>`docker compose restart` | 容器在啟動時會讀取 `.env`。<br>只要重啟容器，新的環境變數就會立即載入生效。                               |
| **書架封面圖檔**<br>(`app/static/covers/*.jpg`)                                       | ❌ 不需要 Build                                      | ❌ 不需要 Restart<br>**(即時生效)**                  | **有設定 Volume 掛載**（`./app/static/covers`）。<br>硬碟檔案直接穿透進入容器，放進去後網頁重新整理立即可讀。 |
| **SQLite 資料庫檔案**<br>(`data/local_dev.db`)                                       | ❌ 不需要 Build                                      | ❌ 不需要 Restart<br>**(即時生效)**                  | **有設定 Volume 掛載**（`./data`）。<br>資料庫即時在 NAS 磁碟寫入，不受容器生命週期影響。               |

---

## 💡 生活化比喻：為什麼有這種差別？

在 Docker 的世界裡，可以想像成**「預鑄屋」**與**「活動家具」**的差別：

```text
┌───────────────────────────────────────────────┐
│ Docker 容器內部環境                            │
│                                               │
│  [映像檔層 Image Layer - 預鑄牆體]             │
│   ├── app/ (Python 原始碼)                     │ ──> 必須拆掉重新灌漿打包
│   ├── app/static/ (HTML/JS/CSS)               │     (docker compose up -d --build)
│   └── 系統與 uv Python 套件庫                  │
│                                               │
│  [掛載層 Volume Layer - 對外窗戶/家具]          │
│   ├── /app/app/static/covers <══> NAS 磁碟 covers │ ──> 直接抽換，即時生效
│   └── /app/data <═══════════════> NAS 磁碟 data   │     (完全不需動容器)
└───────────────────────────────────────────────┘
```

1. **映像檔層（Image）**：就像當初蓋房子時灌進水泥裡的電線管路。如果設計圖改了（改了 Python 或 JS 代碼），你不能只在外面晃晃，必須「重新灌漿開模（Build）」，新房子裡才會有新線路。
2. **掛載層（Volumes）**：就像開給外面 NAS 磁碟的對外窗口。書封圖片與 SQLite 資料庫放在這裡，你從外面直接抽換，容器裡面看出去瞬間就變了。

---

## 🛠️ 三種情境的常用操作指令

### 情境一：修改了程式碼（最常遇到）

上傳了修改後的 `.py`、`.js`、`.html` 到 NAS 後：

```bash
# 進到 NAS 專案目錄
cd /volume2/docker/book-storge

# 重新建置並在背景啟動（自動無縫熱切換）
sudo docker compose up -d --build
```

> 💡 提示：`docker compose up -d --build` 會一邊讓舊容器繼續跑、一邊背景打包，打包成功才瞬間切換，不會讓服務中斷太久。

#### 🖥️ 若使用 Synology Container Manager 圖形介面（GUI）：

1. 點選左側選單的 **「專案 (Project)」**（⚠️ 請勿選「容器」！）。
2. 勾選你的專案（例如 `book-storage` 或 `book-storge`）。
3. 點選上方 **「動作」** ➔ 選擇 **「建立」**（Synology 官方繁體中文將英文「Build」翻譯為「建立」）。
4. 等待背景打包建置完成後，再次點選 **「動作」** ➔ **「啟動」**。
   
   > ⚠️ **嚴正警告**：切勿在「容器」頁面點選「重置（Reset）」！「重置」只會清空容器內部暫存層並以舊映像檔重啟，**絕對不會重新執行 Dockerfile 打包**，代碼依然會是舊的。

---

### 🗄️ 資料庫綱要遷移經驗（Schema Migration Gotcha）

* **問題現象**：重構資料庫模型（例如將 `my_books` 合併至 `books` 新增 `shelf_id` 欄位）後，重新 Build 容器啟動，頁面顯示「共 0 本藏書 ⬆️ 回到頁首」，後台報錯：`sqlalchemy.exc.OperationalError: no such column: books.shelf_id`。
* **原因**：SQLAlchemy 的 `Base.metadata.create_all()` 僅在資料表不存在時建立表格，對於既有資料表**不會自動執行 ALTER TABLE 新增欄位**。
* **根治方案**：在 `app/core/database.py` 的 `init_db()` 中引入 `_migrate_schema()` 機制，在開機時自動檢查 `PRAGMA table_info` / `inspect(engine)`，若缺少 `shelf_id`、`status`、`notes` 等欄位，自動透過 `ALTER TABLE` 補齊，並將舊版 `my_books` 的關聯資料平滑遷移進 `books`，實現全自動自我修復。

### 情境二：修改了 `.env` 設定（例如改連接埠或資料庫模式）

修改完 NAS 上的 `.env` 後，不需要浪費時間重新 build：

```bash
# 重啟容器讀取新變數
sudo docker compose restart
```

或：

```bash
# 讓 Compose 重新套用設定
sudo docker compose up -d
```

---

### 情境三：極速除錯小技巧（免 Build 的熱替換）

如果你只是改了 1~2 行程式碼想快速測試，不想每次等 10 秒重新 build 映像檔：

你可以使用 `docker cp` 將 NAS 上的檔案**直接塞進運行中的容器內**，然後只要重啟：

```bash
# 直接複製進容器
sudo docker cp ./app/api/books.py book-storage:/app/app/api/books.py

# 只要 1 秒重啟
sudo docker compose restart
```

*(注意：此方法適用臨時除錯，若日後下 `--build` 指令，依然會以 NAS 目錄中的正式檔案為主)*

---

## 🚀 未來進階選項：讓程式碼也「免 Build 熱更新」？

如果你希望以後修改 Python 程式碼**完全不用 Rebuild**，只要存檔就生效：
可以在 `docker-compose.yml` 的 `volumes` 加入程式碼掛載：

```yaml
    volumes:
      - ./app/static/covers:/app/app/static/covers
      - ./data:/app/data
      # 新增這行：將整個 app 程式碼目錄也做穿透掛載
      - ./app:/app/app
```

只要加上這行映射，未來你上傳 Python 檔案到 NAS 後，就**完全不用 Build**，只要 `docker compose restart`（甚至搭 uvicorn `--reload` 存檔就秒生效）！
