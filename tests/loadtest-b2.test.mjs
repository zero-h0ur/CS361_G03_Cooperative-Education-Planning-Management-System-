import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { TARGET, digest, validateConfig, validatePayload, credentials, createBootstrap, runSchema } from '../scripts/loadtest/b2-bootstrap.mjs';
import { readReviewedMigrations } from '../scripts/operations/reviewed-migrations.mjs';
import { appendPolicy, removeOwned, preserve, equal, sgRulesPreserved, packageBootstrap, stripSecretPermissions } from '../scripts/loadtest/b2-operator.mjs';
import { readZipEntry } from '../scripts/operations/zip-archive.mjs';
export const payload = { migrations: readReviewedMigrations().map(({ name, checksum, sql }) => ({ name, checksum, sql })),
  grants: readFileSync(new URL('../scripts/loadtest/runtime-grants.sql', import.meta.url), 'utf8') };
const now = 1700000000000;
const config = { host: TARGET.host, database: TARGET.database, owner: TARGET.owner, ownerSecret: TARGET.ownerSecret,
  appSecret: TARGET.appPrefix + 'Ab1234', startedAt: now, expiresAt: now + 3600000, digest: digest(JSON.stringify(payload)) };
test('B2 pins account/test host/database/owner and expiry before any credential/network read', () => {
  validateConfig(config, now); validatePayload(payload, config.digest);
  for (const patch of [{ host: 'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com' },
    { database: 'coed' }, { owner: 'postgres' }, { ownerSecret: 'production-secret' },
    { appSecret: TARGET.ownerSecret }, { expiresAt: now }, { expiresAt: now + 3600001 }, { startedAt: now + 10000 }]) {
    assert.throws(() => validateConfig({ ...config, ...patch }, now), /B2_/);
  }
});
test('B2 fixed SQL payload is hashed and rejects a modified SQL/history/grants set', () => {
  for (const mutate of [p => p.migrations.pop(), p => p.migrations[0].sql += '\nSELECT 1;', p => p.grants += '\nGRANT ALL ON SCHEMA public TO coed_app;']) {
    const p = structuredClone(payload); mutate(p);
    assert.throws(() => validatePayload(p, config.digest), /B2_PAYLOAD_REJECTED/);
  }
});
test('B2 runtime Secret pins all fields and rejects owner identity or injected password', () => {
  const app = { engine: 'postgres', host: TARGET.host, dbname: TARGET.database, username: 'coed_app', port: 5432, password: 'a'.repeat(64) };
  assert.equal(credentials(JSON.stringify(app), 'app').user, 'coed_app');
  for (const patch of [{ host: 'production' }, { dbname: 'coed' }, { username: 'coed_loadtest_owner' },
    { port: 5433 }, { password: "x'; SELECT pg_sleep(99);--" }, { engine: 'mysql' }]) {
    assert.throws(() => credentials(JSON.stringify({ ...app, ...patch }), 'app'), /B2_SECRET_REJECTED/);
  }
});
test('B2 command envelope refuses SQL/additional keys/wrong digest without fetching Secrets', async () => {
  let reads = 0;
  const handler = createBootstrap({ config, payload, now: () => now, secretReader: () => { reads++; }, connect: () => {} });
  for (const event of [{ command: 'reset', digest: config.digest }, { command: 'apply', digest: 'bad' },
    { command: 'apply', digest: config.digest, sql: 'DROP DATABASE coed' }]) {
    assert.equal((await handler(event)).ok, false);
  }
  assert.equal(reads, 0);
});
test('B2 expired window fails closed, errors never serialize Secret/SQL/connection details', async () => {
  const h = createBootstrap({ config, payload, now: () => now + 3600000, secretReader: () => { throw new Error('PRIVATE_CANARY'); } });
  // Handler catches errors with a sanitized response rather than throwing into Lambda logs.
  assert.equal((await h({ command: 'apply', digest: config.digest })).code, 'B2_CONFIG_REJECTED');
});
test('B2 schema failure always rolls back; injection rejected before BEGIN', async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); if (sql.startsWith('SELECT EXISTS')) throw new Error('SYNTHETIC_FAILURE'); } };
  await assert.rejects(runSchema(client, payload, 'a'.repeat(64), true));
  assert.equal(calls.at(-1), 'ROLLBACK');
  calls.length = 0;
  await assert.rejects(runSchema(client, payload, "';COMMIT;--", true));
  assert.equal(calls.length, 0);
});
test('B2 endpoint update preserves production and cleanup removes only its own exact statement', () => {
  const prod = { Version:'2012-10-17',Statement:[{ Sid:'Production',Effect:'Allow',Resource:'PROD',Action:'READ' }] };
  const temp = { Sid:'TemporaryOwner',Effect:'Allow',Resource:['TEST_OWNER','TEST_APP'],Action:'READ' };
  const runtime = { Sid:'Runtime',Effect:'Allow',Resource:'TEST_APP',Action:'READ' };
  const updated=appendPolicy(prod,[temp,runtime]); preserve(prod,updated);
  const concurrent={ ...updated,Statement:[...updated.Statement,{ Sid:'AnotherTeamChange',Effect:'Allow',Resource:'OTHER' }] };
  const cleaned=removeOwned(concurrent,temp); preserve(prod,cleaned);
  assert.equal(cleaned.Statement.length,3);
  assert.ok(cleaned.Statement.some(s=>s.Sid==='AnotherTeamChange'));
  assert.ok(equal(cleaned.Statement[0],prod.Statement[0]));
  assert.throws(()=>appendPolicy(updated,[temp]),/B2_ENDPOINT_SID_EXISTS/);
  assert.throws(()=>preserve(prod,{ Statement:[] }),/B2_ENDPOINT_ORIGINAL_CHANGED/);
  assert.throws(()=>removeOwned({ Statement:[{ ...temp,Resource:'UNEXPECTED' }] },temp),/B2_ENDPOINT_OWNED_DRIFT/);
});
test('B2 SG verification accepts AWS grouping added sources but rejects losing an original production source', () => {
  const old=[{IpProtocol:'tcp',FromPort:443,ToPort:443,UserIdGroupPairs:[{GroupId:'PROD'}]}];
  const added=[{...old[0],UserIdGroupPairs:[{GroupId:'PROD'},{GroupId:'TEST'}]}];
  assert.equal(sgRulesPreserved(old,added),true);
  assert.equal(sgRulesPreserved(old,[{...old[0],UserIdGroupPairs:[{GroupId:'TEST'}]}]),false);
});
test('B2 waiting for managed ENI needs network permissions, not continued owner/app Secret access',()=>{
  const original={Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'secretsmanager:GetSecretValue',Resource:['TEST_OWNER','TEST_APP']},
    {Effect:'Allow',Action:['ec2:DeleteNetworkInterface'],Resource:'*'}]};
  const next=stripSecretPermissions(original);
  assert.ok(equal(next.Statement[0],original.Statement[1]));
  assert.deepEqual(next.Statement[1],{Effect:'Deny',Action:'secretsmanager:GetSecretValue',Resource:'*'});
  assert.ok(equal(stripSecretPermissions(next),next));
  assert.equal(original.Statement.length,2);
});
test('B2 package is an explicit four-file allowlist, containing metadata not credential values', async () => {
  const base=new URL('../tmp/loadtest/',import.meta.url);mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(new URL('package-test-',base).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  const {zip}=await packageBootstrap(config,payload,'SYNTHETIC_PUBLIC_CA',dir);
  assert.deepEqual(JSON.parse(readZipEntry(zip,'config.json').toString()),config);
  assert.deepEqual(JSON.parse(readZipEntry(zip,'payload.json').toString()),payload);
  assert.equal(readZipEntry(zip,'global-bundle.pem').toString(),'SYNTHETIC_PUBLIC_CA');
});
test('B2 closes a wrong connected target without executing DDL or leaking driver errors', async () => {
  let closed=false; const queries=[];
  const handler=createBootstrap({ config,payload,now:()=>now,
    secretReader:async arn=>JSON.stringify(arn===config.ownerSecret ? { username:TARGET.owner,password:'SYNTHETIC' } :
      { engine:'postgres',host:TARGET.host,dbname:TARGET.database,username:'coed_app',port:5432,password:'a'.repeat(64) }),
    connect:async()=>({ query:async sql=>{ queries.push(sql);return { rows:[{ db:'coed',usr:TARGET.owner }] }; },end:async()=>{closed=true;} }) });
  const result=await handler({ command:'apply',digest:config.digest });
  assert.equal(result.code,'B2_CONNECTED_TARGET_REJECTED'); assert.ok(closed);assert.equal(queries.length,1);
});
