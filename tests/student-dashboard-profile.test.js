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
  student_number: '65010001',
  full_name: 'สมชาย ใจดี',
  preferred_name: 'ชาย',
  institutional_email: '65010001@student.university.ac.th',
  department: 'วิทยาการคอมพิวเตอร์',
  program: 'วิทยาศาสตรบัณฑิต',
  major: 'วิทยาการคอมพิวเตอร์',
  academic_year: 2569,
  enrollment_status: 'ELIGIBLE',
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
  const loadSession = jest.fn().mockResolvedValue({ role: 'STUDENT' });
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

describe('Issue #72: Student Dashboard and My Profile UI view', () => {
  it('renders official student fields as read-only and exposes only preferred_name as an editable input', async () => {
    const context = setupStudentShell();

    await context.app.start();
    await flushPromises();

    // Official fields displayed in read-only definition list
    expect(context.root.querySelector('[data-field="student_number"]').textContent).toBe('65010001');
    expect(context.root.querySelector('[data-field="full_name"]').textContent).toBe('สมชาย ใจดี');
    expect(context.root.querySelector('[data-field="institutional_email"]').textContent).toBe('65010001@student.university.ac.th');
    expect(context.root.querySelector('[data-field="department"]').textContent).toBe('วิทยาการคอมพิวเตอร์');
    expect(context.root.querySelector('[data-field="program"]').textContent).toBe('วิทยาศาสตรบัณฑิต');
    expect(context.root.querySelector('[data-field="major"]').textContent).toBe('วิทยาการคอมพิวเตอร์');
    expect(context.root.querySelector('[data-field="academic_year"]').textContent).toBe('2569');
    expect(context.root.querySelector('[data-field="enrollment_status"]').textContent).toContain('ELIGIBLE');

    // Only one form input exists in the entire workspace, and it is preferred_name
    const inputs = [...context.root.querySelectorAll('input, textarea, select')];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].id).toBe('student-preferred-name');
    expect(inputs[0].name).toBe('preferred_name');
    expect(inputs[0].value).toBe('ชาย');

    // Label association and aria-describedby
    const label = context.root.querySelector('label[for="student-preferred-name"]');
    expect(label).not.toBeNull();
    expect(inputs[0].getAttribute('aria-describedby')).toContain('student-preferred-name-hint');
    expect(inputs[0].getAttribute('aria-describedby')).toContain('student-preferred-name-error');
  });

  it('navigates from the Student Dashboard summary CTA to My Plan (#/student/plan)', async () => {
    const context = setupStudentShell();

    await context.app.start();
    await flushPromises();

    const planCta = context.root.querySelector('[data-role="go-to-student-plan"]');
    expect(planCta).not.toBeNull();
    planCta.click();

    expect(context.location.hash).toBe('#/student/plan');
    expect(context.root.querySelector('h1').textContent).toBe('แผนสหกิจของฉัน');
  });

  it('validates preferred_name on blur, resets error state on input, and blocks invalid submit', async () => {
    const context = setupStudentShell();

    await context.app.start();
    await flushPromises();

    const input = context.root.querySelector('#student-preferred-name');
    const errorNode = context.root.querySelector('#student-preferred-name-error');
    const form = context.root.querySelector('form.student-profile-form');

    input.value = 'ก'.repeat(101);
    input.dispatchEvent(new Event('blur'));

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(errorNode.hidden).toBe(false);
    expect(errorNode.textContent).toContain('ต้องไม่เกิน 100 ตัวอักษร');

    // Submitting invalid value does not call API
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(context.studentProfileClient.updateOwnProfile).not.toHaveBeenCalled();

    // Typing a correction immediately clears the error state
    input.value = 'สมชาย (ต้น)';
    input.dispatchEvent(new Event('input'));

    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(errorNode.hidden).toBe(true);
  });

  it('saves preferred_name, disables submit during in-flight request, and syncs UI with updated server response', async () => {
    let resolveUpdate;
    const pendingUpdate = new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    const updateOwnProfile = jest.fn().mockReturnValue(pendingUpdate);
    const context = setupStudentShell({ updateOwnProfile });

    await context.app.start();
    await flushPromises();

    const input = context.root.querySelector('#student-preferred-name');
    const form = context.root.querySelector('form.student-profile-form');
    const submitButton = form.querySelector('button[type="submit"]');

    input.value = '  สมชาย (ต้น)  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // In-flight state
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe('กำลังบันทึก...');
    expect(updateOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredName: 'สมชาย (ต้น)',
        version: 1
      })
    );

    resolveUpdate({
      ...SAMPLE_PROFILE_V1,
      preferred_name: 'สมชาย (ต้น)',
      version: 2
    });
    await flushPromises();

    expect(context.root.querySelector('[data-role="display-greeting"]').textContent).toContain('สมชาย (ต้น) (สมชาย ใจดี)');
    expect(context.root.querySelector('[data-role="profile-version"]').textContent).toContain('v2');
    expect(context.root.querySelector('#student-preferred-name').value).toBe('สมชาย (ต้น)');
    expect(context.root.querySelector('[data-role="profile-feedback"]').textContent).toContain(
      'บันทึกชื่อที่ต้องการให้แสดงเรียบร้อยแล้ว'
    );
  });

  it('recovers from 409 STALE_RECORD_CONFLICT by letting the student reload the latest server profile', async () => {
    const getOwnProfile = jest
      .fn()
      .mockResolvedValueOnce(SAMPLE_PROFILE_V1)
      .mockResolvedValueOnce({
        ...SAMPLE_PROFILE_V1,
        preferred_name: 'ชื่อจากแท็บอื่น',
        version: 3
      });
    const updateOwnProfile = jest.fn().mockRejectedValue(
      new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.STALE_RECORD_CONFLICT)
    );

    const context = setupStudentShell({ getOwnProfile, updateOwnProfile });
    await context.app.start();
    await flushPromises();

    const input = context.root.querySelector('#student-preferred-name');
    const form = context.root.querySelector('form.student-profile-form');

    input.value = 'ชื่อใหม่ที่ชนกัน';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    const feedback = context.root.querySelector('[data-role="profile-feedback"]');
    expect(feedback.getAttribute('role')).toBe('alert');
    expect(feedback.textContent).toContain('กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกใหม่');

    const reloadButton = feedback.querySelector('button');
    expect(reloadButton.textContent).toBe('โหลดข้อมูลล่าสุด');
    reloadButton.click();
    await flushPromises();

    expect(getOwnProfile).toHaveBeenCalledTimes(2);
    expect(context.root.querySelector('#student-preferred-name').value).toBe('ชื่อจากแท็บอื่น');
    expect(context.root.querySelector('[data-role="profile-version"]').textContent).toContain('v3');
  });

  it('clears private profile data and shows the shell expired-session alert when save returns 401', async () => {
    const updateOwnProfile = jest.fn().mockRejectedValue(
      new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED)
    );
    const context = setupStudentShell({ updateOwnProfile });

    await context.app.start();
    await flushPromises();
    expect(context.root.textContent).toContain('65010001');

    const form = context.root.querySelector('form.student-profile-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(context.root.textContent).not.toContain('65010001');
    expect(context.root.textContent).toContain('Session หมดอายุ');
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBe('#/student/profile');
  });
});
