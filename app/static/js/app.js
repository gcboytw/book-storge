/**
 * app.js - 個人藏書庫 SPA 主畫面邏輯、分頁、排序、封面替換與離線整合 (單一 Books 模型優化版)
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM 元素
  const booksGrid = document.getElementById("books-grid");
  const searchInput = document.getElementById("search-input");
  const filterTabs = document.getElementById("filter-tabs");
  const totalCountEl = document.getElementById("total-count");
  const offlineBanner = document.getElementById("offline-banner");
  const themeToggleBtn = document.getElementById("theme-toggle");
  const btnExportZip = document.getElementById("btn-export-zip");
  const paginationContainer = document.getElementById("pagination-container");
  const btnBackToTop = document.getElementById("btn-back-to-top");
  const floatingBackToTop = document.getElementById("floating-back-to-top");

  // Modals & Bottom Sheet
  const scanModal = document.getElementById("scan-modal");
  const bookDetailModal = document.getElementById("book-detail-modal");
  const manualAddModal = document.getElementById("manual-add-modal");
  const shelfBottomSheet = document.getElementById("shelf-bottom-sheet");
  const shelfSheetList = document.getElementById("shelf-sheet-list");
  const btnMobileShelfTrigger = document.getElementById("btn-mobile-shelf-trigger");
  const mobileShelfLabel = document.getElementById("mobile-shelf-label");
  const btnCloseShelfSheet = document.getElementById("btn-close-shelf-sheet");
  const btnOpenScan = document.getElementById("btn-open-scan");
  const btnCloseScan = document.getElementById("btn-close-scan");
  const btnCloseDetail = document.getElementById("btn-close-detail");
  const btnOpenManualAdd = document.getElementById("btn-open-manual-add");
  const btnCloseManualAdd = document.getElementById("btn-close-manual-add");
  const btnCancelManualAdd = document.getElementById("btn-cancel-manual-add");
  const btnSwitchToManual = document.getElementById("btn-switch-to-manual");
  const btnManualIsbnSearch = document.getElementById("btn-manual-isbn-search");
  const manualIsbnInput = document.getElementById("manual-isbn-input");
  const btnSubmitManualAdd = document.getElementById("btn-submit-manual-add");
  const customBookForm = document.getElementById("custom-book-form");

  // 同步狀態與版本管理 Modal 元素
  const btnOpenSync = document.getElementById("btn-open-sync");
  const syncModal = document.getElementById("sync-modal");
  const btnCloseSync = document.getElementById("btn-close-sync");
  const btnTriggerSync = document.getElementById("btn-trigger-sync");
  const btnForceUpdateSw = document.getElementById("btn-force-update-sw");
  const syncSwVersion = document.getElementById("sync-sw-version");
  const syncLocalCount = document.getElementById("sync-local-count");
  const syncPendingCount = document.getElementById("sync-pending-count");
  const syncLastTime = document.getElementById("sync-last-time");
  const syncCoverCount = document.getElementById("sync-cover-count");
  let activeSwVersionName = "";

  // 狀態管理
  const PAGE_SIZE = 24; // 每頁 24 本書籍
  let currentPage = 1;
  let currentFilter = "all"; // 'all' 或 shelf:ID
  let currentSearch = "";
  let cachedBooks = [];
  let shelvesList = [];
  let activeBook = null;
  let scannerInstance = null;

  // 1. 主題切換 (Light / Dark)
  const initTheme = () => {
    const savedTheme = localStorage.getItem("bs_theme") || 
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);
  };

  const updateThemeIcon = (theme) => {
    if (themeToggleBtn) {
      themeToggleBtn.textContent = theme === "dark" ? "☀️" : "🌙";
    }
  };

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("bs_theme", next);
      updateThemeIcon(next);
    });
  }

  initTheme();

  // 2. 回到頁首 (Back to Top)
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (btnBackToTop) {
    btnBackToTop.addEventListener("click", scrollToTop);
  }

  if (floatingBackToTop) {
    floatingBackToTop.addEventListener("click", scrollToTop);
    window.addEventListener("scroll", () => {
      if (window.scrollY > 300) {
        floatingBackToTop.classList.add("visible");
      } else {
        floatingBackToTop.classList.remove("visible");
      }
    });
  }

  // 3. 網路狀態與離線處理
  const updateOnlineStatus = () => {
    if (!navigator.onLine) {
      offlineBanner.classList.add("active");
      offlineBanner.textContent = "⚡ 目前處於離線狀態：使用本地 IndexedDB 秒查個人藏書";
    } else {
      offlineBanner.classList.remove("active");
    }
  };

  window.addEventListener("online", () => {
    updateOnlineStatus();
  });
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  // 4. 排序輔助函式：建立時間新 -> 舊 (created_at 降序，其次為 id 降序)
  function sortBooksByCreatedAtDesc(books) {
    return books.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (dateA !== dateB) {
        return dateB - dateA;
      }
      return (b.id || 0) - (a.id || 0);
    });
  }

  // 5. 離線優先資料載入 (Offline-First)
  // 5.1 讀取本地 IndexedDB 秒開畫面 (0 network delay)
  async function loadOfflineData() {
    if (!window.offlineStorage) return [];
    try {
      const offlineBooks = await window.offlineStorage.getAllBooks();
      const meta = await window.offlineStorage.getSyncMeta();
      if (meta && meta.shelves) {
        shelvesList = meta.shelves;
        populateShelfDropdowns();
      }

      // 轉為統一的清單結構
      const formatted = offlineBooks.map((item) => ({
        id: item.id,
        uuid: item.uuid,
        title: item.title,
        subtitle: item.subtitle,
        author_display: item.author || item.author_display,
        publisher: item.publisher,
        publication_date: item.publication_date,
        isbn13: item.isbn13,
        isbn10: item.isbn10,
        ean: item.ean,
        cover_url: item.cover_url,
        description: item.description,
        category: item.category,
        shelf_id: item.shelf_id,
        shelf: item.shelf_name ? { id: item.shelf_id, name: item.shelf_name } : null,
        notes: item.notes,
        created_at: item.created_at || null,
        updated_at: item.updated_at || null
      }));

      cachedBooks = sortBooksByCreatedAtDesc(formatted);
      renderFilterTabs();
      applyFiltersAndRender();
      return cachedBooks;
    } catch (err) {
      console.warn("讀取 IndexedDB 離線快取失敗:", err);
      return [];
    }
  }

  // 5.2 與中央伺服器主動同步資料 (供手動同步或本地初次為空時使用)
  async function loadBooksFromServer() {
    try {
      // 1. 同步書架
      const shelfResp = await fetch("/api/shelves");
      if (shelfResp.ok) {
        shelvesList = await shelfResp.json();
        renderFilterTabs();
        populateShelfDropdowns();
      }

      // 2. 取得藏書列表並立即渲染畫面
      const booksResp = await fetch("/api/books");
      if (booksResp.ok) {
        const data = await booksResp.json();
        cachedBooks = sortBooksByCreatedAtDesc(data);
        renderFilterTabs();
        applyFiltersAndRender();
        offlineBanner.classList.remove("active");
      }

      // 3. 背景將全量資料快取至 IndexedDB
      try {
        const dumpResp = await fetch("/api/sync/dump");
        if (dumpResp.ok) {
          const dump = await dumpResp.json();
          if (window.offlineStorage) {
            await window.offlineStorage.syncFromServer(dump);
          }
        }
      } catch (cacheErr) {
        console.warn("背景 IndexedDB 快取寫入提示:", cacheErr);
      }
      return true;
    } catch (err) {
      console.warn("連線至中央伺服器失敗:", err);
      throw err;
    }
  }

  // 5.3 應用程式啟動生命週期：先讀本地秒開，為空才嘗試遠端
  async function initAppLifecycle() {
    const localBooks = await loadOfflineData();
    if (localBooks && localBooks.length > 0) {
      // 本地有資料，瞬間完成渲染，不主動發送 API 探測 NAS，避免戶外連線卡頓
      console.log(`⚡ 離線秒開完成：載入本地快取藏書共 ${localBooks.length} 本`);
    } else {
      // 本地完全無資料 (首次在該手機安裝使用)，嘗試連線 NAS 初始化
      if (navigator.onLine) {
        try {
          await loadBooksFromServer();
        } catch (e) {
          offlineBanner.classList.add("active");
          offlineBanner.textContent = "⚡ 目前處於離線狀態且本地尚無快取，請於連上家中 Wi-Fi 或 VPN 後點擊右上角「🔄」進行同步。";
        }
      }
    }
  }

  // 6. 書架與分類標籤渲染 (桌面橫向膠囊 + 手機底部抽屜選單)
  function renderFilterTabs() {
    const totalAllCount = cachedBooks.length;
    const shelfCounts = {};
    for (const b of cachedBooks) {
      const sId = b.shelf_id || (b.shelf ? b.shelf.id : null);
      if (sId) {
        shelfCounts[sId] = (shelfCounts[sId] || 0) + 1;
      }
    }

    // 1. 更新手機版觸發按鈕上的標籤名稱與數量
    let currentLabelText = "所有書籍";
    if (currentFilter.startsWith("shelf:")) {
      const currentShelfId = parseInt(currentFilter.replace("shelf:", ""), 10);
      const currentShelf = shelvesList.find((s) => s.id === currentShelfId);
      if (currentShelf) {
        currentLabelText = `${currentShelf.name} (${shelfCounts[currentShelf.id] || 0})`;
      }
    } else {
      currentLabelText = `所有書籍 (${totalAllCount})`;
    }
    if (mobileShelfLabel) {
      mobileShelfLabel.textContent = currentLabelText;
    }

    // 2. 渲染桌面版篩選標籤膠囊 (Pills)
    let desktopHtml = `
      <button class="filter-tab ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">
        所有書籍 <span class="shelf-count-badge">${totalAllCount}</span>
      </button>
    `;

    for (const s of shelvesList) {
      const count = shelfCounts[s.id] || 0;
      const isActive = currentFilter === `shelf:${s.id}`;
      desktopHtml += `
        <button class="filter-tab ${isActive ? 'active' : ''}" data-filter="shelf:${s.id}">
          ${s.name} <span class="shelf-count-badge">${count}</span>
        </button>
      `;
    }

    filterTabs.innerHTML = desktopHtml;

    // 3. 渲染手機版 Bottom Sheet 列表
    if (shelfSheetList) {
      let sheetHtml = `
        <button class="sheet-shelf-item ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">
          <div class="sheet-shelf-left">
            <span>📚</span>
            <span>所有書籍</span>
          </div>
          <div class="sheet-shelf-right">
            <span class="shelf-count-badge">${totalAllCount} 本</span>
            <span class="shelf-check-icon">✓</span>
          </div>
        </button>
      `;

      for (const s of shelvesList) {
        const count = shelfCounts[s.id] || 0;
        const isActive = currentFilter === `shelf:${s.id}`;
        sheetHtml += `
          <button class="sheet-shelf-item ${isActive ? 'active' : ''}" data-filter="shelf:${s.id}">
            <div class="sheet-shelf-left">
              <span>🏷️</span>
              <span>${s.name}</span>
            </div>
            <div class="sheet-shelf-right">
              <span class="shelf-count-badge">${count} 本</span>
              <span class="shelf-check-icon">✓</span>
            </div>
          </button>
        `;
      }

      shelfSheetList.innerHTML = sheetHtml;

      // 綁定手機抽屜項目點擊事件
      shelfSheetList.querySelectorAll(".sheet-shelf-item").forEach((item) => {
        item.addEventListener("click", () => {
          currentFilter = item.dataset.filter;
          currentPage = 1;
          closeShelfBottomSheet();
          renderFilterTabs();
          applyFiltersAndRender();
        });
      });
    }

    // 4. 綁定桌面標籤點擊事件
    filterTabs.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        currentFilter = tab.dataset.filter;
        currentPage = 1;
        renderFilterTabs();
        applyFiltersAndRender();
      });
    });
  }

  // 7. 手機版 Bottom Sheet 開關
  function openShelfBottomSheet() {
    if (shelfBottomSheet) {
      shelfBottomSheet.classList.add("active");
      document.body.style.overflow = "hidden";
    }
  }

  function closeShelfBottomSheet() {
    if (shelfBottomSheet) {
      shelfBottomSheet.classList.remove("active");
      document.body.style.overflow = "";
    }
  }

  if (btnMobileShelfTrigger) {
    btnMobileShelfTrigger.addEventListener("click", openShelfBottomSheet);
  }

  if (btnCloseShelfSheet) {
    btnCloseShelfSheet.addEventListener("click", closeShelfBottomSheet);
  }

  if (shelfBottomSheet) {
    shelfBottomSheet.addEventListener("click", (e) => {
      if (e.target === shelfBottomSheet) {
        closeShelfBottomSheet();
      }
    });
  }

  function populateShelfDropdowns() {
    const editSelect = document.getElementById("edit-shelf");
    const manualSelect = document.getElementById("manual-shelf");
    
    let options = `<option value="">未分類</option>`;
    for (const s of shelvesList) {
      options += `<option value="${s.id}">${s.name}</option>`;
    }

    if (editSelect) editSelect.innerHTML = options;
    if (manualSelect) manualSelect.innerHTML = options;
  }

  // 8. 搜尋與篩選邏輯 (支援分頁)
  searchInput.addEventListener("input", (e) => {
    currentSearch = e.target.value;
    currentPage = 1;
    applyFiltersAndRender();
  });

  function applyFiltersAndRender() {
    let filtered = [...cachedBooks];

    // 書架篩選
    if (currentFilter !== "all") {
      if (currentFilter.startsWith("shelf:")) {
        const shelfId = parseInt(currentFilter.replace("shelf:", ""), 10);
        filtered = filtered.filter((b) => (b.shelf_id === shelfId || (b.shelf && b.shelf.id === shelfId)));
      }
    }

    // 關鍵字搜尋
    if (currentSearch) {
      const q = currentSearch.toLowerCase().trim();
      filtered = filtered.filter((b) => {
        const titleMatch = (b.title || "").toLowerCase().includes(q);
        const subMatch = (b.subtitle || "").toLowerCase().includes(q);
        const authorMatch = (b.author_display || "").toLowerCase().includes(q);
        const pubMatch = (b.publisher || "").toLowerCase().includes(q);
        const isbn13Match = (b.isbn13 || "").includes(q);
        const isbn10Match = (b.isbn10 || "").includes(q);
        const eanMatch = (b.ean || "").includes(q);
        const notesMatch = (b.notes || "").toLowerCase().includes(q);
        return titleMatch || subMatch || authorMatch || pubMatch || isbn13Match || isbn10Match || eanMatch || notesMatch;
      });
    }

    // 依建立時間新->舊排序
    sortBooksByCreatedAtDesc(filtered);

    // 計算分頁
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems);
    const currentPageBooks = filtered.slice(startIndex, endIndex);

    totalCountEl.textContent = `共 ${totalItems} 本藏書 ${totalPages > 1 ? `(第 ${currentPage} / ${totalPages} 頁，每頁 24 本)` : ""}`;

    if (totalItems === 0) {
      booksGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon">📚</div>
          <h3>沒有找到符合的書籍</h3>
          <p>請嘗試不同關鍵字或按右下角 ➕ 掃描或手動新增藏書</p>
        </div>
      `;
      paginationContainer.innerHTML = "";
      return;
    }

    // 渲染卡片
    booksGrid.innerHTML = currentPageBooks.map((b) => renderBookCard(b)).join("");

    // 點擊卡片開啟詳情
    booksGrid.querySelectorAll(".book-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = parseInt(card.dataset.id, 10);
        const item = cachedBooks.find((x) => x.id === id);
        if (item) openBookDetailModal(item);
      });
    });

    // 渲染分頁控制器
    renderPagination(totalPages, totalItems);
  }

  // 9. 分頁控制項渲染
  function renderPagination(totalPages, totalItems) {
    if (totalPages <= 1) {
      paginationContainer.innerHTML = "";
      return;
    }

    let html = `
      <button class="pagination-btn" id="page-first" ${currentPage === 1 ? 'disabled' : ''} title="第一頁">«</button>
      <button class="pagination-btn" id="page-prev" ${currentPage === 1 ? 'disabled' : ''} title="上一頁">‹ 上一頁</button>
    `;

    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);

    if (startPage > 1) {
      html += `<button class="pagination-btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      html += `<button class="pagination-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">...</span>`;
      html += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `
      <button class="pagination-btn" id="page-next" ${currentPage === totalPages ? 'disabled' : ''} title="下一頁">下一頁 ›</button>
      <button class="pagination-btn" id="page-last" ${currentPage === totalPages ? 'disabled' : ''} title="最後一頁">»</button>
      <div class="pagination-info">每頁 24 本 · 顯示第 ${((currentPage - 1) * PAGE_SIZE) + 1} - ${Math.min(currentPage * PAGE_SIZE, totalItems)} 本 (共 ${totalItems} 本)</div>
    `;

    paginationContainer.innerHTML = html;

    const btnFirst = document.getElementById("page-first");
    const btnPrev = document.getElementById("page-prev");
    const btnNext = document.getElementById("page-next");
    const btnLast = document.getElementById("page-last");

    if (btnFirst) btnFirst.onclick = () => goToPage(1);
    if (btnPrev) btnPrev.onclick = () => goToPage(currentPage - 1);
    if (btnNext) btnNext.onclick = () => goToPage(currentPage + 1);
    if (btnLast) btnLast.onclick = () => goToPage(totalPages);

    paginationContainer.querySelectorAll("button[data-page]").forEach((btn) => {
      btn.onclick = () => goToPage(parseInt(btn.dataset.page, 10));
    });
  }

  function goToPage(page) {
    currentPage = page;
    applyFiltersAndRender();
    const controlsBar = document.querySelector(".controls-bar");
    if (controlsBar) {
      controlsBar.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // 10. 卡片渲染（僅書籍名稱、作者、書封、書架/出版社）
  function renderBookCard(item) {
    const coverUrl = item.cover_url || "";
    const shelfName = item.shelf ? item.shelf.name : (item.publisher || "");

    return `
      <div class="book-card" data-id="${item.id}">
        <div class="book-cover-wrap">
          ${coverUrl ? `
            <img class="book-cover-img" src="${coverUrl}" alt="${item.title}" loading="lazy" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="book-cover-placeholder" style="display: none;">
               <span style="font-size: 2rem;">📖</span>
               <span style="font-size: 0.75rem; margin-top: 0.5rem;">${item.title}</span>
            </div>
          ` : `
            <div class="book-cover-placeholder">
              <span style="font-size: 2rem;">📖</span>
              <span style="font-size: 0.75rem; margin-top: 0.5rem;">${item.title}</span>
            </div>
          `}
        </div>
        <div class="book-details">
          <div class="book-title" title="${item.title}">${item.title}</div>
          <div class="book-author">${item.author_display || "作者不詳"}</div>
          <div class="book-meta-footer">
            <span>${shelfName}</span>
          </div>
        </div>
      </div>
    `;
  }

  // 11. 時間格式化函式 (+8 時區顯示)
  function formatDateTime(isoString) {
    if (!isoString) return "未知時間";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const pad = (n) => String(n).padStart(2, "0");
      const year = d.getFullYear();
      const month = pad(d.getMonth() + 1);
      const date = pad(d.getDate());
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${year}-${month}-${date} ${hours}:${minutes}`;
    } catch (e) {
      return isoString;
    }
  }

  // 12. 條碼掃描 Modal
  function openScanner() {
    scanModal.classList.add("active");
    if (!scannerInstance) {
      const ScannerClass = window.ISBNScanner || window.BarcodeScanner;
      if (ScannerClass) {
        scannerInstance = new ScannerClass("scanner-video", onBarcodeDetected);
      }
    }
    if (scannerInstance) {
      scannerInstance.start().catch((err) => {
        alert(err.message || "無法啟動相機鏡頭");
        closeScanner();
      });
    } else {
      alert("條碼掃描模組尚未就緒，請使用右下角「✍️ 手動輸入 ISBN」！");
      closeScanner();
    }
  }

  function closeScanner() {
    scanModal.classList.remove("active");
    if (scannerInstance) {
      scannerInstance.stop();
    }
  }

  if (btnOpenScan) btnOpenScan.addEventListener("click", openScanner);
  if (btnCloseScan) btnCloseScan.addEventListener("click", closeScanner);

  if (btnSwitchToManual) {
    btnSwitchToManual.addEventListener("click", () => {
      closeScanner();
      openManualAddModal();
    });
  }

  // 13. 掃描條碼成功回呼
  async function onBarcodeDetected(isbn) {
    console.log("掃描偵測到 ISBN:", isbn);
    try {
      const resp = await fetch("/api/isbn/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isbn })
      });

      if (!resp.ok) {
        alert(`查無此 ISBN [${isbn}] 的書目資料，已為您切換至手動填寫！`);
        closeScanner();
        openManualAddModal({ isbn13: isbn });
        return;
      }

      const data = await resp.json();
      closeScanner();
      openManualAddModal(data.book);
    } catch (err) {
      alert(`查詢失敗：${err.message}`);
      closeScanner();
      openManualAddModal({ isbn13: isbn });
    }
  }

  // 14. 手動新增 Modal
  function openManualAddModal(presetData = null) {
    populateShelfDropdowns();

    if (presetData) {
      document.getElementById("manual-title").value = presetData.title || "";
      document.getElementById("manual-author").value = presetData.author_display || "";
      document.getElementById("manual-publisher").value = presetData.publisher || "";
      document.getElementById("manual-isbn13").value = presetData.isbn13 || presetData.isbn10 || presetData.ean || "";
      document.getElementById("manual-pubdate").value = presetData.publication_date || presetData.publication_year || "";
      document.getElementById("manual-cover").value = presetData.cover_url || "";
      document.getElementById("manual-category").value = presetData.category || "";
      document.getElementById("manual-desc").value = presetData.description || "";
      if (manualIsbnInput && (presetData.isbn13 || presetData.isbn10)) {
        manualIsbnInput.value = presetData.isbn13 || presetData.isbn10;
      }
    } else {
      customBookForm.reset();
      if (manualIsbnInput) manualIsbnInput.value = "";
    }

    manualAddModal.classList.add("active");
  }

  function closeManualAddModal() {
    manualAddModal.classList.remove("active");
  }

  if (btnOpenManualAdd) btnOpenManualAdd.addEventListener("click", () => openManualAddModal());
  if (btnCloseManualAdd) btnCloseManualAdd.addEventListener("click", closeManualAddModal);
  if (btnCancelManualAdd) btnCancelManualAdd.addEventListener("click", closeManualAddModal);

  // 手動輸入 ISBN 快速查詢 (三民站內優先)
  if (btnManualIsbnSearch) {
    btnManualIsbnSearch.addEventListener("click", async () => {
      const isbnVal = (manualIsbnInput.value || "").trim();
      if (!isbnVal) {
        alert("請先輸入 ISBN 碼！");
        manualIsbnInput.focus();
        return;
      }

      const hintEl = document.getElementById("manual-isbn-hint");
      hintEl.textContent = `🔍 正在為您查詢 ISBN [${isbnVal}] 的書目資料...`;
      btnManualIsbnSearch.disabled = true;

      try {
        const resp = await fetch("/api/isbn/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isbn: isbnVal })
        });

        if (!resp.ok) {
          hintEl.textContent = `⚠️ 查無此 ISBN 之書目，已自動填入 ISBN 欄位，請直接在下方手動填寫書名與作者。`;
          document.getElementById("manual-isbn13").value = isbnVal;
          document.getElementById("manual-title").focus();
          return;
        }

        const data = await resp.json();
        const b = data.book;

        document.getElementById("manual-title").value = b.title || "";
        document.getElementById("manual-author").value = b.author_display || "";
        document.getElementById("manual-publisher").value = b.publisher || "";
        document.getElementById("manual-isbn13").value = b.isbn13 || b.isbn10 || isbnVal;
        document.getElementById("manual-pubdate").value = b.publication_date || b.publication_year || "";
        document.getElementById("manual-cover").value = b.cover_url || "";
        document.getElementById("manual-category").value = b.category || "";
        document.getElementById("manual-desc").value = b.description || "";

        hintEl.textContent = `✅ 成功取得書目《${b.title}》！封面已自動下載至伺服器。`;
      } catch (err) {
        hintEl.textContent = `⚠️ 查詢失敗：${err.message}`;
      } finally {
        btnManualIsbnSearch.disabled = false;
      }
    });
  }

  // 提交新增藏書 (單一 API 請求)
  if (btnSubmitManualAdd) {
    btnSubmitManualAdd.addEventListener("click", async () => {
      const title = document.getElementById("manual-title").value.trim();
      if (!title) {
        alert("請輸入書名！");
        document.getElementById("manual-title").focus();
        return;
      }

      const author = document.getElementById("manual-author").value.trim();
      const publisher = document.getElementById("manual-publisher").value.trim();
      const isbn13 = document.getElementById("manual-isbn13").value.trim();
      const pubdate = document.getElementById("manual-pubdate").value.trim();
      const coverUrl = document.getElementById("manual-cover").value.trim();
      const category = document.getElementById("manual-category").value.trim();
      const desc = document.getElementById("manual-desc").value.trim();
      const shelfId = document.getElementById("manual-shelf").value;
      const notes = document.getElementById("manual-notes").value.trim();

      btnSubmitManualAdd.disabled = true;
      btnSubmitManualAdd.textContent = "儲存中...";

      try {
        const targetUuid = crypto.randomUUID ? crypto.randomUUID() : `book_${Date.now()}`;
        const bookPayload = {
          title: title,
          author_display: author || null,
          publisher: publisher || null,
          isbn13: isbn13 || null,
          publication_date: pubdate || null,
          publication_year: pubdate ? pubdate.substring(0, 4) : null,
          cover_url: coverUrl || null,
          category: category || null,
          description: desc || null,
          shelf_id: shelfId ? parseInt(shelfId, 10) : null,
          notes: notes || null,
          metadata_source: "Manual",
          uuid: targetUuid
        };

        let serverSaved = false;
        if (navigator.onLine) {
          try {
            const createBookResp = await fetch("/api/books", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bookPayload)
            });
            if (createBookResp.ok) {
              const savedItem = await createBookResp.json();
              if (window.offlineStorage) {
                await window.offlineStorage.saveOfflineBook({ ...bookPayload, id: savedItem.id, uuid: savedItem.uuid }, false);
                await window.offlineStorage.markAsSynced([savedItem.uuid]);
              }
              serverSaved = true;
            }
          } catch (netErr) {
            console.warn("線上新增伺服器無回應，自動降級為離線新增:", netErr);
          }
        }

        if (!serverSaved && window.offlineStorage) {
          await window.offlineStorage.saveOfflineBook(bookPayload, true);
        }

        closeManualAddModal();
        await loadOfflineData();
        if (serverSaved) {
          alert(`🎉《${title}》已成功加入您的藏書庫！`);
        } else {
          alert(`⚡《${title}》已儲存至手機本地（待連線時點擊「🔄」同步至 NAS）。`);
        }
      } catch (err) {
        alert(`❌ 新增失敗：${err.message}`);
      } finally {
        btnSubmitManualAdd.disabled = false;
        btnSubmitManualAdd.textContent = "➕ 儲存並加入藏書";
      }
    });
  }

  // 15. 藏書詳細資訊與修改/刪除視窗（含替換封面圖片功能）
  function openBookDetailModal(item) {
    activeBook = item;
    document.getElementById("detail-modal-title").textContent = "藏書詳細資訊";

    let shelfOptions = `<option value="">未分類</option>`;
    for (const s of shelvesList) {
      const selected = item.shelf_id === s.id ? "selected" : "";
      shelfOptions += `<option value="${s.id}" ${selected}>${s.name}</option>`;
    }

    const modalBody = document.getElementById("detail-modal-body");
    modalBody.innerHTML = `
      <div style="display: flex; gap: 1.25rem;">
        <div style="width: 110px; height: 155px; background: var(--bg-input); border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; position: relative;">
          ${item.cover_url ? `
            <img id="detail-cover-img" src="${item.cover_url}" style="width: 100%; height: 100%; object-fit: cover;">
          ` : `
            <div id="detail-cover-placeholder" style="display:flex;height:100%;align-items:center;justify-content:center;font-size:2.5rem;">📖</div>
          `}
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 0.25rem;">
          <h2 style="font-size: 1.15rem; font-weight: 700;">${item.title}</h2>
          ${item.subtitle ? `<p style="font-size: 0.85rem; color: var(--text-muted);">${item.subtitle}</p>` : ""}
          <p style="font-size: 0.9rem; color: var(--text-secondary);">作者：${item.author_display || '未知'}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">出版社：${item.publisher || '未知'}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">出版日期：${item.publication_date || item.publication_year || '未知'}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">ISBN: ${item.isbn13 || item.isbn10 || item.ean || '無'}</p>
          <p style="font-size: 0.8rem; color: var(--primary); margin-top: 0.25rem;">🕒 加入時間：${formatDateTime(item.created_at)}</p>
        </div>
      </div>

      <!-- 替換書封圖片功能 -->
      <div class="form-group" style="margin-top: 0.75rem; background: var(--bg-input); padding: 0.75rem; border-radius: var(--radius-sm);">
        <label class="form-label" style="font-weight: 600; font-size: 0.85rem;">🖼️ 替換書封圖片</label>
        <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
          <input type="url" id="replace-cover-url" class="form-control" placeholder="輸入新的封面網址 (URL)..." style="font-size: 0.85rem;">
          <button id="btn-save-cover-url" class="btn btn-secondary" style="white-space: nowrap; font-size: 0.8rem;">替換網址</button>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <input type="file" id="replace-cover-file" accept="image/*" style="display: none;">
          <button id="btn-trigger-cover-file" class="btn btn-secondary" style="font-size: 0.8rem; width: 100%;">
            📁 上傳本機封面檔案
          </button>
        </div>
      </div>

      ${item.description ? `
        <div class="form-group">
          <label class="form-label">內容大意簡介</label>
          <div style="font-size: 0.85rem; color: var(--text-secondary); max-height: 100px; overflow-y: auto; background: var(--bg-input); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm);">
            ${item.description}
          </div>
        </div>
      ` : ""}

      <div class="form-group">
        <label class="form-label">所屬書架</label>
        <select id="edit-shelf" class="form-control">${shelfOptions}</select>
      </div>

      <div class="form-group">
        <label class="form-label">個人心得 / 備忘筆記</label>
        <textarea id="edit-notes" class="form-control" rows="3" placeholder="記錄你的閱讀心得或備忘...">${item.notes || ''}</textarea>
      </div>
    `;

    const modalFooter = document.getElementById("detail-modal-footer");
    modalFooter.innerHTML = `
      <button class="btn btn-danger" id="btn-delete-book" style="margin-right: auto;">🗑️ 移出收藏</button>
      <button class="btn btn-secondary" id="btn-cancel-edit">關閉</button>
      <button class="btn btn-primary" id="btn-save-edit">💾 儲存修改</button>
    `;

    document.getElementById("btn-cancel-edit").onclick = () => bookDetailModal.classList.remove("active");

    // 替換封面 - 網址
    document.getElementById("btn-save-cover-url").onclick = async () => {
      const newUrl = document.getElementById("replace-cover-url").value.trim();
      if (!newUrl) {
        alert("請輸入圖片網址！");
        return;
      }
      try {
        const resp = await fetch(`/api/books/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_url: newUrl })
        });
        if (resp.ok) {
          const updatedBook = await resp.json();
          alert("✅ 封面替換成功！");
          item.cover_url = updatedBook.cover_url;
          openBookDetailModal(item);
          loadBooksFromServer();
        } else {
          alert("替換失敗，請確認網址是否正確。");
        }
      } catch (err) {
        alert("異常：" + err.message);
      }
    };

    // 替換封面 - 上傳本機檔案
    const fileInput = document.getElementById("replace-cover-file");
    document.getElementById("btn-trigger-cover-file").onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append("file", file);

      try {
        const resp = await fetch(`/api/books/${item.id}/cover`, {
          method: "POST",
          body: formData
        });
        if (resp.ok) {
          const updatedBook = await resp.json();
          alert("✅ 封面圖檔上傳成功！");
          item.cover_url = updatedBook.cover_url;
          openBookDetailModal(item);
          loadBooksFromServer();
        } else {
          alert("上傳失敗。");
        }
      } catch (err) {
        alert("上傳異常：" + err.message);
      }
    };

    // 儲存修改
    document.getElementById("btn-save-edit").onclick = async () => {
      const shelfVal = document.getElementById("edit-shelf").value;
      const notesVal = document.getElementById("edit-notes").value;
      const updatedFields = {
        ...item,
        shelf_id: shelfVal ? parseInt(shelfVal, 10) : null,
        notes: notesVal
      };

      let serverUpdated = false;
      if (navigator.onLine && item.id) {
        try {
          const resp = await fetch(`/api/books/${item.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shelf_id: updatedFields.shelf_id,
              notes: updatedFields.notes
            })
          });
          if (resp.ok) {
            serverUpdated = true;
          }
        } catch (netErr) {
          console.warn("線上更新失敗，轉為離線更新隊列:", netErr);
        }
      }

      if (window.offlineStorage) {
        await window.offlineStorage.saveOfflineBook(updatedFields, false);
        if (serverUpdated) {
          await window.offlineStorage.markAsSynced([item.uuid]);
        }
      }

      bookDetailModal.classList.remove("active");
      await loadOfflineData();
    };

    // 移出藏書
    document.getElementById("btn-delete-book").onclick = async () => {
      if (!confirm(`確定要將《${item.title}》從個人藏書中移出嗎？`)) return;

      let serverDeleted = false;
      if (navigator.onLine && item.id) {
        try {
          const resp = await fetch(`/api/books/${item.id}`, { method: "DELETE" });
          if (resp.ok) {
            serverDeleted = true;
          }
        } catch (netErr) {
          console.warn("線上刪除失敗，轉為離線軟刪除隊列:", netErr);
        }
      }

      if (window.offlineStorage) {
        if (serverDeleted) {
          const tx = window.offlineStorage.db.transaction("cached_books", "readwrite");
          tx.objectStore("cached_books").delete(item.uuid);
        } else {
          await window.offlineStorage.deleteOfflineBook(item.uuid);
        }
      }

      bookDetailModal.classList.remove("active");
      await loadOfflineData();
      if (!serverDeleted) {
        alert(`已從本地移出《${item.title}》，連上家中 Wi-Fi 或 VPN 點擊「🔄」時將自動自 NAS 刪除。`);
      }
    };

    bookDetailModal.classList.add("active");
  }

  if (btnCloseDetail) {
    btnCloseDetail.addEventListener("click", () => {
      bookDetailModal.classList.remove("active");
    });
  }

  // 16. 註冊 Service Worker 與版號顯示控制
  const swBadge = document.getElementById("sw-version-badge");

  function requestSwVersion(worker) {
    if (!worker) return;
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      if (event.data && event.data.version) {
        const fullVer = event.data.version;
        activeSwVersionName = fullVer;
        const shortMatch = fullVer.match(/-(v[\d.]+)$/);
        if (swBadge) {
          swBadge.textContent = shortMatch ? shortMatch[1] : fullVer;
          swBadge.title = `當前 SW 快取版本：${fullVer}（點擊開啟同步管理面板）`;
        }
        if (syncSwVersion) {
          syncSwVersion.textContent = fullVer;
        }
      }
    };
    worker.postMessage({ type: "GET_VERSION" }, [messageChannel.port2]);
  }

  // 直接讀取 /sw.js 檔案內容解析 CACHE_NAME（供非 HTTPS 區網環境或備援使用，支援 localStorage 持久化記憶）
  async function fetchSwFileVersion() {
    // 1. 先從 localStorage 秒讀上次記住的版號（確保離線時 0 秒顯示，版號永不消失）
    const storedVer = localStorage.getItem("cached_sw_version");
    if (storedVer && !activeSwVersionName) {
      activeSwVersionName = storedVer;
      const shortMatch = storedVer.match(/-(v[\d.]+)$/);
      if (swBadge) {
        swBadge.textContent = shortMatch ? shortMatch[1] : storedVer;
        swBadge.title = `SW 版號（本地記憶）：${storedVer}（點擊開啟同步管理面板）`;
      }
      if (syncSwVersion) {
        syncSwVersion.textContent = storedVer;
      }
    }

    // 2. 若處於連線狀態，嘗試讀取伺服器最新檔案並更新本地記憶
    try {
      let resp = await fetch("/sw.js?t=" + Date.now());
      if (!resp.ok) {
        resp = await fetch("/static/sw.js?t=" + Date.now());
      }
      if (resp && resp.ok) {
        const text = await resp.text();
        const match = text.match(/CACHE_NAME\s*=\s*["']([^"']+)["']/);
        if (match && match[1]) {
          const fullVer = match[1];
          activeSwVersionName = fullVer;
          localStorage.setItem("cached_sw_version", fullVer); // 永久保存最新版號至手機本地

          const shortMatch = fullVer.match(/-(v[\d.]+)$/);
          if (swBadge) {
            swBadge.textContent = shortMatch ? shortMatch[1] : fullVer;
            swBadge.title = `SW 檔案版號：${fullVer}（點擊開啟同步管理面板）`;
          }
          if (syncSwVersion) {
            syncSwVersion.textContent = fullVer;
          }
          return fullVer;
        }
      }
    } catch (e) {
      // 離線狀態連線失敗完全正常，靜默使用 storedVer
      console.warn("離線或讀取 sw.js 檔案版號失敗:", e);
    }
    return storedVer || null;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (reg.active) {
        requestSwVersion(reg.active);
      }
      if (reg.installing) {
        reg.installing.addEventListener("statechange", (e) => {
          if (e.target.state === "activated") {
            requestSwVersion(navigator.serviceWorker.controller || reg.active);
          }
        });
      }
    }).catch((err) => {
      console.warn("ServiceWorker 註冊失敗，嘗試降級讀取檔案版號:", err);
      fetchSwFileVersion();
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (navigator.serviceWorker.controller) {
        requestSwVersion(navigator.serviceWorker.controller);
      }
    });

    // 啟動 1.5 秒若 SW 未回應版號，自動讀取檔案補齊
    setTimeout(() => {
      if (!activeSwVersionName) {
        fetchSwFileVersion();
      }
    }, 1500);
  } else {
    // 非安全連線 (如 HTTP 區網 IP) 降級直接讀取檔案中的 CACHE_NAME
    fetchSwFileVersion();
  }

  // 17. 同步狀態與快取管理控制面板 (Sync Modal)
  async function updateSyncModalInfo() {
    if (syncSwVersion) {
      syncSwVersion.textContent = activeSwVersionName || "讀取中...";
      if (!activeSwVersionName) {
        fetchSwFileVersion();
      }
    }
    if (syncLocalCount) {
      syncLocalCount.textContent = `${cachedBooks.length.toLocaleString()} 本`;
    }
    if (syncPendingCount && window.offlineStorage) {
      try {
        const pendingCount = await window.offlineStorage.getPendingCount();
        if (pendingCount > 0) {
          syncPendingCount.textContent = `${pendingCount} 筆待上傳異動 ⚠️`;
          syncPendingCount.style.color = "var(--warning)";
        } else {
          syncPendingCount.textContent = "0 筆（所有變更已同步）";
          syncPendingCount.style.color = "var(--text-primary)";
        }
      } catch (e) {
        syncPendingCount.textContent = "0 筆";
      }
    }
    if (syncLastTime && window.offlineStorage) {
      try {
        const meta = await window.offlineStorage.getSyncMeta();
        if (meta && meta.timestamp) {
          const d = new Date(meta.timestamp);
          syncLastTime.textContent = d.toLocaleString("zh-TW", { hour12: false });
        } else {
          syncLastTime.textContent = "尚未記錄（可點擊下方立即同步）";
        }
      } catch (e) {
        syncLastTime.textContent = "讀取失敗";
      }
    }
    if (syncCoverCount && window.offlineStorage) {
      try {
        const coverStats = await window.offlineStorage.getCoverCacheStats();
        if (coverStats.total > 0 && coverStats.cached >= coverStats.total) {
          syncCoverCount.textContent = `✅ 100% 全量快取 (${coverStats.cached} 張)`;
          syncCoverCount.style.color = "var(--success)";
        } else if (coverStats.total > 0) {
          syncCoverCount.textContent = `⚡ 已離線 ${coverStats.cached} / ${coverStats.total} 張`;
          syncCoverCount.style.color = "var(--primary)";
        } else {
          syncCoverCount.textContent = "無封面需快取";
        }
      } catch (e) {
        syncCoverCount.textContent = "未檢測";
      }
    }
  }

  const openSyncModal = () => {
    updateSyncModalInfo();
    fetchSwFileVersion(); // 打開面板時背景確認最新版號
    if (syncModal) syncModal.classList.add("active");
  };

  const closeSyncModal = () => {
    if (syncModal) syncModal.classList.remove("active");
  };

  if (btnOpenSync) btnOpenSync.addEventListener("click", openSyncModal);
  if (swBadge) swBadge.addEventListener("click", openSyncModal);
  if (btnCloseSync) btnCloseSync.addEventListener("click", closeSyncModal);

  if (syncModal) {
    syncModal.addEventListener("click", (e) => {
      if (e.target === syncModal) closeSyncModal();
    });
  }

  // 手動觸發與 NAS 雙向同步 (Push -> Pull -> Merge -> Prefetch All Covers)
  if (btnTriggerSync) {
    btnTriggerSync.addEventListener("click", async () => {
      const origText = btnTriggerSync.innerHTML;
      btnTriggerSync.disabled = true;
      btnTriggerSync.innerHTML = "⏳ 正在探測 NAS 連線...";

      try {
        if (!window.offlineStorage) {
          throw new Error("離線資料庫尚未就緒");
        }

        btnTriggerSync.innerHTML = "🔄 正在執行手動雙向同步...";
        const syncResult = await window.offlineStorage.syncTwoWay();

        // 重新讀取本地最新資料庫，並同步檢查最新版號
        await loadOfflineData();
        await fetchSwFileVersion();
        await updateSyncModalInfo();

        // 方案 A：在背景執行書封全量預載並更新狀態（防禦性容錯：若舊快取尚未就緒則平滑略過）
        const hasPrefetch = typeof window.offlineStorage?.prefetchCovers === "function";
        if (hasPrefetch) {
          if (syncCoverCount) syncCoverCount.textContent = "⏳ 正在背景預載書封...";
          window.offlineStorage.prefetchCovers((done, total) => {
            if (syncCoverCount) {
              syncCoverCount.textContent = `⏳ 正在預載 ${done} / ${total} 張...`;
            }
          }).then(() => {
            updateSyncModalInfo();
          }).catch((coverErr) => {
            console.warn("書封背景預載過程提示:", coverErr);
          });
        } else {
          console.warn("離線模組尚未包含 prefetchCovers 方法，已平滑略過書封預載。");
        }

        let msg = `✅ 雙向同步完成！\n` +
          `• 上傳本地異動：${syncResult.pushed_count} 筆\n` +
          `• 拉取雲端更新：${syncResult.pulled_updates} 筆\n` +
          `• 雲端同步刪除：${syncResult.pulled_deleted} 筆\n` +
          `目前手機本地藏書共 ${cachedBooks.length.toLocaleString()} 本。`;

        if (hasPrefetch) {
          msg += `\n已在背景為您啟動【全量書封離線預載】（出門開飛航模式也能秒看所有封面）！`;
        }
        alert(msg);
      } catch (err) {
        alert("⚠️ 同步失敗：" + err.message);
      } finally {
        btnTriggerSync.disabled = false;
        btnTriggerSync.innerHTML = origText;
      }
    });
  }

  // 強制檢查並更新快取（一鍵自清所有舊快取，強破 iOS/Android 死鎖）
  if (btnForceUpdateSw) {
    btnForceUpdateSw.addEventListener("click", async () => {
      const origText = btnForceUpdateSw.innerHTML;
      btnForceUpdateSw.disabled = true;
      btnForceUpdateSw.innerHTML = "⏳ 正在強制清除舊快取並升級...";

      try {
        // 1. 清除本地記錄的舊版號
        localStorage.removeItem("cached_sw_version");
        activeSwVersionName = "";

        // 2. 清除所有 Cache Storage 靜態快取
        if ("caches" in window) {
          try {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((k) => caches.delete(k)));
            console.log("✅ 已清空本地 Cache Storage");
          } catch (cErr) {
            console.warn("清空 Cache Storage 提示:", cErr);
          }
        }

        // 3. 註銷舊版 Service Worker
        if ("serviceWorker" in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const reg of registrations) {
              await reg.unregister();
            }
            console.log("✅ 已註銷舊版 Service Worker");
          } catch (swErr) {
            console.warn("註銷 ServiceWorker 提示:", swErr);
          }
        }

        // 4. 強制穿透快取向伺服器拉取最新版號
        const newVer = await fetchSwFileVersion();
        alert(`✅ 快取已徹底清除！\n已取得最新伺服器版本：${newVer || "最新版"}\n即將重新載入頁面！`);

        // 5. 帶防快取時間戳重載頁面，徹底打破 iOS WebKit 磁碟快取
        window.location.href = window.location.origin + window.location.pathname + "?_t=" + Date.now();
      } catch (e) {
        console.error("清除快取重載異常:", e);
        window.location.reload();
      } finally {
        btnForceUpdateSw.disabled = false;
        btnForceUpdateSw.innerHTML = origText;
      }
    });
  }

  // 18. 匯出藏書 CSV + 書封 ZIP 打包
  if (btnExportZip) {
    btnExportZip.addEventListener("click", async () => {
      if (!navigator.onLine) {
        alert("離線狀態下無法使用伺服器打包匯出功能，請連線後再試。");
        return;
      }

      const originalText = btnExportZip.textContent;
      btnExportZip.disabled = true;
      btnExportZip.textContent = "⏳";
      btnExportZip.title = "正在打包藏書資料與書封圖片...";

      try {
        const resp = await fetch("/api/export/zip");
        if (!resp.ok) {
          throw new Error(`伺服器錯誤 (${resp.status})`);
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);

        let filename = "book_storage_backup.zip";
        const disposition = resp.headers.get("Content-Disposition");
        if (disposition && disposition.includes("filename=")) {
          const match = disposition.match(/filename="?([^"]+)"?/);
          if (match && match[1]) filename = match[1];
        }

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err) {
        console.error("匯出失敗:", err);
        alert("匯出失敗：" + err.message);
      } finally {
        btnExportZip.disabled = false;
        btnExportZip.textContent = originalText;
        btnExportZip.title = "匯出藏書 CSV 與封面圖片 (ZIP)";
      }
    });
  }

  // 19. 應用程式啟動生命週期：優先載入本地離線資料 (10ms 秒開)
  initAppLifecycle();
});
