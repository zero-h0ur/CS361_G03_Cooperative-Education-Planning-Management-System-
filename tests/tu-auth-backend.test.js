/**
 * Tests for TU Authentication Backend (Hybrid Mode).
 * Verifies:
 * - Real TU API verification (success & failure handling)
 * - Local fallback database resolution & provisioning
 * - Token generation, RS256 signature, and TokenValidator compatibility
 * - HTTP route handling at POST /api/v3/auth/tu-login and GET /api/v3/auth/tu-status
 */

const { TuAuthService } = require('../src/auth/tu-auth-service');
const { TokenValidator } = require('../src/auth/token-validator');
const { getTuKeyPair } = require('../src/auth/tu-keys');
const { createApiServer } = require('../src/api/app');
const { ValidationError, UnauthorizedError } = require('../src/api/errors');

function createMockDbPool(initialStudents = []) {
  const users = new Map();
  const students = new Map();
  const identityLinks = new Map();

  for (const s of initialStudents) {
    const studentId = s.id || `stud-${s.student_number}`;
    const userId = s.user_id || `user-${s.student_number}`;
    users.set(userId, { id: userId, role: 'STUDENT', account_status: 'ACTIVE' });
    students.set(studentId, {
      ...s,
      id: studentId,
      user_id: userId,
      student_number: s.student_number,
      full_name: s.full_name || 'ทดสอบ มธ',
      institutional_email: s.institutional_email || `${s.student_number}@dome.tu.ac.th`,
      department: s.department || 'CPE',
      program: s.program || 'B.Eng.',
      major: s.major || 'Computer Engineering',
      academic_year: s.academic_year || 2569,
      enrollment_status: 'ACTIVE'
    });
    identityLinks.set(`${userId}:https://tu.ac.th`, {
      id: `link-${userId}`,
      user_id: userId,
      external_issuer: 'https://tu.ac.th',
      external_subject: s.student_number,
      status: 'ACTIVE'
    });
  }

  return {
    users,
    students,
    identityLinks,
    async query(sql, params = []) {
      const trimmed = sql.trim();

      // SELECT student by student_number
      if (trimmed.includes('FROM students s') && trimmed.includes('WHERE s.student_number = $1')) {
        const studentNumber = params[0];
        const student = Array.from(students.values()).find(
          (s) => s.student_number === studentNumber
        );
        if (!student) return { rows: [] };
        return {
          rows: [
            {
              ...student,
              role: 'STUDENT',
              account_status: 'ACTIVE'
            }
          ]
        };
      }

      // INSERT INTO students
      if (trimmed.startsWith('INSERT INTO students')) {
        const student = {
          id: `stud-${params[1]}`,
          anonymous_ref: params[0],
          student_number: params[1],
          full_name: params[2],
          institutional_email: params[3],
          department: params[4],
          program: params[5],
          major: params[6],
          academic_year: params[7],
          enrollment_status: params[8] || 'ACTIVE',
          user_id: null
        };
        students.set(student.id, student);
        return { rows: [student] };
      }

      // INSERT INTO users
      if (trimmed.startsWith('INSERT INTO users')) {
        const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const user = { id: userId, role: 'STUDENT', account_status: 'ACTIVE' };
        users.set(userId, user);
        return { rows: [user] };
      }

      // UPDATE students SET
      if (trimmed.startsWith('UPDATE students SET')) {
        const studentId = params[params.length - 1];
        const student = students.get(studentId) || Array.from(students.values()).find((s) => s.id === studentId);
        if (trimmed.includes('user_id =') && params[0]) {
          if (student) student.user_id = params[0];
        }
        return { rows: student ? [student] : [] };
      }

      // INSERT INTO external_identity_links
      if (trimmed.includes('INSERT INTO external_identity_links')) {
        const userId = params[0];
        const issuer = params[1];
        const subject = params[2];
        const link = {
          id: `link-${userId}`,
          user_id: userId,
          external_issuer: issuer,
          external_subject: subject,
          status: 'ACTIVE'
        };
        identityLinks.set(`${userId}:${issuer}`, link);
        return { rows: [link] };
      }

      return { rows: [] };
    }
  };
}

