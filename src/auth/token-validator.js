/**
 * Token Validator for CO-ED V3.
 * Conforms to Issue #48 (Cognito session trust model), #51 (Exact iss/sub match),
 * #58 (AUTH_ISSUER / AUTH_AUDIENCE), and #61 (Token validation).
 */

const crypto = require('node:crypto');
const { UnauthorizedError } = require('../api/errors');

const DEFAULT_REQUIRED_SCOPE = 'coed-api/access';
const ALLOWED_ALGORITHMS = new Set(['RS256']);

function createUnauthorized(message, reason) {
  const err = new UnauthorizedError(message, 'UNAUTHORIZED');
  Object.defineProperty(err, 'reason', {
    value: reason,
    enumerable: false,
    writable: false
  });
  return err;
}

/**
 * Base64URL decode helper.
 */
function base64UrlDecodeToBuffer(str) {
  if (typeof str !== 'string' || str.length === 0 || !/^[A-Za-z0-9_-]+$/.test(str)) {
    throw createUnauthorized('Malformed token encoding.', 'MALFORMED_TOKEN');
  }
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  return Buffer.from(padded, 'base64');
}

function base64UrlDecode(str) {
  return base64UrlDecodeToBuffer(str).toString('utf8');
}

/**
 * Parses unverified JWT parts: { header, payload, signatureBuffer, signingInput }
 */
function parseJwt(token) {
  if (typeof token !== 'string') {
    throw createUnauthorized('Authentication token must be a string.', 'MALFORMED_TOKEN');
  }

  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw createUnauthorized('Malformed authentication token.', 'MALFORMED_TOKEN');
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const signatureBuffer = base64UrlDecodeToBuffer(parts[2]);

    if (!header || typeof header !== 'object' || Array.isArray(header)) {
      throw createUnauthorized('Malformed authentication token header.', 'MALFORMED_TOKEN');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw createUnauthorized('Malformed authentication token payload.', 'MALFORMED_TOKEN');
    }

    return {
      header,
      payload,
      signature: parts[2],
      signatureBuffer,
      signingInput: `${parts[0]}.${parts[1]}`
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw createUnauthorized('Malformed authentication token payload.', 'MALFORMED_TOKEN');
  }
}

