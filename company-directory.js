/**
 * Company Directory - Public V2 API Implementation
 */

// DOM Elements
const companySearch = document.getElementById('companySearch');
const searchResultStatus = document.getElementById('searchResultStatus');
const companyList = document.getElementById('companyList');
const loadMoreButton = document.getElementById('loadMoreCompanies');
const locationFilter = document.getElementById('locationFilter');

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

/**
 * Creates a DOM element safely
 */
function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

/**
 * Formats date
 */
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Generates a company card from API data
 */
function createCompanyCardFromAPI(company) {
  const article = document.createElement('article');
  article.className = 'partner-card';

  // Card Header (Name, location, source)
  const infoDiv = document.createElement('div');
  infoDiv.className = 'partner-info';
  infoDiv.style.width = '100%';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.alignItems = 'flex-start';

  const nameEl = createElement('h2', '', company.name || 'ไม่มีชื่อ');
  headerRow.appendChild(nameEl);

  if (company.data_status === 'mock' || company.source === 'mock') {
    const mockBadge = createElement('span', 'partner-tag tag-benefit', 'TO VALIDATE');
    mockBadge.style.background = '#fef08a';
    mockBadge.style.color = '#854d0e';
    mockBadge.style.fontSize = '10px';
    headerRow.appendChild(mockBadge);
  }

  infoDiv.appendChild(headerRow);

  const tagsDiv = document.createElement('div');
  tagsDiv.className = 'partner-tags';

  if (company.location) {
    tagsDiv.appendChild(createElement('span', 'partner-tag tag-location', company.location));
  }
  
  if (company.updated_at) {
    tagsDiv.appendChild(createElement('span', 'partner-tag', `อัปเดต: ${formatDate(company.updated_at)}`));
  }

  // Display positions if available
  if (company.positions && company.positions.length > 0) {
    company.positions.forEach(pos => {
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
  state.mode = 'static';
  companyList.innerHTML = '';
  staticCompanyCards.forEach(card => companyList.appendChild(card));
  
  // Inject warning banner as a child of .header so it sticks with it
  if (!document.getElementById('offlineBanner')) {
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.backgroundColor = '#f1f5f9'; // gray-100
    banner.style.color = '#334155'; // gray-700
    banner.style.padding = '12px 24px';
    banner.style.textAlign = 'center';
    banner.style.fontSize = '14px';
    banner.style.borderBottom = '1px solid #e2e8f0';
    banner.textContent = '⚠️ แจ้งเตือนสถานะระบบ: ไม่สามารถดึงข้อมูลล่าสุดจากฐานข้อมูลได้ ข้อมูลและรายละเอียดการรับสมัครที่ปรากฏบนหน้าเว็บขณะนี้ เป็นเพียงข้อมูลจำลองสำหรับการทดสอบระบบ โปรดตรวจสอบข้อมูลจริงอีกครั้งในภายหลัง';
    
    const header = document.querySelector('.header');
    if (header) {
      header.appendChild(banner);
    }
  }
  
  // Re-bind original static logic
  const extraCompanyCards = document.querySelectorAll('.partner-card-extra');
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
  if(locationFilter) locationFilter.removeEventListener('change', onFilterChange);
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
    searchResultStatus.textContent = 'ไม่สามารถโหลดข้อมูลจากระบบได้ กรุณาลองใหม่อีกครั้ง';
    return;
  }

  if (state.page === 1 && apiDataStore.length === 0) {
    searchResultStatus.textContent = 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
    loadMoreButton.hidden = true;
    return;
  }

  if (state.page === 1) {
    searchResultStatus.textContent = `พบข้อมูลสถานประกอบการ`;
  }

  // Render cards
  const fragment = document.createDocumentFragment();
  const startIdx = (state.page - 1) * state.pageSize;
  const newItems = apiDataStore.slice(startIdx);
  
  newItems.forEach(company => {
    fragment.appendChild(createCompanyCardFromAPI(company));
  });
  
  companyList.appendChild(fragment);

  // Update Load More button
  if (state.page < state.totalPages) {
    loadMoreButton.hidden = false;
    loadMoreButton.disabled = state.loading;
    loadMoreButton.textContent = state.loading ? 'กำลังโหลด...' : 'ดูเพิ่มเติม';
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
  abortController = new AbortController();

  state.loading = true;
  state.error = null;
  renderState();

  try {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.location) params.set('location', state.location);
    params.set('page', state.page);
    params.set('pageSize', state.pageSize);

    const response = await fetch('/api/companies?' + params.toString(), {
      signal: abortController.signal,
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error('API Error: ' + response.status);
    }

    const json = await response.json();
    
    if (!isAppend) {
      apiDataStore = [];
    }
    
    apiDataStore = [...apiDataStore, ...(json.data || [])];
    
    if (json.pagination) {
      state.totalPages = json.pagination.totalPages || 1;
    } else {
      state.totalPages = 1;
    }
    
    state.loading = false;
    renderState();

  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Failed to fetch companies:', error);
    state.loading = false;
    state.error = error;
    
    // First time load failure -> Fallback to static
    if (apiDataStore.length === 0 && state.page === 1) {
      activateStaticFallback();
    } else {
      renderState();
    }
  }
}

/**
 * Event Handlers
 */
function onSearchInput(e) {
  state.query = e.target.value.trim();
  state.page = 1;
  
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
if(locationFilter) locationFilter.addEventListener('change', onFilterChange);

loadMoreButton.onclick = () => {
  if (state.mode === 'api' && !state.loading && state.page < state.totalPages) {
    state.page += 1;
    fetchCompanies(true);
  }
};

// Initial Load
fetchCompanies(false);

