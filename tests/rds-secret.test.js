const { createRdsPasswordProvider } = require('../src/db/rds-secret');
const { getDatabaseConfig } = require('../src/db/connection');

const ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:coed/test/rds-AbCdEf';
const expected = { host: 'test.rds.amazonaws.com', port: 5432, database: 'coed_test', user: 'coed_app' };
const secret = { engine: 'postgres', host: expected.host, port: 5432, dbname: expected.database,
  username: expected.user, password: 'synthetic-only:not-a-real-password' };
const response = (value = secret) => ({ SecretString: JSON.stringify(value) });
const env = { NODE_ENV: 'production', DB_SECRET_ARN: ARN, DB_HOST: expected.host,
  DB_PORT: '5432', DB_NAME: expected.database, DB_USER: expected.user, DB_SSL_CA_FILE: '/trusted/ca.pem' };

describe('RDS Secrets Manager password provider', () => {
  test('fetches the exact ARN and AWSCURRENT, sharing concurrent requests and cached passwords', async () => {
    const client = { send: jest.fn(async () => response()) };
    const get = createRdsPasswordProvider({ secretArn: ARN, expected, client });
    expect(await Promise.all([get(), get(), get()])).toEqual(Array(3).fill(secret.password));
    expect(await get()).toBe(secret.password);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send.mock.calls[0][0].input).toEqual({ SecretId: ARN, VersionStage: 'AWSCURRENT' });
    expect(client.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  test('refreshes after five minutes and does not serve an expired password on refresh failure', async () => {
    let time = 0;
    const client = { send: jest.fn().mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('sensitive SDK diagnostic'))
      .mockResolvedValueOnce(response({ ...secret, password: 'synthetic-rotated-password' })) };
    const get = createRdsPasswordProvider({ secretArn: ARN, expected, client, now: () => time });
    expect(await get()).toBe(secret.password);
    time = 300000;
    await expect(get()).rejects.toMatchObject({ message: 'Database credentials unavailable.', code: 'DB_CREDENTIALS_UNAVAILABLE' });
    expect(await get()).toBe('synthetic-rotated-password');
    expect(client.send).toHaveBeenCalledTimes(3);
  });

  test.each([
    ['host', 'attacker.invalid'], ['username', 'postgres'], ['dbname', 'other_db'],
    ['port', 5433], ['engine', 'mysql'], ['password', ''], ['password', null]
  ])('rejects mismatched or invalid %s without exposing the value', async (key, value) => {
    const client = { send: jest.fn(async () => response({ ...secret, [key]: value })) };
    const get = createRdsPasswordProvider({ secretArn: ARN, expected, client });
    await expect(get()).rejects.toMatchObject({ message: 'Database credentials unavailable.', code: 'DB_CREDENTIALS_UNAVAILABLE' });
  });

  test.each([{ SecretString: 'invalid JSON with private content' }, { SecretBinary: Buffer.from('private') },
    { SecretString: 'null' }, { SecretString: '[]' }, { SecretString: '{}' }])('fails closed for malformed secret response', async (value) => {
    const get = createRdsPasswordProvider({ secretArn: ARN, expected, client: { send: async () => value } });
    await expect(get()).rejects.toThrow('Database credentials unavailable.');
  });

  test('sanitizes denied access and a synchronously failing client, then permits a later retry', async () => {
    const client = { send: jest.fn().mockImplementationOnce(() => { throw new Error(secret.password); })
      .mockResolvedValueOnce(response()) };
    const get = createRdsPasswordProvider({ secretArn: ARN, expected, client });
    try { await get(); throw new Error('expected failure'); } catch (error) {
      expect(error.message).toBe('Database credentials unavailable.');
      expect(error.cause).toBeUndefined();
      expect(error.stack).not.toContain(secret.password);
    }
    expect(await get()).toBe(secret.password);
  });

  test('bounds retrieval time, aborts the SDK request and permits retry', async () => {
    const client = { send: jest.fn().mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(response()) };
    const get = createRdsPasswordProvider({ secretArn: ARN, expected, client, timeoutMs: 15 });
    await expect(get()).rejects.toMatchObject({ code: 'DB_CREDENTIALS_UNAVAILABLE' });
    expect(client.send.mock.calls[0][1].abortSignal.aborted).toBe(true);
    expect(await get()).toBe(secret.password);
  });

  test.each(['', 'coed/test', ARN + '*', ' ' + ARN])('rejects non-exact secret references', (secretArn) => {
    expect(() => createRdsPasswordProvider({ secretArn, expected })).toThrow('Database credentials unavailable.');
  });

  test('returns a sanitized 503 through the real Lambda HTTP adapter, never a credential or SDK error', async () => {
    const { createLambdaHandler } = require('../src/lambda');
    const get = createRdsPasswordProvider({ secretArn: ARN, expected,
      client: { send: async () => { throw new Error(secret.password); } } });
    const handler = createLambdaHandler({ dal: { ...require('../src/db/dal'),
      listPublicCompanies: async () => { await get(); throw new Error('must fail closed'); } } });
    const result = await handler({ rawPath: '/api/companies', requestContext: { http: { method: 'GET' } } });
    expect(result.statusCode).toBe(503);
    expect(JSON.parse(result.body)).toEqual({ error: {
      code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable.'
    } });
    expect(result.body).not.toContain(secret.password);
    expect(result.body).not.toContain(ARN);
  });
});

describe('secret-mode pool configuration', () => {
  const readCa = jest.fn(() => 'synthetic public CA');
  const getPassword = async () => secret.password;
  const createPassword = jest.fn(() => getPassword);
  beforeEach(() => { readCa.mockClear(); createPassword.mockClear(); });

  test('pins the public endpoint/user and enforces TLS without forwarding DATABASE_URL', () => {
    const result = getDatabaseConfig({ ...env, DATABASE_URL: 'postgres://old-private-value' }, { readCa, createPassword });
    expect(result).toEqual({ ...expected, password: getPassword,
      ssl: { rejectUnauthorized: true, ca: 'synthetic public CA' } });
    expect(result).not.toHaveProperty('connectionString');
    expect(readCa).toHaveBeenCalledWith('/trusted/ca.pem', 'utf8');
  });

  test('test mode uses only a distinct TEST_DATABASE_URL, never the production secret', () => {
    const result = getDatabaseConfig({ ...env, NODE_ENV: 'test', DATABASE_URL: 'postgres://prod',
      TEST_DATABASE_URL: 'postgres://test' }, { readCa, createPassword });
    expect(result).toEqual({ connectionString: 'postgres://test' });
    expect(createPassword).not.toHaveBeenCalled();
    expect(readCa).not.toHaveBeenCalled();
    expect(() => getDatabaseConfig({ ...env, NODE_ENV: 'test', DATABASE_URL: 'same', TEST_DATABASE_URL: 'same' }))
      .toThrow('TEST_DATABASE_URL must be different');
    expect(() => getDatabaseConfig({ ...env, NODE_ENV: 'test' })).toThrow('TEST_DATABASE_URL is required');
  });

  test('preserves local URL mode but does not fall back for a blank secret ARN', () => {
    expect(getDatabaseConfig({ DATABASE_URL: 'postgres://local' })).toEqual({ connectionString: 'postgres://local' });
    expect(() => getDatabaseConfig({ ...env, DB_SECRET_ARN: '', DATABASE_URL: 'postgres://fallback' }, { readCa }))
      .toThrow('Database credentials unavailable.');
  });

  test.each([{ DB_USER: 'postgres' }, { DB_USER: 'rdsadmin' }, { DB_PORT: 'NaN' },
    { DB_HOST: '' }, { DB_NAME: '' }, { DB_SSL_CA_FILE: '' }])('rejects unsafe or incomplete configuration', (override) => {
    expect(() => getDatabaseConfig({ ...env, ...override }, { readCa, createPassword }))
      .toThrow('Invalid database secret configuration.');
    expect(createPassword).not.toHaveBeenCalled();
  });

  test('a missing CA fails closed, never disabling verification', () => {
    expect(() => getDatabaseConfig(env, { readCa: () => { throw new Error('missing public CA'); }, createPassword }))
      .toThrow('missing public CA');
  });
});