describe('TU Authentication Service (Hybrid Mode)', () => {
  it('rejects invalid or non-10-digit student ID with ValidationError', async () => {
    const service = new TuAuthService();

    await expect(service.login({ studentId: '123', password: 'pass' })).rejects.toThrow(
      ValidationError
    );
    await expect(service.login({ studentId: 'abcdefghij', password: 'pass' })).rejects.toThrow(
      ValidationError
    );
    await expect(service.login({ studentId: null, password: 'pass' })).rejects.toThrow(
      ValidationError
    );
  });

  it('rejects empty password with ValidationError', async () => {
    const service = new TuAuthService();

    await expect(
      service.login({ studentId: '6609610022', password: '' })
    ).rejects.toThrow(ValidationError);
    await expect(
      service.login({ studentId: '6609610022', password: null })
    ).rejects.toThrow(ValidationError);
  });

  describe('Real TU API Verification (when TU_API_APP_KEY is set)', () => {
    it('verifies student credentials via TU REST API on success and issues valid token', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          type: 'student',
          displayname_th: 'นายทดสอบ วิทยาการ',
          displayname_en: 'Test Science',
          email: '6609610022@dome.tu.ac.th',
          department: 'Computer Science',
          faculty: 'Science and Technology'
        })
      });

      const pool = createMockDbPool();
      const service = new TuAuthService({
        tuAppKey: 'mock-tu-app-key-secret',
        fetchImpl: mockFetch,
        pool
      });

      expect(service.isRealApiConfigured()).toBe(true);

      const result = await service.login({
        studentId: '6609610022',
        password: 'studentpassword'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://restapi.tu.ac.th/api/v1/auth/Ad/verify',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Application-Key': 'mock-tu-app-key-secret'
          }),
          body: JSON.stringify({
            UserName: '6609610022',
            PassWord: 'studentpassword'
          })
        })
      );

      expect(result).toHaveProperty('accessToken');
      expect(result.tokenType).toBe('Bearer');
      expect(result.mode).toBe('tu_api');
      expect(result.user.studentNumber).toBe('6609610022');
      expect(result.user.fullName).toBe('นายทดสอบ วิทยาการ');
      expect(result.user.displayNameEn).toBe('Test Science');
      expect(result.user.email).toBe('6609610022@dome.tu.ac.th');
      expect(result.user.department).toBe('Computer Science');
      expect(result.user.faculty).toBe('Science and Technology');
      expect(result.user.role).toBe('STUDENT');
      expect(result.profile).toEqual(
        expect.objectContaining({
          student_number: '6609610022',
          full_name: 'นายทดสอบ วิทยาการ',
          preferred_name: 'Test Science',
          institutional_email: '6609610022@dome.tu.ac.th',
          department: 'Computer Science',
          faculty: 'Science and Technology',
          academic_year: 2566
        })
      );
      expect(result.tuResponse).toEqual(
        expect.objectContaining({
          status: true,
          type: 'student',
          username: '6609610022',
          displayname_th: 'นายทดสอบ วิทยาการ',
          displayname_en: 'Test Science',
          email: '6609610022@dome.tu.ac.th',
          department: 'Computer Science',
          faculty: 'Science and Technology'
        })
      );

      // Verify token with TokenValidator
      const tokenValidator = new TokenValidator();
      const claims = await tokenValidator.validateToken(result.accessToken);
      expect(claims.subject).toBe('6609610022');
      expect(claims.issuer).toBe('https://tu.ac.th');
      expect(claims.scopes).toContain('coed-api/access');
    });

    it('resolves TU_API_APP_KEY from AWS Secrets Manager when TU_API_SECRET_ARN is configured on Lambda', async () => {
      const mockSecretsClient = {
        send: jest.fn().mockResolvedValue({
          SecretString: JSON.stringify({ TU_API_APP_KEY: 'secret-manager-tu-key' })
        })
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          type: 'student',
          username: '6709650334',
          tu_status: 'ปกติ',
          statusid: '10',
          displayname_th: 'นักศึกษา ซีเคร็ท',
          displayname_en: 'Secret Student',
          email: 'secret@dome.tu.ac.th',
          department: 'สาขาวิชาวิทยาการคอมพิวเตอร์',
          faculty: 'คณะวิทยาศาสตร์และเทคโนโลยี'
        })
      });

      const service = new TuAuthService({
        tuAppKey: '',
        tuSecretArn: 'arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:coed/tu-api-AbCdEf',
        secretsClient: mockSecretsClient,
        fetchImpl: mockFetch,
        pool: createMockDbPool()
      });

      expect(service.isRealApiConfigured()).toBe(true);
      const result = await service.login({
        studentId: '6709650334',
        password: 'pass'
      });

      expect(mockSecretsClient.send).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://restapi.tu.ac.th/api/v1/auth/Ad/verify',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Application-Key': 'secret-manager-tu-key'
          })
        })
      );
      expect(result.profile.full_name).toBe('นักศึกษา ซีเคร็ท');
    });

    it('rejects login with 401 when TU REST API returns status: false', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: false,
          message: 'Incorrect student ID or password'
        })
      });

      const service = new TuAuthService({
        tuAppKey: 'mock-key',
        fetchImpl: mockFetch,
        pool: createMockDbPool()
      });

      await expect(
        service.login({ studentId: '6609610022', password: 'wrongpassword' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('handles network failure to TU API gracefully with 401 UnauthorizedError', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

      const service = new TuAuthService({
        tuAppKey: 'mock-key',
        fetchImpl: mockFetch,
        pool: createMockDbPool()
      });

      await expect(
        service.login({ studentId: '6609610022', password: 'password123' })
      ).rejects.toThrow('ไม่สามารถเชื่อมต่อ TU API ได้ในขณะนี้');
    });
  });

  describe('Local Fallback Verification (when TU_API_APP_KEY is not set)', () => {
    it('authenticates and provisions student in local database fallback mode', async () => {
      const pool = createMockDbPool();
      const service = new TuAuthService({
        tuAppKey: '', // Empty key triggers local fallback mode
        pool
      });

      expect(service.isRealApiConfigured()).toBe(false);

      const result = await service.login({
        studentId: '6609610099',
        password: 'any-password-for-dev'
      });

      expect(result.mode).toBe('local_fallback');
      expect(result.user.studentNumber).toBe('6609610099');
      expect(result.accessToken).toBeDefined();

      // Verify token signature with TokenValidator
      const tokenValidator = new TokenValidator();
      const claims = await tokenValidator.validateToken(result.accessToken);
      expect(claims.subject).toBe('6609610099');
      expect(claims.issuer).toBe('https://tu.ac.th');
    });

    it('resolves existing student record from database', async () => {
      const pool = createMockDbPool([
        {
          student_number: '6601000101',
          full_name: 'สมชาย ใจดี',
          institutional_email: 'somchai@dome.tu.ac.th'
        }
      ]);

      const service = new TuAuthService({ tuAppKey: '', pool });
      const result = await service.login({
        studentId: '6601000101',
        password: 'local-test-pass'
      });

      expect(result.user.fullName).toBe('สมชาย ใจดี');
      expect(result.user.studentNumber).toBe('6601000101');
    });
  });

  describe('HTTP Endpoints (POST /api/v3/auth/tu-login & GET /api/v3/auth/tu-status)', () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
      const pool = createMockDbPool([
        {
          student_number: '6609610022',
          full_name: 'ณัฐวดี ศิริกุล'
        }
      ]);
      const tuAuthService = new TuAuthService({ tuAppKey: '', pool });

      server = createApiServer({
        tuAuthService
      });

      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('GET /api/v3/auth/tu-status returns status information', async () => {
      const res = await fetch(`${baseUrl}/api/v3/auth/tu-status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.configured).toBe(true);
      expect(body.data.mode).toBe('local_fallback');
    });

    it('POST /api/v3/auth/tu-login returns 200 with access token on valid login', async () => {
      const res = await fetch(`${baseUrl}/api/v3/auth/tu-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: '6609610022',
          password: 'pass'
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.tokenType).toBe('Bearer');
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.user.studentNumber).toBe('6609610022');
      expect(body.data.user.fullName).toBe('ณัฐวดี ศิริกุล');
    });

    it('POST /api/v3/auth/tu-login returns 400 on invalid student ID', async () => {
      const res = await fetch(`${baseUrl}/api/v3/auth/tu-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: 'invalid-id',
          password: 'pass'
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('dynamically stores and returns arbitrary TU API response fields without using hardcoded mocks', async () => {
      const uniqueSuffix = Date.now();
      const dynamicTuApiResponse = {
        status: true,
        message: 'Success',
        type: 'student',
        username: '6709650334',
        tu_status: 'ปกติ',
        statusid: '10',
        displayname_th: `ชื่อจริงจาก_TU_API_${uniqueSuffix}`,
        displayname_en: `Real_Name_${uniqueSuffix}`,
        email: `real_${uniqueSuffix}@dome.tu.ac.th`,
        department: `สาขาวิชาจริง_${uniqueSuffix}`,
        faculty: `คณะจริง_${uniqueSuffix}`
      };

      const res = await fetch(`${baseUrl}/api/v3/auth/tu-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: '6709650334',
          password: 'any-password',
          tuResponse: dynamicTuApiResponse
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify every single field in profile & tuResponse comes from the dynamic TU API response
      expect(body.data.tuResponse).toEqual(dynamicTuApiResponse);
      expect(body.data.profile.student_number).toBe('6709650334');
      expect(body.data.profile.full_name).toBe(`ชื่อจริงจาก_TU_API_${uniqueSuffix}`);
      expect(body.data.profile.preferred_name).toBe(`Real_Name_${uniqueSuffix}`);
      expect(body.data.profile.institutional_email).toBe(`real_${uniqueSuffix}@dome.tu.ac.th`);
      expect(body.data.profile.department).toBe(`สาขาวิชาจริง_${uniqueSuffix}`);
      expect(body.data.profile.faculty).toBe(`คณะจริง_${uniqueSuffix}`);
      expect(body.data.profile.tu_status).toBe('ปกติ');
      expect(body.data.profile.statusid).toBe('10');
      expect(body.data.profile.academic_year).toBe(2567);
    });
  });
});
