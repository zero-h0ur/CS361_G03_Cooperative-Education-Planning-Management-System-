// Remove authentication state only. Never use Storage.clear() on a shared origin.
export const AUTH_LOGOUT_EVENT_KEY = 'co-ed:auth-logout';
const LEGACY_KEYS = new Set(['co-ed:session', 'co-ed:return-route', 'amplify-signin-with-hostedUI']);

export function isAuthenticationKey(key, clientId) {
  return typeof key === 'string' && (LEGACY_KEYS.has(key) ||
    (clientId && key.startsWith(`CognitoIdentityServiceProvider.${clientId}.`)));
}

export function clearAuthenticationStorage({ clientId, stores = [] } = {}) {
  let complete = true;
  for (const store of stores) {
    try {
      const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
      for (const key of keys) if (isAuthenticationKey(key, clientId)) store.removeItem(key);
    } catch { complete = false; }
  }
  return complete;
}

export function browserAuthStores() {
  const stores = [];
  for (const name of ['localStorage', 'sessionStorage']) {
    try { stores.push(window[name]); } catch { /* A blocked store must not stop sign-out. */ }
  }
  return stores;
}

export function publishLogout() {
  // Keep an identity-free nonce so a suspended/bfcached tab can notice a missed logout.
  try {
    window.localStorage.setItem(AUTH_LOGOUT_EVENT_KEY, crypto.randomUUID());
  } catch { /* Same-tab logout still succeeds if cross-tab messaging is blocked. */ }
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT_KEY));
}

export function subscribeToLogout(handler, target = window) {
  const readNonce = () => { try { return window.localStorage.getItem(AUTH_LOGOUT_EVENT_KEY); } catch { return null; } };
  let seen = readNonce();
  const localHandler = () => { seen = readNonce(); handler(); };
  const storageHandler = (event) => {
    if (event.key === AUTH_LOGOUT_EVENT_KEY && event.newValue) { seen = event.newValue; handler(); }
  };
  const restoreHandler = () => { const current = readNonce(); if (current && current !== seen) { seen = current; handler(); } };
  target.addEventListener(AUTH_LOGOUT_EVENT_KEY, localHandler);
  target.addEventListener('storage', storageHandler);
  target.addEventListener('pageshow', restoreHandler);
  return () => {
    target.removeEventListener(AUTH_LOGOUT_EVENT_KEY, localHandler);
    target.removeEventListener('storage', storageHandler);
    target.removeEventListener('pageshow', restoreHandler);
  };
}
