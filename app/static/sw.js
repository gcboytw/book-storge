const CACHE_NAME = "book-storage-cache-v3";
const STATIC_ASSETS = [
  "/",
  "/static/index.html",
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/js/scanner.js",
  "/static/js/db_offline.js",
  "/static/manifest.json"
];

// 安裝時快取靜態資源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 啟用時清理舊快取
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 網路優先，離線時降級回快取
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 若為 API 請求，直接走網路（由 db_offline.js 自行處理 IndexedDB 備援）
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
