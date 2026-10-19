import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signInWithRedirect, signOut } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { sessionStorage as amplifySessionStorage } from 'aws-amplify/utils';

import { AUTH_ERROR_CODES, AuthShellError } from './auth-errors.js';
import { browserAuthStores, clearAuthenticationStorage, publishLogout } from './auth-storage.js';

const REQUIRED_ACCESS_SCOPE = 'coed-api/access';
let configuredSignature = null;

function requireNonEmptyString(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  return value.trim();
}

function requireSameOriginUrl(value, currentOrigin) {
  const origin = requireNonEmptyString(currentOrigin);
  let parsed;

  try {
    parsed = new URL(requireNonEmptyString(value), origin);
  } catch {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  if (parsed.origin !== origin) {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  return parsed.href;
}

function normalizeScopes(scopes) {
  const normalized = Array.isArray(scopes)
    ? [...new Set(scopes.filter((scope) => typeof scope === 'string').map((scope) => scope.trim()).filter(Boolean))]
    : [];

  if (!normalized.includes('openid') || !normalized.includes(REQUIRED_ACCESS_SCOPE)) {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  return normalized;
}

export function normalizeAuthConfig(config, currentOrigin) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }
  const domain = requireNonEmptyString(config.domain);
  if (!/^[a-z0-9.-]+$/i.test(domain) || domain.startsWith('.') || domain.endsWith('.')) {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  return Object.freeze({
    userPoolId: requireNonEmptyString(config.userPoolId),
    userPoolClientId: requireNonEmptyString(config.userPoolClientId),
    domain,
    redirectSignIn: requireSameOriginUrl(config.redirectSignIn, currentOrigin),
    redirectSignOut: requireSameOriginUrl(config.redirectSignOut, currentOrigin),
    scopes: Object.freeze(normalizeScopes(config.scopes))
  });
}

export function configureAmplifyAuth(config, currentOrigin = window.location.origin) {
  const normalized = normalizeAuthConfig(config, currentOrigin);
  const signature = JSON.stringify(normalized);

  if (configuredSignature && configuredSignature !== signature) {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  if (!configuredSignature) {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: normalized.userPoolId,
          userPoolClientId: normalized.userPoolClientId,
          loginWith: {
            oauth: {
              domain: normalized.domain,
              scopes: normalized.scopes,
              redirectSignIn: [normalized.redirectSignIn],
              redirectSignOut: [normalized.redirectSignOut],
              responseType: 'code'
            }
          }
        }
      }
    });

    cognitoUserPoolsTokenProvider.setKeyValueStorage(amplifySessionStorage);
    configuredSignature = signature;
  }

  return normalized;
}

export function createAmplifyAuthClient({ config, currentOrigin = window.location.origin,
  stores = browserAuthStores(), navigate = (url) => window.location.assign(url),
  notifyLogout = publishLogout } = {}) {
  const normalized = configureAmplifyAuth(config, currentOrigin);
  let signedOut = false;
  let logoutPromise = null;
  const cleanup = () => clearAuthenticationStorage({ clientId: normalized.userPoolClientId, stores });

  return Object.freeze({
    async getAccessToken({ forceRefresh = false } = {}) {
      try {
        if (signedOut) throw new AuthShellError(AUTH_ERROR_CODES.NOT_SIGNED_IN);
        const session = await fetchAuthSession({ forceRefresh });
        if (signedOut) throw new AuthShellError(AUTH_ERROR_CODES.NOT_SIGNED_IN);
        const accessToken = session.tokens?.accessToken?.toString();

        // No stored tokens means the user has not signed in yet in this tab
        // (sessionStorage); a failed refresh of existing tokens is an expiry.
        if (!accessToken) {
          throw new AuthShellError(AUTH_ERROR_CODES.NOT_SIGNED_IN);
        }

        return accessToken;
      } catch (error) {
        if (error instanceof AuthShellError) {
          throw error;
        }

        throw new AuthShellError(AUTH_ERROR_CODES.SESSION_EXPIRED);
      }
    },

    async startLogin() {
      await signInWithRedirect({ options: { prompt: 'LOGIN' } });
    },

    async restartLogin() {
      await cognitoUserPoolsTokenProvider.tokenOrchestrator.clearTokens();
      cleanup();
      await signInWithRedirect({ options: { prompt: 'LOGIN' } });
    },

    async getDisplayIdentity() {
      if (signedOut) return null;
      const session = await fetchAuthSession();
      if (signedOut) return null;
      // Presentation only, never a role/permission source. Render with textContent.
      const claims = session.tokens?.idToken?.payload || {};
      const email = typeof claims.email === 'string' ? claims.email : '';
      const name = [claims.name, claims.given_name, claims['cognito:username'], email.split('@')[0]]
        .find((value) => typeof value === 'string' && value.trim()) || 'ผู้ใช้งาน';
      return { name, email };
    },

    logout() {
      if (logoutPromise) return logoutPromise;
      signedOut = true;
      logoutPromise = (async () => {
        try {
          // Do not erase tokens/OAuth metadata before the SDK uses them to sign out.
          await signOut({ global: true });
        } catch { /* Still clear local state and visit Hosted UI logout on failure. */ }
        try {
          await cognitoUserPoolsTokenProvider.tokenOrchestrator.clearTokens();
        } finally {
          cleanup();
          notifyLogout();
          // Explicitly close Hosted UI cookies even if old OAuth metadata was missing.
          const logoutUrl = new URL(`https://${normalized.domain}/logout`);
          logoutUrl.searchParams.set('client_id', normalized.userPoolClientId);
          logoutUrl.searchParams.set('logout_uri', normalized.redirectSignOut);
          navigate(logoutUrl.href);
        }
      })().finally(() => { logoutPromise = null; });
      return logoutPromise;
    },

    async invalidateLocalSession() {
      signedOut = true;
      try { await cognitoUserPoolsTokenProvider.tokenOrchestrator.clearTokens(); }
      finally { cleanup(); }
    }
  });
}
