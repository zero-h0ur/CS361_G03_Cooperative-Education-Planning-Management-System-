import { createAmplifyAuthClient } from './src/frontend/auth/amplify-client.js';
import { createSessionClient } from './src/frontend/auth/session-client.js';
import { createPublicNavbar } from './src/frontend/public-navbar.js';
import { createDirectoryClient } from './src/frontend/directory-client.js';

// Separate, bundled public entry point; public content never requires authentication.
const container = document.querySelector('.auth-buttons');
let directoryAuth = null;
if (container) {
  try {
    const config = window.CO_ED_CONFIG || {};
    const authClient = createAmplifyAuthClient({ config: config.auth });
    directoryAuth = authClient;
    const sessionClient = createSessionClient({ apiBaseUrl: config.apiBaseUrl,
      getAccessToken: authClient.getAccessToken });
    createPublicNavbar({ container, authClient, sessionClient }).start();
  } catch {
    // Missing configuration keeps the anonymous login link, never a mock role.
  }
}
if (window.CO_ED_CONFIG?.apiBaseUrl) {
  window.CO_ED_DIRECTORY_API = createDirectoryClient({
    apiBaseUrl: window.CO_ED_CONFIG.apiBaseUrl,
    getAccessToken: directoryAuth?.getAccessToken
  });
  window.dispatchEvent(new Event('coed:directory-ready'));
}
