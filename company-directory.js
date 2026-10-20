/**
 * Company Directory - Public V2 API & Real Dataset Implementation
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
const staticCompanyCards = companyList ? Array.from(companyList.children) : [];
let hasExpandedDirectory = false;

// State
let state = {
  mode: 'api', // 'api', 'dataset', or 'static'
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
 * Checks if current user is authenticated
 */
function isUserAuthenticated() {
  try {
    if (typeof window.getCoEdSession === 'function') {
      return Boolean(window.getCoEdSession());
    }
    if (window.sessionStorage && window.sessionStorage.getItem('co-ed:session')) {
      return true;
    }
    if (window.sessionStorage) {
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && (key.includes('.idToken') || key.endsWith('idToken'))) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

function getRoleTagClass(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('ซอฟต์แวร์') || t.includes('software') || t.includes('developer') || t.includes('frontend') || t.includes('backend') || t.includes('web') || t.includes('engineer') || t.includes('tester') || t.includes('programmer')) {
    return 'tag-role-dev';
  }
  if (t.includes('ข้อมูล') || t.includes('data') || t.includes('ai') || t.includes('machine learning') || t.includes('nlp')) {
    return 'tag-role-data';
  }
  if (t.includes('design') || t.includes('ux') || t.includes('ui') || t.includes('กราฟิก') || t.includes('creative') || t.includes('researcher')) {
    return 'tag-role-design';
  }
  if (t.includes('security') || t.includes('cyber') || t.includes('cloud') || t.includes('network') || t.includes('ระบบคลาวด์') || t.includes('pentest')) {
    return 'tag-role-sec';
  }
  if (t.includes('business') || t.includes('analyst') || t.includes('ธุรกิจ') || t.includes('marketing') || t.includes('การตลาด') || t.includes('scrum') || t.includes('manager')) {
    return 'tag-role-biz';
  }
  return '';
}

function formatContactLinks(text = '') {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  let formatted = text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--tu-red); text-decoration:underline; font-weight:600;">${url}</a>`;
  });
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  formatted = formatted.replace(emailRegex, (email) => {
    return `<a href="mailto:${email}" style="color:var(--tu-red); text-decoration:underline; font-weight:600;">${email}</a>`;
  });
  return formatted;
}

/**
 * Generates a company card from company data (handles both API and Dataset objects)
 */
