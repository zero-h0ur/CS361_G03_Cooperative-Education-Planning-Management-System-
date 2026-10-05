/** @jest-environment jsdom */

const {
  buildCompanyQuery,
  mergeUniqueCompanies,
  getDataStatusIndicator,
  createLatestRequestTracker
} = require('../company-directory-helpers');

describe('company directory helpers', () => {
  test('builds the supported V2 company query', () => {
    const query = buildCompanyQuery({
      query: '  developer  ',
      location: 'กรุงเทพฯ',
      page: 2,
      pageSize: 10
    });

    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      q: 'developer',
      location: 'กรุงเทพฯ',
      page: '2',
      pageSize: '10'
    });
  });

  test('omits empty optional filters', () => {
    const params = new URLSearchParams(buildCompanyQuery());

    expect(params.has('q')).toBe(false);
    expect(params.has('location')).toBe(false);
    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe('10');
  });

  test('merges pages without duplicating a company id', () => {
    const firstPage = [{ id: 1, name: 'Company A' }, { id: 2, name: 'Company B' }];
    const secondPage = [{ id: 2, name: 'Company B updated' }, { id: 3, name: 'Company C' }];

    expect(mergeUniqueCompanies(firstPage, secondPage)).toEqual([
      { id: 1, name: 'Company A' },
      { id: 2, name: 'Company B updated' },
      { id: 3, name: 'Company C' }
    ]);
  });

  test.each([
    [{ data_status: 'mock', source: 'seed' }, 'ข้อมูลจำลอง', 'status-mock'],
    [{ data_status: 'verified', source: 'mock' }, 'ข้อมูลจำลอง', 'status-mock'],
    [{ data_status: 'to_validate', source: 'seed' }, 'รอตรวจสอบ', 'status-to-validate']
  ])('maps mock and to_validate records to visible badges', (company, label, className) => {
    expect(getDataStatusIndicator(company)).toEqual({ label, className });
  });

  test('does not add a warning badge to a verified record', () => {
    expect(getDataStatusIndicator({ data_status: 'verified', source: 'official' })).toBeNull();
  });

  test('invalidates an older request before its response can update the page', () => {
    const tracker = createLatestRequestTracker();
    const firstRequest = tracker.start();

    tracker.invalidate();
    const secondRequest = tracker.start();

    expect(tracker.isCurrent(firstRequest)).toBe(false);
    expect(tracker.isCurrent(secondRequest)).toBe(true);
  });
});

