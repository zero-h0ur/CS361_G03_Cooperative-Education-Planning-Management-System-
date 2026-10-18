export const AUTH_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'AUTH_CONFIGURATION_ERROR',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  SERVICE_UNAVAILABLE: 'SESSION_SERVICE_UNAVAILABLE',
  INVALID_RESPONSE: 'INVALID_SESSION_RESPONSE'
});

const SAFE_MESSAGES = Object.freeze({
  [AUTH_ERROR_CODES.CONFIGURATION]: 'Authentication is not configured.',
  [AUTH_ERROR_CODES.SESSION_EXPIRED]: 'Your session has expired.',
  [AUTH_ERROR_CODES.ACCESS_DENIED]: 'You do not have permission to access this area.',
  [AUTH_ERROR_CODES.SERVICE_UNAVAILABLE]: 'The session service is temporarily unavailable.',
  [AUTH_ERROR_CODES.INVALID_RESPONSE]: 'The session service returned an invalid response.'
});

export class AuthShellError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] || SAFE_MESSAGES[AUTH_ERROR_CODES.SERVICE_UNAVAILABLE]);
    this.name = 'AuthShellError';
    this.code = code;
  }
}

export function isAuthShellError(error, code) {
  return error instanceof AuthShellError && (!code || error.code === code);
}