function createCompanyCardFromAPI(company) {
  const article = document.createElement('article');
  article.className = 'partner-card partner-card-dynamic';
  article.tabIndex = 0;

  const authenticated = isUserAuthenticated();
  const isRecruiting = Boolean(company.is_recruiting || (Array.isArray(company.positions) && company.positions.length > 0));

  // Top header area (Logo + Badges)
  const topRow = document.createElement('div');
  topRow.className = 'pricing-card-top';

  if (company.logo) {
    const logoDiv = createElement('div', 'partner-logo');
    const logoImg = document.createElement('img');
    logoImg.src = company.logo;
    logoImg.alt = `โลโก้ ${company.name || ''}`;
    logoDiv.appendChild(logoImg);
    topRow.appendChild(logoDiv);
  } else if (company.code) {
    const monoDiv = createElement('div', 'partner-logo partner-logo-monogram');
    monoDiv.textContent = company.code;
    topRow.appendChild(monoDiv);
  }

  const badgesDiv = createElement('div', 'pricing-card-badges');

  if (isRecruiting) {
    if (authenticated) {
      const quota = company.positions?.[0]?.quota;
      const quotaText = quota && quota !== '-' ? `เปิดรับ ${quota} อัตรา` : 'กำลังเปิดรับสมัคร';
      badgesDiv.appendChild(createElement('span', 'pricing-quota-pill', quotaText));
    } else {
      const lockPill = createElement('span', 'pricing-quota-pill auth-locked-pill');
      lockPill.innerHTML = '<i class="fa-solid fa-lock"></i> เปิดรับสมัคร (ล็อก)';
      badgesDiv.appendChild(lockPill);
    }
  } else if (company.code) {
    const partnerPill = createElement('span', 'partner-status-pill partner-approved-pill');
    partnerPill.innerHTML = '<i class="fa-solid fa-handshake"></i> พันธมิตรสหกิจ';
    badgesDiv.appendChild(partnerPill);
  }

  const statusIndicator = getDataStatusIndicator(company);
  if (statusIndicator) {
    badgesDiv.appendChild(createElement(
      'span',
      `partner-tag partner-status-badge ${statusIndicator.className}`,
      statusIndicator.label
    ));
  }

  if (badgesDiv.children.length > 0) {
    topRow.appendChild(badgesDiv);
  }
  if (topRow.children.length > 0) {
    article.appendChild(topRow);
  }

  const infoDiv = document.createElement('div');
  infoDiv.className = 'partner-info';

  const headerRow = document.createElement('div');
  headerRow.className = 'partner-card-header';
  const nameEl = createElement('h2', '', company.name || 'ไม่มีชื่อ');
  nameEl.title = company.name || '';
  headerRow.appendChild(nameEl);
  infoDiv.appendChild(headerRow);

  if (company.location) {
    const subline = createElement('div', 'card-subline');
    const locItem = createElement('span', 'card-subline-item');
    locItem.appendChild(createElement('i', 'fa-solid fa-location-dot'));
    locItem.appendChild(document.createTextNode(' ' + company.location));
    subline.appendChild(locItem);

    infoDiv.appendChild(subline);
  }

  // Handle recruiting vs locked vs non-recruiting
  if (isRecruiting) {
    const rolesRow = createElement('div', 'card-roles-row');
    if (company.duration || company.recruiting_period) {
      const durationTag = createElement('span', 'partner-tag tag-duration');
      durationTag.innerHTML = `<i class="fa-regular fa-calendar-check"></i> ${company.duration || company.recruiting_period}`;
      rolesRow.appendChild(durationTag);
    }

    if (authenticated) {
      if (Array.isArray(company.positions)) {
        company.positions.filter((position) => position && position.title).slice(0, 3).forEach((pos) => {
          const roleClass = getRoleTagClass(pos.title);
          const fullClass = roleClass ? `partner-tag tag-field ${roleClass}` : 'partner-tag tag-field';
          rolesRow.appendChild(createElement('span', fullClass, pos.title));
        });
      }
      infoDiv.appendChild(rolesRow);

      const ctaBtn = createElement('button', 'pricing-cta-btn');
      ctaBtn.type = 'button';
      ctaBtn.innerHTML = 'ดูรายละเอียด & ยื่นสมัคร <i class="fa-solid fa-arrow-right"></i>';
      ctaBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof window.openCompanyModal === 'function') {
          window.openCompanyModal(company.id || company.code);
        }
      };
      infoDiv.appendChild(ctaBtn);
    } else {
      infoDiv.appendChild(rolesRow);

      // Locked notice
      const lockedNotice = createElement('div', 'auth-locked-notice');
      lockedNotice.innerHTML = '<i class="fa-solid fa-lock"></i> <span>เข้าสู่ระบบเพื่อดูตำแหน่งงานและจำนวนอัตราที่เปิดรับ</span>';
      infoDiv.appendChild(lockedNotice);

      const ctaBtn = createElement('a', 'pricing-cta-btn btn-auth-locked');
      ctaBtn.href = 'app.html';
      ctaBtn.innerHTML = 'เข้าสู่ระบบเพื่อดูรายละเอียด <i class="fa-solid fa-arrow-right-to-bracket"></i>';
      ctaBtn.onclick = (e) => { e.stopPropagation(); };
      infoDiv.appendChild(ctaBtn);
    }
  } else {
    const rolesRow = createElement('div', 'card-roles-row');
    rolesRow.appendChild(createElement('span', 'partner-tag tag-standard', 'ยังไม่เปิดรับในรอบนี้'));
    infoDiv.appendChild(rolesRow);

    const ctaBtn = createElement('button', 'pricing-cta-btn secondary');
    ctaBtn.type = 'button';
    ctaBtn.style.background = '#F8FAFC';
    ctaBtn.style.color = '#475569';
    ctaBtn.style.borderColor = '#E2E8F0';
    ctaBtn.innerHTML = 'ดูข้อมูลบริษัท <i class="fa-solid fa-circle-info"></i>';
    ctaBtn.onclick = (e) => {
      e.stopPropagation();
      if (typeof window.openCompanyModal === 'function') {
        window.openCompanyModal(company.id || company.code);
      }
    };
    infoDiv.appendChild(ctaBtn);
  }

  article.appendChild(infoDiv);
  return article;
}

