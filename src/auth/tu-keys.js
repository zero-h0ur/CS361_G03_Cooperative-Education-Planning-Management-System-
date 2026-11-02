/**
 * RSA Key Management for TU Authentication and Local JWTs.
 * Provides RS256 key pair for signing and verifying internal/TU tokens.
 */

const crypto = require('node:crypto');

let cachedKeyPair = null;

/**
 * Gets or initializes a stable RSA key pair for TU Auth token signing and verification.
 * Supports environment variables TU_AUTH_PRIVATE_KEY / TU_AUTH_PUBLIC_KEY,
 * or generates an in-memory 2048-bit RSA key pair.
 *
 * @returns {{ privateKey: string|crypto.KeyObject, publicKey: string|crypto.KeyObject }}
 */
function getTuKeyPair() {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  if (process.env.TU_AUTH_PRIVATE_KEY && process.env.TU_AUTH_PUBLIC_KEY) {
    cachedKeyPair = {
      privateKey: process.env.TU_AUTH_PRIVATE_KEY,
      publicKey: process.env.TU_AUTH_PUBLIC_KEY
    };
    return cachedKeyPair;
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  cachedKeyPair = { privateKey, publicKey };
  return cachedKeyPair;
}

/**
 * Signs a payload with RS256.
 *
 * @param {object} payload JWT payload claims
 * @param {object} [options]
 * @param {string|crypto.KeyObject} [options.privateKey]
 * @param {string} [options.kid='tu-key-1']
 * @returns {string} Compact JWT
 */
function signTuJwt(payload, { privateKey, kid = 'tu-key-1' } = {}) {
  const signingKey = privateKey || getTuKeyPair().privateKey;
  const header = { alg: 'RS256', typ: 'JWT', kid };

  const encHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encHeader}.${encPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(signingKey).toString('base64url');

  return `${signingInput}.${signature}`;
}

function resetCachedKeyPair() {
  cachedKeyPair = null;
}

module.exports = {
  getTuKeyPair,
  signTuJwt,
  resetCachedKeyPair
};
