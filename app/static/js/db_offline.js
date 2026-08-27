/**
 * db_offline.js - 手機端 IndexedDB 離線快取與秒級本地檢索庫
 */

const DB_NAME = "BookStorageOfflineDB";
const DB_VERSION = 1;
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
        if (!db.objectStoreNames.contains(STORE_BOOKS)) {
          const store = db.createObjectStore(STORE_BOOKS, { keyPath: "my_book_id" });
          store.createIndex("isbn13", "isbn13", { unique: false });
          store.createIndex("isbn10", "isbn10", { unique: false });
          store.createIndex("title", "title", { unique: false });
          store.createIndex("author", "author", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("shelf_id", "shelf_id", { unique: false });
        }

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
   * 離線全文檢索（比對書名、作者、ISBN、出版社、心得）
   */
  async search(query, statusFilter = null, shelfFilter = null) {
    const books = await this.getAllBooks();
    const q = query ? query.toLowerCase().trim() : "";

    return books.filter((item) => {
      // 狀態篩選
      if (statusFilter && item.status !== statusFilter) {
        return false;
      }
      // 書架篩選
      if (shelfFilter !== null && shelfFilter !== undefined) {
        if (shelfFilter === 0 && item.shelf_id !== null) return false;
        if (shelfFilter > 0 && item.shelf_id !== shelfFilter) return false;
      }

      if (!q) return true;

      const titleMatch = item.title && item.title.toLowerCase().includes(q);
      const subMatch = item.subtitle && item.subtitle.toLowerCase().includes(q);
      const authorMatch = item.author && item.author.toLowerCase().includes(q);
      const pubMatch = item.publisher && item.publisher.toLowerCase().includes(q);
      const isbn13Match = item.isbn13 && item.isbn13.includes(q);
      const isbn10Match = item.isbn10 && item.isbn10.includes(q);
      const notesMatch = item.notes && item.notes.toLowerCase().includes(q);

      return titleMatch || subMatch || authorMatch || pubMatch || isbn13Match || isbn10Match || notesMatch;
    });
  }

  /**
   * 取得同步狀態資訊
   */
  async getSyncMeta() {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(STORE_META, "readonly");
      const store = tx.objectStore(STORE_META);
      const request = store.get("last_sync");

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }
}

// 實例化掛載至全域
window.offlineStorage = new OfflineStorage();