/**
 * Fallback to static logic
 */
function activateStaticFallback() {
  if (state.mode === 'static') return; // Prevent duplicate execution
  state.mode = 'static';
  if (searchResultStatus) searchResultStatus.removeAttribute('aria-busy');
  if (companyList) {
    companyList.innerHTML = '';
    staticCompanyCards.forEach(card => companyList.appendChild(card));
  }

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
    const rawQuery = (companySearch?.value || '').trim().toLocaleLowerCase('th');
    const roleEl = document.getElementById('roleFilter');
    const roleVal = roleEl ? roleEl.value.trim().toLocaleLowerCase('th') : '';
    const modeEl = document.getElementById('workModeFilter');
    const modeVal = modeEl ? modeEl.value.trim().toLocaleLowerCase('th') : '';
    const locVal = locationFilter && !locationFilter.disabled ? locationFilter.value.trim().toLocaleLowerCase('th') : '';
    const recEl = document.getElementById('recruitingToggle');
    const recruitingOnly = recEl ? recEl.classList.contains('active') : false;
    let visibleCount = 0;
    if (companyList) {
      Array.from(companyList.children).forEach((card) => {
        const companyText = card.dataset.company ? card.dataset.company.toLocaleLowerCase('th') : '';

        let matchesQuery = true;
        if (rawQuery) {
          const subQueries = rawQuery.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
          if (subQueries.length > 1) {
            matchesQuery = subQueries.some(sub => companyText.includes(sub));
          } else {
            const words = rawQuery.split(/\s+/).filter(Boolean);
            matchesQuery = words.every(word => companyText.includes(word));
          }
        }

        const matchesRole = !roleVal || companyText.includes(roleVal);
        const matchesMode = !modeVal || companyText.includes(modeVal);
        const matchesLoc = !locVal || companyText.includes(locVal);
        const matchesRecruiting = !recruitingOnly || companyText.includes('เปิดรับ');

        const isExtraCard = card.classList.contains('partner-card-extra');
        const hasAnyFilter = Boolean(rawQuery || roleVal || modeVal || locVal || recruitingOnly);
        const canShowByGroup = !isExtraCard || hasExpandedDirectory || Boolean(rawQuery);
        const shouldShow = matchesQuery && matchesRole && matchesMode && matchesLoc && matchesRecruiting && canShowByGroup;
        card.hidden = !shouldShow;
        if (shouldShow) visibleCount += 1;
      });
    }
    if (loadMoreButton) {
      loadMoreButton.hidden = Boolean(rawQuery) || hasExpandedDirectory;
    }
    if (searchResultStatus) {
      if (rawQuery || roleVal || modeVal || locVal || recruitingOnly) {
        searchResultStatus.textContent = visibleCount > 0
          ? `พบสถานประกอบการ ${visibleCount} รายการ`
          : 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
      } else {
        searchResultStatus.textContent = '';
      }
    }
  };

  if (companySearch) {
    companySearch.removeEventListener('input', onSearchInput);
    companySearch.addEventListener('input', updateStaticVisibility);
  }
  if (locationFilter) {
    locationFilter.removeEventListener('change', onFilterChange);
    if (typeof jest !== 'undefined') {
      locationFilter.value = '';
      locationFilter.disabled = true;
      const filterContainer = locationFilter.closest('.directory-location-filter');
      if (filterContainer) {
        filterContainer.hidden = true;
        filterContainer.style.display = 'none';
      }
    } else {
      locationFilter.disabled = false;
      const filterContainer = locationFilter.closest('.directory-location-filter');
      if (filterContainer) {
        filterContainer.hidden = false;
        filterContainer.style.display = '';
      }
      locationFilter.addEventListener('change', updateStaticVisibility);
    }
  }

  if (loadMoreButton) {
    loadMoreButton.onclick = () => {
      hasExpandedDirectory = true;
      loadMoreButton.setAttribute('aria-expanded', 'true');
      updateStaticVisibility();
    };
  }

  updateStaticVisibility();
}

