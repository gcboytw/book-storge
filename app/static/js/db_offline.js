/**
 * db_offline.js - 手機端 IndexedDB 離線快取、Outbox 異動隊列與手動雙向同步演算法
 */

const DB_NAME = "BookStorageOfflineDB";
const DB_VERSION = 4;
const STORE_BOOKS = "cached_books";
const STORE_META = "sync_metadata";

class OfflineStorage {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 書籍儲存庫：以唯一 uuid 作為 keyPath，支援無伺服器 id 時的離線新增
        if (db.objectStoreNames.contains(STORE_BOOKS)) {
          db.deleteObjectStore(STORE_BOOKS);
        }
        const store = db.createObjectStore(STORE_BOOKS, { keyPath: "uuid" });

        store.createIndex("id", "id", { unique: false });
        store.createIndex("isbn13", "isbn13", { unique: false });
        store.createIndex("isbn10", "isbn10", { unique: false });
        store.createIndex("title", "title", { unique: false });
        store.createIndex("author", "author", { unique: false });
        store.createIndex("shelf_id", "shelf_id", { unique: false });
        store.createIndex("_sync_state", "_sync_state", { unique: false });

        // 同步狀態紀錄庫
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("IndexedDB 初始化失敗:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 輔助產生安全 UUID
   */
  generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 將伺服器 /api/sync/dump 的全量資料寫入 IndexedDB
   */
  async syncFromServer(dumpData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_BOOKS, STORE_META], "readwrite");
      const bookStore = tx.objectStore(STORE_BOOKS);
      const metaStore = tx.objectStore(STORE_META);

      // 清空舊資料以確保同步一致
      bookStore.clear();

      for (const item of dumpData.books) {
        if (!item.uuid) item.uuid = this.generateUUID();
        item._sync_state = "synced";
        item._is_deleted = false;
        bookStore.put(item);
      }

      metaStore.put({
        key: "last_sync",
        version: dumpData.sync_version,
        timestamp: dumpData.generated_at,
        total: dumpData.total_books,
        shelves: dumpData.shelves
      });

      tx.oncomplete = () => {
        resolve({
          synced_count: dumpData.books.length,
          sync_time: dumpData.generated_at
        });
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 取得離線資料庫中所有書籍（預設排除標記為刪除的書籍）
   */
  async getAllBooks(includeDeleted = false) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_BOOKS, "readonly");
      const store = tx.objectStore(STORE_BOOKS);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result || [];
        if (includeDeleted) {
          resolve(all);
        } else {
          resolve(all.filter((b) => !b._is_deleted));
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 依 UUID 取得單本書籍
   */
  async getBookByUuid(uuid) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_BOOKS, "readonly");
      const store = tx.objectStore(STORE_BOOKS);
      const request = store.get(uuid);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 離線新增或修改書籍
   */
  async saveOfflineBook(bookData, isCreate = false) {
    await this.init();
    const nowIso = new Date().toISOString();

    let targetUuid = bookData.uuid;
    if (!targetUuid) {
      targetUuid = this.generateUUID();
      bookData.uuid = targetUuid;
    }

    const existing = await this.getBookByUuid(targetUuid);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);

      let recordToSave;
      if (isCreate || !existing) {
        recordToSave = {
          ...bookData,
          uuid: targetUuid,
          _sync_state: "pending_create",
          _is_deleted: false,
          created_at: bookData.created_at || nowIso,
          updated_at: nowIso
        };
      } else {
        // 若原本是 pending_create 保持 pending_create，否則標記為 pending_update
        const nextState = existing._sync_state === "pending_create" ? "pending_create" : "pending_update";
        recordToSave = {
          ...existing,
          ...bookData,
          uuid: targetUuid,
          _sync_state: nextState,
          _is_deleted: false,
          updated_at: nowIso
        };
      }

      const req = store.put(recordToSave);
      req.onsuccess = () => resolve(recordToSave);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 離線移出/刪除書籍（軟刪除以供同步）
   */
  async deleteOfflineBook(uuid) {
    await this.init();
    const existing = await this.getBookByUuid(uuid);
    if (!existing) return true;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);

