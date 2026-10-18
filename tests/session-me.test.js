/**
 * Integration and Unit Tests for Issue #64:
 * [V3-A01] Provide authenticated /me and session context endpoint.
 */

const crypto = require('node:crypto');
const { createLambdaHandler } = require('../src/lambda');
const {
  TokenValidator,
  IdentityResolver,
  AuthorizationService
} = require('../src/auth');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});

const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_v3pool';
const CLIENT_ID = 'v3-client-id-64';

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(payload, header = { alg: 'RS256', typ: 'JWT' }) {
  const headerSegment = base64UrlEncode(header);
  const payloadSegment = base64UrlEncode(payload);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${signingInput}.${signature}`;
}

function makeAccessClaims(overrides = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: 'cognito-sub-default',
    client_id: CLIENT_ID,
    token_use: 'access',
    scope: 'openid email coed-api/access',
    exp: nowSec + 3600,
    nbf: nowSec - 60,
    ...overrides
  };
}

describe('Issue #64: Authenticated /me and Session Context Endpoint', () => {
  function buildHandlerWithPool(mockPool) {
    const tokenValidator = new TokenValidator({
      expectedIssuer: ISSUER,
      expectedClientId: CLIENT_ID,
      publicKey
    });
    const identityResolver = new IdentityResolver({ pool: mockPool });
    const authorizationService = new AuthorizationService({
      pool: mockPool,
      now: () => new Date('2026-10-18T08:00:00.000Z')
    });

    return createLambdaHandler({
      authOptions: {
        tokenValidator,
        identityResolver,
        authorizationService
      }
    });
  }

  // Production path (#48): API Gateway JWT Authorizer forwards verified claims to Lambda
  function authorizerRequestContext(claims, method = 'GET') {
    return {
      http: { method },
      authorizer: {
        jwt: {
          claims,
          scopes: ['coed-api/access']
        }
      }
    };
  }

  describe('1. Positive Role Bootstrap (/api/v3/me)', () => {
    it('returns stable session context, own profile summary, and navigation flags for STUDENT', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: '11111111-1111-4111-8111-111111111111',
            role: 'STUDENT',
            account_status: 'ACTIVE',
            identity_link_id: 'link-student-1',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: '22222222-2222-4222-8222-222222222222',
            student_number: '6709650001',
            full_name: 'Student Synthetic One',
            institutional_email: 'student1@example.edu',
            department: 'Computer Science',
            program: 'B.Sc.',
            major: 'Computer Science',
            academic_year: 2567,
            enrollment_status: 'ACTIVE'
          }]
        })
      };

      const handler = buildHandlerWithPool(mockPool);
      const claims = makeAccessClaims({ sub: 'sub-student-001' });
      const token = signJwt(claims);

      const response = await handler({
        rawPath: '/api/v3/me',
        headers: {
          authorization: `Bearer ${token}`,
          'x-role': 'ADMIN',
          'x-student-id': 'spoofed-student-id'
        },
        requestContext: authorizerRequestContext(claims)
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.user).toEqual({
        id: '11111111-1111-4111-8111-111111111111',
        role: 'STUDENT',
        accountStatus: 'ACTIVE'
      });
      expect(body.data.role).toBe('STUDENT');
      expect(body.data.studentId).toBe('22222222-2222-4222-8222-222222222222');
      expect(body.data.profile).toEqual({
        studentId: '22222222-2222-4222-8222-222222222222',
        department: 'Computer Science',
        program: 'B.Sc.',
        major: 'Computer Science',
        academicYear: 2567,
        enrollmentStatus: 'ACTIVE'
      });
      expect(body.data.capabilities.scopeMode).toBe('OWN');
      expect(body.data.capabilities.canMutateStudentProfile).toBe(true);
      expect(body.data.capabilities.canMutatePlanContent).toBe(true);
      expect(body.data.capabilities.canSubmitPlan).toBe(true);
      expect(body.data.capabilities.canReviewPlan).toBe(false);
      expect(body.data.capabilities.navigation).toEqual({
        canAccessStudentDashboard: true,
        canAccessMyProfile: true,
        canAccessMyPlan: true,
        canAccessAdvisorStudents: false,
        canAccessStaffStudentManagement: false,
        canAccessStaffReviewQueue: false
      });
      expect(body.data.scope).toEqual({
        mode: 'OWN',
        studentId: '22222222-2222-4222-8222-222222222222',
        operationalScopes: [],
        assignedStudents: [],
        assignedStudentCount: 0
      });

      // Must not leak sensitive claims, token, or internal link IDs
      expect(response.body).not.toContain(token);
      expect(response.body).not.toContain('sub-student-001');
      expect(response.body).not.toContain(ISSUER);
      expect(response.body).not.toContain('link-student-1');
    });

    it('returns active operational scopes and review navigation flags for STAFF via API Gateway authorizer context', async () => {
      const mockPool = {
        query: jest
          .fn()
          // 1st query: IdentityResolver
          .mockResolvedValueOnce({
            rows: [{
              user_id: '33333333-3333-4333-8333-333333333333',
              role: 'STAFF',
              account_status: 'ACTIVE',
              link_status: 'ACTIVE',
              active_link_count: 1,
              student_id: null
            }]
          })
          // 2nd query: AuthorizationRepository.listActiveStaffScopes
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'scope-uuid-1',
                department: 'Computer Science',
                program: 'B.Sc.',
                academicYear: 2567
              }
            ]
          })
      };

      const handler = buildHandlerWithPool(mockPool);
      const response = await handler({
        rawPath: '/api/v3/me',
        requestContext: {
          http: { method: 'GET' },
          authorizer: {
            jwt: {
              claims: makeAccessClaims({ sub: 'sub-staff-001', scope: undefined }),
              scopes: ['coed-api/access']
            }
          }
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.role).toBe('STAFF');
      expect(body.data.studentId).toBeNull();
      expect(body.data.profile).toBeNull();
      expect(body.data.capabilities.scopeMode).toBe('SCOPED');
      expect(body.data.capabilities.canReviewPlan).toBe(true);
      expect(body.data.capabilities.canMutatePlanContent).toBe(false);
      expect(body.data.capabilities.navigation.canAccessStaffStudentManagement).toBe(true);
      expect(body.data.capabilities.navigation.canAccessStaffReviewQueue).toBe(true);
      expect(body.data.scope).toEqual({
        mode: 'SCOPED',
        studentId: null,
        operationalScopes: [
          {
            department: 'Computer Science',
            program: 'B.Sc.',
            academicYear: 2567
          }
        ],
        assignedStudents: [],
        assignedStudentCount: 0
      });
    });

    it('returns active assigned student scopes and read-only capability for ADVISOR', async () => {
      const mockPool = {
        query: jest
          .fn()
          // 1st query: IdentityResolver
          .mockResolvedValueOnce({
            rows: [{
              user_id: '44444444-4444-4444-8444-444444444444',
              role: 'ADVISOR',
              account_status: 'ACTIVE',
              link_status: 'ACTIVE',
              active_link_count: 1,
              student_id: null
            }]
          })
          // 2nd query: AuthorizationRepository.listActiveAdvisorAssignments
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'assign-1',
                studentId: '22222222-2222-4222-8222-222222222222',
                academicYear: 2567,
                semester: 1
              }
            ]
          })
      };

      const handler = buildHandlerWithPool(mockPool);
      const tokenClaims = makeAccessClaims({ sub: 'sub-advisor-001' });

      const response = await handler({
        rawPath: '/api/v3/me',
        requestContext: authorizerRequestContext(tokenClaims)
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.role).toBe('ADVISOR');
      expect(body.data.capabilities.scopeMode).toBe('ASSIGNED');
      expect(body.data.capabilities.isReadOnly).toBe(true);
      expect(body.data.capabilities.canReviewPlan).toBe(false);
      expect(body.data.capabilities.canMutatePlanContent).toBe(false);
      expect(body.data.capabilities.navigation.canAccessAdvisorStudents).toBe(true);
      expect(body.data.scope).toEqual({
        mode: 'ASSIGNED',
        studentId: null,
        operationalScopes: [],
        assignedStudents: [
          {
            studentId: '22222222-2222-4222-8222-222222222222',
            academicYear: 2567,
            semester: 1
          }
        ],
        assignedStudentCount: 1
      });
    });

    it('returns ADMIN session context with no implicit Student/Plan navigation or review scope', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValueOnce({
          rows: [{
            user_id: '55555555-5555-4555-8555-555555555555',
            role: 'ADMIN',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: null
          }]
        })
      };

      const handler = buildHandlerWithPool(mockPool);
      const tokenClaims = makeAccessClaims({ sub: 'sub-admin-001' });

      const response = await handler({
        rawPath: '/api/v3/me',
        requestContext: authorizerRequestContext(tokenClaims)
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.data.role).toBe('ADMIN');
      expect(body.data.capabilities.scopeMode).toBe('DENY');
      expect(body.data.capabilities.isReadOnly).toBe(true);
      expect(body.data.capabilities.navigation).toEqual({
        canAccessStudentDashboard: false,
        canAccessMyProfile: false,
        canAccessMyPlan: false,
        canAccessAdvisorStudents: false,
        canAccessStaffStudentManagement: false,
        canAccessStaffReviewQueue: false
      });
    });
  });

  describe('2. Negative Paths & Security Controls', () => {
    it('returns 401 UNAUTHORIZED for missing, expired, or invalid tokens', async () => {
      const mockPool = { query: jest.fn() };
      const handler = buildHandlerWithPool(mockPool);

      // Missing token
      const resMissing = await handler({
        rawPath: '/api/v3/me',
        requestContext: { http: { method: 'GET' } }
      });
      expect(resMissing.statusCode).toBe(401);
      expect(JSON.parse(resMissing.body)).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.'
        }
      });

      // Expired token
      const expiredTokenClaims = makeAccessClaims({ exp: 1000 });
      const resExpired = await handler({
        rawPath: '/api/v3/me',
        requestContext: authorizerRequestContext(expiredTokenClaims)
      });
      expect(resExpired.statusCode).toBe(401);
      expect(JSON.parse(resExpired.body)).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.'
        }
      });

      // Validly signed Bearer token without API Gateway authorizer claims (#48 trust boundary)
      const resBearerOnly = await handler({
        rawPath: '/api/v3/me',
        headers: { authorization: `Bearer ${signJwt(makeAccessClaims())}` },
        requestContext: { http: { method: 'GET' } }
      });
      expect(resBearerOnly.statusCode).toBe(401);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('serves the session endpoint only at the canonical /api/v3/me path', async () => {
      const handler = buildHandlerWithPool({ query: jest.fn() });

      for (const legacyPath of ['/api/me', '/me']) {
        const response = await handler({
          rawPath: legacyPath,
          requestContext: authorizerRequestContext(makeAccessClaims())
        });
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body).error.code).toBe('ROUTE_NOT_FOUND');
      }
    });

    it('returns 403 FORBIDDEN for unlinked, revoked, disabled, or incomplete-student identities', async () => {
      // Unlinked identity
      const mockPoolUnlinked = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };
      const handlerUnlinked = buildHandlerWithPool(mockPoolUnlinked);
      const tokenClaims = makeAccessClaims({ sub: 'unlinked-sub' });

      const resUnlinked = await handlerUnlinked({
        rawPath: '/api/v3/me',
        requestContext: authorizerRequestContext(tokenClaims)
      });
      expect(resUnlinked.statusCode).toBe(403);
      expect(JSON.parse(resUnlinked.body)).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied.'
        }
      });

      // Disabled user
      const mockPoolDisabled = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'disabled-user',
            role: 'STAFF',
            account_status: 'DISABLED',
            link_status: 'ACTIVE',
            active_link_count: 1
          }]
        })
      };
      const handlerDisabled = buildHandlerWithPool(mockPoolDisabled);
      const resDisabled = await handlerDisabled({
        rawPath: '/api/v3/me',
        requestContext: authorizerRequestContext(tokenClaims)
      });
      expect(resDisabled.statusCode).toBe(403);
      expect(JSON.parse(resDisabled.body)).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied.'
        }
      });
    });

    it('rejects unexpected query parameters (e.g. ?role=ADMIN) with 400 VALIDATION_ERROR', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'staff-1',
            role: 'STAFF',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1
          }]
        })
      };
      const handler = buildHandlerWithPool(mockPool);
      const tokenClaims = makeAccessClaims({ sub: 'staff-sub' });

      const response = await handler({
        rawPath: '/api/v3/me',
        rawQueryString: 'role=ADMIN',
        requestContext: authorizerRequestContext(tokenClaims)
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-GET methods on /api/v3/me with 405 METHOD_NOT_ALLOWED and Allow: GET', async () => {
      const mockPool = { query: jest.fn() };
      const handler = buildHandlerWithPool(mockPool);

      const response = await handler({
        rawPath: '/api/v3/me',
        requestContext: { http: { method: 'POST' } }
      });

      expect(response.statusCode).toBe(405);
      expect(response.headers.Allow).toBe('GET');
      expect(JSON.parse(response.body).error.code).toBe('METHOD_NOT_ALLOWED');
    });
  });
});