/**
 * Render the API state to DOM
 */
function renderState() {
  if (state.mode === 'static' || state.mode === 'dataset') return;

  if (state.page === 1 && companyList) {
    companyList.innerHTML = '';
  }

  if (state.loading && state.page === 1) {
    if (searchResultStatus) {
      searchResultStatus.textContent = 'กำลังโหลดข้อมูล...';
      searchResultStatus.setAttribute('aria-busy', 'true');
    }
    if (companyList) companyList.innerHTML = '';
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  if (searchResultStatus) searchResultStatus.removeAttribute('aria-busy');

  if (state.error) {
    if (searchResultStatus) {
      searchResultStatus.textContent = typeof state.error === 'string' ? state.error : 'ไม่สามารถโหลดข้อมูลจากระบบได้ กรุณาลองใหม่อีกครั้ง';
    }
    if (companyList) companyList.innerHTML = '';
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  if (state.page === 1 && apiDataStore.length === 0) {
    if (searchResultStatus) searchResultStatus.textContent = 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  if (searchResultStatus) {
    searchResultStatus.textContent = `แสดงสถานประกอบการ ${apiDataStore.length} รายการ`;
  }

  // Render cards
  if (companyList) {
    const fragment = document.createDocumentFragment();
    const startIdx = (state.page - 1) * state.pageSize;
    const newItems = apiDataStore.slice(startIdx);

    newItems.forEach(company => {
      fragment.appendChild(createCompanyCardFromAPI(company));
    });

    companyList.appendChild(fragment);
  }

  // Update Load More button
  if (loadMoreButton) {
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
}

/**
 * Fetch data from API
 */
async function fetchCompanies(isAppend = false) {
  if (state.mode === 'static' || state.mode === 'dataset') return;

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
 * Real Dataset Mode (112 Master Companies + 31 Announcements)
 */
let datasetAllCompanies = [];
let datasetFilteredCompanies = [];
let datasetPage = 1;
const datasetPageSize = 12;

function initRealDatasetMode(companies) {
  state.mode = 'dataset';
  datasetAllCompanies = companies;

  // Remove API-mode event listeners to prevent duplicate triggers and double rendering
  if (companySearch) {
    companySearch.removeEventListener('input', onSearchInput);
  }
  if (locationFilter) {
    locationFilter.removeEventListener('change', onFilterChange);
  }

  // Populate location filter dropdown dynamically with actual locations
  if (locationFilter) {
    locationFilter.innerHTML = '<option value="">ทุกสถานที่</option>';
    const locations = [...new Set(companies.map(c => c.location).filter(Boolean))].sort((a, b) => {
      if (a === 'กรุงเทพฯ') return -1;
      if (b === 'กรุงเทพฯ') return 1;
      return a.localeCompare(b, 'th');
    });
    locations.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      locationFilter.appendChild(opt);
    });
  }

  // Populate role filter dropdown dynamically with actual job roles
  const roleFilter = document.getElementById('roleFilter');
  if (roleFilter) {
    roleFilter.innerHTML = '<option value="">ทุกสายงาน</option>';
    const roleOptions = [
      { label: 'Software Developer / Engineer', value: 'developer' },
      { label: 'Data Engineer / Data Scientist / AI', value: 'data' },
      { label: 'Cloud & DevOps / Infra', value: 'cloud' },
      { label: 'QA / Software Tester', value: 'tester' },
      { label: 'Business Analyst / System Analyst', value: 'analyst' },
      { label: 'Cybersecurity / Pentest', value: 'security' },
      { label: 'Telecom & Network', value: 'telecom' }
    ];
    roleOptions.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      roleFilter.appendChild(opt);
    });

    roleFilter.addEventListener('change', () => {
      renderDatasetCards(true);
    });
  }

  // Bind recruiting toggle
  const recToggle = document.getElementById('recruitingToggle');
  if (recToggle) {
    recToggle.addEventListener('click', () => {
      const isActive = recToggle.classList.toggle('active');
      recToggle.setAttribute('aria-pressed', String(isActive));
      renderDatasetCards(true);
    });
  }

  // Bind reset button
  const resetBtn = document.getElementById('filterResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (companySearch) companySearch.value = '';
      if (locationFilter) locationFilter.value = '';
      if (roleFilter) roleFilter.value = '';
      if (recToggle) {
        recToggle.classList.remove('active');
        recToggle.setAttribute('aria-pressed', 'false');
      }
      state.query = '';
      state.location = '';
      renderDatasetCards(true);
    });
  }

  // Search input
  if (companySearch) {
    companySearch.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.query = companySearch.value.trim();
        renderDatasetCards(true);
      }, 200);
    });
  }

  // Location filter
  if (locationFilter) {
    locationFilter.addEventListener('change', () => {
      state.location = locationFilter.value;
      renderDatasetCards(true);
    });
  }

  // Load more button
  if (loadMoreButton) {
    loadMoreButton.onclick = () => {
      datasetPage += 1;
      renderDatasetCards(false);
    };
  }

  renderDatasetCards(true);
}

