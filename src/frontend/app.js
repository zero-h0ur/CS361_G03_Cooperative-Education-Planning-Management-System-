import './authenticated-shell.css';

import { createAmplifyAuthClient } from './auth/amplify-client.js';
import { createSessionClient } from './auth/session-client.js';
import { createAdvisorClient } from './advisor/advisor-client.js';
import { createStaffClient } from './staff/staff-client.js';
import { createShellApp, renderStartupFailure } from './shell-app.js';
import { createStaffReviewClient } from './staff/staff-review-client.js';
import { createStudentPlanClient } from './student/plan-submission-client.js';
import { createStudentProfileClient } from './student/profile-client.js';
import { createWorkflowClient } from './workflow/workflow-client.js';
import { createApplicationClient } from './student/application-client.js';

const root = document.getElementById('authenticatedApp');

if (root) {
  try {
    const config = window.CO_ED_CONFIG || {};
    const authClient = createAmplifyAuthClient({ config: config.auth });

    const getAccessToken = async () => {
      const tuToken =
        window.sessionStorage?.getItem('co-ed:access-token') ||
        window.localStorage?.getItem('co-ed:access-token');
      if (tuToken) return tuToken;
      return authClient.getAccessToken();
    };

    const startTuAuthLogin = async ({ studentId, password }) => {
      const res = await fetch(`${config.apiBaseUrl}/api/v3/auth/tu-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, password })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          body?.error?.message ||
          body?.message ||
          'ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบรหัสนักศึกษาและรหัสผ่าน'
        );
      }
      const token = body?.data?.accessToken;
      if (!token) {
        throw new Error('ไม่ได้รับ Access Token จากระบบยืนยันตัวตน');
      }
      window.sessionStorage?.setItem('co-ed:access-token', token);
      window.localStorage?.setItem('co-ed:access-token', token);
      window.sessionStorage?.setItem('co-ed:auth-mode', 'tu-auth');
      if (body?.data?.profile) {
        const profileJson = JSON.stringify(body.data.profile);
        window.sessionStorage?.setItem('co-ed:tu-profile', profileJson);
        window.localStorage?.setItem('co-ed:tu-profile', profileJson);
      }
      if (body?.data?.tuResponse) {
        const tuRespJson = JSON.stringify(body.data.tuResponse);
        window.sessionStorage?.setItem('co-ed:tu-response', tuRespJson);
        window.localStorage?.setItem('co-ed:tu-response', tuRespJson);
      }
      window.location.hash = '#/student/profile';
      window.location.reload();
    };

    const isTuAuthActive = () =>
      (window.sessionStorage?.getItem('co-ed:auth-mode') === 'tu-auth' ||
        Boolean(window.sessionStorage?.getItem('co-ed:tu-profile') || window.localStorage?.getItem('co-ed:tu-profile'))) &&
      Boolean(
        window.sessionStorage?.getItem('co-ed:access-token') ||
        window.localStorage?.getItem('co-ed:access-token')
      );

    const getCachedTuProfile = () => {
      const cachedRaw =
        window.sessionStorage?.getItem('co-ed:tu-profile') ||
        window.localStorage?.getItem('co-ed:tu-profile');
      if (!cachedRaw) return null;
      try {
        return JSON.parse(cachedRaw);
      } catch {
        return null;
      }
    };

    const logout = async () => {
      window.sessionStorage?.removeItem('co-ed:access-token');
      window.localStorage?.removeItem('co-ed:access-token');
      window.sessionStorage?.removeItem('co-ed:auth-mode');
      window.sessionStorage?.removeItem('co-ed:tu-profile');
      window.localStorage?.removeItem('co-ed:tu-profile');
      window.sessionStorage?.removeItem('co-ed:tu-response');
      window.localStorage?.removeItem('co-ed:tu-response');
      await authClient.logout();
    };

    const invalidateLocalSession = async () => {
      window.sessionStorage?.removeItem('co-ed:access-token');
      window.localStorage?.removeItem('co-ed:access-token');
      window.sessionStorage?.removeItem('co-ed:auth-mode');
      window.sessionStorage?.removeItem('co-ed:tu-profile');
      window.localStorage?.removeItem('co-ed:tu-profile');
      window.sessionStorage?.removeItem('co-ed:tu-response');
      window.localStorage?.removeItem('co-ed:tu-response');
      await authClient.invalidateLocalSession();
    };

    const sessionClient = createSessionClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const baseStudentProfileClient = createStudentProfileClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const studentProfileClient = {
      ...baseStudentProfileClient,
      async getOwnProfile(options) {
        try {
          return await baseStudentProfileClient.getOwnProfile(options);
        } catch (error) {
          const cached = getCachedTuProfile();
          if (cached) {
            return cached;
          }
          throw error;
        }
      }
    };
    const baseApplicationClient = createApplicationClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const applicationClient = {
      ...baseApplicationClient,
      async options(optionsArg) {
        try {
          return await baseApplicationClient.options(optionsArg);
        } catch (error) {
          const cached = getCachedTuProfile();
          if (isTuAuthActive() && cached) {
            return {
              official: {
                student_id: cached.id || 'tu-student',
                full_name: cached.full_name,
                student_number: cached.student_number,
                institutional_email: cached.institutional_email,
                department: cached.department,
                program: cached.program,
                major: cached.major,
                curriculum: '66',
                entry_year: cached.academic_year || 2567,
                academic_verified: true
              },
              cycles: [],
              criteria: [],
              storage_configured: false
            };
          }
          throw error;
        }
      },
      async list(optionsArg) {
        try {
          return await baseApplicationClient.list(optionsArg);
        } catch (error) {
          if (isTuAuthActive()) {
            return [];
          }
          throw error;
        }
      }
    };
    const baseWorkflowClient = createWorkflowClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const workflowClient = {
      ...baseWorkflowClient,
      async request(path, reqOptions = {}) {
        try {
          return await baseWorkflowClient.request(path, reqOptions);
        } catch (error) {
          const cached = getCachedTuProfile();
          if (isTuAuthActive() && cached && path === '/api/v3/students/me') {
            if (reqOptions.method === 'PATCH' && reqOptions.body) {
              const updated = {
                ...cached,
                contact_email: reqOptions.body.contact_email ?? cached.contact_email ?? null,
                contact_phone: reqOptions.body.contact_phone ?? cached.contact_phone ?? null,
                contact_address: reqOptions.body.contact_address ?? cached.contact_address ?? null,
                version: (Number(cached.version) || 1) + 1
              };
              const updatedJson = JSON.stringify(updated);
              window.sessionStorage?.setItem('co-ed:tu-profile', updatedJson);
              window.localStorage?.setItem('co-ed:tu-profile', updatedJson);
              return updated;
            }
            return cached;
          }
          throw error;
        }
      }
    };
    const studentPlanClient = createStudentPlanClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const advisorClient = createAdvisorClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const staffClient = createStaffClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const staffReviewClient = createStaffReviewClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    if (window.location.hash && window.location.hash.startsWith('#/staff')) {
      window.location.hash = '#/coordinator/applications';
    }
    const loadSession = async (options) => {
      try {
        const session = await sessionClient.loadSession(options);
        if (session?.role === 'STAFF') {
          return { ...session, role: 'COORDINATOR' };
        }
        return session;
      } catch (error) {
        if (isTuAuthActive()) {
          return Object.freeze({ role: 'STUDENT', canReviewPlan: false });
        }
        throw error;
      }
    };
    const app = createShellApp({
      applicationClient,
      workflowClient,
      root,
      loadSession,
      startLogin: authClient.startLogin,
      restartLogin: authClient.restartLogin,
      logout,
      startTuAuthLogin,
      invalidateLocalSession,
      location: window.location,
      eventTarget: window,
      storage: window.sessionStorage,
      studentProfileClient,
      studentPlanClient,
      advisorClient,
      staffClient,
      staffReviewClient
    });

    app.start();
  } catch {
    renderStartupFailure(root);
  }
}
