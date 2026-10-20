/** @jest-environment jsdom */

const {
  STUDENT_PROFILE_ERROR_CODES,
  StudentProfileError,
  createStudentProfileClient,
  validatePreferredName
} = require('../tmp/frontend-test-modules/student/profile-client.cjs');
const {
  createShellApp
} = require('../tmp/frontend-test-modules/shell-app.cjs');

const SAMPLE_PROFILE_V1 = Object.freeze({
  id: '20000000-0000-4000-8000-000000000101',
  student_number: 'TEST000001',
  full_name: 'สมชาย ใจดี',
  preferred_name: 'ชาย',
  institutional_email: 'test000001@student.example.com',
  department: 'วิทยาการคอมพิวเตอร์',
  program: 'วิทยาศาสตรบัณฑิต',
  major: 'วิทยาการคอมพิวเตอร์',
  academic_year: 2569,
  enrollment_status: 'ACTIVE',
  created_at: '2026-01-10T08:00:00.000Z',
  updated_at: '2026-01-15T09:30:00.000Z',
  version: 1
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload)
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setupStudentShell({
  hash = '#/student/profile',
  role = 'STUDENT',
  getOwnProfile = jest.fn().mockResolvedValue(SAMPLE_PROFILE_V1),
  updateOwnProfile = jest.fn().mockResolvedValue({
    ...SAMPLE_PROFILE_V1,
    preferred_name: 'สมชาย (ต้น)',
    version: 2
  })
} = {}) {
  document.body.innerHTML = '<div id="authenticatedApp" aria-live="polite"></div>';
  window.sessionStorage.clear();

  const root = document.getElementById('authenticatedApp');
  const location = { pathname: '/app.html', search: '', hash };
  const eventTarget = new EventTarget();
  const loadSession = jest.fn().mockResolvedValue({ role });
  const startLogin = jest.fn().mockResolvedValue(undefined);
  const restartLogin = jest.fn().mockResolvedValue(undefined);
  const logout = jest.fn().mockResolvedValue(undefined);
  const studentProfileClient = {
    getOwnProfile,
    updateOwnProfile
  };

  const app = createShellApp({
    root,
    loadSession,
    startLogin,
    restartLogin,
    logout,
    location,
    eventTarget,
    storage: window.sessionStorage,
    studentProfileClient
  });

  return {
    app,
    root,
    location,
    eventTarget,
    studentProfileClient,
    restartLogin,
    logout
  };
}

describe('Issue #72: Student Profile API client', () => {
  it('calls GET /api/v3/students/me with Bearer token and strips any non-allowlisted fields', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {
      data: {
        ...SAMPLE_PROFILE_V1,
        user_id: 'secret-internal-user-uuid',
        anonymous_ref: 'ANON-001',
        private_note: 'staff confidential',
        external_subject: 'cognito-sub-123'
      }
    }));

    const client = createStudentProfileClient({
      apiBaseUrl: 'https://api.example.com/prod/',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('student-access-token'),
      fetchImpl
    });

    const profile = await client.getOwnProfile();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/api/v3/students/me',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer student-access-token'
        }
      })
    );
    expect(profile).toEqual(SAMPLE_PROFILE_V1);
    expect(profile.user_id).toBeUndefined();
    expect(profile.anonymous_ref).toBeUndefined();
    expect(profile.private_note).toBeUndefined();
    expect(profile.external_subject).toBeUndefined();
  });

  it('sends PATCH /api/v3/students/me with only { preferred_name, version } and normalizes blank string to null', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {
      data: {
        ...SAMPLE_PROFILE_V1,
        preferred_name: null,
        version: 2
      }
    }));

    const client = createStudentProfileClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('student-access-token'),
      fetchImpl
    });

    const updated = await client.updateOwnProfile({
      preferredName: '   ',
      version: 1
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/api/v3/students/me',
      expect.objectContaining({
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer student-access-token'
        },
        body: JSON.stringify({
          preferred_name: null,
          version: 1
        })
      })
    );
    expect(updated.preferred_name).toBeNull();
    expect(updated.version).toBe(2);
  });

  it('validates preferred_name length and control characters on the client before making a network call', async () => {
    const fetchImpl = jest.fn();
    const client = createStudentProfileClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetchImpl
    });

    expect(validatePreferredName('a'.repeat(101)).valid).toBe(false);
    expect(validatePreferredName('ชื่อ\u0000ไม่ปลอดภัย').valid).toBe(false);

    await expect(
      client.updateOwnProfile({ preferredName: 'a'.repeat(101), version: 1 })
    ).rejects.toMatchObject({
      code: STUDENT_PROFILE_ERROR_CODES.VALIDATION_ERROR
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [400, STUDENT_PROFILE_ERROR_CODES.VALIDATION_ERROR],
    [401, STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED],
    [403, STUDENT_PROFILE_ERROR_CODES.ACCESS_DENIED],
    [404, STUDENT_PROFILE_ERROR_CODES.NOT_FOUND],
    [409, STUDENT_PROFILE_ERROR_CODES.STALE_RECORD_CONFLICT],
    [503, STUDENT_PROFILE_ERROR_CODES.SERVICE_UNAVAILABLE]
  ])('maps HTTP %i responses to %s', async (status, expectedCode) => {
    const client = createStudentProfileClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetchImpl: jest.fn().mockResolvedValue(jsonResponse(status, { error: { code: expectedCode } }))
    });

    await expect(client.getOwnProfile()).rejects.toMatchObject({ code: expectedCode });
  });
});

