import { AUTH_ERROR_CODES, AuthShellError } from './auth-errors.js';

export const SUPPORTED_ROLES = Object.freeze(['STUDENT', 'STAFF', 'ADVISOR']);
const SUPPORTED_ROLE_SET = new Set(SUPPORTED_ROLES);
// Valid backend roles (#49) that have no area in the V3 shell, e.g. ADMIN uses OPS only
const SHELL_DENIED_ROLE_SET = new Set(['ADMIN']);

function buildMeEndpoint(apiBaseUrl, currentOrigin) {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  try {
    const baseUrl = new URL(apiBaseUrl, currentOrigin);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/api/v3/me`;
    baseUrl.search = '';
    baseUrl.hash = '';
    return baseUrl.href;
  } catch {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }
}

async function parseSuccessResponse(response) {
  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new AuthShellError(AUTH_ERROR_CODES.INVALID_RESPONSE);
  }

  const role = payload?.data?.role;
  if (SHELL_DENIED_ROLE_SET.has(role)) {
    throw new AuthShellError(AUTH_ERROR_CODES.ACCESS_DENIED);
  }
  if (typeof role !== 'string' || !SUPPORTED_ROLE_SET.has(role)) {
    throw new AuthShellError(AUTH_ERROR_CODES.INVALID_RESPONSE);
  }

  // The shell retains only role and the review capability. canReviewPlan only decides
  // whether review controls are rendered (#77); the backend re-checks every command.
  // Identity/profile/scope fields belong to downstream features.
  const canReviewPlan = role === 'STAFF' && payload?.data?.capabilities?.canReviewPlan === true;
  return Object.freeze({ role, canReviewPlan });
}

function mapFailureStatus(status) {
  if (status === 401) {
    return new AuthShellError(AUTH_ERROR_CODES.SESSION_EXPIRED);
  }

  if (status === 403) {
    return new AuthShellError(AUTH_ERROR_CODES.ACCESS_DENIED);
  }

  return new AuthShellError(AUTH_ERROR_CODES.SERVICE_UNAVAILABLE);
}

export function createSessionClient({
  apiBaseUrl,
  getAccessToken,
  fetchImpl = window.fetch.bind(window),
  currentOrigin = window.location.origin
} = {}) {
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new AuthShellError(AUTH_ERROR_CODES.CONFIGURATION);
  }

  const endpoint = buildMeEndpoint(apiBaseUrl, currentOrigin);

  return Object.freeze({
    async loadSession({ signal } = {}) {
      const accessToken = await getAccessToken();
      let response;

      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }

        throw new AuthShellError(AUTH_ERROR_CODES.SERVICE_UNAVAILABLE);
      }

      if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
        throw new AuthShellError(AUTH_ERROR_CODES.INVALID_RESPONSE);
      }

      if (!response.ok) {
        throw mapFailureStatus(response.status);
      }

      return parseSuccessResponse(response);
    }
  });
}
