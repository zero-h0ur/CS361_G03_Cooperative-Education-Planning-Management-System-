const companyList = document.getElementById('companyList');
const companySearch = document.getElementById('companySearch');
const loadMoreButton = document.getElementById('loadMoreCompanies');
const searchResultStatus = document.getElementById('searchResultStatus');

// เก็บการ์ดเดิมไว้เป็น fallback เมื่อเปิดเว็บแบบ Static โดยไม่มี Local Compute Server
const staticCompanyCards = Array.from(companyList.querySelectorAll('.partner-card'));

const state = {
  mode: 'api',
  currentPage: 1,
  totalPages: 1,
  loadedCount: 0,
  query: '',
  requestController: null,
  searchTimer: null
};

function setStatus(message, statusType = '') {
  searchResultStatus.textContent = message;
  if (statusType) {
    searchResultStatus.dataset.state = statusType;
  } else {
    delete searchResultStatus.dataset.state;
  }
}

function setLoading(isLoading) {
  companySearch.setAttribute('aria-busy', String(isLoading));
  loadMoreButton.disabled = isLoading;
  loadMoreButton.setAttribute('aria-busy', String(isLoading));
}

function createTag(text, className) {
  const tag = document.createElement('span');
  tag.className = `partner-tag ${className}`;
  tag.textContent = text;
  return tag;
}

function createCompanyCard(company) {
  const card = document.createElement('article');
  card.className = 'partner-card';
  card.dataset.companyId = company.id;

  const logo = document.createElement('div');
  logo.className = ['partner-logo', company.logoClass].filter(Boolean).join(' ');

  const image = document.createElement('img');
  image.src = company.image;
  image.alt = `โลโก้ ${company.name}`;
  image.loading = 'lazy';
  logo.append(image);

  const information = document.createElement('div');
  information.className = 'partner-info';

  const heading = document.createElement('h2');
  heading.textContent = company.name;

  const tags = document.createElement('div');
  tags.className = 'partner-tags';
  tags.append(
    createTag(company.location, 'tag-location'),
    createTag(company.position, 'tag-field'),
    createTag(company.benefit, 'tag-benefit')
  );

  information.append(heading, tags);
  card.append(logo, information);
  return card;
}

function renderApiResult(result, append = false) {
  if (!append) {
    companyList.replaceChildren();
    state.loadedCount = 0;
  }

  const fragment = document.createDocumentFragment();
  result.items.forEach((company) => fragment.append(createCompanyCard(company)));
  companyList.append(fragment);

  state.currentPage = result.pagination.page;
  state.totalPages = result.pagination.totalPages;
  state.loadedCount += result.items.length;

  if (result.pagination.total === 0) {
    setStatus('ไม่พบสถานประกอบการที่ตรงกับคำค้นหา');
  } else if (result.query) {
    setStatus(
      `พบ ${result.pagination.total} รายการ แสดงแล้ว ${state.loadedCount} รายการ`,
      'compute'
    );
  } else {
    setStatus(
      `แสดง ${state.loadedCount} จาก ${result.pagination.total} รายการ · Local Compute API`,
      'compute'
    );
  }

  loadMoreButton.hidden = !result.pagination.hasNextPage;
  loadMoreButton.setAttribute('aria-expanded', String(state.currentPage > 1));
}

async function requestCompanies({ page = 1, append = false } = {}) {
  state.requestController?.abort();
  const controller = new AbortController();
  state.requestController = controller;

  const query = companySearch.value.trim();
  const parameters = new URLSearchParams({ page: String(page) });
  if (query) parameters.set('q', query);

  setLoading(true);
  setStatus('กำลังค้นหาข้อมูล...');

  try {
    const response = await fetch(`/api/companies?${parameters}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Company API returned ${response.status}`);
    }

    const result = await response.json();
    state.query = query;
    renderApiResult(result, append);
  } finally {
    if (state.requestController === controller) {
      state.requestController = null;
      setLoading(false);
    }
  }
}

function updateStaticVisibility() {
  const query = companySearch.value.trim().toLocaleLowerCase('th');
  let visibleCount = 0;

  staticCompanyCards.forEach((card) => {
    const companyText = card.dataset.company.toLocaleLowerCase('th');
    const isExtraCard = card.classList.contains('partner-card-extra');
    const matchesQuery = !query || companyText.includes(query);
    const canShow = !isExtraCard || state.currentPage > 1 || Boolean(query);
    const shouldShow = matchesQuery && canShow;

    card.hidden = !shouldShow;
    if (shouldShow) visibleCount += 1;
  });

  loadMoreButton.hidden = Boolean(query) || state.currentPage > 1;
  setStatus(
    query
      ? visibleCount > 0
        ? `พบสถานประกอบการ ${visibleCount} รายการ`
        : 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา'
      : ''
  );
}

function activateStaticFallback() {
  state.mode = 'static';
  state.currentPage = 1;
  companyList.replaceChildren(...staticCompanyCards);
  companySearch.disabled = false;
  loadMoreButton.disabled = false;
  updateStaticVisibility();
  console.info('Local Compute API is unavailable. Using static company search.');
}

async function initializeDirectory() {
  try {
    await requestCompanies();
  } catch (error) {
    if (error.name !== 'AbortError') activateStaticFallback();
  }
}

companySearch.addEventListener('input', () => {
  window.clearTimeout(state.searchTimer);

  if (state.mode === 'static') {
    updateStaticVisibility();
    return;
  }

  // ยกเลิกผลการค้นหาเก่าทันที แต่ไม่ปิดช่องค้นหา เพื่อให้พิมพ์ต่อเนื่องได้
  state.requestController?.abort();

  state.searchTimer = window.setTimeout(() => {
    requestCompanies({ page: 1 }).catch((error) => {
      if (error.name !== 'AbortError') {
        console.error(error);
        setStatus('ค้นหาข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
      }
    });
  }, 250);
});

loadMoreButton.addEventListener('click', () => {
  if (state.mode === 'static') {
    state.currentPage = 2;
    loadMoreButton.setAttribute('aria-expanded', 'true');
    updateStaticVisibility();

    const firstExtraCard = staticCompanyCards.find((card) =>
      card.classList.contains('partner-card-extra')
    );
    firstExtraCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (state.currentPage >= state.totalPages) return;

  requestCompanies({ page: state.currentPage + 1, append: true }).catch((error) => {
    if (error.name !== 'AbortError') {
      console.error(error);
      setStatus('โหลดข้อมูลเพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง', 'error');
    }
  });
});

initializeDirectory();
