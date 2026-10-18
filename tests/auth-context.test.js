/**
 * Automated tests for Issue #61: Token validation and trusted request identity context.
 */

const crypto = require('node:crypto');
const { TokenValidator } = require('../src/auth/token-validator');
const { IdentityResolver } = require('../src/auth/identity-resolver');
const { createAuthMiddleware } = require('../src/auth/auth-middleware');
const { getRequestContext } = require('../src/api/context');
const { UnauthorizedError, ForbiddenError } = require('../src/api/errors');
const { createLambdaHandler } = require('../src/lambda');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});
const { publicKey: wrongPublicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});

function signJwt(payload, header = { alg: 'RS256', typ: 'JWT', kid: 'key-1' }, signingKey = privateKey) {
  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encHeader}.${encPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(signingKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('Issue #61: Token Validation and Trusted Identity Context', () => {
  const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_mockPool';
  const CLIENT_ID = 'mock-app-client-id-123';

  function validPayload(overrides = {}) {
    return {
      sub: 'cognito-sub-uuid-1111',
      iss: ISSUER,
      client_id: CLIENT_ID,
      token_use: 'access',
      scope: 'openid email coed-api/access',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nbf: Math.floor(Date.now() / 1000) - 10,
      username: 'student.sample',
      ...overrides
    };
  }

  describe('TokenValidator (Signature, Claim validation & Safety)', () => {
    let validator;

    beforeEach(() => {
      validator = new TokenValidator({
        expectedIssuer: ISSUER,
        expectedClientId: CLIENT_ID,
        requiredScope: 'coed-api/access',
        publicKey
      });
    });

    it('passes valid RS256 signed Access Token and extracts claims', async () => {
      const token = signJwt(validPayload());
      const claims = await validator.validateToken(token);
      expect(claims.subject).toBe('cognito-sub-uuid-1111');
      expect(claims.issuer).toBe(ISSUER);
      expect(claims.clientId).toBe(CLIENT_ID);
      expect(claims.scopes).toContain('coed-api/access');
    });

    it('supports AUTH_ISSUER and AUTH_AUDIENCE environment variables from #58', () => {
      const origIssuer = process.env.AUTH_ISSUER;
      const origAudience = process.env.AUTH_AUDIENCE;
      process.env.AUTH_ISSUER = ISSUER;
      process.env.AUTH_AUDIENCE = CLIENT_ID;

      try {
        const envValidator = new TokenValidator({ publicKey });
        const claims = envValidator.validateClaims(validPayload());
        expect(claims.issuer).toBe(ISSUER);
        expect(claims.clientId).toBe(CLIENT_ID);
      } finally {
        if (origIssuer === undefined) delete process.env.AUTH_ISSUER;
        else process.env.AUTH_ISSUER = origIssuer;
        if (origAudience === undefined) delete process.env.AUTH_AUDIENCE;
        else process.env.AUTH_AUDIENCE = origAudience;
      }
    });

    it('rejects missing or whitespace-padded subject claim (Exact match per #51)', () => {
      expect(() => {
        validator.validateClaims(validPayload({ sub: '' }));
      }).toThrow(UnauthorizedError);

      expect(() => {
        validator.validateClaims(validPayload({ sub: ' cognito-sub-uuid-1111 ' }));
      }).toThrow(UnauthorizedError);
    });

    it('rejects expired token with 401 Unauthorized', () => {
      const expiredPayload = validPayload({
        exp: Math.floor(Date.now() / 1000) - 60
      });
      expect(() => {
        validator.validateClaims(expiredPayload);
      }).toThrow('Authentication token has expired.');
    });

    it('accepts numeric string exp from API Gateway authorizer claims', () => {
      const stringExpPayload = validPayload({
        exp: String(Math.floor(Date.now() / 1000) + 3600)
      });
      const claims = validator.validateClaims(stringExpPayload);
      expect(typeof claims.expiresAt).toBe('number');
    });

    it('rejects token not active yet (nbf in future)', () => {
      const futurePayload = validPayload({
        nbf: Math.floor(Date.now() / 1000) + 120
      });
      expect(() => {
        validator.validateClaims(futurePayload);
      }).toThrow('Token is not active yet.');
    });

    it('rejects ID token or missing token_use per #48 (token_use !== access)', () => {
      expect(() => {
        validator.validateClaims(validPayload({ token_use: 'id' }));
      }).toThrow('Only Access Tokens are permitted for API authorization.');

      expect(() => {
        validator.validateClaims(validPayload({ token_use: undefined }));
      }).toThrow('Only Access Tokens are permitted for API authorization.');
    });

    it('rejects issuer mismatch or missing expectedIssuer with 401 Unauthorized', () => {
      expect(() => {
        validator.validateClaims(validPayload({ iss: 'https://rogue-issuer.evil.com' }));
      }).toThrow('Token issuer mismatch.');

      const unconfiguredValidator = new TokenValidator({ expectedClientId: CLIENT_ID });
      expect(() => {
        unconfiguredValidator.validateClaims(validPayload());
      }).toThrow(UnauthorizedError);
    });

    it('rejects client ID / audience mismatch with 401 Unauthorized', () => {
      expect(() => {
        validator.validateClaims(validPayload({ client_id: 'unauthorized-app-client' }));
      }).toThrow('Token client ID mismatch.');

      expect(() => {
        validator.validateClaims(validPayload({ client_id: CLIENT_ID, aud: 'wrong-aud' }));
      }).toThrow('Token audience mismatch.');
    });

    it('rejects token without required coed-api/access scope', () => {
      const missingScopePayload = validPayload({
        scope: 'openid email'
      });
      expect(() => {
        validator.validateClaims(missingScopePayload);
      }).toThrow('Token lacks required scope: coed-api/access.');
    });

    it('rejects tampered JWT payload or invalid cryptographic signature', async () => {
      const validToken = signJwt(validPayload());
      const [h, , s] = validToken.split('.');
      const tamperedPayload = Buffer.from(
        JSON.stringify(validPayload({ sub: 'spoofed-sub-999' }))
      ).toString('base64url');

      await expect(validator.validateToken(`${h}.${tamperedPayload}.${s}`))
        .rejects.toThrow('Token signature verification failed.');

      const wrongKeyValidator = new TokenValidator({
        expectedIssuer: ISSUER,
        expectedClientId: CLIENT_ID,
        publicKey: wrongPublicKey
      });
      await expect(wrongKeyValidator.validateToken(validToken))
        .rejects.toThrow('Token signature verification failed.');
    });

    it('rejects disallowed algorithms (alg: none or HS256) and missing verification key', async () => {
      const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(validPayload())).toString('base64url')}.sig`;
      await expect(validator.validateToken(noneToken))
        .rejects.toThrow('Unsupported or missing token algorithm.');

      const noKeyValidator = new TokenValidator({
        expectedIssuer: ISSUER,
        expectedClientId: CLIENT_ID
      });
      await expect(noKeyValidator.validateToken(signJwt(validPayload())))
        .rejects.toThrow('Unable to resolve verification key for token.');
    });

    it('rejects malformed token strings safely', async () => {
      await expect(validator.validateToken('not-a-jwt')).rejects.toThrow(UnauthorizedError);
      await expect(validator.validateToken('part1.part2')).rejects.toThrow(UnauthorizedError);
      await expect(validator.validateToken(12345)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('IdentityResolver (Database identity linking & role resolution)', () => {
    it('resolves active student identity with complete profile correctly without exposing iss/sub', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-uuid-1',
            role: 'STUDENT',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: 'student-uuid-1',
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

      const resolver = new IdentityResolver({ pool: mockPool });
      const identity = await resolver.resolveIdentity(ISSUER, 'cognito-sub-1');

      expect(identity.userId).toBe('user-uuid-1');
      expect(identity.role).toBe('STUDENT');
      expect(identity.studentId).toBe('student-uuid-1');
      expect(identity.department).toBe('Computer Science');
      expect(identity.accountStatus).toBe('ACTIVE');
      expect(identity).not.toHaveProperty('externalIssuer');
      expect(identity).not.toHaveProperty('externalSubject');
    });

    it('rejects unlinked identity with 403 Forbidden (UNLINKED_IDENTITY)', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };

      const resolver = new IdentityResolver({ pool: mockPool });
      await expect(resolver.resolveIdentity(ISSUER, 'unknown-sub')).rejects.toThrow(
        new ForbiddenError('Identity is not linked to an application account.', 'UNLINKED_IDENTITY')
      );
    });

    it('rejects revoked identity link with 403 Forbidden (REVOKED_IDENTITY)', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-uuid-1',
            role: 'STUDENT',
            account_status: 'ACTIVE',
            link_status: 'REVOKED',
            active_link_count: 0,
            student_id: 'student-uuid-1'
          }]
        })
      };

      const resolver = new IdentityResolver({ pool: mockPool });
      await expect(resolver.resolveIdentity(ISSUER, 'revoked-sub')).rejects.toThrow(
        new ForbiddenError('Identity link has been revoked.', 'REVOKED_IDENTITY')
      );
    });

    it('rejects disabled user account with 403 Forbidden (ACCOUNT_DISABLED)', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-uuid-disabled',
            role: 'STAFF',
            account_status: 'DISABLED',
            link_status: 'ACTIVE',
            active_link_count: 1
          }]
        })
      };

      const resolver = new IdentityResolver({ pool: mockPool });
      await expect(resolver.resolveIdentity(ISSUER, 'disabled-sub')).rejects.toThrow(
        new ForbiddenError('Application account is disabled.', 'ACCOUNT_DISABLED')
      );
    });

    it('rejects STUDENT user without linked Student record or incomplete profile (INCOMPLETE_PROVISIONING per #51)', async () => {
      const mockPoolNoStudent = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-uuid-unprovisioned',
            role: 'STUDENT',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: null
          }]
        })
      };

      const resolver = new IdentityResolver({ pool: mockPoolNoStudent });
      await expect(resolver.resolveIdentity(ISSUER, 'student-no-profile')).rejects.toThrow(
        new ForbiddenError('Student account provisioning is incomplete.', 'INCOMPLETE_PROVISIONING')
      );

      const mockPoolMissingDept = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-uuid-incomplete',
            role: 'STUDENT',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: 'student-uuid-incomplete',
            department: null
          }]
        })
      };

      const resolver2 = new IdentityResolver({ pool: mockPoolMissingDept });
      await expect(resolver2.resolveIdentity(ISSUER, 'student-no-dept')).rejects.toThrow(
        new ForbiddenError('Student account provisioning is incomplete.', 'INCOMPLETE_PROVISIONING')
      );
    });

    it('rejects duplicate active identity links with 403 Forbidden (DUPLICATE_IDENTITY)', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-uuid-dup',
            role: 'STAFF',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 2
          }]
        })
      };

      const resolver = new IdentityResolver({ pool: mockPool });
      await expect(resolver.resolveIdentity(ISSUER, 'dup-sub')).rejects.toThrow(
        new ForbiddenError('Duplicate active identity links found for user.', 'DUPLICATE_IDENTITY')
      );
    });
  });

  describe('Authentication Middleware & Lambda Authorizer Integration', () => {
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

    it('attaches frozen trusted context for valid Bearer token and ignores client role/id spoofing', async () => {
      const token = signJwt(validPayload());
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'user-123',
            role: 'STUDENT',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: 'student-999'
          }]
        })
      };

      const middleware = createAuthMiddleware({
        tokenValidator: new TokenValidator({
          expectedIssuer: ISSUER,
          expectedClientId: CLIENT_ID,
          publicKey
        }),
        identityResolver: new IdentityResolver({ pool: mockPool })
      });

      const req = {
        headers: {
          authorization: `Bearer ${token}`,
          'x-user-role': 'ADMIN',
          'x-user-id': 'hacker-id',
          'x-student-id': 'other-student'
        }
      };
      const res = createMockResponse();

      await middleware(req, res);

      const ctx = getRequestContext(req);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.userId).toBe('user-123');
      expect(ctx.user.id).toBe('user-123');
      expect(ctx.user.studentId).toBe('student-999');
      expect(ctx.role).toBe('STUDENT');
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(ctx.user)).toBe(true);
      // Sensitive claims must not be attached to downstream context
      expect(JSON.stringify(ctx)).not.toContain('cognito-sub-uuid-1111');
      expect(JSON.stringify(ctx)).not.toContain(ISSUER);
      expect(res.writableEnded).toBe(false);
    });

    it('resolves identity from API Gateway HTTP API requestContext.authorizer.jwt.claims', async () => {
      const mockPool = {
        query: jest.fn().mockResolvedValue({
          rows: [{
            user_id: 'staff-user-1',
            role: 'STAFF',
            account_status: 'ACTIVE',
            link_status: 'ACTIVE',
            active_link_count: 1,
            student_id: null
          }]
        })
      };

      const middleware = createAuthMiddleware({
        tokenValidator: new TokenValidator({
          expectedIssuer: ISSUER,
          expectedClientId: CLIENT_ID
        }),
        identityResolver: new IdentityResolver({ pool: mockPool })
      });

      const req = {
        headers: {
          authorization: 'Bearer forwarded-by-apigw'
        },
        requestContext: {
          authorizer: {
            jwt: {
              claims: validPayload({ sub: 'staff-sub-001', scope: undefined }),
              scopes: ['coed-api/access']
            }
          }
        }
      };
      const res = createMockResponse();

      await middleware(req, res);

      const ctx = getRequestContext(req);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.userId).toBe('staff-user-1');
      expect(ctx.role).toBe('STAFF');
      expect(ctx.scopes).toEqual(['coed-api/access']);
    });

    it('forwards headers and requestContext through createLambdaHandler', async () => {
      const handler = createLambdaHandler();
      const response = await handler({
        rawPath: '/api/health',
        headers: { 'x-test': '1' },
        requestContext: { http: { method: 'GET' } }
      });
      expect(response.statusCode).toBe(200);
    });

    it('rejects request with missing token when authentication is required', async () => {
      const middleware = createAuthMiddleware({ required: true });
      const req = { headers: {} };
      const res = createMockResponse();

      await middleware(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.'
        }
      });
      expect(res.writableEnded).toBe(true);
    });

    it('returns uniform 403 FORBIDDEN without leaking account or identity link existence', async () => {
      const token = signJwt(validPayload({ sub: 'secret-unlinked-sub-999' }));
      const mockPool = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };

      const middleware = createAuthMiddleware({
        tokenValidator: new TokenValidator({
          expectedIssuer: ISSUER,
          expectedClientId: CLIENT_ID,
          publicKey
        }),
        identityResolver: new IdentityResolver({ pool: mockPool })
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = createMockResponse();

      await middleware(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied.'
        }
      });
      expect(JSON.stringify(res.body)).not.toContain('secret-unlinked-sub-999');
    });

    it('attaches unauthenticated context when token is optional and missing', async () => {
      const middleware = createAuthMiddleware({ required: false });
      const req = { headers: {} };
      const res = createMockResponse();

      await middleware(req, res);

      const ctx = getRequestContext(req);
      expect(ctx.isAuthenticated).toBe(false);
      expect(ctx.user).toBeNull();
      expect(res.writableEnded).toBe(false);
    });

    it('masks raw token, issuer, and stack traces in 401 error responses', async () => {
      const sensitiveToken = signJwt(validPayload({ exp: 1 }));
      const middleware = createAuthMiddleware({
        tokenValidator: new TokenValidator({
          expectedIssuer: ISSUER,
          expectedClientId: CLIENT_ID,
          publicKey
        })
      });
      const req = {
        headers: { authorization: `Bearer ${sensitiveToken}` }
      };
      const res = createMockResponse();

      await middleware(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.'
        }
      });
      expect(JSON.stringify(res.body)).not.toContain(sensitiveToken);
      expect(JSON.stringify(res.body)).not.toContain(ISSUER);
    });
  });
});
