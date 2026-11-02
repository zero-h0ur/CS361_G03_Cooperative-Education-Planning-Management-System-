/** @jest-environment jsdom */
const {
  getRoute, getRoutesForRole, getNavigationRoutesForRole, canRoleAccessRoute
} = require('../tmp/frontend-test-modules/routes.cjs');
const { createShellApp } = require('../tmp/frontend-test-modules/shell-app.cjs');

test('Student menu has only Profile and Phase 1 while retaining the legacy route registry', () => {
  expect(getNavigationRoutesForRole('STUDENT').map(route => route.hash))
    .toEqual(['#/student/profile', '#/student/application']);
  expect(getRoutesForRole('STUDENT').map(route => route.hash))
    .toContain('#/student/plan');
  expect(getRoutesForRole('STUDENT').map(route => route.hash))
    .toContain('#/student/selection');
});

test.each(['#/student/plan', '#/student/selection'])('legacy bookmark %s still requires the original Student role', async hash => {
  expect(getRoute(hash).navigation).toBe(false);
  expect(canRoleAccessRoute('STUDENT', hash)).toBe(true);
  for (const role of ['STAFF', 'ADVISOR', 'COORDINATOR', 'COMMITTEE', 'ADMIN', undefined]) {
    expect(canRoleAccessRoute(role, hash)).toBe(false);
  }
  const root = document.createElement('div'); document.body.append(root);
  const app = createShellApp({root, location: {hash}, eventTarget: new EventTarget(), storage: null,
    loadSession: async () => ({role:'STUDENT'}), startLogin: async () => {}, restartLogin: async () => {}, logout: async () => {}});
  try {
    await app.start();
    expect(root.querySelector('h1').textContent).toBe(getRoute(hash).title);
    expect([...root.querySelectorAll('.shell-nav__link')].map(link => link.getAttribute('href')))
      .toEqual(['#/student/profile', '#/student/application', 'company-directory.html']);
    expect(root.querySelector('.shell-nav').textContent).not.toContain('ระบบเดิม');
    expect(root.querySelector('[aria-current="page"]')).toBeNull();
  } finally { app.destroy(); root.remove(); }
});

test.each(['STAFF', 'ADVISOR', 'COORDINATOR', 'COMMITTEE', 'ADMIN'])('%s menu and authorization are unchanged', role => {
  expect(getNavigationRoutesForRole(role)).toEqual(getRoutesForRole(role));
  expect(canRoleAccessRoute(role, '#/student/application')).toBe(false);
});

test('current Phase 1 routes remain allowlisted and unknown roles get no navigation', () => {
  expect(canRoleAccessRoute('STUDENT', '#/student/application')).toBe(true);
  const route = getRoute('#/student/application/11111111-1111-4111-8111-111111111111');
  expect(route.navHash).toBe('#/student/application');
  expect(getNavigationRoutesForRole('unknown')).toEqual([]);
});
