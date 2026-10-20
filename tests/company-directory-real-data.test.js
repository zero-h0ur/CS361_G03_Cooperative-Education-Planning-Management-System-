/** @jest-environment jsdom */

const dataset = require('../data/companies.json');

describe('Company Directory - Real Dataset & Auth Lock State', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    delete window.CO_ED_CONFIG;
    window.COMPANIES_DATA = dataset;
    window.CompanyDirectoryHelpers = require('../company-directory-helpers');

    document.body.innerHTML = `
      <header class="header">
        <div class="auth-buttons">
          <a href="app.html" class="btn-login">เข้าสู่ระบบ</a>
        </div>
      </header>
      <input id="companySearch" type="search">
      <div id="searchResultStatus"></div>
      <label class="directory-location-filter" for="locationFilter">
        <select id="locationFilter">
          <option value="">ทุกสถานที่</option>
        </select>
      </label>
      <select id="roleFilter">
        <option value="">ทุกสายงาน</option>
      </select>
      <button type="button" id="recruitingToggle" aria-pressed="false">เปิดรับสมัครอยู่</button>
      <button type="button" id="filterResetBtn">ล้างตัวกรอง</button>
      <section id="companyList"></section>
      <button id="loadMoreCompanies" type="button" aria-expanded="false">ดูเพิ่มเติม</button>

      <div id="companyModal" class="modal-overlay">
        <div class="modal-container">
          <div id="modalLogo"></div>
          <h3 id="modalName"></h3>
          <p id="modalLocation"></p>
          <div id="modalDescription"></div>
          <div id="modalReq"></div>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    jest.resetModules();
    delete window.COMPANIES_DATA;
  });

  function loadDirectoryScript() {
    jest.isolateModules(() => {
      require('../company-directory');
    });
  }

  test('renders locked view for anonymous users on actively recruiting companies', () => {
    loadDirectoryScript();

    const companyList = document.getElementById('companyList');
    expect(companyList.children.length).toBeGreaterThan(0);

    // Find an actively recruiting company card (e.g. CDG C01 or Agoda C43)
    const cards = Array.from(companyList.querySelectorAll('.partner-card'));
    const lockedCard = cards.find(card => card.querySelector('.auth-locked-notice'));
    expect(lockedCard).not.toBeUndefined();

    // Verify locked badge and CTA
    expect(lockedCard.querySelector('.auth-locked-pill')).not.toBeNull();
    expect(lockedCard.querySelector('.auth-locked-notice').textContent).toContain('เข้าสู่ระบบเพื่อดูตำแหน่งงานและจำนวนอัตราที่เปิดรับ');
    const ctaBtn = lockedCard.querySelector('.btn-auth-locked');
    expect(ctaBtn).not.toBeNull();
    expect(ctaBtn.getAttribute('href')).toBe('app.html');
  });

  test('renders unlocked view with positions and quotas when user is authenticated', () => {
    window.sessionStorage.setItem('co-ed:session', JSON.stringify({
      name: 'ทดสอบ นักศึกษา',
      email: 'student@dome.tu.ac.th',
      role: 'STUDENT'
    }));

    loadDirectoryScript();

    const companyList = document.getElementById('companyList');
    const cards = Array.from(companyList.querySelectorAll('.partner-card'));
    const recruitingCard = cards.find(card => card.querySelector('.pricing-quota-pill:not(.auth-locked-pill)'));
    expect(recruitingCard).not.toBeUndefined();

    // Unlocked card should have position tags and interactive apply button
    expect(recruitingCard.querySelector('.auth-locked-notice')).toBeNull();
    expect(recruitingCard.querySelector('.pricing-cta-btn').textContent).toContain('ดูรายละเอียด & ยื่นสมัคร');
  });

  test('filters actively recruiting companies when recruiting toggle is clicked', () => {
    loadDirectoryScript();

    const recruitingToggle = document.getElementById('recruitingToggle');
    const status = document.getElementById('searchResultStatus');

    // Click toggle to filter only recruiting companies
    recruitingToggle.click();

    expect(recruitingToggle.classList.contains('active')).toBe(true);
    expect(recruitingToggle.getAttribute('aria-pressed')).toBe('true');
    expect(status.textContent).toContain('24'); // 24 actively recruiting companies

    // Reset filters
    document.getElementById('filterResetBtn').click();
    expect(recruitingToggle.classList.contains('active')).toBe(false);
    expect(status.textContent).toBe('');
  });

  test('populates location options and filters by location', () => {
    loadDirectoryScript();

    const locationFilter = document.getElementById('locationFilter');
    expect(locationFilter.options.length).toBeGreaterThan(1);

    locationFilter.value = 'นนทบุรี';
    locationFilter.dispatchEvent(new Event('change', { bubbles: true }));

    const status = document.getElementById('searchResultStatus');
    expect(status.textContent).toContain('พบสถานประกอบการ');
    const cards = document.querySelectorAll('#companyList .partner-card');
    cards.forEach(card => {
      expect(card.textContent).toContain('นนทบุรี');
    });
  });

  test('displays normalized duration tag on recruiting cards and standard tag on non-recruiting', () => {
    loadDirectoryScript();

    const recruitingCard = Array.from(document.querySelectorAll('#companyList .partner-card'))
      .find(c => c.querySelector('.auth-locked-pill'));
    expect(recruitingCard).not.toBeUndefined();
    const durationTag = recruitingCard.querySelector('.tag-duration');
    expect(durationTag).not.toBeNull();
    expect(durationTag.textContent.length).toBeGreaterThan(3);

    // Non-recruiting card
    const nonRecruitingCard = Array.from(document.querySelectorAll('#companyList .partner-card'))
      .find(c => !c.querySelector('.auth-locked-pill') && !c.querySelector('.pricing-quota-pill'));
    expect(nonRecruitingCard).not.toBeUndefined();
    expect(nonRecruitingCard.textContent).toContain('ยังไม่เปิดรับในรอบนี้');
  });

  test('sets title attribute on company name headings to support tooltip and accessible full name inspection', () => {
    loadDirectoryScript();

    const headers = document.querySelectorAll('#companyList .partner-card-header h2');
    expect(headers.length).toBeGreaterThan(0);
    headers.forEach(h2 => {
      expect(h2.title).toBe(h2.textContent);
      expect(h2.title.length).toBeGreaterThan(0);
    });
  });
});

