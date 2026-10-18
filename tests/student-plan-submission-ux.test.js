/** @jest-environment jsdom */

const {
  PLAN_STATUSES,
  STUDENT_PLAN_ERROR_CODES,
  StudentPlanError,
  createStudentPlanClient,
  evaluatePlanReadiness
} = require('../tmp/frontend-test-modules/student/plan-submission-client.cjs');
const {
  createShellApp
} = require('../tmp/frontend-test-modules/shell-app.cjs');

const READY_DRAFT_PLAN = Object.freeze({
  id: '30000000-0000-4000-8000-000000000201',
  student_id: '20000000-0000-4000-8000-000000000101',
  company_id: '40000000-0000-4000-8000-000000000301',
  company_name: 'บริษัท เทคโนโลยีไทย จำกัด',
  academic_year: 2569,
  semester: 1,
  position_title: 'Software Engineer Intern',
  job_description: 'พัฒนาและทดสอบระบบบริการข้อมูลสหกิจศึกษา',
  start_date: '2026-06-01',
  end_date: '2026-09-30',
  status: PLAN_STATUSES.DRAFT,
  return_reason: null,
  submitted_at: null,
  reviewed_at: null,
  approved_at: null,
  cancelled_at: null,
  created_at: '2026-02-01T08:00:00.000Z',
  updated_at: '2026-02-02T09:00:00.000Z',
  version: 1
});

const INITIAL_HISTORY = Object.freeze([
  {
    id: '50000000-0000-4000-8000-000000000501',
    plan_id: READY_DRAFT_PLAN.id,
    from_status: null,
    to_status: PLAN_STATUSES.DRAFT,
    actor_label: 'นักศึกษา (เจ้าของแผน)',
    reason: 'สร้างแผนสหกิจศึกษาฉบับร่าง',
    created_at: '2026-02-01T08:00:00.000Z'
  }
]);

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

function setupStudentPlanShell({
  hash = '#/student/plan',
  plan = READY_DRAFT_PLAN,
  statusHistory = INITIAL_HISTORY,
  getOwnPlan,
  submitPlan
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

  const studentPlanClient = {
    getOwnPlan:
      getOwnPlan ||
      jest.fn().mockResolvedValue({
        plan,
        statusHistory
      }),
    submitPlan:
      submitPlan ||
      jest.fn().mockResolvedValue({
        plan: {
          ...plan,
          status: PLAN_STATUSES.SUBMITTED,
          submitted_at: '2026-02-10T10:00:00.000Z',
          version: plan.version + 1
        },
        statusHistory: [
          ...statusHistory,
          {
            id: '50000000-0000-4000-8000-000000000502',
            plan_id: plan.id,
            from_status: plan.status,
            to_status: PLAN_STATUSES.SUBMITTED,
            actor_label: 'นักศึกษา (เจ้าของแผน)',
            reason: 'ส่งแผนสหกิจศึกษาให้เจ้าหน้าที่ตรวจสอบ',
            created_at: '2026-02-10T10:00:00.000Z'
          }
        ]
      })
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
    studentPlanClient
  });

  return {
    app,
    root,
    location,
    studentPlanClient,
    restartLogin,
    logout
  };
}

