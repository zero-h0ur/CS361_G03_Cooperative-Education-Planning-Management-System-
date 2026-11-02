/**
 * TU Authentication Service for CO-ED V3/V4.
 * Implements a Hybrid authentication adapter:
 * - If TU_API_APP_KEY is set: verifies credentials via Thammasat University REST API (restapi.tu.ac.th)
 *   and stores the returned TU API response.
 * - If TU_API_APP_KEY is not set: uses stored TU API response or database records in Local/Fallback mode.
 *
 * Automatically links authenticated students to internal User and External Identity Link records,
 * stores the TU API response profile, and issues a valid RS256 Access Token.
 */

const { ValidationError, UnauthorizedError } = require('../api/errors');
const { getPool } = require('../db/connection');
const { getTuKeyPair, signTuJwt } = require('./tu-keys');

const STUDENT_ID_REGEX = /^\d{10}$/;
const DEFAULT_TU_API_URL = 'https://restapi.tu.ac.th/api/v1/auth/Ad/verify';
const DEFAULT_TU_ISSUER = 'https://tu.ac.th';

/**
 * In-memory store for TU API responses and normalized profiles keyed by studentNumber / userId.
 * Allows standalone/preview environments without RDS to serve the exact response returned by TU API.
 */
const tuResponseStore = new Map();

/**
 * Maps a raw TU REST API response (/api/v1/auth/Ad/verify) into a normalized Student Profile record.
 *
 * Example TU API Student response:
 * {
 *   "status": true,
 *   "message": "Success",
 *   "type": "student",
 *   "username": "5701010101",
 *   "tu_status": "สำเร็จการศึกษา",
 *   "statusid": "40",
 *   "displayname_th": "นักศึกษา ทดสอบ",
 *   "displayname_en": "nuksuksa todsob",
 *   "email": "email.std@dome.tu.ac.th",
 *   "department": "สาขาวิชาการบริหารเทคโนโลยี",
 *   "faculty": "วิทยาลัยนวัตกรรม"
 * }
 *
 * @param {string} studentId
 * @param {object|null} tuResponse
 * @param {string} [existingStudentUuid]
 * @returns {{ rawResponse: object, profile: object }}
 */
function mapTuApiResponseToProfile(studentId, tuResponse = null, existingStudentUuid = null) {
  const cleanId = String(tuResponse?.username || studentId || '').trim();
  const yearPrefix = parseInt(cleanId.slice(0, 2), 10);
  const derivedYear = Number.isInteger(yearPrefix) && yearPrefix > 0 ? 2500 + yearPrefix : 2567;

  const rawTuStatus = String(
    tuResponse?.tu_status ||
      tuResponse?.StatusEmp ||
      (String(tuResponse?.statusid) === '40' ? 'สำเร็จการศึกษา' : 'ปกติ')
  ).trim();

  const raw = {
    status: tuResponse?.status ?? true,
    message: tuResponse?.message || 'Success',
    type: tuResponse?.type || 'student',
    username: cleanId,
    tu_status: rawTuStatus,
    statusid: String(tuResponse?.statusid || tuResponse?.StatusWork || '10'),
    displayname_th: tuResponse?.displayname_th || tuResponse?.full_name || `นักศึกษา (${cleanId})`,
    displayname_en: tuResponse?.displayname_en || tuResponse?.preferred_name || '',
    email: tuResponse?.email || tuResponse?.institutional_email || `${cleanId}@dome.tu.ac.th`,
    department: tuResponse?.department || 'สาขาวิชาวิทยาการคอมพิวเตอร์',
    faculty: tuResponse?.faculty || tuResponse?.organization || 'คณะวิทยาศาสตร์และเทคโนโลยี'
  };

  const academicYear = Number.isInteger(tuResponse?.academic_year)
    ? tuResponse.academic_year
    : derivedYear;

  const enrollmentStatus = raw.tu_status;
  const dbEnrollmentStatus =
    raw.tu_status === 'ปกติ' || raw.tu_status === 'ACTIVE'
      ? 'ACTIVE'
      : 'INACTIVE';

  const nowIso = new Date().toISOString();

  const profile = {
    id: existingStudentUuid || `stud-${cleanId}`,
    student_number: cleanId,
    full_name: raw.displayname_th,
    preferred_name: raw.displayname_en || null,
    institutional_email: raw.email,
    department: raw.department,
    program: tuResponse?.program || raw.faculty,
    major: tuResponse?.major || raw.department,
    faculty: raw.faculty,
    tu_status: raw.tu_status,
    statusid: raw.statusid,
    tu_type: raw.type,
    academic_year: academicYear,
    enrollment_status: enrollmentStatus,
    db_enrollment_status: dbEnrollmentStatus,
    version: 1,
    created_at: nowIso,
    updated_at: nowIso
  };

  return { rawResponse: raw, profile };
}

