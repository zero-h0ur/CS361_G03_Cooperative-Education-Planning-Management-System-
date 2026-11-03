/**
 * RSA Key Management for TU Authentication and Local JWTs.
 * Provides RS256 key pair for signing and verifying internal/TU tokens.
 */

const crypto = require('node:crypto');

let cachedKeyPair = null;

const DEFAULT_SPKI_DER_B64 =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmMuqN8Ng2qojXdbTbDJOiLchaN9YlmtGt611MNBV3MxH+7XAAGXj98JGjj0vasC3WYqAql/1ocS5IZShlVrckKAIm515z+7PdFvJay1ovfKQbHU+QyzH58rrdRww7+vmOHX5s5lD7YubvsIdpLKOo+z0RGHeoKy59MS3La1yYXEYWU29qJpJztl55FT1FW0cetz1Uj0tDhqXSqVlbLObp8Kqrcr5wJC/YR/IwluyKoM6shEg9Jw9NiDlarJk/vNl/C5shoWjGKL8wuIRa36Pa04VBXMRrq1M9hlwsqLKSXggxAz5Mo7ynrc0lGeyTQeL6DmFIxUhT1pThi/AcWO5iwIDAQAB';

const DEFAULT_PKCS8_DER_B64 = [
  'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCYy6o3w2DaqiNd1tNsMk6ItyFo31iWa0a3rXUw0FXczEf7tcAAZeP3wkaOPS9qwLdZioCqX/Wh',
  'xLkhlKGVWtyQoAibnXnP7s90W8lrLWi98pBsdT5DLMfnyut1HDDv6+Y4dfmzmUPti5u+wh2kso6j7PREYd6grLn0xLctrXJhcRhZTb2omknO2XnkVPUVbRx63PVS',
  'PS0OGpdKpWVss5unwqqtyvnAkL9hH8jCW7IqgzqyESD0nD02IOVqsmT+82X8LmyGhaMYovzC4hFrfo9rThUFcxGurUz2GXCyospJeCDEDPkyjvKetzSUZ7JNB4vo',
  'OYUjFSFPWlOGL8BxY7mLAgMBAAECggEABRnOIb9u1SNB5qjnH6EMTcnDSUN6KxyuBzAODfuef4OoUYcElQl8aJx+i31lFFdrp4cVUDAU509wbhEOqzRAfGmDRWKm',
  'muJE4Fm3adG3F0Q+PbNU8/F47kwwERWdrUdpmkVB+T9qwkbbWQJqR+xtZkaLnwQfZlYYfSCGDEsn2t3aSmeUfy6SVMyvxPwps6vd0r7jMFknKkTZFG6WFTQt3yMU',
  '8VjoQudXqOnpc5z0H3kOeaic75/kSa75b/kHd+W6SWlXXlj+v+1+5SxZy51NmQyZqvrfd+BRYF/Wgj0feGqixPDL4I+119v6nZrje5RBzxnl9uHub7vVorkBGNCa',
  '3QKBgQDMatkKxSDgTZbinOlEDrkcbRCX0CDF0Tf4YZmgak87OfV6ZvQPl1/a/U8RPf1Ef1Vp/110NR6pjYIp0oyba+pRhoThfj81hVXWjtwyDUE1URjXKriyY01z',
  'OQbJj+OabXkaHckt2SkrgQSStZJ+d11umsBA/PJc3KUrl7OQUqU9tQKBgQC/Whny8NgwdS+5gQlwaqlLW1ARimrvd4uLH0zOag1tyiXfliu8GazHk0Y2Hqia5uRW',
  'q2/WJFq8wnfe/wr/s064AT25U7RZJYQ+NavbHuzh2iQS+ua0s97bCs0phAad9juxnNt2KZuiJudoNpwhRc+NLnYKbggXMcElNtIEVxmiPwKBgQCHln+sQyERZqWk',
  'XkvjVpi2ICmXaPez/phPaf2Kh7lSIZmPvOY5yUBNcyOU3jc1zfgLvNRyFiHmePRTZVLabHQZ604Me77Vc0GCdXPcxynvgYEmhzHHMVLYEIVOAOEJN3/SMNuWS6qh',
  'Loyn+0PWGrqgeIj5Ek54BeqQxajXG9p62QKBgQCeGJBl8217I+cpah5lXgq/sxMFWwqdDXUindq0lFTCCAmgoI9D2yawwdJ5tnzxdqDjpsNA90psuHOXr7rjpr78',
  'MjJQI4NXQDLxvyBda0CmHbg+YkQouo//A/6cNXPOIPoS9hkwmJH4uBHrPWtj5izkZaWrWlue5kHBQHjmkxwfuwKBgDURmn4quhWbYPfE6PHp4OleCsCsE/IEpq7Z',
  'jVkmzcjAt/Fa68+usYs7Q6ipxa3ysjbJ0fiUw6D5Y50Ys2eWkjjURPBiDRkMerDOvD1qZT3SSSmHJ52Jd2lJjOSE1AI7SeVhWOT/o41uYTrEmVmAaqkfcRonZ8An',
  '1wjfNKADS9fQ'
].join('');

/**
 * Gets or initializes a stable RSA key pair for TU Auth token signing and verification.
 * Supports environment variables TU_AUTH_PRIVATE_KEY / TU_AUTH_PUBLIC_KEY,
 * or uses a deterministic 2048-bit RSA key pair shared across Lambda instances.
 *
 * @returns {{ privateKey: string|crypto.KeyObject, publicKey: string|crypto.KeyObject }}
 */
function getTuKeyPair() {
  if (cachedKeyPair) {
    return cachedKeyPair;
  }

  const publicKey =
    process.env.TU_AUTH_PUBLIC_KEY ||
    crypto
      .createPublicKey({
        key: Buffer.from(DEFAULT_SPKI_DER_B64, 'base64'),
        format: 'der',
        type: 'spki'
      })
      .export({ type: 'spki', format: 'pem' });

  const privateKey =
    process.env.TU_AUTH_PRIVATE_KEY ||
    crypto
      .createPrivateKey({
        key: Buffer.from(DEFAULT_PKCS8_DER_B64, 'base64'),
        format: 'der',
        type: 'pkcs8'
      })
      .export({ type: 'pkcs8', format: 'pem' });

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
