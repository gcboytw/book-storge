# Synology Docker 環境下書封圖片刪除失敗之原因分析與排查指南

本文檔記錄了藏書管理系統（Book Storage）在部署於 Synology NAS 的 Docker (Container Manager) 環境時，當使用者執行「刪除藏書 / 移出收藏」操作，資料庫紀錄已成功刪除但本地書封實體檔案（`app/static/covers/`）未被刪除的原因分析與排查說明。

---

## 🔍 問題現象

在前端點選「移出藏書」後，書籍資料已從資料庫順利刪除，但對應的封面圖檔依然殘留在 NAS 的實體磁碟目錄中，佔用儲存空間。

---

## 🛠️ 核心原因分析 (Root Cause Analysis)

### 1. 圖片網址路徑格式比對過於嚴格 (`cover_url` 格式不符合) ⚠️ **[主要原因]**
* **技術細節**：後端 `BookLookupService.delete_cover_file` 現行檢查邏輯如下：
  ```python
  if cover_url.startswith("/static/covers/"):
      filename = cover_url.replace("/static/covers/", "").strip()
  ```
* **問題**：
  * 當系統透過 Synology 區網 IP 或 Domain 存取（例如 `http://192.168.1.100:8000/static/covers/abc.jpg`）時，若資料庫存入的是完整 URL，`startswith("/static/covers/")` 會直接回傳 `False`，導致系統判定「非本地檔案」而**完全未執行刪除**。
  * 若網址帶有 Query 快取參數（如 `/static/covers/abc.jpg?v=123`），提取出的檔名包含 Query 字串，導致 `file_path.is_file()` 找不到對應磁碟檔案。

---

### 2. Synology NAS 媒體索引服務鎖定檔案 (`synoindexd` / Universal Search)
* **技術細節**：Synology DSM 背景有強大的媒體與檔案索引機制（`synoindexd` / `fileindexd` / Universal Search / Synology Photos）。
* **問題**：當圖片被寫入或被存取時，NAS 系統會第一時間讀取圖檔以產生預覽縮圖。若刪除書籍時 NAS 背景正處於檔案開啓或索引鎖定狀態，Linux 容器內 Python 的 `unlink()`（刪除檔案）會因檔案被 Occupied/Locked 而失敗。

---

### 3. Windows 檔案共享 (SMB) 存取與 Oplock 鎖定
* **技術細節**：若 Docker 掛載目錄 `./app/static/covers` 同時透過 NAS 的 SMB 共享給 Windows 檔案總管存取。
* **問題**：當 Windows 檔案總管正好開啟該資料夾，或是 Windows 正在背景讀取縮圖（`Thumbs.db`），SMB 協定的 opportunistic lock (oplock) 會鎖定檔案，導致容器內部的 Linux 程序無權刪除該實體檔案。

---

### 4. Linux 容器與 NAS 共享資料夾權限不一致 (UID/GID & POSIX ACL)
* **技術細節**：Docker 容器內 Python 程序預設以特定用戶（如 `root`）執行，但 NAS 共享資料夾受 Synology DSM 的 POSIX ACL 存取控制清單限制。
* **問題**：若圖檔是由外部上傳或備份還原進來，擁有者與權限未開放寫入/刪除（`w`）給 Docker 運作身份，`unlink()` 操作會觸發 `Permission denied` 錯誤。

---

### 5. 異常捕捉處理 leading to 靜默失敗 (Silent Failure)
* **技術細節**：刪除邏輯採用了 `try...except` 捕捉異常：
  ```python
  try:
      if file_path.is_file():
          file_path.unlink(missing_ok=True)
          return True
  except Exception as e:
      print(f"[CoverDelete] 刪除本地封面檔案失敗 ({file_path}): {e}")
  ```
* **問題**：當刪除失敗時，錯誤僅輸出至容器後台 Log（Standard Output），API 依然回傳 HTTP 204 No Content，前端網頁無法得知實體圖檔刪除失敗。

---

## 💡 排查與驗證步驟 (Troubleshooting Steps)

1. **查看 Container Logs**：
   在 Synology DSM 進入 **Container Manager** -> 選擇 **項目 / 容器 (book-storage)** -> 點擊 **日誌 (Logs)**，在前端進行刪除操作，觀察是否有印出 `[CoverDelete] 刪除本地封面檔案失敗` 相關訊息。

2. **檢查資料庫記錄**：
   確認資料庫中 `books` 資料表的 `cover_url` 欄位格式是否為以 `/static/covers/` 開頭之相對路徑。

3. **確認 SMB 鎖定情況**：
   在刪除藏書測試時，嘗試先關閉電腦端已連線至該 NAS 共享目錄的 Windows 檔案總管視窗。

---

## 🚀 已實作修復方案與排查增強 (Implemented Solutions)

1. ✅ **使用 `urllib.parse` 優化路徑提取**：
   不論傳入的是包含 Domain 的絕對網址（`http://192.168.1.40:5000/static/covers/...`）還是相對路徑，皆透過 `urllib.parse.urlparse` 提取出純檔名，並自動過濾 Query 快取參數。
2. ✅ **補充完整除錯日誌（Debug Logs）**：
   在所有可能略過或失敗的分支（共用圖檔保留、非本地路徑、檔案不存在、權限/鎖定異常），皆印出帶有 `[CoverDelete]` 前綴的標準日誌。

---

## 📌 重要提示：Synology Docker 重新建置（Rebuild）

由於程式碼是在映像檔建立時 `COPY` 寫進容器內的（非熱掛載）：
修改程式碼後，**務必在 Synology NAS 重新建置 Docker 映像檔**，變更才會生效：

```bash
# 於 NAS 專案目錄下執行
docker compose build --no-cache
docker compose up -d
```
或在 Synology **Container Manager** 中，對專案執行「建置 / 重新啟動」。
