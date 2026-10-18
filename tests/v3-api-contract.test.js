const {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  InvalidStateTransitionError,
  ServiceUnavailableError,
  mapError
} = require('../src/api/errors');

const {
  formatSuccess,
  formatError,
  sendJson,
  sendSuccess,
  sendError
} = require('../src/api/response');

const {
  Router,
  decodePathParameter,
  assertAllowedQueryParameters
} = require('../src/api/router');

const {
  extractBearerToken,
  attachRequestContext,
  getRequestContext
} = require('../src/api/context');

const {
  createAppRouter,
  createRequestHandler
} = require('../src/api/app');

describe('Issue #55 - V3 Modular API and Shared Response/Error Contract', () => {
  describe('Module boundaries and circular dependency freedom', () => {
    it('cleanly imports all modules without circular reference failures', () => {
      const errors = require('../src/api/errors');
      const response = require('../src/api/response');
      const router = require('../src/api/router');
      const context = require('../src/api/context');
      const publicRoutes = require('../src/api/routes/public-company-routes');
      const v3Routes = require('../src/api/routes/v3-routes');
      const app = require('../src/api/app');

      expect(typeof errors.mapError).toBe('function');
      expect(typeof response.sendSuccess).toBe('function');
      expect(typeof router.Router).toBe('function');
      expect(typeof context.getRequestContext).toBe('function');
      expect(typeof publicRoutes.registerPublicCompanyRoutes).toBe('function');
      expect(typeof v3Routes.registerV3Routes).toBe('function');
      expect(typeof app.createRequestHandler).toBe('function');
    });
  });

  describe('Shared Success & Error Envelopes', () => {
    it('formats success responses with standard { data } envelope', () => {
      const payload = formatSuccess({ id: '123', status: 'DRAFT' });
      expect(payload).toEqual({
        data: { id: '123', status: 'DRAFT' }
      });
      expect(payload).not.toHaveProperty('pagination');
    });

    it('formats paginated success responses with standard { data, pagination } envelope', () => {
      const pagination = { page: 1, pageSize: 10, total: 100, totalPages: 10 };
      const payload = formatSuccess([{ id: '1' }], pagination);
      expect(payload).toEqual({
        data: [{ id: '1' }],
        pagination: { page: 1, pageSize: 10, total: 100, totalPages: 10 }
      });
    });

    it('formats error responses with standard { error: { code, message } } envelope', () => {
      const payload = formatError('INVALID_STATE_TRANSITION', 'Plan must be in DRAFT to submit.');
      expect(payload).toEqual({
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: 'Plan must be in DRAFT to submit.'
        }
      });
    });

    it('includes details in error envelope when provided', () => {
      const details = [{ field: 'company_id', issue: 'required' }];
      const payload = formatError('VALIDATION_ERROR', 'Validation failed.', details);
      expect(payload).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed.',
          details: [{ field: 'company_id', issue: 'required' }]
        }
      });
    });
  });

  describe('Error Mapping Contract (Acceptance Criteria #3)', () => {
    it('maps ValidationError to HTTP 400', () => {
      const err = new ValidationError('Cycle ID is required.', [{ field: 'cycle_id' }]);
      const mapped = mapError(err);
      expect(mapped.status).toBe(400);
      expect(mapped.code).toBe('VALIDATION_ERROR');
      expect(mapped.message).toBe('Cycle ID is required.');
      expect(mapped.details).toEqual([{ field: 'cycle_id' }]);
    });

    it('maps UnauthorizedError to HTTP 401', () => {
      const err = new UnauthorizedError('Token expired.');
      const mapped = mapError(err);
      expect(mapped.status).toBe(401);
      expect(mapped.code).toBe('UNAUTHORIZED');
      expect(mapped.message).toBe('Token expired.');
    });

    it('maps ForbiddenError to HTTP 403', () => {
      const err = new ForbiddenError('Advisor has read-only access.');
      const mapped = mapError(err);
      expect(mapped.status).toBe(403);
      expect(mapped.code).toBe('FORBIDDEN');
      expect(mapped.message).toBe('Advisor has read-only access.');
    });

    it('maps NotFoundError to HTTP 404', () => {
      const err = new NotFoundError('Plan not found.');
      const mapped = mapError(err);
      expect(mapped.status).toBe(404);
      expect(mapped.code).toBe('RECORD_NOT_FOUND');
      expect(mapped.message).toBe('Plan not found.');
    });

    it('maps MethodNotAllowedError to HTTP 405 and sets Allow header', () => {
      const err = new MethodNotAllowedError('Method not allowed.', ['GET', 'POST']);
      const mapped = mapError(err);
      expect(mapped.status).toBe(405);
      expect(mapped.code).toBe('METHOD_NOT_ALLOWED');
      expect(mapped.headers).toEqual({ Allow: 'GET, POST' });
    });

    it('maps ConflictError to HTTP 409', () => {
      const err = new ConflictError('Stale version detected. Plan has been updated.');
      const mapped = mapError(err);
      expect(mapped.status).toBe(409);
      expect(mapped.code).toBe('CONFLICT');
      expect(mapped.message).toBe('Stale version detected. Plan has been updated.');
    });

    it('maps InvalidStateTransitionError to HTTP 422', () => {
      const err = new InvalidStateTransitionError('Cannot approve a Plan in DRAFT state.');
      const mapped = mapError(err);
      expect(mapped.status).toBe(422);
      expect(mapped.code).toBe('INVALID_STATE_TRANSITION');
      expect(mapped.message).toBe('Cannot approve a Plan in DRAFT state.');
    });

    it('maps ServiceUnavailableError to HTTP 503', () => {
      const err = new ServiceUnavailableError('Database pool exhausted.');
      const mapped = mapError(err);
      expect(mapped.status).toBe(503);
      expect(mapped.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('sanitizes unexpected internal errors to HTTP 500 without leaking stack traces', () => {
      const err = new TypeError('Cannot read properties of undefined (reading secret_db_key)');
      const mapped = mapError(err);
      expect(mapped.status).toBe(500);
      expect(mapped.code).toBe('INTERNAL_ERROR');
      expect(mapped.message).toBe('Internal server error.');
    });

    it('maps legacy DAL errors consistently with V2 behavior', () => {
      const mockDal = {
        InvalidInputError: class extends Error { constructor(msg) { super(msg); this.code = 'INVALID_INPUT'; } },
        RecordNotFoundError: class extends Error { constructor(msg) { super(msg); this.code = 'NOT_FOUND'; } },
        DALError: class extends Error { constructor(msg, code) { super(msg); this.code = code; } }
      };

      const invalidInput = new mockDal.InvalidInputError('Bad query parameter');
      expect(mapError(invalidInput, mockDal)).toEqual({
        status: 400,
        code: 'INVALID_INPUT',
        message: 'Bad query parameter',
        headers: {},
        details: null
      });

      const notFound = new mockDal.RecordNotFoundError('Position not found');
      expect(mapError(notFound, mockDal)).toEqual({
        status: 404,
        code: 'NOT_FOUND',
        message: 'Position not found',
        headers: {},
        details: null
      });

      const dbDown = new mockDal.DALError('DB down', 'CONNECTION_ERROR');
      expect(mapError(dbDown, mockDal)).toEqual({
        status: 503,
        code: 'CONNECTION_ERROR',
        message: 'Service temporarily unavailable.',
        headers: {},
        details: null
      });
    });
  });

  describe('Router & Dispatcher Contract', () => {
    function createMockResponse() {
      let statusCode = 200;
      let headers = {};
      let body = '';
      return {
        writeHead(code, h = {}) {
          statusCode = code;
          headers = { ...headers, ...h };
        },
        end(data) {
          body = data;
          this.writableEnded = true;
        },
        get statusCode() { return statusCode; },
        get headers() { return headers; },
        get body() { return body ? JSON.parse(body) : null; },
        writableEnded: false
      };
    }

    it('dispatches GET and POST routes correctly', async () => {
      const router = new Router();
      router.get('/api/test', (req, res) => {
        sendSuccess(res, { message: 'hello get' });
      });
      router.post('/api/test', (req, res) => {
        sendSuccess(res, { message: 'hello post' }, 201);
      });

      const resGet = createMockResponse();
      await router.handle({ method: 'GET', url: '/api/test' }, resGet);
      expect(resGet.statusCode).toBe(200);
      expect(resGet.body).toEqual({ data: { message: 'hello get' } });

      const resPost = createMockResponse();
      await router.handle({ method: 'POST', url: '/api/test' }, resPost);
      expect(resPost.statusCode).toBe(201);
      expect(resPost.body).toEqual({ data: { message: 'hello post' } });
    });

    it('returns 405 Method Not Allowed with Allow header when path exists but method does not match', async () => {
      const router = new Router();
      router.get('/api/test', (req, res) => sendSuccess(res, {}));

      const res = createMockResponse();
      await router.handle({ method: 'DELETE', url: '/api/test' }, res);
      expect(res.statusCode).toBe(405);
      expect(res.headers.Allow).toBe('GET');
      expect(res.body).toEqual({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }
      });
    });

    it('returns 404 Route Not Found for unregistered routes', async () => {
      const router = new Router();
      const res = createMockResponse();
      await router.handle({ method: 'GET', url: '/api/unknown' }, res);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' }
      });
    });

    it('executes middleware pipeline and respects early termination', async () => {
      const router = new Router();
      router.use((req, res) => {
        sendError(res, new UnauthorizedError('Unauthorized middleware'));
      });
      router.get('/api/protected', (req, res) => {
        sendSuccess(res, { secret: 'data' });
      });

      const res = createMockResponse();
      await router.handle({ method: 'GET', url: '/api/protected' }, res);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized middleware' }
      });
    });
  });

  describe('Context and Bearer Token Extensions', () => {
    it('extracts Bearer tokens correctly from Authorization headers', () => {
      expect(extractBearerToken({ headers: { authorization: 'Bearer test-token-123' } }))
        .toBe('test-token-123');
      expect(extractBearerToken({ headers: { Authorization: 'BEARER test-token-456' } }))
        .toBe('test-token-456');
      expect(extractBearerToken({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }))
        .toBeNull();
      expect(extractBearerToken({ headers: {} }))
        .toBeNull();
    });

    it('attaches and retrieves request context safely', () => {
      const req = {};
      expect(getRequestContext(req)).toEqual({
        isAuthenticated: false,
        user: null,
        role: null,
        scopes: []
      });

      attachRequestContext(req, {
        isAuthenticated: true,
        user: { id: 'usr-123' },
        role: 'STUDENT',
        scopes: ['coed-api/access']
      });

      expect(getRequestContext(req)).toEqual({
        isAuthenticated: true,
        user: { id: 'usr-123' },
        role: 'STUDENT',
        scopes: ['coed-api/access']
      });
    });
  });

  describe('Parameter validation helpers', () => {
    it('assertAllowedQueryParameters throws ValidationError on unknown query param', () => {
      const searchParams = new URLSearchParams('page=1&unknownParam=true');
      expect(() => {
        assertAllowedQueryParameters(searchParams, new Set(['page']));
      }).toThrow(ValidationError);
    });

    it('decodePathParameter decodes uri components or throws ValidationError on malformed sequence', () => {
      expect(decodePathParameter('valid%20path')).toBe('valid path');
      expect(() => {
        decodePathParameter('%E0%A4%A');
      }).toThrow(ValidationError);
    });
  });
});
