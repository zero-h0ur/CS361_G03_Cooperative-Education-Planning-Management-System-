/** @jest-environment jsdom */
jest.mock('aws-amplify', () => ({ Amplify: { configure: jest.fn() } }));
jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn(), signInWithRedirect: jest.fn(), signOut: jest.fn() }));
jest.mock('aws-amplify/auth/cognito', () => ({ cognitoUserPoolsTokenProvider: {
  setKeyValueStorage: jest.fn(), tokenOrchestrator: { clearTokens: jest.fn() }
} }));
jest.mock('aws-amplify/utils', () => ({ sessionStorage: {} }));
const { signOut, signInWithRedirect, fetchAuthSession } = require('aws-amplify/auth');
const { cognitoUserPoolsTokenProvider: provider } = require('aws-amplify/auth/cognito');
const { createAmplifyAuthClient } = require('../tmp/frontend-test-modules/auth/amplify-client.cjs');
const { clearAuthenticationStorage, subscribeToLogout, AUTH_LOGOUT_EVENT_KEY } = require('../tmp/frontend-test-modules/auth/auth-storage.cjs');
const config = { userPoolId: 'us-east-1_example', userPoolClientId: 'client-test', domain: 'test.auth.example.com',
  redirectSignIn: 'http://localhost/app.html', redirectSignOut: 'http://localhost/index.html', scopes: ['openid', 'coed-api/access'] };
let navigate;
function client() { return createAmplifyAuthClient({ config, currentOrigin: 'http://localhost',
  stores: [localStorage, sessionStorage], navigate, notifyLogout: jest.fn() }); }
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  provider.tokenOrchestrator.clearTokens.mockResolvedValue(); signOut.mockResolvedValue();
  navigate = jest.fn();
  for (const store of [localStorage, sessionStorage]) {
    store.setItem('CognitoIdentityServiceProvider.client-test.user.accessToken', 'access');
    store.setItem('CognitoIdentityServiceProvider.client-test.user.refreshToken', 'refresh');
    store.setItem('CognitoIdentityServiceProvider.client-test.oauthSignIn', 'true');
    store.setItem('CognitoIdentityServiceProvider.other-client.user.accessToken', 'unrelated-client');
    store.setItem('co-ed:session', 'legacy mock'); store.setItem('co-ed:return-route', '#/student/profile');
    store.setItem('theme', 'dark'); store.setItem('company-directory:favorites', 'keep');
  }
});
test('SDK sees tokens before cleanup; both stores retain unrelated data and Hosted UI logout is visited', async () => {
  signOut.mockImplementation(async () => {
    expect(sessionStorage.getItem('CognitoIdentityServiceProvider.client-test.user.accessToken')).toBe('access');
  });
  await client().logout();
  expect(signOut).toHaveBeenCalledWith({ global: true });
  for (const store of [localStorage, sessionStorage]) {
    expect(store.getItem('CognitoIdentityServiceProvider.client-test.user.accessToken')).toBeNull();
    expect(store.getItem('CognitoIdentityServiceProvider.client-test.user.refreshToken')).toBeNull();
    expect(store.getItem('CognitoIdentityServiceProvider.client-test.oauthSignIn')).toBeNull();
    expect(store.getItem('co-ed:session')).toBeNull(); expect(store.getItem('co-ed:return-route')).toBeNull();
    expect(store.getItem('theme')).toBe('dark'); expect(store.getItem('company-directory:favorites')).toBe('keep');
    expect(store.getItem('CognitoIdentityServiceProvider.other-client.user.accessToken')).toBe('unrelated-client');
  }
  const url = new URL(navigate.mock.calls[0][0]);
  expect(url.origin + url.pathname).toBe('https://test.auth.example.com/logout');
  expect(url.searchParams.get('client_id')).toBe('client-test');
  expect(url.searchParams.get('logout_uri')).toBe('http://localhost/index.html');
});
test('SDK failure still removes local tokens and closes Hosted UI; later token reads fail closed', async () => {
  signOut.mockRejectedValue(new Error('service failure'));
  const auth = client(); await auth.logout();
  expect(navigate).toHaveBeenCalledTimes(1);
  await expect(auth.getAccessToken()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' });
  expect(fetchAuthSession).not.toHaveBeenCalled();
});
test('token cleanup failure still removes storage keys and attempts Hosted UI logout', async () => {
  provider.tokenOrchestrator.clearTokens.mockRejectedValue(new Error('blocked'));
  await expect(client().logout()).rejects.toThrow('blocked');
  expect(sessionStorage.getItem('co-ed:session')).toBeNull(); expect(navigate).toHaveBeenCalledTimes(1);
});
test('duplicate concurrent logout does not issue duplicate SDK operations', async () => {
  let finish; signOut.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const auth = client(); const one = auth.logout(); const two = auth.logout();
  expect(signOut).toHaveBeenCalledTimes(1); finish(); await Promise.all([one, two]);
});
test('sign-in/restart explicitly request interactive login', async () => {
  const auth = client(); await auth.startLogin(); await auth.restartLogin();
  expect(signInWithRedirect).toHaveBeenNthCalledWith(1, { options: { prompt: 'LOGIN' } });
  expect(signInWithRedirect).toHaveBeenNthCalledWith(2, { options: { prompt: 'LOGIN' } });
});
test('one blocked storage does not prevent cleanup in the other', () => {
  const blocked = { get length() { throw new Error('denied'); } };
  expect(clearAuthenticationStorage({ clientId: 'client-test', stores: [blocked, sessionStorage] })).toBe(false);
  expect(sessionStorage.getItem('co-ed:session')).toBeNull(); expect(sessionStorage.getItem('theme')).toBe('dark');
});
test('cross-tab invalidation ignores unrelated storage events and can unsubscribe', () => {
  const handler = jest.fn(); const unsubscribe = subscribeToLogout(handler);
  window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
  expect(handler).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent('storage', { key: AUTH_LOGOUT_EVENT_KEY, newValue: 'nonce' }));
  expect(handler).toHaveBeenCalledTimes(1); unsubscribe();
});
