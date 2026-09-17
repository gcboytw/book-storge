const CACHE_NAME = "book-storage-cache-v5.9";
const STATIC_ASSETS = [
  "/",
  "/static/index.html",
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/js/scanner.js",
  "/static/js/db_offline.js",
  "/static/js/vendor/zxing.min.js",
  "/static/js/vendor/quagga.min.js",
  "/static/manifest.json",
  "/static/index-logo.png"
];

// 監聽前端頁面查詢版本或跳過等待
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_VERSION") {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: CACHE_NAME });
    }
  } else if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// 安裝時快取靜態核心資源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// 啟用時清理舊版快取
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

// 資源請求攔截
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. 若為 API 請求或 sw.js 自身，直接走網路，絕不走快取（由 db_offline.js 與 app.js 自行處理 IndexedDB 備援）
  if (url.pathname.startsWith("/api/") || url.pathname.endsWith("sw.js")) {
    return;
  }

  // 2. 方案 A 核心：書封圖片採用 Cache First 策略，快取命中即秒開，確保離線與飛航模式翻頁順暢
  if (url.pathname.startsWith("/static/covers/")) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);
      })
    );
    return;
  }

  // 3. 核心靜態資源（HTML, CSS, JS, 圖示）採用 Cache First 策略：本地 0 秒秒開，避免出門時發送無效網路請求卡死
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});
