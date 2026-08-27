/**
 * app.js - 個人藏書庫 SPA 主畫面邏輯、分頁、排序、封面替換與離線整合
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM 元素
  const booksGrid = document.getElementById("books-grid");
  const searchInput = document.getElementById("search-input");
  const filterTabs = document.getElementById("filter-tabs");
  const totalCountEl = document.getElementById("total-count");
  const offlineBanner = document.getElementById("offline-banner");
  const themeToggleBtn = document.getElementById("theme-toggle");
  const paginationContainer = document.getElementById("pagination-container");
  const btnBackToTop = document.getElementById("btn-back-to-top");
  const floatingBackToTop = document.getElementById("floating-back-to-top");

  // Modals
  const scanModal = document.getElementById("scan-modal");
  const bookDetailModal = document.getElementById("book-detail-modal");
  const manualAddModal = document.getElementById("manual-add-modal");
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

  // 狀態管理
  const PAGE_SIZE = 50; // 每頁 50 本書籍
  let currentPage = 1;
  let currentFilter = "all"; // 'all' 或 shelf:ID
  let currentSearch = "";
  let cachedBooks = [];
  let shelvesList = [];
  let activeBook = null;
  let scannerInstance = null;
  let tempLookupBookId = null;

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
    loadBooksFromServer();
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

  // 5. 載入資料 (優先線上，離線則由 IndexedDB 備援)
  async function loadBooksFromServer() {
    if (!navigator.onLine) {
      return loadOfflineData();
    }

    try {
      // 1. 同步書架
      const shelfResp = await fetch("/api/shelves");
      if (shelfResp.ok) {
        shelvesList = await shelfResp.json();
        renderFilterTabs();
        populateShelfDropdowns();
      }

      // 2. 取得全量同步 Dump 並快取至 IndexedDB
      const dumpResp = await fetch("/api/sync/dump");
      if (dumpResp.ok) {
        const dump = await dumpResp.json();
        await window.offlineStorage.syncFromServer(dump);
      }

      // 3. 取得藏書列表
      const booksResp = await fetch("/api/my-books");
      if (booksResp.ok) {
        const data = await booksResp.json();
        cachedBooks = sortBooksByCreatedAtDesc(data);
        applyFiltersAndRender();
      }
    } catch (err) {
      console.warn("無法連線至中央伺服器，切換為離線資料庫:", err);
      loadOfflineData();
    }
  }

  async function loadOfflineData() {
    offlineBanner.classList.add("active");
    const offlineBooks = await window.offlineStorage.getAllBooks();
    const meta = await window.offlineStorage.getSyncMeta();
    if (meta && meta.shelves) {
      shelvesList = meta.shelves;
      renderFilterTabs();
      populateShelfDropdowns();
    }
    
    // 轉為格式相容的清單
    const formatted = offlineBooks.map((item) => ({
      id: item.my_book_id,
      uuid: item.uuid,
      book_id: item.book_id,
      status: item.status,
      shelf_id: item.shelf_id,
      rating: item.rating,
      notes: item.notes,
      purchase_date: item.purchase_date,
      purchase_price: item.purchase_price,
      purchase_place: item.purchase_place,
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
      book: {
        id: item.book_id,
        uuid: item.book_uuid,
        title: item.title,
        subtitle: item.subtitle,
        author_display: item.author,
        publisher: item.publisher,
        publication_date: item.publication_date,
        isbn13: item.isbn13,
        isbn10: item.isbn10,
        ean: item.ean,
        cover_url: item.cover_url,
        description: item.description,
        category: item.category,
        created_at: item.created_at || null
      },
      shelf: item.shelf_name ? { id: item.shelf_id, name: item.shelf_name } : null
    }));

    cachedBooks = sortBooksByCreatedAtDesc(formatted);
    applyFiltersAndRender();
  }

  // 6. 書架與分類標籤渲染 (僅保留「全部書籍」與「所屬書架」)
  function renderFilterTabs() {
    let html = `
      <button class="filter-chip ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">全部書籍</button>
    `;

    for (const shelf of shelvesList) {
      const active = currentFilter === `shelf:${shelf.id}` ? "active" : "";
      html += `<button class="filter-chip ${active}" data-filter="shelf:${shelf.id}">📁 ${shelf.name}</button>`;
    }

    filterTabs.innerHTML = html;

    filterTabs.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentFilter = btn.dataset.filter;
        currentPage = 1; // 切換分類時重設至第一頁
        renderFilterTabs();
        applyFiltersAndRender();
      });
    });
  }

  function populateShelfDropdowns() {
    const manualShelfSelect = document.getElementById("manual-shelf");
    if (!manualShelfSelect) return;
    let shelfOptions = `<option value="">未分類</option>`;
    for (const s of shelvesList) {
      shelfOptions += `<option value="${s.id}">${s.name}</option>`;
    }
    manualShelfSelect.innerHTML = shelfOptions;
  }

  // 7. 格式化日期時間 (UTC+8 台灣時間)
  function formatDateTime(dateStr) {
    if (!dateStr) return "無紀錄";
    try {
      // 支援各種 ISO 或 standard 日期格式
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch {
      return dateStr;
    }
  }

  // 8. 篩選與渲染卡片（純粹卡片：書名、作者、書封）
  function applyFiltersAndRender() {
    let filtered = [...cachedBooks];

    // 書架篩選
    if (currentFilter !== "all") {
      if (currentFilter.startsWith("shelf:")) {
        const shelfId = parseInt(currentFilter.replace("shelf:", ""), 10);
        filtered = filtered.filter((b) => b.shelf_id === shelfId);
      }
    }

    // 關鍵字搜尋
    if (currentSearch) {
      const q = currentSearch.toLowerCase().trim();
      filtered = filtered.filter((b) => {
        const book = b.book || {};
        const titleMatch = (book.title || "").toLowerCase().includes(q);
        const subMatch = (book.subtitle || "").toLowerCase().includes(q);
        const authorMatch = (book.author_display || "").toLowerCase().includes(q);
        const pubMatch = (book.publisher || "").toLowerCase().includes(q);
        const isbn13Match = (book.isbn13 || "").includes(q);
        const isbn10Match = (book.isbn10 || "").includes(q);
        const notesMatch = (b.notes || "").toLowerCase().includes(q);
        return titleMatch || subMatch || authorMatch || pubMatch || isbn13Match || isbn10Match || notesMatch;
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

    totalCountEl.textContent = `共 ${totalItems} 本藏書 ${totalPages > 1 ? `(第 ${currentPage} / ${totalPages} 頁，每頁 50 本)` : ""}`;

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
      <div class="pagination-info">每頁 50 本 · 顯示第 ${((currentPage - 1) * PAGE_SIZE) + 1} - ${Math.min(currentPage * PAGE_SIZE, totalItems)} 本 (共 ${totalItems} 本)</div>
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
    const book = item.book || {};
    const coverUrl = book.cover_url || "";

    return `
      <div class="book-card" data-id="${item.id}">
        <div class="book-cover-wrap">
          ${coverUrl ? `
            <img class="book-cover-img" src="${coverUrl}" alt="${book.title}" loading="lazy" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="book-cover-placeholder" style="display: none;">
              <span style="font-size: 2rem;">📖</span>
              <span style="font-size: 0.75rem; margin-top: 0.5rem;">${book.title}</span>
            </div>
          ` : `
            <div class="book-cover-placeholder">
              <span style="font-size: 2rem;">📖</span>
              <span style="font-size: 0.75rem; margin-top: 0.5rem;">${book.title}</span>
            </div>
          `}
        </div>
        <div class="book-details">
          <div class="book-title" title="${book.title}">${book.title}</div>
          <div class="book-author">${book.author_display || "作者不詳"}</div>
          <div class="book-meta-footer">
            <span>${item.shelf ? item.shelf.name : (book.publisher || "")}</span>
          </div>
        </div>
      </div>
    `;
  }

  // 11. 搜尋防抖
  let debounceTimer;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentSearch = e.target.value;
      currentPage = 1;
      applyFiltersAndRender();
    }, 200);
  });

  // 12. 條碼掃描 Modal
  if (btnOpenScan) {
    btnOpenScan.addEventListener("click", () => {
      scanModal.classList.add("active");
      startScanner();
    });
  }

  if (btnCloseScan) {
    btnCloseScan.addEventListener("click", closeScanner);
  }

  if (btnSwitchToManual) {
    btnSwitchToManual.addEventListener("click", () => {
      closeScanner();
      openManualAddModal();
    });
  }

  function startScanner() {
    const video = document.getElementById("scanner-video");
    const scanStatus = document.getElementById("scan-status-text");
    scanStatus.textContent = "鏡頭開啟中，請將條碼對準紅線...";

    scannerInstance = new ISBNScanner("scanner-video", (detectedIsbn) => {
      scanStatus.textContent = `🎯 偵測到 ISBN: ${detectedIsbn}，查詢書目中...`;
      handleIsbnLookup(detectedIsbn);
    });

    scannerInstance.start().catch((err) => {
      scanStatus.textContent = `⚠️ ${err.message}`;
    });
  }

  function closeScanner() {
    if (scannerInstance) {
      scannerInstance.stop();
      scannerInstance = null;
    }
    scanModal.classList.remove("active");
  }

  // 13. ISBN 查詢與自動填入
  async function handleIsbnLookup(isbn) {
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
    tempLookupBookId = presetData?.id || null;

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
      tempLookupBookId = null;
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
        tempLookupBookId = b.id || null;

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

  // 提交手動新增書籍
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
        let bookId = tempLookupBookId;

        // 若無 bookId 則先向後端建立全域書籍 Book (後端會自動下載外部封面圖)
        if (!bookId) {
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
            metadata_source: "Manual",
            uuid: crypto.randomUUID ? crypto.randomUUID() : null
          };

          const createBookResp = await fetch("/api/books", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bookPayload)
          });

          if (!createBookResp.ok) {
            const errData = await createBookResp.json();
            throw new Error(errData.detail || "建立書籍資料失敗");
          }

          const createdBook = await createBookResp.json();
          bookId = createdBook.id;
        }

        // 加入個人藏書 MyBook
        const myBookPayload = {
          book_id: bookId,
          shelf_id: shelfId ? parseInt(shelfId, 10) : null,
          notes: notes || null,
          uuid: crypto.randomUUID ? crypto.randomUUID() : null
        };

        const myBookResp = await fetch("/api/my-books", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(myBookPayload)
        });

        if (!myBookResp.ok) {
          const errData = await myBookResp.json();
          throw new Error(errData.detail || "加入個人藏書失敗");
        }

        closeManualAddModal();
        alert(`🎉《${title}》已成功加入您的藏書庫！`);
        await loadBooksFromServer();
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
    const book = item.book || {};
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
          ${book.cover_url ? `
            <img id="detail-cover-img" src="${book.cover_url}" style="width: 100%; height: 100%; object-fit: cover;">
          ` : `
            <div id="detail-cover-placeholder" style="display:flex;height:100%;align-items:center;justify-content:center;font-size:2.5rem;">📖</div>
          `}
        </div>
        <div style="flex: 1; display: flex; flex-direction: column; gap: 0.25rem;">
          <h2 style="font-size: 1.15rem; font-weight: 700;">${book.title}</h2>
          ${book.subtitle ? `<p style="font-size: 0.85rem; color: var(--text-muted);">${book.subtitle}</p>` : ""}
          <p style="font-size: 0.9rem; color: var(--text-secondary);">作者：${book.author_display || '未知'}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">出版社：${book.publisher || '未知'}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">出版日期：${book.publication_date || book.publication_year || '未知'}</p>
          <p style="font-size: 0.85rem; color: var(--text-muted);">ISBN: ${book.isbn13 || book.isbn10 || book.ean || '無'}</p>
          <p style="font-size: 0.8rem; color: var(--primary); margin-top: 0.25rem;">🕒 加入時間：${formatDateTime(item.created_at || book.created_at)}</p>
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

      ${book.description ? `
        <div class="form-group">
          <label class="form-label">內容大意簡介</label>
          <div style="font-size: 0.85rem; color: var(--text-secondary); max-height: 100px; overflow-y: auto; background: var(--bg-input); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm);">
            ${book.description}
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
        const resp = await fetch(`/api/books/${book.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cover_url: newUrl })
        });
        if (resp.ok) {
          const updatedBook = await resp.json();
          alert("✅ 封面替換成功！");
          book.cover_url = updatedBook.cover_url;
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
        const resp = await fetch(`/api/books/${book.id}/cover`, {
          method: "POST",
          body: formData
        });
        if (resp.ok) {
          const updatedBook = await resp.json();
          alert("✅ 封面圖檔上傳成功！");
          book.cover_url = updatedBook.cover_url;
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

      try {
        const resp = await fetch(`/api/my-books/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shelf_id: shelfVal ? parseInt(shelfVal, 10) : null,
            notes: notesVal
          })
        });

        if (resp.ok) {
          bookDetailModal.classList.remove("active");
          loadBooksFromServer();
        }
      } catch (err) {
        alert("更新失敗：" + err.message);
      }
    };

    // 移出藏書
    document.getElementById("btn-delete-book").onclick = async () => {
      if (!confirm(`確定要將《${book.title}》從個人藏書中移出嗎？`)) return;
      try {
        const resp = await fetch(`/api/my-books/${item.id}`, { method: "DELETE" });
        if (resp.ok) {
          bookDetailModal.classList.remove("active");
          loadBooksFromServer();
        }
      } catch (err) {
        alert("刪除失敗：" + err.message);
      }
    };

    bookDetailModal.classList.add("active");
  }

  if (btnCloseDetail) {
    btnCloseDetail.addEventListener("click", () => {
      bookDetailModal.classList.remove("active");
    });
  }

  // 16. 註冊 Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/static/sw.js").catch((err) => {
      console.warn("ServiceWorker 註冊失敗:", err);
    });
  }

  // 初始載入
  loadBooksFromServer();
});
