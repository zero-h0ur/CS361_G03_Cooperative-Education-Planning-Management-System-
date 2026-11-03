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
import { createTuAuthClients } from './tu-auth-fallback.js';

const root = document.getElementById('authenticatedApp');

if (root) {
  try {
    const config = window.CO_ED_CONFIG || {};
    const authClient = createAmplifyAuthClient({ config: config.auth });

    const clearTuAuthStorage = () => {
      for (const key of ['co-ed:access-token', 'co-ed:auth-mode', 'co-ed:tu-profile', 'co-ed:tu-response']) {
        window.sessionStorage?.removeItem(key);
        window.localStorage?.removeItem(key);
      }
    };

    // If returning from Cognito OAuth callback (?code=...), clear any leftover TU Auth session first
    if (typeof window.location?.search === 'string' && /[?&](code|error)=/.test(window.location.search)) {
      clearTuAuthStorage();
    }

    const isTuAuthActive = () =>
      (window.sessionStorage?.getItem('co-ed:auth-mode') === 'tu-auth' ||
        Boolean(window.sessionStorage?.getItem('co-ed:tu-profile') || window.localStorage?.getItem('co-ed:tu-profile'))) &&
      Boolean(
        window.sessionStorage?.getItem('co-ed:access-token') ||
        window.localStorage?.getItem('co-ed:access-token')
      );

    const getAccessToken = async (options) => {
      if (isTuAuthActive()) {
        const tuToken =
          window.sessionStorage?.getItem('co-ed:access-token') ||
          window.localStorage?.getItem('co-ed:access-token');
        if (tuToken) return tuToken;
      }
      return authClient.getAccessToken(options);
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

    const startCognitoLogin = async () => {
      clearTuAuthStorage();
      await authClient.restartLogin();
    };

    const logout = async () => {
      clearTuAuthStorage();
      await authClient.logout();
    };

    const invalidateLocalSession = async () => {
      clearTuAuthStorage();
      await authClient.invalidateLocalSession();
    };

    const tuProxyBaseUrl = `${String(config.apiBaseUrl || '').replace(/\/$/, '')}/api/tu-proxy`;
    const sessionClient = createSessionClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const baseStudentProfileClient = createStudentProfileClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const baseApplicationClient = createApplicationClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const baseWorkflowClient = createWorkflowClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const baseStudentPlanClient = createStudentPlanClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken
    });
    const tuStudentProfileClient = createStudentProfileClient({
      apiBaseUrl: tuProxyBaseUrl,
      getAccessToken
    });
    const tuApplicationClient = createApplicationClient({
      apiBaseUrl: tuProxyBaseUrl,
      getAccessToken
    });
    const tuWorkflowClient = createWorkflowClient({
      apiBaseUrl: tuProxyBaseUrl,
      getAccessToken
    });
    const tuStudentPlanClient = createStudentPlanClient({
      apiBaseUrl: tuProxyBaseUrl,
      getAccessToken
    });
    const {
      studentProfileClient,
      applicationClient,
      studentPlanClient,
      workflowClient
    } = createTuAuthClients({
      apiBaseUrl: config.apiBaseUrl,
      isTuAuthActive,
      getCachedTuProfile,
      baseStudentProfileClient,
      baseApplicationClient,
      baseWorkflowClient,
      baseStudentPlanClient,
      tuStudentProfileClient,
      tuApplicationClient,
      tuWorkflowClient,
      tuStudentPlanClient
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
      if (isTuAuthActive()) {
        return Object.freeze({ role: 'STUDENT', canReviewPlan: false });
      }
      const session = await sessionClient.loadSession(options);
      if (session?.role === 'STAFF') {
        return { ...session, role: 'COORDINATOR' };
      }
      return session;
    };
    const app = createShellApp({
      applicationClient,
      workflowClient,
      root,
      loadSession,
      startLogin: startCognitoLogin,
      restartLogin: startCognitoLogin,
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
