import './authenticated-shell.css';

import { createAmplifyAuthClient } from './auth/amplify-client.js';
import { createSessionClient } from './auth/session-client.js';
import { createShellApp, renderStartupFailure } from './shell-app.js';
import { createStudentPlanClient } from './student/plan-submission-client.js';
import { createStudentProfileClient } from './student/profile-client.js';

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
    const app = createShellApp({
      root,
      loadSession: sessionClient.loadSession,
      startLogin: authClient.startLogin,
      restartLogin: authClient.restartLogin,
      logout: authClient.logout,
      location: window.location,
      eventTarget: window,
      storage: window.sessionStorage,
      studentProfileClient,
      studentPlanClient
    });

    app.start();
  } catch {
    renderStartupFailure(root);
  }
}