describe('Student Profile read-only workflow UI', () => {
  it('separates identity, official data and an informational guide with decorative icons', async () => {
    const context = setupStudentShell();
    await context.app.start(); await flushPromises();
    const cards = context.root.querySelectorAll('.student-profile-workspace .student-card--illustrated');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.querySelector('.student-card__icon svg').getAttribute('aria-hidden')).toBe('true');
      expect(card.querySelector('.student-card__body h2').id).toBe(card.getAttribute('aria-labelledby'));
    }
    expect(context.root.querySelector('.student-profile-editable, #student-preferred-name')).toBeNull();
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
    context.app.destroy();
  });

  it('uses only the official name and renders every official field without editable controls', async () => {
    const context = setupStudentShell();
    await context.app.start(); await flushPromises();
    const workspace = context.root.querySelector('.student-profile-workspace');
    for (const field of ['student_number', 'full_name', 'institutional_email', 'department', 'program', 'major', 'academic_year']) {
      expect(workspace.querySelector('[data-field="' + field + '"]').textContent).toBe(String(SAMPLE_PROFILE_V1[field]));
    }
    expect(workspace.querySelector('[data-field="enrollment_status"]').textContent).toContain('กำลังศึกษา (ACTIVE)');
    expect(workspace.querySelector('[data-role="display-greeting"]').textContent).toBe('สวัสดี สมชาย ใจดี');
    expect(workspace.querySelector('form, input, textarea, select, [contenteditable="true"]')).toBeNull();
    expect(workspace.textContent).not.toContain('ตั้งค่าชื่อที่ต้องการให้แสดง');
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('navigates to the real My Plan route without adding workflow actions', async () => {
    const context = setupStudentShell();
    await context.app.start(); await flushPromises();
    const plan = context.root.querySelector('[data-role="go-to-student-plan"]');
    expect(plan.getAttribute('href')).toBe('#/student/plan');
    plan.click();
    expect(context.location.hash).toBe('#/student/plan');
    expect(context.root.querySelector('h1').textContent).toBe('แผนสหกิจของฉัน');
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('uses native expandable guidance, not a claimed progress or company-confirmation form', async () => {
    const context = setupStudentShell();
    await context.app.start(); await flushPromises();
    const guide = context.root.querySelector('.student-profile-guide');
    expect(guide.textContent).toContain('ไม่ใช่สถานะปัจจุบันของคุณ');
    expect(guide.textContent).toContain('ไม่สามารถแก้ไข ลบ หรือส่งแผนเดิมซ้ำ');
    expect(guide.textContent).toContain('การไม่อนุมัติเพราะคุณสมบัติไม่ผ่านต่างจากการส่งกลับให้แก้ไข');
    expect(guide.textContent).toContain('อาจารย์จะอ่านข้อมูลของคุณได้เมื่อได้รับมอบหมายแล้ว');
    expect(guide.textContent).toContain('ส่ง CV / Resume และสมัครกับบริษัทด้วยตนเอง');
    expect(guide.querySelector('form, button, [role="progressbar"], [aria-current="step"]')).toBeNull();
    const details = [...guide.querySelectorAll('details')];
    expect(details).toHaveLength(4);
    expect(details.every((item) => !item.open && item.firstElementChild.tagName === 'SUMMARY')).toBe(true);
    details[1].open = true; details[1].dispatchEvent(new Event('toggle'));
    context.root.querySelector('[data-role="profile-refresh"]').click();
    await flushPromises();
    expect(context.root.querySelectorAll('.student-profile-guide details')[1].open).toBe(true);
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('refreshes with one in-flight GET, loading feedback and restored keyboard focus', async () => {
    let resolveRefresh;
    const getOwnProfile = jest.fn().mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const context = setupStudentShell({ getOwnProfile });
    await context.app.start(); await flushPromises();
    const refresh = context.root.querySelector('[data-role="profile-refresh"]');
    refresh.focus(); refresh.click(); refresh.click();
    expect(getOwnProfile).toHaveBeenCalledTimes(2);
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    expect(context.root.querySelector('[data-role="profile-refresh-status"]').textContent).toContain('กำลังโหลด');
    resolveRefresh({ ...SAMPLE_PROFILE_V1, full_name: 'สมชาย ชื่อทางการใหม่', version: 3 });
    await flushPromises();
    expect(context.root.querySelector('[data-role="display-greeting"]').textContent).toBe('สวัสดี สมชาย ชื่อทางการใหม่');
    expect(context.root.querySelector('[data-role="profile-version"]').textContent).toContain('v3');
    expect(context.root.querySelector('[data-role="profile-refresh-status"]').getAttribute('role')).toBe('status');
    expect(context.root.querySelector('[data-role="profile-refresh-status"]').textContent).toContain('เรียบร้อย');
    expect(document.activeElement).toBe(context.root.querySelector('[data-role="profile-refresh"]'));
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('does not steal focus from another shell control when refresh resolves', async () => {
    let resolveRefresh;
    const context = setupStudentShell({ getOwnProfile: jest.fn().mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; })) });
    await context.app.start(); await flushPromises();
    const refresh = context.root.querySelector('[data-role="profile-refresh"]');
    refresh.focus(); refresh.click();
    const other = context.root.querySelector('.shell-nav a');
    other.focus();
    resolveRefresh(SAMPLE_PROFILE_V1); await flushPromises();
    expect(document.activeElement).toBe(other);
  });

  it('preserves a guide reading point selected while refresh is pending', async () => {
    let resolveRefresh;
    const context = setupStudentShell({ getOwnProfile: jest.fn().mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; })) });
    await context.app.start(); await flushPromises();
    const refresh = context.root.querySelector('[data-role="profile-refresh"]');
    refresh.focus(); refresh.click();
    context.root.querySelector('[data-profile-focus="guide-2"]').focus();
    resolveRefresh(SAMPLE_PROFILE_V1); await flushPromises();
    expect(document.activeElement).toBe(context.root.querySelector('[data-profile-focus="guide-2"]'));
  });

  it.each(['STAFF', 'ADVISOR', 'ADMIN'])('does not read a Student profile for the %s role', async (role) => {
    const context = setupStudentShell({ role });
    await context.app.start(); await flushPromises();
    expect(context.studentProfileClient.getOwnProfile).not.toHaveBeenCalled();
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
    expect(context.root.querySelector('.student-profile-workspace')).toBeNull();
  });

  it('recovers from an initial error and a failed refresh using retry, without profile writes', async () => {
    const getOwnProfile = jest.fn()
      .mockRejectedValueOnce(new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SERVICE_UNAVAILABLE))
      .mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockRejectedValueOnce(new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SERVICE_UNAVAILABLE))
      .mockResolvedValueOnce(SAMPLE_PROFILE_V1);
    const context = setupStudentShell({ getOwnProfile });
    await context.app.start(); await flushPromises();
    expect(context.root.querySelector('.student-card--error').getAttribute('role')).toBe('alert');
    context.root.querySelector('.student-card--error button').click(); await flushPromises();
    context.root.querySelector('[data-role="profile-refresh"]').click(); await flushPromises();
    expect(context.root.textContent).not.toContain('TEST000001');
    context.root.querySelector('.student-card--error button').click(); await flushPromises();
    expect(context.root.textContent).toContain('TEST000001');
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();
  });

  it.each([
    [STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED, 'Session หมดอายุ'],
    [STUDENT_PROFILE_ERROR_CODES.ACCESS_DENIED, 'ไม่มีสิทธิ์เข้าถึง']
  ])('clears private data when refresh fails with %s', async (code, copy) => {
    const context = setupStudentShell({ getOwnProfile: jest.fn().mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockRejectedValueOnce(new StudentProfileError(code)) });
    await context.app.start(); await flushPromises();
    context.root.querySelector('[data-role="profile-refresh"]').click(); await flushPromises();
    expect(context.root.textContent).not.toContain('TEST000001');
    expect(context.root.textContent).not.toContain(SAMPLE_PROFILE_V1.institutional_email);
    expect(context.root.textContent).toContain(copy);
    if (code === STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED) {
      expect(window.sessionStorage.getItem('co-ed:return-route')).toBe('#/student/profile');
    }
  });

  it('ignores an aborted refresh after navigation even if the client resolves late', async () => {
    let resolveRefresh;
    const context = setupStudentShell({ getOwnProfile: jest.fn().mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; })) });
    await context.app.start(); await flushPromises();
    context.root.querySelector('[data-role="profile-refresh"]').click();
    context.root.querySelector('[data-role="go-to-student-plan"]').click();
    resolveRefresh({ ...SAMPLE_PROFILE_V1, full_name: 'ข้อมูลล่าช้าที่ต้องไม่แสดง' }); await flushPromises();
    expect(context.root.querySelector('h1').textContent).toBe('แผนสหกิจของฉัน');
    expect(context.root.textContent).not.toContain('ข้อมูลล่าช้าที่ต้องไม่แสดง');
    expect(context.root.querySelector('.student-profile-workspace')).toBeNull();
  });

  it('renders untrusted long names as wrapping text, not markup, and handles missing values', async () => {
    const full_name = '<img src=x onerror=alert(1)>' + 'ชื่อสมมติ'.repeat(30);
    const context = setupStudentShell({ getOwnProfile: jest.fn().mockResolvedValue({
      ...SAMPLE_PROFILE_V1, full_name, institutional_email: null, updated_at: 'invalid'
    }) });
    await context.app.start(); await flushPromises();
    const workspace = context.root.querySelector('.student-profile-workspace');
    expect(workspace.querySelector('img, script')).toBeNull();
    expect(workspace.querySelector('[data-role="display-greeting"]').textContent).toContain(full_name);
    expect(workspace.querySelector('[data-field="institutional_email"]').textContent).toBe('ไม่ระบุ');
    expect(workspace.querySelector('.student-profile-metadata').textContent).toContain('ไม่ระบุวันที่อัปเดต');
  });

  it('defines pointer-scoped card lift, keyboard emphasis and reduced-motion overrides', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const css = readFileSync(join(__dirname, '../src/frontend/authenticated-shell.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css; document.head.append(style);
    try {
      const reduced = [...style.sheet.cssRules].filter((rule) => rule.conditionText === '(prefers-reduced-motion: reduce)');
      const overrides = reduced.flatMap((rule) => [...rule.cssRules]);
      const motion = overrides.find((rule) => rule.selectorText?.includes('.student-profile-workspace .student-profile-guide__step[open] > .student-profile-guide__content'));
      expect(motion.style.getPropertyValue('animation')).toBe('none');
      expect(motion.selectorText).toContain('.student-profile-workspace .student-profile-refresh > .workspace-icon');
      const hover = [...style.sheet.cssRules].find((rule) => rule.conditionText === '(hover: hover) and (pointer: fine)');
      const lift = [...hover.cssRules].find((rule) => rule.selectorText === '.student-profile-workspace > .student-card--illustrated:hover');
      expect(lift.style.getPropertyValue('transform')).toBe('translateY(-3px)');
      const still = overrides.find((rule) => rule.selectorText === lift.selectorText);
      expect(still.style.getPropertyValue('transform')).toBe('none');
      const focus = [...style.sheet.cssRules].find((rule) => rule.selectorText === '.student-profile-workspace > .student-card--illustrated:focus-within');
      expect(focus.style.getPropertyValue('border-color')).toBe('var(--shell-primary)');
      expect(focus.style.getPropertyValue('transform')).toBe('');
    } finally { style.remove(); }
  });

  describe('hash navigation using the jsdom window', () => {
    function startWithRealWindow(hash) {
      document.body.innerHTML = '<div id="authenticatedApp"></div>';
      window.location.hash = hash;
      const root = document.getElementById('authenticatedApp');
      const studentProfileClient = {
        getOwnProfile: jest.fn(async () => SAMPLE_PROFILE_V1),
        updateOwnProfile: jest.fn()
      };
      const app = createShellApp({
        root,
        loadSession: jest.fn().mockResolvedValue({ role: 'STUDENT' }),
        startLogin: jest.fn(),
        restartLogin: jest.fn(),
        logout: jest.fn(),
        location: window.location,
        eventTarget: window,
        storage: window.sessionStorage,
        history: window.history,
        studentProfileClient
      });
      return { app, root, studentProfileClient };
    }

    function countRenders(root) {
      const counter = { renders: 0 };
      const original = root.replaceChildren.bind(root);
      root.replaceChildren = (...nodes) => {
        counter.renders += 1;
        return original(...nodes);
      };
      return counter;
    }

    it('renders the target route once when the dashboard navigates (no duplicate render from hashchange)', async () => {
      const { app, root } = startWithRealWindow('#/student/profile');
      await app.start();
      await flushPromises();

      const counter = countRenders(root);
      const cta = [...root.querySelectorAll('main button, main a')]
        .find((node) => /แผนสหกิจ/.test(node.textContent));
      cta.click();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(window.location.hash).toBe('#/student/plan');
      expect(counter.renders).toBe(1);
      app.destroy();
    });

    it('still renders when the hash changes outside the shell (menu link or Back button)', async () => {
      const { app, root, studentProfileClient } = startWithRealWindow('#/student/plan');
      await app.start();
      await flushPromises();

      window.location.hash = '#/student/profile';
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(root.querySelector('h1').textContent).toBe('ข้อมูลนักศึกษา');
      expect(studentProfileClient.getOwnProfile).toHaveBeenCalledTimes(1);
      app.destroy();
    });
  });

  it('labels the INACTIVE enrollment status allowed by #51', async () => {
    const context = setupStudentShell({
      getOwnProfile: jest.fn().mockResolvedValue({ ...SAMPLE_PROFILE_V1, enrollment_status: 'INACTIVE' })
    });
    await context.app.start();
    await flushPromises();
    expect(context.root.querySelector('[data-field="enrollment_status"]').textContent)
      .toContain('INACTIVE');
    const badge = context.root.querySelector('.student-dashboard-summary__badges .student-badge');
    expect(badge.classList.contains('student-badge--status')).toBe(false);
    expect(badge.textContent).toContain('INACTIVE');
  });
});
