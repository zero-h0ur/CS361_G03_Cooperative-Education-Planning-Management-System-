/**
 * Company Directory - Public V2 API Implementation
 */

// DOM Elements
const companySearch = document.getElementById('companySearch');
const searchResultStatus = document.getElementById('searchResultStatus');
const companyList = document.getElementById('companyList');
const loadMoreButton = document.getElementById('loadMoreCompanies');
const locationFilter = document.getElementById('locationFilter');
const {
  buildCompanyQuery,
  mergeUniqueCompanies,
  getDataStatusIndicator,
  createLatestRequestTracker
} = window.CompanyDirectoryHelpers;

// Fallback items
const staticCompanyCards = Array.from(companyList.children);
let hasExpandedDirectory = false;

// State
let state = {
  mode: 'api', // 'api' or 'static'
  query: '',
  location: '',
  page: 1,
  pageSize: 10,
  totalPages: 1,
  loading: false,
  error: null
};

let abortController = null;
let debounceTimer = null;
let apiDataStore = [];
const requestTracker = createLatestRequestTracker();
const apiBaseUrl = String(window.CO_ED_CONFIG?.apiBaseUrl || '')
  .trim()
  .replace(/\/+$/, '');

function buildApiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

function cancelPendingRequest() {
  requestTracker.invalidate();
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}

/**
 * Creates a DOM element safely
 */
function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined && textContent !== null) el.textContent = textContent;
  return el;
}

/**
 * Formats date
 */
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isValidCompanyListResponse(json) {
  const pagination = json && json.pagination;

  return Boolean(
    json
    && Array.isArray(json.data)
    && pagination
    && Number.isInteger(pagination.page)
    && pagination.page >= 1
    && Number.isInteger(pagination.pageSize)
    && pagination.pageSize >= 1
    && Number.isInteger(pagination.total)
    && pagination.total >= 0
    && Number.isInteger(pagination.totalPages)
    && pagination.totalPages >= 0
  );
}

/**
 * Generates a company card from API data
 */
function createCompanyCardFromAPI(company) {
  const article = document.createElement('article');
  article.className = 'partner-card partner-card-dynamic';

  const infoDiv = document.createElement('div');
  infoDiv.className = 'partner-info';

  const headerRow = document.createElement('div');
  headerRow.className = 'partner-card-header';

  const nameEl = createElement('h2', '', company.name || 'ไม่มีชื่อ');
  headerRow.appendChild(nameEl);

  const statusIndicator = getDataStatusIndicator(company);
  if (statusIndicator) {
    headerRow.appendChild(createElement(
      'span',
      `partner-tag partner-status-badge ${statusIndicator.className}`,
      statusIndicator.label
    ));
  }

  infoDiv.appendChild(headerRow);

  const tagsDiv = document.createElement('div');
  tagsDiv.className = 'partner-tags';

  if (company.location) {
    tagsDiv.appendChild(createElement('span', 'partner-tag tag-location', company.location));
  }

  if (company.source) {
    tagsDiv.appendChild(createElement('span', 'partner-tag tag-metadata', `แหล่งที่มา: ${company.source}`));
  }

  const updatedDate = formatDate(company.updated_at);
  if (updatedDate) {
    tagsDiv.appendChild(createElement('span', 'partner-tag tag-metadata', `อัปเดต: ${updatedDate}`));
  }

  if (!statusIndicator && company.data_status) {
    tagsDiv.appendChild(createElement('span', 'partner-tag tag-metadata', `สถานะ: ${company.data_status}`));
  }

  if (Array.isArray(company.positions)) {
    company.positions.filter((position) => position && position.title).forEach((pos) => {
      tagsDiv.appendChild(createElement('span', 'partner-tag tag-field', pos.title));
    });
  }

  infoDiv.appendChild(tagsDiv);
  article.appendChild(infoDiv);

  return article;
}

/**
 * Fallback to static logic
 */
function activateStaticFallback() {
  if (state.mode === 'static') return; // Prevent duplicate execution
  state.mode = 'static';
  searchResultStatus.removeAttribute('aria-busy');
  companyList.innerHTML = '';
  staticCompanyCards.forEach(card => companyList.appendChild(card));

  if (!document.getElementById('offlineBanner')) {
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.className = 'directory-offline-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'ไม่สามารถดึงข้อมูลล่าสุดได้ ขณะนี้กำลังแสดงข้อมูลตัวอย่าง โปรดรีเฟรชหน้าเพื่อลองอีกครั้ง';

    const header = document.querySelector('.header');
    if (header) {
      header.appendChild(banner);
    }
  }

  const updateStaticVisibility = () => {
    const query = companySearch.value.trim().toLocaleLowerCase('th');
    let visibleCount = 0;
    Array.from(companyList.children).forEach((card) => {
      const companyText = card.dataset.company ? card.dataset.company.toLocaleLowerCase('th') : '';
      const matchesQuery = !query || companyText.includes(query);
      const isExtraCard = card.classList.contains('partner-card-extra');
      const canShowByGroup = !isExtraCard || hasExpandedDirectory || Boolean(query);
      const shouldShow = matchesQuery && canShowByGroup;
      card.hidden = !shouldShow;
      if (shouldShow) visibleCount += 1;
    });
    loadMoreButton.hidden = Boolean(query) || hasExpandedDirectory;
    if (query) {
      searchResultStatus.textContent = visibleCount > 0
        ? `พบสถานประกอบการ ${visibleCount} รายการ`
        : 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
    } else {
      searchResultStatus.textContent = '';
    }
  };

  companySearch.removeEventListener('input', onSearchInput);
  if (locationFilter) {
    locationFilter.removeEventListener('change', onFilterChange);
    locationFilter.value = '';
    locationFilter.disabled = true;
    const filterContainer = locationFilter.closest('.directory-location-filter');
    if (filterContainer) {
      filterContainer.hidden = true;
      filterContainer.style.display = 'none';
    }
  }
  companySearch.addEventListener('input', updateStaticVisibility);

  loadMoreButton.onclick = () => {
    hasExpandedDirectory = true;
    loadMoreButton.setAttribute('aria-expanded', 'true');
    updateStaticVisibility();
  };

  updateStaticVisibility();
}

