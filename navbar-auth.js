import { createAmplifyAuthClient } from './src/frontend/auth/amplify-client.js';
import { createSessionClient } from './src/frontend/auth/session-client.js';
import { createPublicNavbar } from './src/frontend/public-navbar.js';

// Separate, bundled public entry point; public content never requires authentication.
const container = document.querySelector('.auth-buttons');
if (container) {
  try {
    const config = window.CO_ED_CONFIG || {};
    const authClient = createAmplifyAuthClient({ config: config.auth });
    const sessionClient = createSessionClient({ apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken });
    createPublicNavbar({ container, authClient, sessionClient }).start();
  } catch {
    // Missing configuration keeps the anonymous login link, never a mock role.
  }
}
