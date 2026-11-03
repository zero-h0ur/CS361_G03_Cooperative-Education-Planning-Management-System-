const { ACTIONS } = require('../services/authorization-service');
const { Phase1ScheduleService } = require('../services/phase1-schedule-service');
const { parseJsonBody, assertAllowedQueryParameters } = require('../router');
const { sendSuccess } = require('../response');
const { ValidationError } = require('../errors');

function registerPhase1ScheduleRoutes(router, protect, options = {}) {
  const service = options.phase1ScheduleService || new Phase1ScheduleService(options);

  const reg = (method, pattern, action, handler, queryKeys = []) =>
    protect(router, {
      method,
      pattern,
      action,
      authOptions: options.authOptions || {},
      resolveResource: () => ({ listOnly: true }),
      handler: async (req, res, ctx) => {
        assertAllowedQueryParameters(ctx.url.searchParams, new Set(queryKeys));
        for (const key of queryKeys) {
          if (ctx.url.searchParams.getAll(key).length > 1) {
            throw new ValidationError('Duplicate query parameter.');
          }
        }
        const body = method === 'GET' ? null : await parseJsonBody(req);
        const query = Object.fromEntries(ctx.url.searchParams);
        const result = await handler(ctx.authContext, ctx.params || [], body, query);
        sendSuccess(res, result, 200, null, { 'Cache-Control': 'no-store' });
      }
    });

  // Schedule endpoints
  reg('GET', /^\/api\/v4\/cycles\/([^/]+)\/schedule$/, ACTIONS.PHASE1_SCHEDULE_READ, (a, p) =>
    service.getSchedule(p[0], a)
  );
  reg('PUT', /^\/api\/v4\/cycles\/([^/]+)\/schedule$/, ACTIONS.PHASE1_SCHEDULE_WRITE, (a, p, b) =>
    service.updateSchedule(a, p[0], b)
  );

  // Announcement & Deadline enforcement
  reg('POST', /^\/api\/v4\/cycles\/([^/]+)\/announce$/, ACTIONS.PHASE1_SCHEDULE_WRITE, (a, p, b) =>
    service.announceResults(a, p[0], b)
  );

  // Student selection decision & response
  reg('GET', /^\/api\/v4\/cycles\/([^/]+)\/selection-decision$/, ACTIONS.STUDENT_SELECTION_READ, (a, p) =>
    service.getStudentDecision(a, p[0])
  );
  reg('POST', /^\/api\/v4\/cycles\/([^/]+)\/confirm$/, ACTIONS.PHASE1_CONFIRMATION_WRITE, (a, p, b) =>
    service.respondConfirmation(a, p[0], b, 'CONFIRM')
  );
  reg('POST', /^\/api\/v4\/cycles\/([^/]+)\/waive$/, ACTIONS.PHASE1_CONFIRMATION_WRITE, (a, p, b) =>
    service.respondConfirmation(a, p[0], b, 'WAIVE')
  );

  // Coordinator confirmation tracker & auto-waive sweep
  reg(
    'GET',
    /^\/api\/v4\/coordinator\/cycles\/([^/]+)\/confirmations$/,
    ACTIONS.COORDINATOR_SELECTION_READ,
    (a, p, _b, q) => service.listConfirmations(a, p[0], q),
    ['status', 'search']
  );
  reg(
    'POST',
    /^\/api\/v4\/coordinator\/cycles\/([^/]+)\/confirmations\/sweep$/,
    ACTIONS.PHASE1_SCHEDULE_WRITE,
    (a, p) => service.processExpiredConfirmations(a, p[0])
  );
  reg(
    'POST',
    /^\/api\/v4\/coordinator\/cycles\/([^/]+)\/confirmations\/([^/]+)\/team-joined$/,
    ACTIONS.PHASE1_SCHEDULE_WRITE,
    (a, p, b) => service.confirmTeamJoined(a, p[0], p[1], b)
  );

  // In-App Notifications
  reg(
    'GET',
    '/api/v4/notifications',
    ACTIONS.APPLICATION_READ,
    (a, _p, _b, q) => service.listNotifications(a, q),
    ['unread_only', 'limit']
  );
  reg(
    'PATCH',
    /^\/api\/v4\/notifications\/([^/]+)\/read$/,
    ACTIONS.APPLICATION_READ,
    (a, p) => service.markNotificationRead(a, p[0])
  );
}

module.exports = { registerPhase1ScheduleRoutes };