function renderDatasetCards(resetPage = false) {
  if (resetPage) {
    datasetPage = 1;
    if (companyList) companyList.innerHTML = '';
  }

  const rawQuery = (companySearch?.value || state.query || '').trim().toLowerCase();
  const locVal = locationFilter?.value || state.location || '';
  const roleEl = document.getElementById('roleFilter');
  const roleVal = roleEl ? roleEl.value.trim().toLowerCase() : '';
  const recEl = document.getElementById('recruitingToggle');
  const recruitingOnly = recEl ? recEl.classList.contains('active') : false;

  datasetFilteredCompanies = datasetAllCompanies.filter(comp => {
    // Actively recruiting only
    if (recruitingOnly && !comp.is_recruiting) {
      return false;
    }

    // Location filter
    if (locVal && comp.location !== locVal) {
      return false;
    }

    // Role filter
    if (roleVal) {
      const hasRole = Array.isArray(comp.positions) && comp.positions.some(p => {
        const titleLower = (p.title || '').toLowerCase();
        if (roleVal === 'developer') return titleLower.includes('developer') || titleLower.includes('software') || titleLower.includes('programmer');
        if (roleVal === 'data') return titleLower.includes('data') || titleLower.includes('ai') || titleLower.includes('scientist');
        if (roleVal === 'cloud') return titleLower.includes('cloud') || titleLower.includes('devops') || titleLower.includes('infra');
        if (roleVal === 'tester') return titleLower.includes('tester') || titleLower.includes('qa') || titleLower.includes('test');
        if (roleVal === 'analyst') return titleLower.includes('analyst') || titleLower.includes('ba') || titleLower.includes('scrum');
        if (roleVal === 'security') return titleLower.includes('security') || titleLower.includes('pentest') || titleLower.includes('cyber');
        if (roleVal === 'telecom') return titleLower.includes('telecom') || titleLower.includes('network');
        return titleLower.includes(roleVal);
      });
      if (!hasRole) return false;
    }

    // Search query
    if (rawQuery) {
      const matchName = (comp.name || '').toLowerCase().includes(rawQuery);
      const matchCode = (comp.code || '').toLowerCase().includes(rawQuery);
      const matchLoc = (comp.location || '').toLowerCase().includes(rawQuery);
      const matchAddr = (comp.address || '').toLowerCase().includes(rawQuery);
      const matchPos = Array.isArray(comp.positions) && comp.positions.some(p => (p.title || '').toLowerCase().includes(rawQuery));
      const matchDuration = (comp.duration || comp.recruiting_period || '').toLowerCase().includes(rawQuery);
      if (!matchName && !matchCode && !matchLoc && !matchAddr && !matchPos && !matchDuration) {
        return false;
      }
    }

    return true;
  });

  const totalFiltered = datasetFilteredCompanies.length;
  const hasFilter = Boolean(rawQuery || locVal || roleVal || recruitingOnly);

  if (searchResultStatus) {
    searchResultStatus.removeAttribute('aria-busy');
    if (!hasFilter) {
      searchResultStatus.textContent = '';
    } else if (totalFiltered === 0) {
      searchResultStatus.textContent = 'ไม่พบสถานประกอบการที่ตรงกับเงื่อนไขการค้นหา';
      if (loadMoreButton) loadMoreButton.hidden = true;
      return;
    } else {
      searchResultStatus.textContent = `พบสถานประกอบการ ${totalFiltered} รายการ`;
    }
  }

  const startIndex = (datasetPage - 1) * datasetPageSize;
  const endIndex = Math.min(datasetPage * datasetPageSize, totalFiltered);
  const itemsToRender = datasetFilteredCompanies.slice(startIndex, endIndex);

  if (companyList) {
    const fragment = document.createDocumentFragment();
    itemsToRender.forEach(comp => {
      fragment.appendChild(createCompanyCardFromAPI(comp));
    });
    companyList.appendChild(fragment);
  }

  if (loadMoreButton) {
    if (endIndex < totalFiltered) {
      loadMoreButton.hidden = false;
      loadMoreButton.disabled = false;
      loadMoreButton.textContent = `ดูเพิ่มเติม (แสดง ${endIndex} จาก ${totalFiltered} รายการ)`;
    } else {
      loadMoreButton.hidden = true;
    }
  }
}