describe('company directory browser flow', () => {
  function company(id, overrides = {}) {
    return {
      id: String(id),
      name: `Company ${id}`,
      location: 'กรุงเทพฯ',
      source: 'mock',
      updated_at: '2026-10-01T00:00:00.000Z',
      data_status: 'mock',
      positions: [],
      ...overrides
    };
  }

  function apiResponse(data, { page = 1, totalPages = 1 } = {}) {
    return {
      ok: true,
      json: jest.fn().mockResolvedValue({
        data,
        pagination: { page, pageSize: 10, totalPages }
      })
    };
  }

  function setupDirectoryDom() {
    document.body.innerHTML = `
      <header class="header"></header>
      <p id="searchResultStatus" aria-live="polite"></p>
      <label for="companySearch">
        <input id="companySearch" type="search">
      </label>
      <label class="directory-location-filter" for="locationFilter">
        <select id="locationFilter">
          <option value="">ทุกสถานที่</option>
          <option value="กรุงเทพฯ">กรุงเทพฯ</option>
          <option value="ชลบุรี">ชลบุรี</option>
        </select>
      </label>
      <section id="companyList">
        <article class="partner-card" data-company="Static One กรุงเทพฯ"></article>
        <article class="partner-card partner-card-extra" data-company="Static Two ชลบุรี"></article>
      </section>
      <button id="loadMoreCompanies" type="button" aria-expanded="false">ดูเพิ่มเติม</button>
    `;

    window.CompanyDirectoryHelpers = require('../company-directory-helpers');
  }

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function loadDirectoryScript() {
    jest.isolateModules(() => {
      require('../company-directory');
    });
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useRealTimers();
    setupDirectoryDom();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('resets search and location requests to page 1', async () => {
    jest.useFakeTimers();
    const firstPage = Array.from({ length: 10 }, (_, index) => company(index + 1));
    global.fetch = jest.fn()
      .mockResolvedValueOnce(apiResponse(firstPage, { totalPages: 2 }))
      .mockResolvedValueOnce(apiResponse([company(11)], { page: 2, totalPages: 2 }))
      .mockResolvedValueOnce(apiResponse([], { totalPages: 1 }))
      .mockResolvedValueOnce(apiResponse([], { totalPages: 1 }));

    loadDirectoryScript();
    await flushAsyncWork();

    document.getElementById('loadMoreCompanies').click();
    await flushAsyncWork();

    const search = document.getElementById('companySearch');
    search.value = 'developer';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    jest.advanceTimersByTime(300);
    await flushAsyncWork();

    const searchUrl = new URL(global.fetch.mock.calls[2][0], 'http://localhost');
    expect(searchUrl.searchParams.get('q')).toBe('developer');
    expect(searchUrl.searchParams.get('page')).toBe('1');

    const location = document.getElementById('locationFilter');
    location.value = 'ชลบุรี';
    location.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsyncWork();

    const filterUrl = new URL(global.fetch.mock.calls[3][0], 'http://localhost');
    expect(filterUrl.searchParams.get('location')).toBe('ชลบุรี');
    expect(filterUrl.searchParams.get('page')).toBe('1');
  });

  test('opens static fallback safely after the initial API request fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockRejectedValue(new Error('API unavailable'));

    loadDirectoryScript();
    await flushAsyncWork();

    expect(document.getElementById('offlineBanner')).not.toBeNull();
    expect(document.querySelectorAll('#companyList .partner-card')).toHaveLength(2);
    expect(document.getElementById('locationFilter').disabled).toBe(true);
    expect(document.querySelector('.directory-location-filter').hidden).toBe(true);
    expect(document.getElementById('searchResultStatus').hasAttribute('aria-busy')).toBe(false);
  });

  test('renders API text as text without executing or inserting HTML', async () => {
    const unsafeName = '<img src=x onerror="window.__xssExecuted = true">';
    global.fetch = jest.fn().mockResolvedValue(apiResponse([
      company(1, { name: unsafeName })
    ]));

    loadDirectoryScript();
    await flushAsyncWork();

    const companyList = document.getElementById('companyList');
    expect(companyList.querySelector('h2').textContent).toBe(unsafeName);
    expect(companyList.querySelector('img')).toBeNull();
    expect(window.__xssExecuted).toBeUndefined();
  });

  test('disables load more while loading and appends only new companies', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => company(index + 1));
    let resolveNextPage;
    const nextPagePromise = new Promise((resolve) => {
      resolveNextPage = resolve;
    });

    global.fetch = jest.fn()
      .mockResolvedValueOnce(apiResponse(firstPage, { totalPages: 2 }))
      .mockImplementationOnce(() => nextPagePromise);

    loadDirectoryScript();
    await flushAsyncWork();

    const loadMore = document.getElementById('loadMoreCompanies');
    loadMore.click();
    expect(loadMore.disabled).toBe(true);
    expect(loadMore.textContent).toBe('กำลังโหลด...');

    resolveNextPage(apiResponse([
      company(10, { name: 'Company 10 updated' }),
      company(11)
    ], { page: 2, totalPages: 2 }));
    await flushAsyncWork();

    const cards = document.querySelectorAll('#companyList .partner-card-dynamic');
    expect(cards).toHaveLength(11);
    expect(Array.from(cards).filter((card) => card.textContent.includes('Company 11'))).toHaveLength(1);
    expect(loadMore.hidden).toBe(true);
  });
});