describe('Issue #76: Student Plan Submission Client & Readiness', () => {
  it('evaluates readiness accurately and only allows submit for complete DRAFT or RETURNED_FOR_REVISION plans', () => {
    expect(evaluatePlanReadiness(READY_DRAFT_PLAN)).toMatchObject({
      isSubmittableStatus: true,
      isComplete: true,
      canSubmit: true,
      isReadOnly: false,
      missingFields: []
    });

    const incompleteDraft = {
      ...READY_DRAFT_PLAN,
      company_id: null,
      position_title: '   '
    };
    const incompleteResult = evaluatePlanReadiness(incompleteDraft);
    expect(incompleteResult.canSubmit).toBe(false);
    expect(incompleteResult.missingFields.map((m) => m.field)).toEqual([
      'company_id',
      'position_title'
    ]);

    const submittedPlan = {
      ...READY_DRAFT_PLAN,
      status: PLAN_STATUSES.SUBMITTED
    };
    expect(evaluatePlanReadiness(submittedPlan)).toMatchObject({
      isSubmittableStatus: false,
      isComplete: true,
      canSubmit: false,
      isReadOnly: true
    });
  });

  it('calls POST /api/v3/plans/:planId/submit with Bearer token and strips private actor fields from history', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          plan: {
            ...READY_DRAFT_PLAN,
            status: PLAN_STATUSES.SUBMITTED,
            version: 2,
            private_internal_note: 'must-not-leak'
          },
          statusHistory: {
            id: '50000000-0000-4000-8000-000000000599',
            plan_id: READY_DRAFT_PLAN.id,
            from_status: PLAN_STATUSES.DRAFT,
            to_status: PLAN_STATUSES.SUBMITTED,
            actor_user_id: 'secret-actor-uuid-999',
            actor_role: 'STUDENT',
            external_subject: 'cognito-sub-secret',
            reason: 'พร้อมรับการตรวจ',
            created_at: '2026-02-10T10:00:00.000Z'
          }
        }
      })
    );

    const client = createStudentPlanClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('student-token-123'),
      fetchImpl
    });

    const result = await client.submitPlan({
      planId: READY_DRAFT_PLAN.id,
      version: 1,
      reason: '  พร้อมรับการตรวจ  '
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.com/api/v3/plans/${READY_DRAFT_PLAN.id}/submit`,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer student-token-123'
        },
        body: JSON.stringify({
          version: 1,
          reason: 'พร้อมรับการตรวจ'
        })
      })
    );

    expect(result.plan.status).toBe(PLAN_STATUSES.SUBMITTED);
    expect(result.plan.version).toBe(2);
    expect(result.plan.private_internal_note).toBeUndefined();
    expect(result.statusHistory).toHaveLength(1);
    expect(result.statusHistory[0].actor_label).toBe('นักศึกษา (เจ้าของแผน)');
    expect(result.statusHistory[0].actor_user_id).toBeUndefined();
    expect(result.statusHistory[0].external_subject).toBeUndefined();
  });
});

describe('Issue #76: Student Plan Submission, Current Status & History UI', () => {
  it('disables submit and highlights missing fields when a DRAFT plan is incomplete', async () => {
    const incompletePlan = {
      ...READY_DRAFT_PLAN,
      company_id: null,
      company_name: null,
      job_description: ''
    };
    const context = setupStudentPlanShell({ plan: incompletePlan });

    await context.app.start();
    await flushPromises();

    const submitButton = context.root.querySelector('[data-role="submit-plan-button"]');
    expect(submitButton.disabled).toBe(true);
    expect(context.root.querySelector('[data-role="plan-missing-fields"]').textContent).toContain(
      'ยังไม่ได้ระบุสถานประกอบการ'
    );
    expect(context.root.querySelector('[data-role="plan-missing-fields"]').textContent).toContain(
      'ยังไม่ได้ระบุรายละเอียดงานโดยสังเขป'
    );
  });

  it('prevents accidental duplicate submit while in flight, refreshes state/history from server, and locks fields as read-only after submit', async () => {
    let resolveSubmit;
    const pendingSubmit = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    const submitPlan = jest.fn().mockReturnValue(pendingSubmit);
    const context = setupStudentPlanShell({ submitPlan });

    await context.app.start();
    await flushPromises();

    const form = context.root.querySelector('form.student-profile-form');
    const submitButton = context.root.querySelector('[data-role="submit-plan-button"]');
    const noteInput = context.root.querySelector('#student-plan-submit-note');

    expect(submitButton.disabled).toBe(false);
    expect(context.root.querySelector('.student-plan-workspace').dataset.planReadonly).toBe('false');

    noteInput.value = 'ส่งแผนครั้งที่ 1';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // Second accidental submit while first is still in flight:
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(submitPlan).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.textContent).toBe('กำลังส่งแผนสหกิจ...');

    resolveSubmit({
      plan: {
        ...READY_DRAFT_PLAN,
        status: PLAN_STATUSES.SUBMITTED,
        version: 2
      },
      statusHistory: [
        {
          id: '50000000-0000-4000-8000-000000000502',
          plan_id: READY_DRAFT_PLAN.id,
          from_status: PLAN_STATUSES.DRAFT,
          to_status: PLAN_STATUSES.SUBMITTED,
          actor_label: 'นักศึกษา (เจ้าของแผน)',
          reason: 'ส่งแผนครั้งที่ 1',
          created_at: '2026-02-10T10:00:00.000Z'
        }
      ]
    });
    await flushPromises();

    // State and history updated strictly from server response
    expect(context.root.querySelector('[data-role="plan-current-status"]').textContent).toContain(
      'ส่งแผนแล้ว (SUBMITTED)'
    );
    expect(context.root.querySelector('[data-role="plan-version"]').textContent).toContain('v2');
    expect(context.root.querySelector('.student-plan-workspace').dataset.planReadonly).toBe('true');
    expect(context.root.querySelector('#student-plan-submit-note').readOnly).toBe(true);
    expect(context.root.querySelector('[data-role="submit-plan-button"]').disabled).toBe(true);

    const historyItems = context.root.querySelectorAll('.student-plan-history__item');
    expect(historyItems).toHaveLength(2);
    expect(historyItems[1].textContent).toContain('ฉบับร่าง (DRAFT) → ส่งแผนแล้ว (SUBMITTED)');
    expect(historyItems[1].textContent).toContain('ผู้ดำเนินการ: นักศึกษา (เจ้าของแผน)');
    expect(historyItems[1].textContent).toContain('ส่งแผนครั้งที่ 1');
  });

  it('shows staff return reason on RETURNED_FOR_REVISION and allows resubmission', async () => {
    const returnedPlan = {
      ...READY_DRAFT_PLAN,
      status: PLAN_STATUSES.RETURNED_FOR_REVISION,
      return_reason: 'กรุณาระบุขอบเขตงานส่วน Backend ให้ชัดเจนขึ้น',
      version: 3
    };
    const context = setupStudentPlanShell({ plan: returnedPlan });

    await context.app.start();
    await flushPromises();

    expect(context.root.querySelector('[data-role="plan-return-reason"]').textContent).toContain(
      'กรุณาระบุขอบเขตงานส่วน Backend ให้ชัดเจนขึ้น'
    );
    expect(context.root.querySelector('[data-role="submit-plan-button"]').disabled).toBe(false);
  });

  it('does not show a false success state on 409 conflict and allows reloading latest server plan', async () => {
    const getOwnPlan = jest
      .fn()
      .mockResolvedValueOnce({
        plan: READY_DRAFT_PLAN,
        statusHistory: INITIAL_HISTORY
      })
      .mockResolvedValueOnce({
        plan: {
          ...READY_DRAFT_PLAN,
          status: PLAN_STATUSES.SUBMITTED,
          version: 2
        },
        statusHistory: INITIAL_HISTORY
      });
    const submitPlan = jest.fn().mockRejectedValue(
      new StudentPlanError(
        STUDENT_PLAN_ERROR_CODES.STALE_RECORD_CONFLICT,
        'ข้อมูลแผนสหกิจถูกอัปเดตจากหน้าต่างหรือคำสั่งอื่น กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการใหม่'
      )
    );

    const context = setupStudentPlanShell({ getOwnPlan, submitPlan });
    await context.app.start();
    await flushPromises();

    const form = context.root.querySelector('form.student-profile-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    // Still shows DRAFT (never shows false SUBMITTED state)
    expect(context.root.querySelector('[data-role="plan-current-status"]').textContent).toContain(
      'ฉบับร่าง (DRAFT)'
    );
    const feedback = context.root.querySelector('[data-role="plan-submit-feedback"]');
    expect(feedback.getAttribute('role')).toBe('alert');
    expect(feedback.textContent).toContain('กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการใหม่');

    const reloadBtn = feedback.querySelector('button');
    expect(reloadBtn.textContent).toBe('โหลดข้อมูลแผนล่าสุด');
    reloadBtn.click();
    await flushPromises();

    expect(getOwnPlan).toHaveBeenCalledTimes(2);
    expect(context.root.querySelector('[data-role="plan-current-status"]').textContent).toContain(
      'ส่งแผนแล้ว (SUBMITTED)'
    );
  });

  it('immediately clears private plan data and shows the shell expired-session alert when submit returns 401', async () => {
    const submitPlan = jest.fn().mockRejectedValue(
      new StudentPlanError(STUDENT_PLAN_ERROR_CODES.SESSION_EXPIRED)
    );
    const context = setupStudentPlanShell({ submitPlan });

    await context.app.start();
    await flushPromises();
    expect(context.root.textContent).toContain('บริษัท เทคโนโลยีไทย จำกัด');

    const form = context.root.querySelector('form.student-profile-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(context.root.textContent).not.toContain('บริษัท เทคโนโลยีไทย จำกัด');
    expect(context.root.textContent).toContain('Session หมดอายุ');
    expect(window.sessionStorage.getItem('co-ed:return-route')).toBe('#/student/plan');
  });
});
