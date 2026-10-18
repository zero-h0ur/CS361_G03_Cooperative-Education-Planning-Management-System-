/** @jest-environment jsdom */

const {
  AUTH_ERROR_CODES,
  AuthShellError
} = require('../tmp/frontend-test-modules/auth/auth-errors.cjs');
const {
  SUPPORTED_ROLES,
  createSessionClient
} = require('../tmp/frontend-test-modules/auth/session-client.cjs');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload)
  };
}

describe('authenticated V3 session client', () => {
  it('accepts only the three V3 shell roles', () => {
    expect(SUPPORTED_ROLES).toEqual(['STUDENT', 'STAFF', 'ADVISOR']);
  });

  it('calls /api/v3/me with an Access Token and returns only role and the review capability', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, {
      data: {
        role: 'STUDENT',
        userId: 'private-user-id',
        studentId: 'private-student-id',
        capabilities: ['untrusted-client-capability']
      }
    }));
    const client = createSessionClient({
      apiBaseUrl: 'https://api.example.com/stage/',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('access-token-value'),
      fetchImpl
    });

    await expect(client.loadSession()).resolves.toEqual({ role: 'STUDENT', canReviewPlan: false });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/stage/api/v3/me',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer access-token-value'
        }
      })
    );
  });

  it.each([
    ['STAFF', { canReviewPlan: true }, true],
    ['STAFF', { canReviewPlan: 'true' }, false],
    ['STAFF', undefined, false],
    // A capability on any other role is never trusted to render review controls (#77)
    ['ADVISOR', { canReviewPlan: true }, false],
    ['STUDENT', { canReviewPlan: true }, false]
  ])('keeps canReviewPlan only for %s with a boolean true capability (%#)', async (role, capabilities, expected) => {
    const client = createSessionClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('access-token-value'),
      fetchImpl: jest.fn().mockResolvedValue(response(200, { data: { role, capabilities } }))
    });

    await expect(client.loadSession()).resolves.toEqual({ role, canReviewPlan: expected });
  });

  it.each([
    [{ data: {} }],
    [{ data: { role: 'student' } }],
    [{ role: 'STUDENT' }]
  ])('fails closed for malformed or unsupported session payload %#', async (payload) => {
    const client = createSessionClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetchImpl: jest.fn().mockResolvedValue(response(200, payload))
    });

    await expect(client.loadSession()).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.INVALID_RESPONSE
    });
  });

  it('treats a valid ADMIN session as access denied because the shell has no ADMIN area', async () => {
    const client = createSessionClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetchImpl: jest.fn().mockResolvedValue(response(200, { data: { role: 'ADMIN' } }))
    });

    await expect(client.loadSession()).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.ACCESS_DENIED
    });
  });

  it.each([
    [401, AUTH_ERROR_CODES.SESSION_EXPIRED],
    [403, AUTH_ERROR_CODES.ACCESS_DENIED],
    [503, AUTH_ERROR_CODES.SERVICE_UNAVAILABLE],
    [500, AUTH_ERROR_CODES.SERVICE_UNAVAILABLE]
  ])('maps HTTP %i without exposing a server error message', async (status, expectedCode) => {
    const client = createSessionClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetchImpl: jest.fn().mockResolvedValue(response(status, {
        error: { message: '<img src=x onerror=alert(1)>' }
      }))
    });

    await expect(client.loadSession()).rejects.toMatchObject({ code: expectedCode });
    await client.loadSession().catch((error) => {
      expect(error.message).not.toContain('<img');
    });
  });

  it('maps a network failure to a safe unavailable error', async () => {
    const client = createSessionClient({
      apiBaseUrl: 'https://api.example.com',
      currentOrigin: 'https://app.example.com',
      getAccessToken: jest.fn().mockResolvedValue('token'),
      fetchImpl: jest.fn().mockRejectedValue(new Error('secret network detail'))
    });

    await expect(client.loadSession()).rejects.toMatchObject({
      name: new AuthShellError(AUTH_ERROR_CODES.SERVICE_UNAVAILABLE).name,
      code: AUTH_ERROR_CODES.SERVICE_UNAVAILABLE
    });
  });
});