function parseNumericClaim(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isNonEmptyExactString(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function extractScopes(payload, authorizerScopes = null) {
  const scopeSet = new Set();

  if (typeof payload.scope === 'string' && payload.scope.trim().length > 0) {
    for (const s of payload.scope.trim().split(/\s+/)) {
      if (s) scopeSet.add(s);
    }
  }

  if (Array.isArray(payload.scp)) {
    for (const s of payload.scp) {
      if (typeof s === 'string' && s.trim()) {
        scopeSet.add(s.trim());
      }
    }
  }

  if (Array.isArray(authorizerScopes)) {
    for (const s of authorizerScopes) {
      if (typeof s === 'string' && s.trim()) {
        scopeSet.add(s.trim());
      }
    }
  }

  return Array.from(scopeSet);
}

class TokenValidator {
  /**
   * @param {object} [options]
   * @param {string} [options.expectedIssuer] Expected Cognito User Pool issuer URL
   * @param {string} [options.expectedClientId] Expected Cognito App Client ID (or AUTH_AUDIENCE)
   * @param {string} [options.expectedAudience] Alias for expectedClientId
   * @param {string} [options.requiredScope] Required OAuth2 scope (default: 'coed-api/access')
   * @param {number} [options.clockToleranceSeconds] Clock skew tolerance in seconds (default: 5)
   * @param {string|Buffer|object} [options.publicKey] Static public key PEM/KeyObject for RS256 verification
   * @param {Function} [options.keyResolver] Async function (header) => publicKeyPem | KeyObject
   */
  constructor(options = {}) {
    this.expectedIssuer =
      options.expectedIssuer ??
      process.env.AUTH_ISSUER ??
      process.env.COGNITO_ISSUER ??
      null;
    this.expectedClientId =
      options.expectedClientId ??
      options.expectedAudience ??
      process.env.AUTH_AUDIENCE ??
      process.env.COGNITO_CLIENT_ID ??
      null;
    this.requiredScope = options.requiredScope === undefined
      ? DEFAULT_REQUIRED_SCOPE
      : options.requiredScope;
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 5;
    this.publicKey = options.publicKey || null;
    this.keyResolver = options.keyResolver || null;
  }

  /**
   * Validates claims inside the token payload.
   *
   * @param {object} payload
   * @param {number} [nowSeconds]
   * @param {Array<string>} [authorizerScopes] Optional scopes array from API Gateway JWT authorizer
   */
  validateClaims(payload, nowSeconds = Math.floor(Date.now() / 1000), authorizerScopes = null) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw createUnauthorized('Invalid token payload.', 'INVALID_PAYLOAD');
    }

    // 1. Subject (sub) must be a non-empty exact string (no leading/trailing whitespace per #51)
    if (!isNonEmptyExactString(payload.sub)) {
      throw createUnauthorized('Token is missing a valid subject claim.', 'INVALID_SUBJECT');
    }

    // 2. Issuer (iss) must be a non-empty exact string and match expectedIssuer
    if (!isNonEmptyExactString(payload.iss)) {
      throw createUnauthorized('Token is missing a valid issuer claim.', 'INVALID_ISSUER');
    }
    if (!isNonEmptyExactString(this.expectedIssuer) || payload.iss !== this.expectedIssuer) {
      throw createUnauthorized('Token issuer mismatch.', 'INVALID_ISSUER');
    }

    // 3. Expiry (exp)
    const exp = parseNumericClaim(payload.exp);
    if (exp === null) {
      throw createUnauthorized('Token is missing expiration claim.', 'MISSING_EXP');
    }
    if (exp + this.clockToleranceSeconds < nowSeconds) {
      throw createUnauthorized('Authentication token has expired.', 'TOKEN_EXPIRED');
    }

    // 4. Not Before (nbf) if present
    if (payload.nbf !== undefined && payload.nbf !== null) {
      const nbf = parseNumericClaim(payload.nbf);
      if (nbf === null || nbf - this.clockToleranceSeconds > nowSeconds) {
        throw createUnauthorized('Token is not active yet.', 'TOKEN_NOT_ACTIVE');
      }
    }

    // 5. Token Use MUST be 'access' (ID tokens prohibited for API authorization per #48)
    if (payload.token_use !== 'access') {
      throw createUnauthorized(
        'Only Access Tokens are permitted for API authorization.',
        'INVALID_TOKEN_USE'
      );
    }

    // 6. Client ID / Audience (client_id or aud) must match expectedClientId
    if (!isNonEmptyExactString(this.expectedClientId)) {
      throw createUnauthorized('Token audience configuration is missing.', 'INVALID_AUDIENCE');
    }

    const clientIdClaim = isNonEmptyExactString(payload.client_id) ? payload.client_id : null;
    const audCandidates = Array.isArray(payload.aud)
      ? payload.aud.filter(isNonEmptyExactString)
      : (isNonEmptyExactString(payload.aud) ? [payload.aud] : []);

    const matchesClientId = clientIdClaim === this.expectedClientId;
    const matchesAud = audCandidates.includes(this.expectedClientId);

    if (clientIdClaim !== null) {
      if (!matchesClientId) {
        throw createUnauthorized('Token client ID mismatch.', 'INVALID_AUDIENCE');
      }
      if (audCandidates.length > 0 && !matchesAud) {
        throw createUnauthorized('Token audience mismatch.', 'INVALID_AUDIENCE');
      }
    } else if (!matchesAud) {
      throw createUnauthorized('Token client ID mismatch.', 'INVALID_AUDIENCE');
    }

    // 7. Required Scope (coed-api/access per #48)
    const scopes = extractScopes(payload, authorizerScopes);
    if (this.requiredScope && !scopes.includes(this.requiredScope)) {
      throw createUnauthorized(
        `Token lacks required scope: ${this.requiredScope}.`,
        'MISSING_SCOPE'
      );
    }

    return {
      subject: payload.sub,
      issuer: payload.iss,
      clientId: clientIdClaim || this.expectedClientId,
      scopes,
      expiresAt: exp
    };
  }

  /**
   * Verifies cryptographic RS256 signature of a raw JWT.
   */
  async verifySignature(jwt) {
    if (!jwt?.header || !ALLOWED_ALGORITHMS.has(jwt.header.alg)) {
      throw createUnauthorized('Unsupported or missing token algorithm.', 'INVALID_ALGORITHM');
    }

    if (!jwt.signatureBuffer || jwt.signatureBuffer.length === 0) {
      throw createUnauthorized('Token signature is missing.', 'INVALID_SIGNATURE');
    }

    const key = this.keyResolver
      ? await this.keyResolver(jwt.header)
      : this.publicKey;

    if (!key) {
      throw createUnauthorized(
        'Unable to resolve verification key for token.',
        'MISSING_VERIFICATION_KEY'
      );
    }

    let isValid = false;
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(jwt.signingInput);
      verifier.end();
      isValid = verifier.verify(key, jwt.signatureBuffer);
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw createUnauthorized('Token signature verification failed.', 'INVALID_SIGNATURE');
    }
    return true;
  }

  /**
   * Full verification of raw JWT string.
   *
   * @param {string} rawToken
   * @param {number} [nowSeconds]
   * @returns {Promise<object>} Cleaned validated claims
   */
  async validateToken(rawToken, nowSeconds) {
    const jwt = parseJwt(rawToken);
    await this.verifySignature(jwt);
    return this.validateClaims(jwt.payload, nowSeconds);
  }
}

module.exports = {
  TokenValidator,
  parseJwt,
  base64UrlDecode,
  DEFAULT_REQUIRED_SCOPE
};
