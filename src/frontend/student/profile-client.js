export const STUDENT_PROFILE_ERROR_CODES = Object.freeze({
  CONFIGURATION: 'CONFIGURATION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  STALE_RECORD_CONFLICT: 'STALE_RECORD_CONFLICT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
});

export const MAX_PREFERRED_NAME_LENGTH = 100;
const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;

export const ALLOWED_STUDENT_PROFILE_FIELDS = Object.freeze([
  'id',
  'student_number',
  'full_name',
  'preferred_name',
  'institutional_email',
  'department',
  'program',
  'major',
  'academic_year',
  'enrollment_status',
  'created_at',
  'updated_at',
  'version'
]);

export class StudentProfileError extends Error {
  constructor(code, message = 'Student profile request failed.', details = []) {
    super(message);
    this.name = 'StudentProfileError';
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
  }
}

export function validatePreferredName(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return Object.freeze({ valid: true, value: null, error: null });
  }

  if (typeof rawValue !== 'string') {
    return Object.freeze({
      valid: false,
      value: null,
      error: 'ชื่อที่ต้องการให้แสดงต้องเป็นข้อความ'
    });
  }

  const trimmed = rawValue.trim();

  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    return Object.freeze({
      valid: false,
      value: null,
      error: 'ชื่อที่ต้องการให้แสดงต้องไม่มีอักขระควบคุม'
    });
  }

  if (trimmed.length > MAX_PREFERRED_NAME_LENGTH) {
    return Object.freeze({
      valid: false,
      value: null,
      error: `ชื่อที่ต้องการให้แสดงต้องไม่เกิน ${MAX_PREFERRED_NAME_LENGTH} ตัวอักษร`
    });
  }

  return Object.freeze({
    valid: true,
    value: trimmed.length === 0 ? null : trimmed,
    error: null
  });
}

export function sanitizeStudentProfile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.INVALID_RESPONSE);
  }

  if (
    typeof data.student_number !== 'string' ||
    data.student_number.trim() === '' ||
    typeof data.full_name !== 'string' ||
    data.full_name.trim() === '' ||
    !Number.isInteger(data.version) ||
    data.version < 1
  ) {
    throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.INVALID_RESPONSE);
  }

  const sanitized = {};
  for (const field of ALLOWED_STUDENT_PROFILE_FIELDS) {
    const value = data[field];
    sanitized[field] = value === undefined ? null : value;
  }

  return Object.freeze(sanitized);
}

function buildStudentMeEndpoint(apiBaseUrl, currentOrigin) {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.CONFIGURATION);
  }

  try {
    const baseUrl = new URL(apiBaseUrl, currentOrigin);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/api/v3/students/me`;
    baseUrl.search = '';
    baseUrl.hash = '';
    return baseUrl.href;
  } catch {
    throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.CONFIGURATION);
  }
}

async function parseErrorResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];

  if (response.status === 401) {
    return new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED);
  }

  if (response.status === 403) {
    return new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.ACCESS_DENIED);
  }

  if (response.status === 404) {
    return new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.NOT_FOUND);
  }

  if (response.status === 409) {
    return new StudentProfileError(
      STUDENT_PROFILE_ERROR_CODES.STALE_RECORD_CONFLICT,
      'ข้อมูลถูกอัปเดตจากหน้าต่างหรืออุปกรณ์อื่น กรุณาโหลดข้อมูลล่าสุดก่อนบันทึกใหม่',
      details
    );
  }

  if (response.status === 400 || response.status === 422) {
    return new StudentProfileError(
      STUDENT_PROFILE_ERROR_CODES.VALIDATION_ERROR,
      'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
      details
    );
  }

  return new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SERVICE_UNAVAILABLE);
}

async function parseProfileResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.INVALID_RESPONSE);
  }

  return sanitizeStudentProfile(payload?.data);
}

export function createStudentProfileClient({
  apiBaseUrl,
  getAccessToken,
  fetchImpl = window.fetch.bind(window),
  currentOrigin = window.location.origin
} = {}) {
  if (typeof getAccessToken !== 'function' || typeof fetchImpl !== 'function') {
    throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.CONFIGURATION);
  }

  const endpoint = buildStudentMeEndpoint(apiBaseUrl, currentOrigin);

  async function requestToken() {
    try {
      const token = await getAccessToken();
      if (typeof token !== 'string' || token.trim() === '') {
        throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED);
      }
      return token;
    } catch (error) {
      if (error instanceof StudentProfileError) {
        throw error;
      }
      throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SESSION_EXPIRED);
    }
  }

  return Object.freeze({
    async getOwnProfile({ signal } = {}) {
      const accessToken = await requestToken();
      let response;

      try {
        response = await fetchImpl(endpoint, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SERVICE_UNAVAILABLE);
      }

      if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
        throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.INVALID_RESPONSE);
      }

      if (!response.ok) {
        throw await parseErrorResponse(response);
      }

      return parseProfileResponse(response);
    },

    async updateOwnProfile({ preferredName, version, signal } = {}) {
      const validation = validatePreferredName(preferredName);
      if (!validation.valid) {
        throw new StudentProfileError(
          STUDENT_PROFILE_ERROR_CODES.VALIDATION_ERROR,
          validation.error,
          [{ field: 'preferred_name', issue: validation.error }]
        );
      }

      if (!Number.isInteger(version) || version < 1) {
        throw new StudentProfileError(
          STUDENT_PROFILE_ERROR_CODES.VALIDATION_ERROR,
          'ไม่พบเลขเวอร์ชันของข้อมูลล่าสุด กรุณาโหลดข้อมูลใหม่',
          [{ field: 'version', issue: 'version must be a positive integer' }]
        );
      }

      const accessToken = await requestToken();
      let response;

      try {
        response = await fetchImpl(endpoint, {
          method: 'PATCH',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            preferred_name: validation.value,
            version
          }),
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.SERVICE_UNAVAILABLE);
      }

      if (!response || typeof response.ok !== 'boolean' || !Number.isInteger(response.status)) {
        throw new StudentProfileError(STUDENT_PROFILE_ERROR_CODES.INVALID_RESPONSE);
      }

      if (!response.ok) {
        throw await parseErrorResponse(response);
      }

      return parseProfileResponse(response);
    }
  });
}
