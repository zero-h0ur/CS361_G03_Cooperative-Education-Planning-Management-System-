const { createAppRouter } = require('../src/api/app');
const { attachRequestContext } = require('../src/api/context');
const { StudentPlanRepository } = require('../src/db/repositories/student-plan-repository');

const ACTOR = {
  isAuthenticated: true, role: 'STUDENT', accountStatus: 'ACTIVE',
  userId: '70000000-0000-4000-8000-000000000001',
  studentId: '40000000-0000-4000-8000-000000000101'
};
const CYCLE = {
  id: '30000000-0000-4000-8000-000000000101', name: 'รอบที่ 1',
  academic_year: 2569, semester: 1, status: 'OPEN', source: 'hidden',
  visibility: 'public', data_status: 'mock'
};

function setup(overrides = {}) {
  const repository = {
    findActiveStudentLink: jest.fn(async () => ({ id: ACTOR.studentId })),
    listCycleOptions: jest.fn(async () => [CYCLE]),
    ...overrides
  };
  const router = createAppRouter({ studentPlanRepository: repository });
  async function request(actor = ACTOR, suffix = '', method = 'GET') {
    const req = { method, url: `/api/v3/plan-options/cycles${suffix}`, headers: {} };
    if (actor) attachRequestContext(req, actor);
    const res = {
      writeHead(code) { this.status = code; },
      end(body) { this.body = JSON.parse(body); this.writableEnded = true; }
    };
    await router.handle(req, res);
    return res;
  }
  return { repository, request };
}

test('active linked Student receives exactly the cycle allowlist', async () => {
  const { request, repository } = setup();
  const res = await request();
  expect(res.status).toBe(200);
  expect(Object.keys(res.body.data[0])).toEqual(['id', 'name', 'academic_year', 'semester', 'status']);
  expect(repository.listCycleOptions).toHaveBeenCalledWith({ userId: ACTOR.userId, studentId: ACTOR.studentId });
});

test.each(['ADVISOR', 'STAFF', 'ADMIN'])('denies %s before reading options', async (role) => {
  const { request, repository } = setup();
  expect((await request({ ...ACTOR, role })).status).toBe(403);
  expect(repository.listCycleOptions).not.toHaveBeenCalled();
});

test('requires authentication and an active linked Student', async () => {
  const { request, repository } = setup({ findActiveStudentLink: jest.fn(async () => null) });
  expect((await request(null)).status).toBe(401);
  expect((await request({ ...ACTOR, studentId: null })).status).toBe(403);
  expect((await request({ ...ACTOR, accountStatus: 'DISABLED' })).status).toBe(403);
  expect((await request()).status).toBe(403);
  expect(repository.listCycleOptions).not.toHaveBeenCalled();
});

test('supports empty options and rejects unsupported queries and writes', async () => {
  const { request } = setup({ listCycleOptions: jest.fn(async () => []) });
  expect((await request()).body).toEqual({ data: [] });
  expect((await request(ACTOR, '?student_id=other')).status).toBe(400);
  expect((await request(ACTOR, '', 'POST')).status).toBe(405);
});

test('repository scopes public cycles to an active Student and uses stable ordering', async () => {
  const pool = { query: jest.fn(async () => ({ rows: [CYCLE] })) };
  const repository = new StudentPlanRepository({ pool });
  await repository.listCycleOptions({ userId: ACTOR.userId, studentId: ACTOR.studentId });
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toContain("r.visibility = 'public'");
  expect(sql).toContain("u.role = 'STUDENT' AND u.account_status = 'ACTIVE'");
  expect(sql).toContain('ORDER BY r.academic_year DESC, r.semester DESC NULLS LAST, r.name ASC, r.id ASC');
  expect(params).toEqual([ACTOR.studentId, ACTOR.userId]);
});
