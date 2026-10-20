/** @jest-environment jsdom */

// Exercise the lockfile-installed Amplify implementation, NOT a signOut mock.
// Only the HTTP boundary is replaced; every credential below is a local fake.
const { TextEncoder, TextDecoder } = require('node:util');
Object.assign(global, { TextEncoder, TextDecoder });
const { cognitoUserPoolsTokenProvider: provider } = require('aws-amplify/auth/cognito');
const { createAmplifyAuthClient } = require('../tmp/frontend-test-modules/auth/amplify-client.cjs');

const config = {
  userPoolId: 'us-east-1_example', userPoolClientId: 'client-test',
  domain: 'test.auth.example.com', redirectSignIn: 'http://localhost/app.html',
  redirectSignOut: 'http://localhost/index.html',
  scopes: ['openid', 'email', 'coed-api/access']
};
const tokenPrefix = `CognitoIdentityServiceProvider.${config.userPoolClientId}.logout-test-user.`;
const originalFetch = global.fetch;
let auth, navigate, notifyLogout;

function response(status, payload = {}) {
  return { status, headers: new Map([['content-type', 'application/x-amz-json-1.1']]),
    text: async () => JSON.stringify(payload), json: async () => payload };
}

async function seedSession({ revocable = true } = {}) {
  const payload = {
    sub: 'synthetic-logout-test', token_use: 'access',
    scope: config.scopes.join(' '), exp: Math.floor(Date.now() / 1000) + 3600,
    ...(revocable ? { origin_jti: 'synthetic-token-family' } : {})
  };
  const jwt = [Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'), 'synthetic-signature'].join('.');
  await provider.authTokenStore.storeTokens({
    username: 'logout-test-user', clockDrift: 0,
    accessToken: { payload, toString: () => jwt }, refreshToken: 'synthetic-only-refresh-token'
  });
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  global.fetch = jest.fn().mockResolvedValue(response(200));
  navigate = jest.fn(); notifyLogout = jest.fn();
  auth = createAmplifyAuthClient({ config, currentOrigin: 'http://localhost',
    stores: [localStorage, sessionStorage], navigate, notifyLogout });
  await seedSession();
});

afterEach(() => { global.fetch = originalFetch; });

function expectRevocationRequest() {
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  expect(String(url)).toBe('https://cognito-idp.us-east-1.amazonaws.com/');
  expect(options.method).toBe('POST');
  expect(options.headers['x-amz-target']).toBe('AWSCognitoIdentityProviderService.RevokeToken');
  const body = JSON.parse(options.body);
  expect(body).toEqual({ ClientId: config.userPoolClientId, Token: 'synthetic-only-refresh-token' });
  expect(options.headers.Authorization).toBeUndefined();
  expect(options.headers.authorization).toBeUndefined();
}

function expectLocalLogout() {
  expect(sessionStorage.getItem(`${tokenPrefix}refreshToken`)).toBeNull();
  expect(sessionStorage.getItem(`${tokenPrefix}accessToken`)).toBeNull();
  expect(notifyLogout).toHaveBeenCalledTimes(1);
  const url = new URL(navigate.mock.calls[0][0]);
  expect(url.origin + url.pathname).toBe(`https://${config.domain}/logout`);
  expect(url.searchParams.get('client_id')).toBe(config.userPoolClientId);
  expect(url.searchParams.get('logout_uri')).toBe(config.redirectSignOut);
  expect([...url.searchParams.keys()].sort()).toEqual(['client_id', 'logout_uri']);
}

test('real SDK sends RevokeToken before removing tokens, without the GlobalSignOut admin scope', async () => {
  global.fetch.mockImplementation(async () => {
    expect(sessionStorage.getItem(`${tokenPrefix}refreshToken`)).toBe('synthetic-only-refresh-token');
    expect(navigate).not.toHaveBeenCalled();
    return response(200);
  });
  await auth.logout();
  expectRevocationRequest();
  expectLocalLogout();
  await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' });
});

test('concurrent logout shares one real SDK revocation request', async () => {
  const first = auth.logout(); const second = auth.logout();
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expectRevocationRequest(); expectLocalLogout();
});

test('SDK-swallowed revocation rejection still removes local access; resolution is NOT proof of remote revocation', async () => {
  global.fetch.mockResolvedValue(response(400, {
    __type: 'InvalidParameterException', message: 'Synthetic revocation failure'
  }));
  await auth.logout();
  expectRevocationRequest(); expectLocalLogout();
  await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' });
});

test('already signed-out tab has no refresh token to revoke but still closes the Hosted UI session', async () => {
  await provider.tokenOrchestrator.clearTokens();
  await auth.logout();
  expect(global.fetch).not.toHaveBeenCalled();
  expectLocalLogout();
});

test('a legacy token without origin_jti is not proof of revocation support', async () => {
  await seedSession({ revocable: false });
  await auth.logout();
  expect(global.fetch).not.toHaveBeenCalled();
  expectLocalLogout();
});
