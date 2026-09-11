# 個人藏書庫開發歷程與重大進度記錄 (Process Record)

> **歸檔空間**：記憶宮殿 `book_storge` / `documentation` (`doc/`)  
> **記錄日期**：2026-09-08 ~ 2026-09-09  
> **里程碑**：PWA 離線旗艦升級、雙向增量同步、方案 A 背景全量書封離線快取

---

## 📅 2026-09-08 ~ 2026-09-09 核心進度總覽

本日完成專案歷史上最大規模的架構升級，達成：
**「平日出門在外 100% 離線極速秒查、飛航模式全書封秒開、回到家區網一鍵手動雙向增量同步」**。

```text
[階段一] PWA 獨立 App 圖示與靜態快取升級 -------------- 100% 完成
[階段二] 介面同步面板 (Sync Modal) 與 SW 版號 Badge --- 100% 完成
[階段三] 純離線秒開 (Offline-First) 啟動生命週期 ------ 100% 完成
[階段四] 後端雙向增量同步 API (Push/Pull/LWW/Ping) ---- 100% 完成
[階段五] 前端 Outbox 離線異動隊列與手動雙向演算法 ----- 100% 完成
[方案 A] 背景全量預載書封 (Prefetch All Covers) ------- 100% 完成
```

---

## 一、 詳細階段實施內容

### 1. 階段一：PWA 獨立 App 視覺與圖示升級
- **品牌識別圖示**：將原先未對齊的圖示統一替換為專屬設計的 `/static/index-logo.png`。
- **Manifest 與 HTML Meta**：
  - 更新 `app/static/manifest.json`，支援 192x192 與 512x512 規格（含 `purpose: "any maskable"`）。
  - 更新 `app/static/index.html` 的 `apple-touch-icon` 與標籤列圖示，在 iPhone 與 Android 上均能以全螢幕原生 App 風格開啟。

### 2. 階段二：同步面板 UI 與 Service Worker 版號透明化
- **Header 版本徽章**：頂端標題旁新增 `#sw-version-badge`（顯示 `v8`），方便使用者點開檢查 Service Worker 快取版號。
- **手動同步面板 (`#sync-modal`)**：
  - 提供即時資訊：當前 SW 版號、本地 IndexedDB 藏書量、待同步上傳異動筆數、上次同步成功時間戳記、全量離線書封快取狀態。
  - 提供核心按鈕：「🔄 立即手動同步至 NAS」與「⚡ 檢查最新快取版本並重載」。

### 3. 階段三：純離線秒開 (Offline-First) 啟動生命週期
- **極速載入**：在 `app.js` 中實現 `initAppLifecycle()`。頁面開啟時優先自本地 IndexedDB 瞬間渲染（0ms 網路等待）。
- **戶外網路保護**：若本地已有藏書資料，絕不主動向 NAS 發送 fetch 請求，徹底消除戶外訊號不佳或未開 VPN 時的轉圈卡頓。
- **快取命中容錯**：在 `sw.js` 的 `caches.match` 加入 `{ ignoreSearch: true }`，防止帶有 `?v=X` 版號的腳本或圖片因 query string 導致快取未命中。

### 4. 階段四：後端雙向增量同步 API (FastAPI)
- **刪除紀錄追蹤表 (`DeletedRecord`)**：
  - 建立 `app/models/deleted_record.py`，當使用者從書架刪除書籍時自動登記 UUID 與刪除時間戳，解決單向同步無法追蹤已刪除資料的問題。
- **雙向同步端點**：
  - `POST /api/sync/up`：接收前端上傳的異動資料（新增、編輯、軟刪除），以「最後寫入者獲勝 (LWW)」策略安全合併至資料庫。
  - `GET /api/sync/down?last_sync_time=...`：依時間戳增量回傳 NAS 端的新增、更新書籍與已被刪除的 UUID 清單。
  - `GET /api/ping`：10ms 極速探測端點，供前端判斷當前是否連通家中 Wi-Fi 或 VPN。

### 5. 階段五：前端 Outbox 離線異動隊列
- **IndexedDB 升級至 Version 4**：
  - 資料儲存區以 `uuid` 作為唯一主鍵 (`keyPath: "uuid"`)。
  - 記錄內部同步狀態 `_sync_state` (`pending_create`, `pending_update`, `pending_delete`, `synced`)。
- **離線寫入支援**：在外斷網時依然能新增、編輯筆記或刪除藏書，變更會安全暫存於本地 IndexedDB，回到家一鍵上傳。

### 6. 方案 A：背景全量預載書封 (Prefetch All Covers)
- **問題背景**：使用者在手機 PWA 載入首頁第一頁後開飛航模式，翻到第 2 頁時看不到書封圖片，原因是瀏覽器原本採隨看隨載（Lazy Load），未翻到的頁面尚未將圖片抓入快取。
- **方案 A 落地解法**：
  1. 在 `db_offline.js` 實作 `prefetchCovers(onProgress)`，以每次 6 張圖片併發平滑預載所有書封至 Cache Storage。
  2. 在手動雙向同步成功後，自動於背景背景啟動預載，同步面板實時回報進度（例如：`⏳ 正在預載 120 / 373 張...` -> `✅ 100% 全量快取 (373 張)`）。
  3. 在 `sw.js` 對 `/static/covers/` 書封請求實作 **Cache First 策略**，飛航模式下秒開圖片。
  4. 經 `修改.md` 正式將方案 A 記錄為第 13 項並標記完成。

---

## 二、 踩坑與排查總結（重大經驗）

1. **0 本藏書事件**：
   - 成因：`.env` 誤設為 `SQLITE_DB_PATH=./local_dev.db`，未與 `docker-compose.yml` 的 `- ./data:/app/data` 對齊，導致容器在 ephemeral layer 建立了空白資料庫。
   - 解法：鐵律鎖定 `SQLITE_DB_PATH=./data/local_dev.db`，詳見 [0本藏書與資料庫路徑踩坑排查記錄.md](file:///c:/Users/gcboy/Documents/Google_Code/book-storge/doc/0%E6%9C%AC%E8%97%8F%E6%9B%B8%E8%88%87%E8%B3%87%E6%96%99%E5%BA%AB%E8%B7%AF%E5%BE%91%E8%B8%A9%E5%9D%91%E6%8E%92%E6%9F%A5%E8%A8%98%E9%8C%84.md)。
2. **語法錯誤防護**：
   - 曾因變數解構時殘留識別碼造成 `SyntaxError: Unexpected identifier 'targetUuid'`，已建立部署前以 `node -c` 逐一語法檢驗的機制，全數 0 錯誤通過。
3. **Docker 容器更新**：
   - 前端靜態檔案已被打包至 Docker 映像檔中，每次更新代碼後必須在 NAS 上執行 `sudo docker compose up -d --build` 才能保證生效。