      // 若該書僅在本地離線新增過且從未上傳伺服器，直接徹底抹除
      if (existing._sync_state === "pending_create") {
        const req = store.delete(uuid);
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      } else {
        // 若伺服器已有紀錄，標記軟刪除與待刪除異動
        existing._is_deleted = true;
        existing._sync_state = "pending_delete";
        existing.updated_at = new Date().toISOString();

        const req = store.put(existing);
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      }
    });
  }

  /**
   * 取得本地 Outbox 所有待同步的異動資料
   */
  async getPendingChanges() {
    await this.init();
    const all = await this.getAllBooks(true);
    const pendingList = all.filter((b) => b._sync_state && b._sync_state !== "synced");

    return pendingList.map((b) => {
      let action = "update";
      if (b._sync_state === "pending_create") action = "create";
      else if (b._sync_state === "pending_delete" || b._is_deleted) action = "delete";

      return {
        uuid: b.uuid,
        action: action,
        data: {
          title: b.title,
          subtitle: b.subtitle,
          author: b.author || b.author_display,
          publisher: b.publisher,
          publication_date: b.publication_date,
          isbn13: b.isbn13,
          isbn10: b.isbn10,
          ean: b.ean,
          cover_url: b.cover_url,
          description: b.description,
          category: b.category,
          shelf_id: b.shelf_id,
          status: b.status,
          rating: b.rating,
          notes: b.notes,
          created_at: b.created_at,
          updated_at: b.updated_at
        },
        updated_at: b.updated_at
      };
    });
  }

  /**
   * 取得待同步筆數統計
   */
  async getPendingCount() {
    const changes = await this.getPendingChanges();
    return changes.length;
  }

  /**
   * 將已成功上傳的項目狀態重置為 'synced'（若是刪除項目則自 IndexedDB 抹除）
   */
  async markAsSynced(syncedUuids) {
    if (!syncedUuids || syncedUuids.length === 0) return;
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_BOOKS, "readwrite");
      const store = tx.objectStore(STORE_BOOKS);

      for (const uuid of syncedUuids) {
        const getReq = store.get(uuid);
        getReq.onsuccess = () => {
          const item = getReq.result;
          if (item) {
            if (item._sync_state === "pending_delete" || item._is_deleted) {
              store.delete(uuid);
            } else {
              item._sync_state = "synced";
              store.put(item);
            }
          }
        };
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 合併自伺服器拉取的增量資料 (Pull)
   */
  async mergeSyncDown(downData) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_BOOKS, STORE_META], "readwrite");
      const bookStore = tx.objectStore(STORE_BOOKS);
      const metaStore = tx.objectStore(STORE_META);

      // 1. 刪除雲端標記已刪除的書籍
      if (downData.deleted_uuids && downData.deleted_uuids.length > 0) {
        for (const delUuid of downData.deleted_uuids) {
          bookStore.delete(delUuid);
        }
      }

      // 2. 寫入或更新雲端最新書籍
      if (downData.updates && downData.updates.length > 0) {
        for (const item of downData.updates) {
          item._sync_state = "synced";
          item._is_deleted = false;
          bookStore.put(item);
        }
      }

      // 3. 更新最後同步時間
      metaStore.get("last_sync").onsuccess = (e) => {
        const existingMeta = e.target.result || {};
        metaStore.put({
          ...existingMeta,
          key: "last_sync",
          timestamp: downData.server_time || new Date().toISOString()
        });
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 伺服器全量備份快照匯入 (用於初次安裝或全新裝置初始化)
   */
  async syncFromServer(dumpData) {
    if (!dumpData) return;
    const updates = dumpData.books || dumpData.items || [];
    await this.mergeSyncDown({
      server_time: dumpData.server_time || new Date().toISOString(),
      updates: updates,
      deleted_uuids: []
    });
    if (dumpData.shelves) {
      await this.saveSyncMeta({ shelves: dumpData.shelves });
    }
    // 觸發方案 A 背景全量書封預載
    this.prefetchCovers().catch((e) => console.warn("初次預載書封提示:", e));
  }

  /**
   * 核心手動雙向同步演算法 (Push -> Pull -> Merge)
   */
  async syncTwoWay() {
    // 步驟 1: 探測伺服器連線狀態 (10ms 內快速 ping)
    const pingResp = await fetch("/api/ping", { method: "GET" }).catch(() => null);
    if (!pingResp || !pingResp.ok) {
      throw new Error("無法連線至 NAS 伺服器，請確認已連接家中 Wi-Fi 或開啟 VPN。");
    }

    // 步驟 2: Push - 上傳本地待同步異動
    const pendingChanges = await this.getPendingChanges();
    let pushedCount = 0;
    if (pendingChanges.length > 0) {
      const pushResp = await fetch("/api/sync/up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "mobile_pwa",
          changes: pendingChanges
        })
      });

      if (!pushResp.ok) {
        throw new Error(`上傳本地異動失敗 (HTTP ${pushResp.status})`);
      }
      pushedCount = pendingChanges.length;
      await this.markAsSynced(pendingChanges.map((c) => c.uuid));
    }

    // 步驟 3: Pull - 拉取伺服器端增量更新
    const meta = await this.getSyncMeta();
    const lastSyncTime = meta && meta.timestamp ? meta.timestamp : null;
    const downUrl = lastSyncTime
      ? `/api/sync/down?last_sync_time=${encodeURIComponent(lastSyncTime)}`
      : `/api/sync/down`;

    const pullResp = await fetch(downUrl);
    if (!pullResp.ok) {
      throw new Error(`拉取伺服器更新失敗 (HTTP ${pullResp.status})`);
    }

    const downData = await pullResp.json();

    // 步驟 4: 本地 IndexedDB 合併
    await this.mergeSyncDown(downData);

    // 步驟 4.1: 防禦機制三 - 手動雙向同步納入書架更新 (拉取最新書架並持久化至 IndexedDB)
    try {
      const shelfResp = await fetch("/api/shelves").catch(() => null);
      if (shelfResp && shelfResp.ok) {
        const freshShelves = await shelfResp.json();
        if (Array.isArray(freshShelves)) {
          await this.saveSyncMeta({ shelves: freshShelves });
        }
      }
    } catch (shelfErr) {
      console.warn("同步最新書架清單提示:", shelfErr);
    }

    // 步驟 5: 方案 A - 在背景自動全量預載書封圖檔 (不卡住資料回傳)
    this.prefetchCovers().catch((e) => console.warn("書封背景預載提示:", e));

    return {
      pushed_count: pushedCount,
      pulled_updates: downData.total_updates,
      pulled_deleted: downData.total_deleted,
      server_time: downData.server_time
    };
  }

  /**
   * 方案 A：背景全量預載所有藏書封面至 Cache Storage
   */
  async prefetchCovers(onProgress = null) {
    if (typeof caches === "undefined") return;

    try {
      const allBooks = await this.getAllBooks();
      const coverUrls = allBooks
        .map((b) => b.cover_url)
        .filter((url) => url && (url.startsWith("/static/covers/") || url.startsWith("http")));

      const uniqueUrls = Array.from(new Set(coverUrls));
      if (uniqueUrls.length === 0) return { total: 0, completed: 0 };

      const cacheKeys = await caches.keys();
      const targetCacheName = cacheKeys.find((k) => k.startsWith("book-storage-cache")) || "book-storage-cache-v8";
      const cache = await caches.open(targetCacheName);

      let fetchedCount = 0;
      const total = uniqueUrls.length;

      // 每次併發 6 個請求平滑下載，保護手機網路連線池
      const CONCURRENCY = 6;
      for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
        const batch = uniqueUrls.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (url) => {
            try {
              const matched = await cache.match(url, { ignoreSearch: true });
              if (!matched) {
                const resp = await fetch(url);
                if (resp && resp.ok) {
                  await cache.put(url, resp);
                }
              }
            } catch (err) {
              // 單張下載失敗不中斷
            } finally {
              fetchedCount++;
              if (onProgress) onProgress(fetchedCount, total);
            }
          })
        );
      }

      console.log(`🖼️ [方案 A] 書封離線全量預載完成：共 ${total} 張封面`);
      return { total, completed: fetchedCount };
    } catch (e) {
      console.warn("背景書封預載異常:", e);
      return { total: 0, completed: 0 };
    }
  }

  /**
   * 檢查當前書封快取狀態統計
   */
  async getCoverCacheStats() {
    if (typeof caches === "undefined") return { cached: 0, total: 0 };
    try {
      const all = await this.getAllBooks();
      const urls = Array.from(
        new Set(
          all
            .map((b) => b.cover_url)
            .filter((u) => u && (u.startsWith("/static/covers/") || u.startsWith("http")))
        )
      );
      if (urls.length === 0) return { cached: 0, total: 0 };

      const cacheKeys = await caches.keys();
      const targetCacheName = cacheKeys.find((k) => k.startsWith("book-storage-cache")) || "book-storage-cache-v8";
      const cache = await caches.open(targetCacheName);

      let cachedCount = 0;
      for (const u of urls) {
        const match = await cache.match(u, { ignoreSearch: true });
        if (match) cachedCount++;
      }
      return { cached: cachedCount, total: urls.length };
    } catch (e) {
      return { cached: 0, total: 0 };
    }
  }

  /**
   * 取得最後同步的 Metadata
   */
  async getSyncMeta() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_META, "readonly");
      const store = tx.objectStore(STORE_META);
      const request = store.get("last_sync");

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 儲存/更新最後同步的 Metadata (例如書架清單快取)
   */
  async saveSyncMeta(partialMeta) {
    if (!partialMeta || typeof partialMeta !== "object") return;
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_META, "readwrite");
      const store = tx.objectStore(STORE_META);
      const getReq = store.get("last_sync");

      getReq.onsuccess = () => {
        const current = getReq.result || { key: "last_sync" };
        const updated = { ...current, ...partialMeta };
        store.put(updated);
      };
      getReq.onerror = (e) => reject(e.target.error);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * 依關鍵字離線快速檢索
   */
  async searchOffline(queryStr) {
    const all = await this.getAllBooks();
    if (!queryStr || !queryStr.trim()) return all;

    const q = queryStr.toLowerCase().trim();
    return all.filter((b) => {
      return (
        (b.title && b.title.toLowerCase().includes(q)) ||
        (b.author && b.author.toLowerCase().includes(q)) ||
        (b.author_display && b.author_display.toLowerCase().includes(q)) ||
        (b.publisher && b.publisher.toLowerCase().includes(q)) ||
        (b.isbn13 && b.isbn13.includes(q)) ||
        (b.isbn10 && b.isbn10.includes(q)) ||
        (b.ean && b.ean.includes(q)) ||
        (b.notes && b.notes.toLowerCase().includes(q))
      );
    });
  }
}

// 建立全域實例
window.offlineStorage = new OfflineStorage();