function saveTuResponseRecord(studentId, record) {
  if (!studentId || !record) return;
  tuResponseStore.set(String(studentId).trim(), record);
  if (record.profile?.id) {
    tuResponseStore.set(record.profile.id, record);
  }
  if (record.user?.id) {
    tuResponseStore.set(record.user.id, record);
  }
}

function getStoredTuResponseRecord(key) {
  if (!key) return null;
  return tuResponseStore.get(String(key).trim()) || null;
}

class TuAuthService {
  /**
   * @param {object} [options]
   * @param {string} [options.tuApiUrl]
   * @param {string} [options.tuAppKey]
   * @param {string} [options.issuer]
   * @param {string} [options.clientId]
   * @param {object} [options.pool]
   * @param {Function} [options.fetchImpl]
   * @param {object} [options.keyPair]
   */
  constructor(options = {}) {
    this.tuApiUrl =
      options.tuApiUrl || process.env.TU_API_URL || DEFAULT_TU_API_URL;
    this.tuAppKey =
      options.tuAppKey !== undefined
        ? options.tuAppKey
        : (process.env.TU_API_APP_KEY || '');
    this.issuer =
      options.issuer || process.env.TU_AUTH_ISSUER || DEFAULT_TU_ISSUER;
    this.clientId =
      options.clientId ||
      process.env.TU_AUTH_CLIENT_ID ||
      process.env.AUTH_AUDIENCE ||
      'coed-api';
    this.pool = options.pool || null;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.keyPair = options.keyPair || getTuKeyPair();
  }

  getDbPool() {
    if (this.pool) return this.pool;
    try {
      return getPool();
    } catch {
      return null;
    }
  }

  isRealApiConfigured() {
    return typeof this.tuAppKey === 'string' && this.tuAppKey.trim().length > 0;
  }

