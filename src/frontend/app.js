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

const root = document.getElementById('authenticatedApp');

if (root) {
  try {
    const config = window.CO_ED_CONFIG || {};
    const authClient = createAmplifyAuthClient({ config: config.auth });
    const sessionClient = createSessionClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken
    });
    const studentProfileClient = createStudentProfileClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken
    });
    const studentPlanClient = createStudentPlanClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken
    });
    const advisorClient = createAdvisorClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken
    });
    const staffClient = createStaffClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken
    });
    const staffReviewClient = createStaffReviewClient({
      apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken
    });
    const app = createShellApp({
      workflowClient: createWorkflowClient({apiBaseUrl:config.apiBaseUrl,getAccessToken:authClient.getAccessToken}),
      root,
      loadSession: sessionClient.loadSession,
      startLogin: authClient.startLogin,
      restartLogin: authClient.restartLogin,
      logout: authClient.logout,
      invalidateLocalSession: authClient.invalidateLocalSession,
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
