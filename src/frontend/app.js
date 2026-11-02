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
      window.location.hash = '#/student/plan';
      window.location.reload();
    };

    const logout = async () => {
      window.sessionStorage?.removeItem('co-ed:access-token');
      window.localStorage?.removeItem('co-ed:access-token');
      window.sessionStorage?.removeItem('co-ed:auth-mode');
      await authClient.logout();
    };

    const invalidateLocalSession = async () => {
      window.sessionStorage?.removeItem('co-ed:access-token');
      window.localStorage?.removeItem('co-ed:access-token');
      window.sessionStorage?.removeItem('co-ed:auth-mode');
      await authClient.invalidateLocalSession();
    };

    const sessionClient = createSessionClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const studentProfileClient = createStudentProfileClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
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
      const session = await sessionClient.loadSession(options);
      if (session?.role === 'STAFF') {
        return { ...session, role: 'COORDINATOR' };
      }
      return session;
    };
    const app = createShellApp({
      applicationClient: createApplicationClient({apiBaseUrl:config.apiBaseUrl,getAccessToken}),
      workflowClient: createWorkflowClient({apiBaseUrl:config.apiBaseUrl,getAccessToken}),
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