/**
 * Render the API state to DOM
 */
function renderState() {
  if (state.mode === 'static') return;

  if (state.page === 1) {
    companyList.innerHTML = '';
  }

  if (state.loading && state.page === 1) {
    searchResultStatus.textContent = 'กำลังโหลดข้อมูล...';
    searchResultStatus.setAttribute('aria-busy', 'true');
    companyList.innerHTML = '';
    loadMoreButton.hidden = true;
    return;
  }

  searchResultStatus.removeAttribute('aria-busy');

  if (state.error) {
    searchResultStatus.textContent = typeof state.error === 'string' ? state.error : 'ไม่สามารถโหลดข้อมูลจากระบบได้ กรุณาลองใหม่อีกครั้ง';
    companyList.innerHTML = '';
    loadMoreButton.hidden = true;
    return;
  }

  if (state.page === 1 && apiDataStore.length === 0) {
    searchResultStatus.textContent = 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
    loadMoreButton.hidden = true;
    return;
  }

  searchResultStatus.textContent = `แสดงสถานประกอบการ ${apiDataStore.length} รายการ`;

  // Render cards
  const fragment = document.createDocumentFragment();
  const startIdx = (state.page - 1) * state.pageSize;
  const newItems = apiDataStore.slice(startIdx);

  newItems.forEach(company => {
    fragment.appendChild(createCompanyCardFromAPI(company));
  });

  companyList.appendChild(fragment);

  // Update Load More button
  if (state.loading && state.page > 1) {
    loadMoreButton.hidden = false;
    loadMoreButton.disabled = true;
    loadMoreButton.textContent = 'กำลังโหลด...';
  } else if (state.page < state.totalPages) {
    loadMoreButton.hidden = false;
    loadMoreButton.disabled = false;
    loadMoreButton.textContent = 'ดูเพิ่มเติม';
  } else {
    loadMoreButton.hidden = true;
  }
}

/**
 * Fetch data from API
 */
async function fetchCompanies(isAppend = false) {
  if (state.mode === 'static') return;

  if (abortController) {
    abortController.abort();
  }
  const controller = new AbortController();
  abortController = controller;
  const requestVersion = requestTracker.start();

  state.loading = true;
  state.error = null;
  renderState();

  try {
    const queryString = buildCompanyQuery(state);

    const response = await fetch(buildApiUrl(`/api/companies?${queryString}`), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    if (response.status === 400) {
      let errorMsg = 'ข้อมูลการค้นหาไม่ถูกต้อง';
      try {
        const errJson = await response.json();
        if (typeof errJson?.error?.message === 'string') {
          errorMsg = errJson.error.message;
        }
      } catch (e) {}
      const err = new Error('ValidationError');
      err.validationMessage = errorMsg;
      throw err;
    }

    if (!response.ok) {
      throw new Error('ServiceError: ' + response.status);
    }

    const json = await response.json();
    if (!isValidCompanyListResponse(json)) {
      throw new Error('ServiceError: invalid response contract');
    }
    if (!requestTracker.isCurrent(requestVersion)) return;

    if (!isAppend) {
      apiDataStore = [];
    }

    apiDataStore = mergeUniqueCompanies(apiDataStore, json.data);
    state.totalPages = json.pagination.totalPages;

    state.loading = false;
    if (abortController === controller) abortController = null;
    renderState();

  } catch (error) {
    if (error.name === 'AbortError' || !requestTracker.isCurrent(requestVersion)) return;
    
    console.error('Failed to fetch companies:', error);
    state.loading = false;
    if (abortController === controller) abortController = null;
    
    if (error.message === 'ValidationError') {
      state.error = error.validationMessage;
      renderState();
      return;
    }
    
    // Unconditional fallback on Service failure / Network error / Invalid JSON
    activateStaticFallback();
  }
}

/**
 * Event Handlers
 */
function onSearchInput(e) {
  state.query = e.target.value.trim();
  state.page = 1;

  cancelPendingRequest();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fetchCompanies(false);
  }, 300);
}

function onFilterChange(e) {
  state.location = e.target.value;
  state.page = 1;
  fetchCompanies(false);
}

// Bind Events
companySearch.addEventListener('input', onSearchInput);
if (locationFilter) locationFilter.addEventListener('change', onFilterChange);

loadMoreButton.onclick = () => {
  if (state.mode === 'api' && !state.loading && state.page < state.totalPages) {
    state.page += 1;
    fetchCompanies(true);
  }
};

// Initial Load
fetchCompanies(false);
