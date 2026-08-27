/**
 * db_offline.js - 手機端 IndexedDB 離線快取與秒級本地檢索庫
 */

const DB_NAME = "BookStorageOfflineDB";
const DB_VERSION = 2;
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
        
        // 書籍儲存庫
        let store;
        if (!db.objectStoreNames.contains(STORE_BOOKS)) {
          store = db.createObjectStore(STORE_BOOKS, { keyPath: "my_book_id" });
        } else {
          store = event.target.transaction.objectStore(STORE_BOOKS);
        }

        if (!store.indexNames.contains("uuid")) store.createIndex("uuid", "uuid", { unique: false });
        if (!store.indexNames.contains("isbn13")) store.createIndex("isbn13", "isbn13", { unique: false });
        if (!store.indexNames.contains("isbn10")) store.createIndex("isbn10", "isbn10", { unique: false });
        if (!store.indexNames.contains("title")) store.createIndex("title", "title", { unique: false });
        if (!store.indexNames.contains("author")) store.createIndex("author", "author", { unique: false });
        if (!store.indexNames.contains("shelf_id")) store.createIndex("shelf_id", "shelf_id", { unique: false });

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

      // 批次寫入書籍
      for (const item of dumpData.books) {
        bookStore.put(item);
      }

      // 儲存同步版本資訊
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
   * 取得離線資料庫中所有書籍
   */
  async getAllBooks() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_BOOKS, "readonly");
      const store = tx.objectStore(STORE_BOOKS);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
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
