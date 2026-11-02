const { createLambdaHandler } = require('../src/lambda');
const { TokenValidator, IdentityResolver } = require('../src/auth');
const { randomUUID } = require('node:crypto');

const issuer = 'https://issuer.example.invalid/test-pool';
const clientId = 'phase1-schedule-test-client';

function setup(role = 'COORDINATOR') {
  const userId = randomUUID();
  const pool = {
    query: jest.fn(async () => ({
      rows: [
        {
          user_id: userId,
          role,
          account_status: 'ACTIVE',
          link_status: 'ACTIVE',
          active_link_count: 1,
          ...(role === 'STUDENT' ? { student_id: randomUUID() } : { student_id: null })
        }
      ]
    }))
  };

  const phase1ScheduleService = {
    getSchedule: jest.fn(async () => ({
      cycle_id: randomUUID(),
      application_window: { is_open: true, state: 'OPEN' },
      confirmation_window: { is_open: false, state: 'UNSCHEDULED' }
    })),
    updateSchedule: jest.fn(async () => ({
      version: 2,
      replayed: false
    })),
    announceResults: jest.fn(async () => ({
      selected_count: 5,
      version: 2
    })),
    getStudentDecision: jest.fn(async () => ({
      has_result: true,
      outcome: 'SELECTED',
      confirmation_status: 'PENDING_CONFIRMATION'
    })),
    respondConfirmation: jest.fn(async () => ({
      confirmation_status: 'CONFIRMED'
    })),
    listConfirmations: jest.fn(async () => ({
      confirmations: [],
      stats: { total_selected: 0 }
    })),
    processExpiredConfirmations: jest.fn(async () => ({
      count: 0,
      processed: true
    })),
    confirmTeamJoined: jest.fn(async () => ({
      success: true
    })),
    listNotifications: jest.fn(async () => ({
      notifications: []
    })),
    markNotificationRead: jest.fn(async () => ({
      id: randomUUID(),
      read_at: new Date().toISOString()
    }))
  };

  const handler = createLambdaHandler({
    phase1ScheduleService,
    authOptions: {
      pool,
      tokenValidator: new TokenValidator({ expectedIssuer: issuer, expectedClientId: clientId }),
      identityResolver: new IdentityResolver({ pool })
    }
  });

  const event = (path, method = 'GET', authenticated = true) => ({
    rawPath: path,
    rawQueryString: '',
    body: method === 'GET' ? undefined : '{}',
    headers: { 'x-role': role },
    requestContext: {
      http: { method },
      ...(authenticated
        ? {
            authorizer: {
              jwt: {
                claims: {
                  iss: issuer,
                  sub: 'synthetic-sub',
                  client_id: clientId,
                  token_use: 'access',
                  scope: 'coed-api/access',
                  exp: Math.floor(Date.now() / 1000) + 3600,
                  role,
                  'cognito:groups': [role]
                },
                scopes: ['coed-api/access']
              }
            }
          }
        : {})
    }
  });

  return { handler, event, phase1ScheduleService, userId };
}

describe('Phase 1 Schedule & Confirmation API', () => {
  test('GET /api/v4/cycles/:id/schedule returns schedule and no-store headers', async () => {
    const { handler, event, phase1ScheduleService } = setup('COORDINATOR');
    const cycleId = randomUUID();
    const res = await handler(event(`/api/v4/cycles/${cycleId}/schedule`));

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(phase1ScheduleService.getSchedule).toHaveBeenCalledWith(cycleId, expect.anything());
  });

  test('PUT /api/v4/cycles/:id/schedule is allowed for COORDINATOR and rejects STUDENT with 403', async () => {
    const cycleId = randomUUID();
    const { handler: coordHandler, event: coordEvent, phase1ScheduleService } = setup('COORDINATOR');
    const postEv = coordEvent(`/api/v4/cycles/${cycleId}/schedule`, 'PUT');
    postEv.body = JSON.stringify({
      operation_id: randomUUID(),
      expected_version: 1,
      opens_at: '2026-06-01T02:00:00.000Z',
      closes_at: '2026-06-20T10:00:00.000Z'
    });
    const res = await coordHandler(postEv);
    expect(res.statusCode).toBe(200);
    expect(phase1ScheduleService.updateSchedule).toHaveBeenCalled();

    // STUDENT attempt
    const { handler: studentHandler, event: studentEvent } = setup('STUDENT');
    const studentRes = await studentHandler(studentEvent(`/api/v4/cycles/${cycleId}/schedule`, 'PUT'));
    expect(studentRes.statusCode).toBe(403);
  });

  test('POST /api/v4/cycles/:id/announce is restricted to COORDINATOR', async () => {
    const cycleId = randomUUID();
    const { handler, event, phase1ScheduleService } = setup('COORDINATOR');
    const announceEv = event(`/api/v4/cycles/${cycleId}/announce`, 'POST');
    announceEv.body = JSON.stringify({
      operation_id: randomUUID(),
      expected_version: 1,
      confirmation_opens_at: '2026-06-25T04:00:00.000Z',
      confirmation_closes_at: '2026-07-02T10:00:00.000Z'
    });

    const res = await handler(announceEv);
    expect(res.statusCode).toBe(200);
    expect(phase1ScheduleService.announceResults).toHaveBeenCalled();

    const { handler: sHandler, event: sEvent } = setup('STUDENT');
    expect((await sHandler(sEvent(`/api/v4/cycles/${cycleId}/announce`, 'POST'))).statusCode).toBe(403);
  });

  test('POST /api/v4/cycles/:id/confirm allows STUDENT and rejects COORDINATOR with 403', async () => {
    const cycleId = randomUUID();
    const { handler: sHandler, event: sEvent, phase1ScheduleService } = setup('STUDENT');
    const confirmEv = sEvent(`/api/v4/cycles/${cycleId}/confirm`, 'POST');
    confirmEv.body = JSON.stringify({
      operation_id: randomUUID(),
      expected_version: 1
    });

    const res = await sHandler(confirmEv);
    expect(res.statusCode).toBe(200);
    expect(phase1ScheduleService.respondConfirmation).toHaveBeenCalledWith(
      expect.anything(),
      cycleId,
      expect.objectContaining({ expected_version: 1 }),
      'CONFIRM'
    );

    const { handler: cHandler, event: cEvent } = setup('COORDINATOR');
    expect((await cHandler(cEvent(`/api/v4/cycles/${cycleId}/confirm`, 'POST'))).statusCode).toBe(403);
  });

  test('GET /api/v4/coordinator/cycles/:id/confirmations rejects duplicate query parameters with 400', async () => {
    const cycleId = randomUUID();
    const { handler, event } = setup('COORDINATOR');
    const ev = event(`/api/v4/coordinator/cycles/${cycleId}/confirmations`);
    ev.rawQueryString = 'status=CONFIRMED&status=WAIVED';

    const res = await handler(ev);
    expect(res.statusCode).toBe(400);
  });

  test('Anonymous requests to protected schedule routes are rejected with 401', async () => {
    const cycleId = randomUUID();
    const { handler, event } = setup('STUDENT');
    const unauthEv = event(`/api/v4/cycles/${cycleId}/selection-decision`, 'GET', false);

    const res = await handler(unauthEv);
    expect(res.statusCode).toBe(401);
  });
});
