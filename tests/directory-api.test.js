const { createAppRouter } = require('../src/api/app');
const { attachRequestContext } = require('../src/api/context');
const { parseDirectoryQuery } = require('../src/db/repositories/directory-repository');
const { toPublicCompany } = require('../src/api/routes/public-company-routes');
const ID = '11111111-1111-4111-8111-111111111111';
const row = { id: ID, name: 'Synthetic Partner', contact: 'MUST_NOT_LEAK', email: 'MUST_NOT_LEAK',
  positions: [{ id: ID, company_id: ID, title: 'Synthetic Developer', quota: '2', contact: 'MUST_NOT_LEAK' }] };
function setup() {
  const repository = { list: jest.fn(async () => ({ items: [row], pagination: { page: 1, total: 1, totalPages: 1 } })),
    detail: jest.fn(async () => row), positions: jest.fn(async () => row.positions),
    position: jest.fn(async () => row.positions[0]) };
  const router = createAppRouter({ directoryRepository: repository });
  return { repository, async request(url, actor = null, method = 'GET') {
    const request = { url, method, headers: {} };
    if (actor) attachRequestContext(request, { isAuthenticated: true, userId: ID, role: actor, accountStatus: 'ACTIVE' });
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = JSON.parse(body); this.writableEnded = true; } };
    await router.handle(request, response);
    return response;
  } };
}
test('public catalogue returns only public company fields, never positions or contacts', async () => {
  const { request } = setup();
  const res = await request('/api/directory/companies');
  expect(res.status).toBe(200);
  expect(res.headers['Cache-Control']).toBe('no-store');
  expect(res.body.data[0]).toEqual({ id: ID, name: row.name, details_available: false });
  expect(JSON.stringify(res.body)).not.toContain('MUST_NOT_LEAK');
});
test.each(['STUDENT', 'STAFF', 'ADVISOR'])('%s reads approved detail fields without contact data', async role => {
  const { request } = setup();
  const res = await request('/api/v3/directory/companies/' + ID, role);
  expect(res.status).toBe(200);
  expect(res.body.data.positions[0].title).toBe('Synthetic Developer');
  expect(JSON.stringify(res.body)).not.toContain('MUST_NOT_LEAK');
});
test.each([
  '/api/v3/directory/companies', '/api/v3/directory/companies/' + ID,
  '/api/v3/directory/companies/' + ID + '/positions', '/api/v3/directory/positions/' + ID
])('anonymous requests to %s cannot read repository data', async path => {
  const { request, repository } = setup();
  expect((await request(path)).status).toBe(401);
  expect(Object.values(repository).every(fn => fn.mock.calls.length === 0)).toBe(true);
});
test.each(['ADMIN', 'SYSTEM', 'unknown'])('does not grant %s catalogue access implicitly', async role => {
  const { request, repository } = setup();
  expect((await request('/api/v3/directory/companies', role)).status).toBe(403);
  expect(repository.list).not.toHaveBeenCalled();
});
test.each(['role=Developer', 'duration=test', 'q=a&q=b', 'pageSize=101', 'page=NaN', 'recruitingOnly=true'])(
  'public query rejects %s rather than leaking private filters', query => {
    expect(() => parseDirectoryQuery(new URLSearchParams(query), false)).toThrow();
  });
test('protected filters are validated and preserve exact duration', () => {
  expect(parseDirectoryQuery(new URLSearchParams('q=test&role=Developer&duration=6+months&recruitingOnly=true'), true))
    .toMatchObject({ q: 'test', role: 'Developer', duration: '6 months', recruitingOnly: true });
});
test('unsupported writes never reach the read repository', async () => {
  const { request, repository } = setup();
  expect((await request('/api/v3/directory/companies', 'ADVISOR', 'POST')).status).toBe(405);
  expect(repository.list).not.toHaveBeenCalled();
});
test('legacy public responses exclude real position details', () => {
  expect(toPublicCompany({ ...row, positions: [{ ...row.positions[0], data_status: 'to_validate' }] }).positions).toEqual([]);
});