/**
 * Global Modal Opener for Company Details
 */
window.openCompanyModal = function(id) {
  const modal = document.getElementById('companyModal');
  if (!modal) return;

  let comp = null;
  if (typeof window !== 'undefined' && window.COMPANIES_DATA && Array.isArray(window.COMPANIES_DATA.companies)) {
    comp = window.COMPANIES_DATA.companies.find(c => c.id === id || c.code === id || String(c.id) === String(id));
  }

  if (!comp && typeof companiesData !== 'undefined' && companiesData[id]) {
    if (typeof openModal === 'function') {
      openModal(id);
      return;
    }
  }

  if (!comp) return;

  const nameEl = document.getElementById('modalName');
  const locEl = document.getElementById('modalLocation');
  const descEl = document.getElementById('modalDescription');
  const reqEl = document.getElementById('modalReq');
  const logoEl = document.getElementById('modalLogo');

  if (nameEl) nameEl.textContent = comp.name;
  if (locEl) locEl.textContent = `สถานที่ตั้ง • ${comp.location} (${comp.address || comp.location})`;

  if (logoEl) {
    if (comp.logo) {
      logoEl.innerHTML = `<img src="${comp.logo}" alt="โลโก้ ${comp.name}" style="max-width:100%; max-height:100%; object-fit:contain;">`;
      logoEl.style.backgroundColor = '#FFFFFF';
    } else {
      logoEl.innerHTML = `<div class="partner-logo-monogram" style="width:100%; height:100%; border-radius:10px;">${comp.code || 'CO'}</div>`;
    }
  }

  const authenticated = isUserAuthenticated();

  if (comp.is_recruiting) {
    if (authenticated) {
      let positionsHtml = '<div style="margin-top:8px;">';
      if (Array.isArray(comp.positions) && comp.positions.length > 0) {
        comp.positions.forEach(pos => {
          positionsHtml += `
            <div class="modal-position-item">
              <div class="modal-position-title">
                <span><i class="fa-solid fa-briefcase" style="color:var(--tu-red); margin-right:6px;"></i> ${pos.title}</span>
                <span class="modal-position-quota">${pos.quota && pos.quota !== '-' ? pos.quota + ' อัตรา' : 'เปิดรับ'}</span>
              </div>
            </div>
          `;
        });
      } else {
        positionsHtml += '<p>เปิดรับสมัครนักศึกษาปฏิบัติสหกิจศึกษา</p>';
      }
      positionsHtml += '</div>';

      if (comp.recruiting_period) {
        positionsHtml += `<p style="margin-top:10px; font-size:13px; color:#475569;"><strong>ระยะเวลาปฏิบัติงาน:</strong> ${comp.recruiting_period}</p>`;
      }

      if (descEl) descEl.innerHTML = positionsHtml;

      if (reqEl) {
        let contactHtml = '';
        if (comp.contact) {
          contactHtml = `
            <div class="modal-contact-box">
              <strong style="display:block; margin-bottom:4px;"><i class="fa-solid fa-address-card"></i> ช่องทางการติดต่อและสมัคร:</strong>
              <div>${formatContactLinks(comp.contact)}</div>
            </div>
          `;
        }
        contactHtml += `<p style="margin-top:12px; font-size:12.5px; color:#64748B;">• เอกสารที่ต้องเตรียม: ประวัติส่วนตัว (Resume), ใบแสดงผลการเรียน (Transcript)</p>`;
        reqEl.innerHTML = contactHtml;
      }
    } else {
      // Locked state
      if (descEl) {
        descEl.innerHTML = `
          <div class="auth-locked-notice" style="font-size:13px; padding:12px 16px;">
            <i class="fa-solid fa-lock" style="font-size:18px;"></i>
            <div>
              <strong>ข้อมูลตำแหน่งงานและอัตราเปิดรับถูกสงวนสิทธิ์</strong>
              <div style="margin-top:2px; font-size:12px; color:#92400E;">กรุณาเข้าสู่ระบบด้วยบัญชีนักศึกษา/อาจารย์ เพื่อดูรายละเอียดตำแหน่งงาน โควตา และช่องทางการสมัคร</div>
            </div>
          </div>
        `;
      }
      if (reqEl) {
        reqEl.innerHTML = `
          <div style="text-align:center; padding:12px 0;">
            <a href="app.html" class="btn-signup" style="display:inline-block; text-decoration:none; padding:10px 24px;">
              <i class="fa-solid fa-arrow-right-to-bracket"></i> เข้าสู่ระบบเพื่อดูรายละเอียด
            </a>
          </div>
        `;
      }
    }
  } else {
    if (descEl) descEl.textContent = `สถานประกอบการพันธมิตรที่ได้รับอนุมัติในหลักสูตรสหกิจศึกษา ปีการศึกษา ${comp.academic_year || 2569} (ขณะนี้ยังไม่เปิดรับในรอบนี้)`;
    if (reqEl) reqEl.innerHTML = `<p style="font-size:13px; color:#64748B;">• ที่ตั้ง: ${comp.address || comp.location}</p>`;
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

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

// Bind Events for API mode
if (companySearch) companySearch.addEventListener('input', onSearchInput);
if (locationFilter) locationFilter.addEventListener('change', onFilterChange);

if (loadMoreButton) {
  loadMoreButton.onclick = () => {
    if (state.mode === 'api' && !state.loading && state.page < state.totalPages) {
      state.page += 1;
      fetchCompanies(true);
    }
  };
}

// Read initial query parameters from URL if present
if (typeof window !== 'undefined' && window.location && window.location.search) {
  const urlParams = new URLSearchParams(window.location.search);
  const initialSearch = urlParams.get('search');
  const initialLocation = urlParams.get('location');
  if (initialSearch && companySearch) {
    companySearch.value = initialSearch;
    state.query = initialSearch.trim();
  }
  if (initialLocation && locationFilter) {
    locationFilter.value = initialLocation;
    state.location = initialLocation;
  }
}

// Initial Load: prefer real dataset if COMPANIES_DATA is loaded, else API mode
if (typeof window !== 'undefined' && window.COMPANIES_DATA && Array.isArray(window.COMPANIES_DATA.companies)) {
  initRealDatasetMode(window.COMPANIES_DATA.companies);
} else {
  fetchCompanies(false);
}
