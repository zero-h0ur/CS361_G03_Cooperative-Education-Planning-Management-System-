/* Shared Directory/Spotlight view. All live data comes from the API. */
(function () {
  const list = document.getElementById('companyList') ||
    document.querySelector('#company-directory-preview .partner-grid');
  if (!list) return;
  const isDirectory = list.id === 'companyList';
  const status = document.getElementById('searchResultStatus') || document.createElement('p');
  if (!status.parentNode) { status.setAttribute('role', 'status'); list.before(status); }
  const search = document.getElementById('companySearch');
  const location = document.getElementById('locationFilter');
  const duration = document.getElementById('durationFilter');
  const role = document.getElementById('roleFilter');
  const recruiting = document.getElementById('recruitingToggle');
  const more = document.getElementById('loadMoreCompanies');
  let page = 1, sequence = 0, controller = null, timer = null, lastFocus = null;
  let retryAppend = null, privateShown = false;
  const initialQuery = new URLSearchParams(window.location.search);
  let initialLocation = initialQuery.get('location') || '';
  if (search) search.value = initialQuery.get('search') || initialQuery.get('q') || '';
  const filters = { pageSize: isDirectory ? 12 : 6 };
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }
  function image(company) {
    const box = node('div', 'partner-logo');
    if (/^resources\/images\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)$/.test(company.logo || '') && !company.logo.includes('..')) {
      const img = node('img'); img.src = company.logo; img.alt = 'โลโก้ ' + company.name; img.loading = 'lazy';
      img.addEventListener('error', () => box.replaceChildren(node('span', 'partner-logo-monogram', company.code || 'CO')), { once: true });
      box.append(img);
    } else box.append(node('span', 'partner-logo-monogram', company.code || 'CO'));
    return box;
  }
  function card(company) {
    const article = node('article', 'partner-card partner-card-dynamic');
    const top = node('div', 'pricing-card-top');
    const badges = node('div', 'pricing-card-badges');
    const positions = company.details_available && Array.isArray(company.positions) ? company.positions : [];
    badges.append(node('span', company.details_available ? 'partner-status-pill' : 'pricing-quota-pill auth-locked-pill',
      company.details_available ? (positions.length ? 'มีประกาศรับสมัคร' : 'ยังไม่มีประกาศในชุดข้อมูล') : 'รายละเอียดต้องเข้าสู่ระบบ'));
    top.append(image(company), badges);
    const info = node('div', 'partner-info');
    const heading = node('div', 'partner-card-header'), title = node('h2', '', company.name);
    title.title = company.name; heading.append(title); info.append(heading);
    info.append(node('div', 'card-subline', company.location || 'ไม่ระบุจังหวัด'));
    const tags = node('div', 'card-roles-row');
    for (const position of positions.slice(0, 3)) tags.append(node('span', 'partner-tag tag-field', position.title));
    if (!company.details_available) tags.append(node('span', 'auth-locked-notice', 'เข้าสู่ระบบเพื่อดูตำแหน่งและรายละเอียดประกาศ'));
    info.append(tags);
    const button = node('button', 'pricing-cta-btn', 'ดูข้อมูลบริษัท'); button.type = 'button';
    button.addEventListener('click', () => window.openCompanyModal(company.id));
    info.append(button); article.append(top, info); return article;
  }
  function fillSelect(select, values, label) {
    if (!select) return;
    const old = select.value;
    const first = node('option', '', label); first.value = '';
    select.replaceChildren(first);
    for (const value of [...new Set(values || [])]) {
      const option = node('option', '', value); option.value = value; select.append(option);
    }
    select.value = [...select.options].some(option => option.value === old) ? old : '';
  }
  function privacyFilters(available, options) {
    for (const element of [duration, role, recruiting]) if (element) {
      element.disabled = !available;
      element.title = available ? '' : 'เข้าสู่ระบบเพื่อใช้ตัวกรองรายละเอียดประกาศ';
    }
    fillSelect(location, options?.locations, 'ทุกสถานที่');
    if (location && initialLocation) { location.value = initialLocation; initialLocation = ''; }
    fillSelect(duration, available ? options?.durations : [], 'ทุกช่วงเวลา');
    if (role && role.options.length <= 1) fillSelect(role,
      ['Developer', 'Data', 'Cloud', 'Tester', 'Analyst', 'Security', 'Network'], 'ทุกสายงาน');
    if (!available) {
      if (duration) duration.value = '';
      if (role) role.value = '';
      if (recruiting) { recruiting.classList.remove('active'); recruiting.setAttribute('aria-pressed', 'false'); }
    }
  }
  async function load(append = false) {
    const api = window.CO_ED_DIRECTORY_API;
    if (!api) { status.textContent = 'กำลังเตรียมการเชื่อมต่อข้อมูล'; return; }
    const current = ++sequence;
    controller?.abort(); controller = new AbortController();
    const active = controller;
    const timeout = setTimeout(() => active.abort(), 20000);
    if (!append) { page = 1; list.replaceChildren(); }
    status.textContent = 'กำลังโหลดข้อมูลสถานประกอบการ'; status.setAttribute('aria-busy', 'true');
    if (more) more.disabled = true;
    try {
      const result = await api.list({ ...filters, q: search?.value.trim(), location: initialLocation || location?.value,
        role: role?.value, duration: duration?.value, recruitingOnly: recruiting?.classList.contains('active'), page }, { signal: active.signal });
      if (current !== sequence) return;
      if (!Array.isArray(result?.data) || !Number.isInteger(result?.pagination?.total) ||
          !Number.isInteger(result?.pagination?.totalPages)) throw new Error('Invalid directory response.');
      if (privateShown && !result.pagination.details_available) {
        list.replaceChildren(); closeModal();
        if (append) { privateShown = false; load(); return; }
      }
      privateShown = result.pagination.details_available === true;
      privacyFilters(result.pagination.details_available === true, result.pagination.filters);
      for (const company of result.data) list.append(card(company));
      status.textContent = result.pagination.total ? 'พบสถานประกอบการ ' + result.pagination.total + ' รายการ' : 'ไม่พบสถานประกอบการตามเงื่อนไข';
      retryAppend = null;
      if (more) { more.hidden = page >= result.pagination.totalPages; more.disabled = false; more.textContent = 'โหลดเพิ่มเติม'; }
      const total = document.querySelector('[data-directory-company-count]');
      if (total) total.textContent = result.pagination.total;
    } catch (error) {
      if (current !== sequence) return;
      if (!append) list.replaceChildren();
      if (append) page--;
      retryAppend = append;
      status.textContent = 'ยังโหลดข้อมูลไม่ได้ กรุณาลองใหม่อีกครั้ง';
      if (more) { more.hidden = false; more.disabled = false; more.textContent = 'ลองโหลดอีกครั้ง'; }
    } finally {
      clearTimeout(timeout);
      if (current === sequence) status.removeAttribute('aria-busy');
    }
  }
  function clearPrivate() {
    ++sequence; controller?.abort(); window.CO_ED_DIRECTORY_API?.invalidate();
    list.replaceChildren(); closeModal(); privacyFilters(false, {});
    privateShown = false;
    status.textContent = 'ออกจากระบบแล้ว กรุณาโหลดหน้าใหม่เพื่อดูข้อมูลสาธารณะ';
  }
  function closeModal() {
    ++modalSequence; modalController?.abort();
    const modal = document.getElementById('companyModal');
    modal?.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('modalDescription')?.replaceChildren();
    document.getElementById('modalReq')?.replaceChildren();
    lastFocus?.focus();
  }
  let modalSequence = 0, modalController = null;
  window.closeModal = closeModal;
  window.handleBackdropClick = event => { if (event.target.id === 'companyModal') closeModal(); };
  window.openModal = id => window.openCompanyModal(id);
  window.openCompanyModal = async id => {
    const modal = document.getElementById('companyModal');
    if (!modal || !window.CO_ED_DIRECTORY_API) return;
    const current = ++modalSequence; modalController?.abort(); modalController = new AbortController();
    const active = modalController, timeout = setTimeout(() => active.abort(), 20000);
    lastFocus = document.activeElement;
    modal.classList.add('active'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modalName'); document.body.style.overflow = 'hidden';
    const description = document.getElementById('modalDescription'), requirements = document.getElementById('modalReq');
    document.getElementById('modalName').textContent = 'ข้อมูลสถานประกอบการ';
    document.getElementById('modalLocation').textContent = '';
    document.getElementById('modalLogo').replaceChildren();
    description?.replaceChildren(node('p', '', 'กำลังโหลดข้อมูล')); requirements?.replaceChildren();
    modal.querySelector('button')?.focus();
    try {
      const result = await window.CO_ED_DIRECTORY_API.detail(id, { signal: active.signal });
      if (current !== modalSequence) return;
      const company = result.data;
      if (privateShown && !company.details_available) {
        privateShown = false; list.replaceChildren(); privacyFilters(false, {}); load();
      }
      document.getElementById('modalName').textContent = company.name;
      document.getElementById('modalLocation').textContent = company.address || company.location || 'ไม่ระบุที่ตั้ง';
      document.getElementById('modalLogo').replaceChildren(image(company));
      description?.replaceChildren();
      if (company.details_available && Array.isArray(company.positions)) {
        const groups = new Map();
        for (const p of company.positions) {
          const key = p.announcement_ref || p.id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(p);
        }
        for (const group of groups.values()) {
          const section = node('section', 'modal-position-item');
          section.append(node('h4', 'modal-position-title', group.map(p => p.title).join(', ')));
          section.append(node('p', '', 'อัตราตามประกาศ (รวม): ' + (group[0].quota || 'ไม่ระบุ')));
          section.append(node('p', '', 'ช่วงเวลา: ' + (group[0].duration || 'ไม่ระบุ')));
          description?.append(section);
        }
        if (!groups.size) description?.append(node('p', '', 'ยังไม่มีประกาศในชุดข้อมูลนี้'));
        requirements?.append(node('p', '', 'ประกาศปีการศึกษา 2569 โปรดตรวจสอบสถานะล่าสุดกับช่องทางทางการของบริษัท ไม่มีข้อมูลผู้ติดต่อส่วนบุคคลในระบบ'));
      } else {
        description?.append(node('p', 'auth-locked-notice', 'เข้าสู่ระบบเพื่อดูตำแหน่ง อัตรา และช่วงเวลาตามประกาศ'));
        const link = node('a', 'btn-signup', 'เข้าสู่ระบบ'); link.href = 'app.html'; requirements?.append(link);
      }
    } catch {
      if (current === modalSequence) description?.replaceChildren(node('p', '', 'ยังโหลดรายละเอียดไม่ได้ กรุณาลองใหม่อีกครั้ง'));
    } finally { clearTimeout(timeout); }
  };
  search?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); });
  for (const input of [location, duration, role]) input?.addEventListener('change', () => load());
  recruiting?.addEventListener('click', () => {
    const active = recruiting.classList.toggle('active'); recruiting.setAttribute('aria-pressed', String(active)); load();
  });
  document.getElementById('filterResetBtn')?.addEventListener('click', () => {
    for (const input of [search, location, duration, role]) if (input) input.value = '';
    recruiting?.classList.remove('active'); recruiting?.setAttribute('aria-pressed', 'false'); load();
  });
  more?.addEventListener('click', () => {
    if (retryAppend === false) load();
    else { page++; load(true); }
  });
  document.addEventListener('keydown', event => {
    const modal = document.getElementById('companyModal');
    if (!modal?.classList.contains('active')) return;
    if (event.key === 'Escape') closeModal();
    if (event.key === 'Tab') {
      const items = [...modal.querySelectorAll('button:not([disabled]),a[href]')];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  });
  window.addEventListener('coed:private-content-clear', clearPrivate);
  window.addEventListener('co-ed:auth-logout', clearPrivate);
  window.addEventListener('storage', event => { if (event.key === 'co-ed:auth-logout' && event.newValue) clearPrivate(); });
  window.addEventListener('pagehide', () => { ++sequence; controller?.abort(); list.replaceChildren(); closeModal(); });
  window.addEventListener('pageshow', event => { if (event.persisted) load(); });
  window.addEventListener('coed:directory-ready', () => load());
  for (const input of [duration, role, recruiting]) if (input) input.disabled = true;
  if (window.CO_ED_DIRECTORY_API) load();
})();
