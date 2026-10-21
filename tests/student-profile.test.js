const crypto = require('node:crypto');
const { createLambdaHandler } = require('../src/lambda');
const {
  TokenValidator,
  IdentityResolver,
  AuthorizationService
} = require('../src/auth');
const {
  STUDENT_SELF_PROFILE_FIELDS,
  STUDENT_SELF_MASKED_FIELDS,
  STUDENT_SELF_EDITABLE_FIELDS
} = require('../src/api/services/student-profile-service');

function createTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048
  });

  return { publicKey, privateKey };
}

function signJwt(payload, privateKey, headerOverrides = {}) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...headerOverrides
  };

  const fullPayload = {
    token_use: 'access',
    client_id: payload.aud || 'profile-test-client-id',
    scope: 'openid email coed-api/access',
    ...payload
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

describe('Issue #65: Student self-profile read/update API (/api/v3/students/me)', () => {
  const ISSUER = 'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_profileTest';
  const AUDIENCE = 'profile-test-client-id';
  let keyPair;
  let nowSeconds;

  const STUDENT_A_ROW = {
    id: '20000000-0000-0000-0000-000000000001',
    user_id: '10000000-0000-0000-0000-000000000001',
    student_number: '6509610001',
    full_name: 'Somchai Jaidee',
    preferred_name: 'Chai',
    institutional_email: 'somchai.jai@dome.tu.ac.th',
    department: 'Computer Science',
    program: 'B.Sc. Computer Science',
    major: 'Software Engineering',
    academic_year: 2566,
    enrollment_status: 'ACTIVE',
    created_at: new Date('2026-01-10T08:00:00.000Z'),
    updated_at: new Date('2026-02-15T10:30:00.000Z'),
    version: 3,
    // Internal / legacy columns that MUST be masked in Student self-profile responses
    anonymous_ref: 'STU-ANON-0001',
    year_level: 3,
    source: 'TU_REGISTRAR_SYNC',
    data_source: 'LEGACY_CSV',
    visibility: 'INTERNAL',
    data_status: 'VERIFIED',
    private_note: 'Confidential staff note',
    external_issuer: ISSUER,
    external_subject: 'sub-student-a'
  };

  const STUDENT_B_ID = '20000000-0000-0000-0000-000000000002';

  beforeAll(() => {
    keyPair = createTestKeyPair();
  });

  beforeEach(() => {
    nowSeconds = Math.floor(Date.now() / 1000);
  });

  // Production path (#48): API Gateway's JWT Authorizer verifies the token and forwards
  // its claims to Lambda, which trusts only requestContext.authorizer.jwt.claims (#61).
  function authorizerFromToken(token) {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return { jwt: { claims, scopes: ['coed-api/access'] } };
  }

  function buildEvent(path, token, options = {}) {
    return {
      version: '2.0',
      rawPath: path,
      rawQueryString: options.rawQueryString || '',
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === 'string'
            ? options.body
            : JSON.stringify(options.body),
      isBase64Encoded: Boolean(options.isBase64Encoded),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      },
      requestContext: {
        http: {
          method: options.method || 'GET',
          path
        },
        ...(token ? { authorizer: authorizerFromToken(token) } : {})
      }
    };
  }

  function createAuthDependencies(identityMap, studentProfileRepositoryOverrides = {}) {
    const mockFindOwnStudentProfile = jest.fn(async ({ userId, studentId }) => {
      if (
        userId === STUDENT_A_ROW.user_id &&
        studentId === STUDENT_A_ROW.id
      ) {
        return { ...STUDENT_A_ROW };
      }
      return null;
    });

    const mockUpdateOwnPreferredName = jest.fn(
      async ({ userId, studentId, preferredName, expectedVersion }) => {
        if (
          userId !== STUDENT_A_ROW.user_id ||
          studentId !== STUDENT_A_ROW.id
        ) {
          return null;
        }

        if (
          expectedVersion !== null &&
          expectedVersion !== undefined &&
          expectedVersion !== STUDENT_A_ROW.version
        ) {
          return null;
        }

        return {
          ...STUDENT_A_ROW,
          preferred_name: preferredName,
          version: STUDENT_A_ROW.version + 1,
          updated_at: new Date('2026-03-01T12:00:00.000Z')
        };
      }
    );

    const studentProfileRepository = {
      findOwnStudentProfile: mockFindOwnStudentProfile,
      updateOwnPreferredName: mockUpdateOwnPreferredName,
      ...studentProfileRepositoryOverrides
    };

    const mockPool = {
      query: jest.fn(async (_sql, params = []) => {
        const sub = params[1];
        const entry = identityMap[sub];
        if (!entry) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              user_id: entry.userId,
              role: entry.roles[0],
              account_status: entry.status || 'ACTIVE',
              identity_link_id: `link-${sub}`,
              link_status: 'ACTIVE',
              active_link_count: 1,
              student_id: entry.studentId || null,
              student_number: entry.studentNumber || null,
              full_name: entry.displayName || null,
              institutional_email: entry.email || null,
              department: entry.department || null,
              program: 'B.Sc. Computer Science',
              major: 'Software Engineering',
              academic_year: 2566,
              enrollment_status: 'ACTIVE',
              staff_profile_id: entry.advisorStaffId || null
            }
          ]
        };
      })
    };

    const tokenValidator = new TokenValidator({
      expectedIssuer: ISSUER,
      expectedClientId: AUDIENCE,
      publicKey: keyPair.publicKey
    });

    const identityResolver = new IdentityResolver({ pool: mockPool });
    const authorizationService = new AuthorizationService({
      pool: mockPool,
      now: () => new Date('2026-10-18T08:00:00.000Z')
    });

    const dal = {
      listPublicCompanies: jest.fn(async () => ({
        items: [{ id: 'comp-1', name: 'ACME' }],
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1
      })),
      getCompanyById: jest.fn(async () => null),
      checkHealth: jest.fn(async () => true)
    };

    const handler = createLambdaHandler({
      dal,
      authOptions: {
        tokenValidator,
        identityResolver,
        authorizationService
      },
      studentProfileRepository
    });

    return {
      handler,
      studentProfileRepository,
      mockFindOwnStudentProfile,
      mockUpdateOwnPreferredName
    };
  }

  const STUDENT_A_IDENTITY = {
    userId: STUDENT_A_ROW.user_id,
    email: STUDENT_A_ROW.institutional_email,
    displayName: 'Somchai Jaidee',
    status: 'ACTIVE',
    roles: ['STUDENT'],
    studentId: STUDENT_A_ROW.id,
    studentNumber: STUDENT_A_ROW.student_number,
    advisorStaffId: null,
    department: 'Computer Science'
  };

  describe('1. GET /api/v3/students/me — Student Self-Profile Read & Field Masking', () => {
    test('returns 200 OK with only allowlisted STUDENT_SELF_PROFILE_FIELDS for the authenticated Student', async () => {
      const { handler, mockFindOwnStudentProfile } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      const response = await handler(buildEvent('/api/v3/students/me', token));
      expect(response.statusCode).toBe(200);

      const payload = JSON.parse(response.body);
      expect(payload).toEqual({
        data: {
          id: STUDENT_A_ROW.id,
          student_number: '6509610001',
          full_name: 'Somchai Jaidee',
          preferred_name: 'Chai',
          contact_address: null,
          contact_phone: null,
          institutional_email: 'somchai.jai@dome.tu.ac.th',
          department: 'Computer Science',
          program: 'B.Sc. Computer Science',
          major: 'Software Engineering',
          academic_year: 2566,
          enrollment_status: 'ACTIVE',
          created_at: '2026-01-10T08:00:00.000Z',
          updated_at: '2026-02-15T10:30:00.000Z',
          version: 3
        }
      });

      // Verify exact field set matches STUDENT_SELF_PROFILE_FIELDS
      expect(Object.keys(payload.data)).toEqual(STUDENT_SELF_PROFILE_FIELDS);

      // Verify all internal / legacy columns are masked
      for (const maskedField of STUDENT_SELF_MASKED_FIELDS) {
        expect(payload.data).not.toHaveProperty(maskedField);
      }

      expect(mockFindOwnStudentProfile).toHaveBeenCalledTimes(1);
      expect(mockFindOwnStudentProfile).toHaveBeenCalledWith({
        userId: STUDENT_A_ROW.user_id,
        studentId: STUDENT_A_ROW.id
      });
    });

    test('serves the self-profile only at the canonical /api/v3/students/me path', async () => {
      const { handler } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      for (const path of ['/api/students/me', '/students/me']) {
        const response = await handler(buildEvent(path, token));
        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body).error.code).toBe('ROUTE_NOT_FOUND');
      }
    });

    test('rejects query parameters such as ?studentId=... with 400 VALIDATION_ERROR', async () => {
      const { handler, mockFindOwnStudentProfile } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      const response = await handler(
        buildEvent('/api/v3/students/me', token, {
          rawQueryString: `studentId=${STUDENT_B_ID}`
        })
      );

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(mockFindOwnStudentProfile).not.toHaveBeenCalled();
    });
  });

  describe('2. PATCH /api/v3/students/me — Editable Field Allowlist & Normalization', () => {
    test('rejects the legacy preferred-name write path instead of bypassing audited contact commands', async () => {
      const { handler, mockUpdateOwnPreferredName } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      expect(STUDENT_SELF_EDITABLE_FIELDS).toEqual(['contact_address','contact_phone']);

      const response = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PATCH',
          body: {
            preferred_name: '  Somchai S.  ',
            version: 3
          }
        })
      );

      expect(response.statusCode).toBe(400);
      expect(mockUpdateOwnPreferredName).not.toHaveBeenCalled();
    });

    test('does not clear historical preferred_name using unversioned PATCH or PUT', async () => {
      const { handler, mockUpdateOwnPreferredName } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      const whitespaceResponse = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PATCH',
          body: { preferred_name: '   ' }
        })
      );
      expect(whitespaceResponse.statusCode).toBe(400);
      expect(mockUpdateOwnPreferredName).not.toHaveBeenCalled();

      const nullResponse = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PUT',
          body: { preferred_name: null }
        })
      );
      expect(nullResponse.statusCode).toBe(400);
    });

    test('does not treat a version on a legacy nickname payload as permission to write it', async () => {
      const { handler } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      const response = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PATCH',
          body: {
            preferred_name: 'New Nickname',
            version: 1 // current version is 3
          }
        })
      );

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Full-Request Rejection on Official, Immutable, or Unknown Fields (No Partial Update)', () => {
    test.each([
      ['full_name', { preferred_name: 'Chai', full_name: 'Hacked Name' }],
      ['department', { preferred_name: 'Chai', department: 'Electrical Engineering' }],
      ['student_number', { preferred_name: 'Chai', student_number: '9999999999' }],
      ['institutional_email', { preferred_name: 'Chai', institutional_email: 'evil@tu.ac.th' }],
      ['program', { preferred_name: 'Chai', program: 'Other Program' }],
      ['major', { preferred_name: 'Chai', major: 'Other Major' }],
      ['academic_year', { preferred_name: 'Chai', academic_year: 2570 }],
      ['enrollment_status', { preferred_name: 'Chai', enrollment_status: 'GRADUATED' }],
      ['user_id', { preferred_name: 'Chai', user_id: STUDENT_B_ID }],
      ['studentId', { preferred_name: 'Chai', studentId: STUDENT_B_ID }],
      ['id', { preferred_name: 'Chai', id: STUDENT_B_ID }],
      ['phone', { preferred_name: 'Chai', phone: '0812345678' }]
    ])(
      'rejects entire request with 400 VALIDATION_ERROR and performs 0 DB writes when "%s" is included',
      async (disallowedField, requestBody) => {
        const { handler, mockUpdateOwnPreferredName } = createAuthDependencies({
          'sub-student-a': STUDENT_A_IDENTITY
        });

        const token = signJwt(
          {
            iss: ISSUER,
            sub: 'sub-student-a',
            aud: AUDIENCE,
            exp: nowSeconds + 3600
          },
          keyPair.privateKey
        );

        const response = await handler(
          buildEvent('/api/v3/students/me', token, {
            method: 'PATCH',
            body: requestBody
          })
        );

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe('VALIDATION_ERROR');
        expect(body.error.details).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: disallowedField })
          ])
        );

        // Zero partial updates allowed
        expect(mockUpdateOwnPreferredName).not.toHaveBeenCalled();
      }
    );

    test('rejects invalid payload shapes, missing preferred_name, or over-length preferred_name with 400 VALIDATION_ERROR', async () => {
      const { handler, mockUpdateOwnPreferredName } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      // Missing preferred_name
      const emptyObjectRes = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PATCH',
          body: {}
        })
      );
      expect(emptyObjectRes.statusCode).toBe(400);

      // Non-string preferred_name
      const numberPrefRes = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PATCH',
          body: { preferred_name: 12345 }
        })
      );
      expect(numberPrefRes.statusCode).toBe(400);

      // Over 100 characters
      const longPrefRes = await handler(
        buildEvent('/api/v3/students/me', token, {
          method: 'PATCH',
          body: { preferred_name: 'A'.repeat(101) }
        })
      );
      expect(longPrefRes.statusCode).toBe(400);

      expect(mockUpdateOwnPreferredName).not.toHaveBeenCalled();
    });
  });

  describe('4. Cross-User & Role Access Control (403 FORBIDDEN / 401 UNAUTHORIZED)', () => {
    test('rejects Student A attempting to read or update Student B via /api/v3/students/:studentId', async () => {
      const { handler, mockFindOwnStudentProfile, mockUpdateOwnPreferredName } =
        createAuthDependencies({
          'sub-student-a': STUDENT_A_IDENTITY
        });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      const getOtherResponse = await handler(
        buildEvent(`/api/v3/students/${STUDENT_B_ID}`, token, {
          method: 'GET'
        })
      );
      // No endpoint lets a Student select a profile owner by studentId (#65 coordination note)
      expect(getOtherResponse.statusCode).toBe(404);
      expect(JSON.parse(getOtherResponse.body).error.code).toBe('ROUTE_NOT_FOUND');

      const patchOtherResponse = await handler(
        buildEvent(`/api/v3/students/${STUDENT_B_ID}`, token, {
          method: 'PATCH',
          body: { preferred_name: 'Hacked' }
        })
      );
      // Non-GET on an unregistered path keeps the V2 405 behavior from #55
      expect(patchOtherResponse.statusCode).toBe(405);
      expect(JSON.parse(patchOtherResponse.body).error.code).toBe('METHOD_NOT_ALLOWED');

      expect(mockFindOwnStudentProfile).not.toHaveBeenCalled();
      expect(mockUpdateOwnPreferredName).not.toHaveBeenCalled();
    });

    test('rejects non-Student roles (STAFF, ADVISOR, ADMIN) from Student self-profile endpoint with 403 FORBIDDEN', async () => {
      const { handler, mockFindOwnStudentProfile, mockUpdateOwnPreferredName } =
        createAuthDependencies({
          'sub-staff-1': {
            userId: '10000000-0000-0000-0000-000000000010',
            email: 'staff@tu.ac.th',
            displayName: 'Staff User',
            status: 'ACTIVE',
            roles: ['STAFF'],
            studentId: null,
            advisorStaffId: '30000000-0000-0000-0000-000000000010',
            department: 'Computer Science'
          },
          'sub-advisor-1': {
            userId: '10000000-0000-0000-0000-000000000020',
            email: 'advisor@tu.ac.th',
            displayName: 'Advisor User',
            status: 'ACTIVE',
            roles: ['ADVISOR'],
            studentId: null,
            advisorStaffId: '30000000-0000-0000-0000-000000000020',
            department: 'Computer Science'
          }
        });

      for (const sub of ['sub-staff-1', 'sub-advisor-1']) {
        const token = signJwt(
          {
            iss: ISSUER,
            sub,
            aud: AUDIENCE,
            exp: nowSeconds + 3600
          },
          keyPair.privateKey
        );

        const getRes = await handler(buildEvent('/api/v3/students/me', token));
        expect(getRes.statusCode).toBe(403);

        const patchRes = await handler(
          buildEvent('/api/v3/students/me', token, {
            method: 'PATCH',
            body: { preferred_name: 'Not A Student' }
          })
        );
        expect(patchRes.statusCode).toBe(403);
      }

      expect(mockFindOwnStudentProfile).not.toHaveBeenCalled();
      expect(mockUpdateOwnPreferredName).not.toHaveBeenCalled();
    });

    test('rejects unauthenticated requests to /api/v3/students/me with 401 UNAUTHORIZED', async () => {
      const { handler } = createAuthDependencies({});

      const getRes = await handler(buildEvent('/api/v3/students/me', null));
      expect(getRes.statusCode).toBe(401);

      const patchRes = await handler(
        buildEvent('/api/v3/students/me', null, {
          method: 'PATCH',
          body: { preferred_name: 'Anon' }
        })
      );
      expect(patchRes.statusCode).toBe(401);
    });

    test('rejects a signed Bearer token without API Gateway authorizer claims with 401 (#48)', async () => {
      const { handler, mockFindOwnStudentProfile } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });
      const token = signJwt(
        { iss: ISSUER, sub: 'sub-student-a', aud: AUDIENCE, exp: nowSeconds + 3600 },
        keyPair.privateKey
      );

      const response = await handler({
        rawPath: '/api/v3/students/me',
        headers: { authorization: `Bearer ${token}` },
        requestContext: { http: { method: 'GET' } }
      });

      expect(response.statusCode).toBe(401);
      expect(mockFindOwnStudentProfile).not.toHaveBeenCalled();
    });

    test('returns 503 when the profile database is unavailable', async () => {
      const { StudentProfileRepository } = require('../src/db/repositories/student-profile-repository');
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      const unavailableRepository = new StudentProfileRepository({
        pool: { query: jest.fn().mockRejectedValue(connectionError) }
      });
      const { handler } = createAuthDependencies(
        { 'sub-student-a': STUDENT_A_IDENTITY },
        {
          findOwnStudentProfile: (params) => unavailableRepository.findOwnStudentProfile(params)
        }
      );
      const token = signJwt(
        { iss: ISSUER, sub: 'sub-student-a', aud: AUDIENCE, exp: nowSeconds + 3600 },
        keyPair.privateKey
      );

      const response = await handler(buildEvent('/api/v3/students/me', token));

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).error.code).toBe('SERVICE_UNAVAILABLE');
    });

    test('returns 405 METHOD_NOT_ALLOWED for DELETE or POST on /api/v3/students/me', async () => {
      const { handler } = createAuthDependencies({
        'sub-student-a': STUDENT_A_IDENTITY
      });

      const token = signJwt(
        {
          iss: ISSUER,
          sub: 'sub-student-a',
          aud: AUDIENCE,
          exp: nowSeconds + 3600
        },
        keyPair.privateKey
      );

      const deleteRes = await handler(
        buildEvent('/api/v3/students/me', token, { method: 'DELETE' })
      );
      expect(deleteRes.statusCode).toBe(405);
      expect(deleteRes.headers.Allow).toBe('GET, PATCH, PUT');
    });

    test('keeps existing V1/V2 public routes working without regression', async () => {
      const { handler } = createAuthDependencies({});
      const response = await handler(buildEvent('/api/companies', null));
      expect(response.statusCode).toBe(200);
    });
  });
});