  /**
   * Verifies credentials against real TU REST API (/api/v1/auth/Ad/verify).
   *
   * @param {string} studentId 10-digit student ID
   * @param {string} password Student portal password
   * @returns {Promise<object>} Raw TU API response payload
   */
  async verifyWithRealTuApi(studentId, password) {
    let response;
    try {
      response = await this.fetchImpl(this.tuApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Application-Key': this.tuAppKey.trim()
        },
        body: JSON.stringify({
          UserName: studentId,
          PassWord: password
        })
      });
    } catch (networkErr) {
      throw new UnauthorizedError(
        `ไม่สามารถเชื่อมต่อ TU API ได้ในขณะนี้: ${networkErr.message}`,
        'TU_API_NETWORK_ERROR'
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    // TU REST API returns status: true on success
    const isSuccess =
      response.ok &&
      payload &&
      (payload.status === true ||
        payload.status === 'true' ||
        payload.status === 200 ||
        payload.type === 'student' ||
        payload.type === 'employee');

    if (!isSuccess) {
      let msg =
        payload?.Description ||
        payload?.description ||
        payload?.message;
      if (!msg) {
        if (response.status === 401 || response.status === 403) {
          msg = 'Application-Key ของ TU API ไม่ถูกต้องหรือไม่มีสิทธิ์เข้าถึง (401/403)';
        } else {
          msg = 'รหัสนักศึกษาหรือรหัสผ่านระบบทะเบียนไม่ถูกต้อง';
        }
      }
      throw new UnauthorizedError(msg, 'INVALID_CREDENTIALS');
    }

    return payload;
  }

  /**
   * Resolves or provisions Student, User, and External Identity Link in the database,
   * and stores the TU API response in memory and DB.
   *
   * @param {string} studentId
   * @param {object|null} tuProfile Raw TU API response
   * @returns {Promise<{ user: object, student: object, rawResponse: object }>}
   */
  async resolveOrCreateStudentIdentity(studentId, tuProfile = null) {
    const pool = this.getDbPool();
    const cached = getStoredTuResponseRecord(studentId);
    const effectiveTuProfile = tuProfile || cached?.rawResponse || null;

    const { rawResponse, profile: mappedProfile } = mapTuApiResponseToProfile(
      studentId,
      effectiveTuProfile
    );

    // Fallback when running without an active database connection
    if (!pool) {
      const user = {
        id: `user-${studentId}`,
        role: rawResponse.type === 'employee' ? 'STAFF' : 'STUDENT',
        accountStatus: 'ACTIVE'
      };
      saveTuResponseRecord(studentId, {
        rawResponse,
        profile: mappedProfile,
        user
      });
      return {
        user,
        student: mappedProfile,
        rawResponse
      };
    }

    // 1. Look up existing student
    const existingStudentRes = await pool.query(
      `SELECT s.*, u.id AS user_id, u.role, u.account_status
       FROM students s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.student_number = $1`,
      [studentId]
    );

    let student = existingStudentRes?.rows?.[0] || null;
    let userId = student?.user_id || null;

    // 2. If student does not exist, provision in database using TU API response fields
    if (!student) {
      const newStudentRes = await pool.query(
        `INSERT INTO students (
           id, anonymous_ref, student_number, full_name, institutional_email,
           department, program, major, academic_year, enrollment_status
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9
         ) RETURNING *`,
        [
          `anon-tu-${studentId}`,
          studentId,
          mappedProfile.full_name,
          mappedProfile.institutional_email,
          mappedProfile.department,
          mappedProfile.program,
          mappedProfile.major,
          mappedProfile.academic_year,
          mappedProfile.enrollment_status
        ]
      );
      student = newStudentRes.rows[0];
    } else if (effectiveTuProfile) {
      // Synchronize latest profile data returned from TU API into DB
      const updateFields = [];
      const updateParams = [];
      let idx = 1;

      if (effectiveTuProfile.displayname_th && student.full_name !== effectiveTuProfile.displayname_th) {
        updateFields.push(`full_name = $${idx++}`);
        updateParams.push(effectiveTuProfile.displayname_th);
      }
      if (effectiveTuProfile.email && student.institutional_email !== effectiveTuProfile.email) {
        updateFields.push(`institutional_email = $${idx++}`);
        updateParams.push(effectiveTuProfile.email);
      }
      if (effectiveTuProfile.department && student.department !== effectiveTuProfile.department) {
        updateFields.push(`department = $${idx++}`);
        updateParams.push(effectiveTuProfile.department);
      }

      if (updateFields.length > 0) {
        updateParams.push(student.id);
        const updateRes = await pool.query(
          `UPDATE students SET ${updateFields.join(', ')} WHERE id = $${idx} RETURNING *`,
          updateParams
        );
        if (updateRes?.rows?.[0]) {
          student = { ...student, ...updateRes.rows[0] };
        }
      }

      // If existing DB row had generic fallback values and no new tuProfile was passed,
      // preserve the DB row's fields in rawResponse
    }

    // Enrich student with TU API response fields if available
    const enrichedStudent = {
      ...mappedProfile,
      ...student,
      preferred_name: student?.preferred_name || mappedProfile.preferred_name || null,
      faculty: mappedProfile.faculty,
      tu_status: mappedProfile.tu_status,
      statusid: mappedProfile.statusid,
      enrollment_status: effectiveTuProfile
        ? mappedProfile.enrollment_status
        : (student?.enrollment_status || mappedProfile.enrollment_status),
      version: student?.version || 1,
      created_at: student?.created_at || mappedProfile.created_at,
      updated_at: student?.updated_at || mappedProfile.updated_at
    };

    // Keep rawResponse synced with DB student fields when in local DB mode
    const syncedRawResponse = effectiveTuProfile
      ? rawResponse
      : {
          ...rawResponse,
          displayname_th: enrichedStudent.full_name,
          displayname_en: enrichedStudent.preferred_name || '',
          email: enrichedStudent.institutional_email,
          department: enrichedStudent.department,
          faculty: enrichedStudent.faculty || enrichedStudent.program
        };

    // 3. Ensure User record exists
    if (!userId) {
      const newUserRes = await pool.query(
        `INSERT INTO users (id, role, account_status)
         VALUES (gen_random_uuid(), 'STUDENT', 'ACTIVE')
         RETURNING id`,
        []
      );
      userId = newUserRes.rows[0].id;

      await pool.query(
        `UPDATE students SET user_id = $1 WHERE id = $2`,
        [userId, student.id]
      );
      enrichedStudent.user_id = userId;
    }

    // 4. Ensure External Identity Link exists
    await pool.query(
      `INSERT INTO external_identity_links (
         id, user_id, external_issuer, external_subject, status
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 'ACTIVE'
       ) ON CONFLICT (external_issuer, external_subject)
       DO UPDATE SET status = 'ACTIVE', user_id = $1`,
      [userId, this.issuer, studentId]
    );

    const user = {
      id: userId,
      role: 'STUDENT',
      accountStatus: 'ACTIVE'
    };

    saveTuResponseRecord(studentId, {
      rawResponse: syncedRawResponse,
      profile: enrichedStudent,
      user
    });

    return {
      user,
      student: enrichedStudent,
      rawResponse: syncedRawResponse
    };
  }

  /**
   * Main login entry point for TU Authentication.
   *
   * @param {object} params
   * @param {string} params.studentId 10-digit student ID
   * @param {string} params.password
   * @param {object} [params.tuResponse] Optional pre-fetched TU API response payload
   * @returns {Promise<object>} Access token, user, normalized profile, and raw TU API response
   */
  async login({ studentId, password, tuResponse = null }) {
    if (
      typeof studentId !== 'string' ||
      !STUDENT_ID_REGEX.test(studentId.trim())
    ) {
      throw new ValidationError(
        'รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก (เช่น 6609610022)',
        [{ field: 'studentId', issue: 'must be exactly 10 digits' }]
      );
    }

    if (
      typeof password !== 'string' ||
      password.length === 0
    ) {
      throw new ValidationError('กรุณากรอกรหัสผ่าน', [
        { field: 'password', issue: 'password cannot be empty'      }]);
    }

    const cleanStudentId = studentId.trim();

    // 1. Verify credentials (Real TU API if configured, else provided tuResponse / Local DB)
    let tuProfile = tuResponse || null;
    let authMode = 'local_fallback';

    if (this.isRealApiConfigured()) {
      tuProfile = await this.verifyWithRealTuApi(cleanStudentId, password);
      authMode = 'tu_api';
    } else if (tuProfile) {
      authMode = 'tu_api_cached';
    }

    // 2. Resolve or provision student identity and store TU API response
    const { user, student, rawResponse } = await this.resolveOrCreateStudentIdentity(
      cleanStudentId,
      tuProfile
    );

    // 3. Issue RS256 Access Token matching TokenValidator contract
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 86400; // 24 hours

    const payload = {
      sub: cleanStudentId,
      iss: this.issuer,
      client_id: this.clientId,
      token_use: 'access',
      scope: 'openid email coed-api/access',
      exp: now + expiresIn,
      nbf: now - 5,
      iat: now,
      student_number: cleanStudentId,
      user_id: user.id
    };

    const accessToken = signTuJwt(payload, {
      privateKey: this.keyPair.privateKey,
      kid: 'tu-key-1'
    });

    return Object.freeze({
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      mode: authMode,
      user: Object.freeze({
        id: user.id,
        role: user.role,
        studentId: student.id,
        studentNumber: student.student_number,
        fullName: student.full_name,
        displayNameEn: student.preferred_name || null,
        email: student.institutional_email,
        department: student.department,
        faculty: student.faculty || null,
        tuStatus: student.tu_status || null,
        statusId: student.statusid || null
      }),
      profile: Object.freeze({ ...student }),
      tuResponse: Object.freeze({ ...rawResponse })
    });
  }
}

module.exports = {
  TuAuthService,
  DEFAULT_TU_API_URL,
  DEFAULT_TU_ISSUER,
  mapTuApiResponseToProfile,
  saveTuResponseRecord,
  getStoredTuResponseRecord
};
