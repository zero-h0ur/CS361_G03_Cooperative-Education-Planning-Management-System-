import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signInWithRedirect, signOut } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { sessionStorage as amplifySessionStorage } from 'aws-amplify/utils';

import { AUTH_ERROR_CODES, AuthShellError } from './auth-errors.js';

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

  return Object.freeze({
    userPoolId: requireNonEmptyString(config.userPoolId),
    userPoolClientId: requireNonEmptyString(config.userPoolClientId),
    domain: requireNonEmptyString(config.domain),
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

export function createAmplifyAuthClient({ config, currentOrigin = window.location.origin } = {}) {
  configureAmplifyAuth(config, currentOrigin);

  return Object.freeze({
    async getAccessToken({ forceRefresh = false } = {}) {
      try {
        const session = await fetchAuthSession({ forceRefresh });
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
      await signInWithRedirect();
    },

    async restartLogin() {
      await cognitoUserPoolsTokenProvider.tokenOrchestrator.clearTokens();
      await signInWithRedirect();
    },

    async logout() {
      await signOut({ global: true });
    }
  });
}
