import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {provisionLogin} from '../scripts/operations/tu-owner/handler.mjs';
const url=process.env.OWNER_TOOL_TEST_DATABASE_URL;
test('temporary owner login provision: real SCRAM, minimal grants, retry and failure safety',
 {skip:!url && !process.env.CI},async t=>{
  const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55440');assert.equal(u.pathname,'/coed');
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PRESENT_SCHEMA_DISPOSABLE,'true');
  const owner=new pg.Client({connectionString:url});await owner.connect();
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='coed_tu_login'")).rows[0].n,0);
  let secret,puts=0;const run='b'.repeat(32),env={OWNER_RUN_ID:run,
    OWNER_LOGIN_SECRET_ARN:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/tu-login-Abc123',
    OWNER_ROLE_SQL_SHA256:createHash('sha256').update(readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url))).digest('hex')};
  const sm={send:async command=>{
    if(command.constructor.name==='GetSecretValueCommand'){if(!secret){const e=Error();e.name='ResourceNotFoundException';throw e;}return {SecretString:JSON.stringify(secret)};}
    assert.equal(command.constructor.name,'PutSecretValueCommand');assert.equal(command.input.ClientRequestToken,run);
    puts++;secret=JSON.parse(command.input.SecretString);return {};
  }};
  const loginFactory=(password,user)=>new pg.Client({host:'127.0.0.1',port:55440,database:'coed',user,password});
  try{
   await owner.query('CREATE TABLE public.users(id text,role text,account_status text)');
   await owner.query('CREATE TABLE public.external_identity_links(id text,user_id text,external_issuer text,external_subject text,status text)');
   await owner.query('CREATE TABLE public.students(id text,user_id text,student_number text,full_name text,preferred_name text,institutional_email text,department text,program text,major text,academic_year int,enrollment_status text,version int,contact_email text,contact_phone text,contact_address text)');
   await t.test('no Secret write success means no role or login enabled',async()=>{
    await assert.rejects(provisionLogin(owner,{send:async c=>{if(c.constructor.name==='GetSecretValueCommand')return sm.send(c);throw Error('synthetic secret failure');}},env,loginFactory));
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='coed_tu_login'")).rows[0].n,0);
   });
   await t.test('provisions a working SELECT-only credential without plaintext in SQL/verifier',async()=>{
    const result=await provisionLogin(owner,sm,env,loginFactory);assert.equal(result.loginConnectionVerified,true);assert.equal(puts,1);
    const verifier=(await owner.query("SELECT rolpassword FROM pg_authid WHERE rolname='coed_tu_login'")).rows[0].rolpassword;
    assert.ok(verifier.startsWith('SCRAM-SHA-256$'));assert.ok(!verifier.includes(secret.password));
    const login=loginFactory(secret.password,'coed_tu_login');await login.connect();
    try{
     assert.deepEqual((await login.query('SELECT id,role FROM public.users')).rows,[]);
     await assert.rejects(login.query('UPDATE public.users SET role=role WHERE false'),e=>e.code==='42501');
     await assert.rejects(login.query('CREATE TABLE public.not_allowed(id int)'),e=>e.code==='42501');
    }finally{await login.end();}
   });
   await t.test('replay reuses the same Secret and does not rotate an enabled credential',async()=>{
    const before=(await owner.query("SELECT rolpassword FROM pg_authid WHERE rolname='coed_tu_login'")).rows[0].rolpassword;
    await provisionLogin(owner,sm,env,loginFactory);assert.equal(puts,1);
    assert.equal((await owner.query("SELECT rolpassword FROM pg_authid WHERE rolname='coed_tu_login'")).rows[0].rolpassword,before);
   });
   await t.test('missing/foreign operation Secret cannot reset an existing enabled role',async()=>{
    const empty={send:async()=>{const e=Error();e.name='ResourceNotFoundException';throw e;}};
    await assert.rejects(provisionLogin(owner,empty,env,loginFactory),e=>e.safeCode==='LOGIN_ROLE_UNEXPLAINED');
   });
  }finally{
   await owner.query('ROLLBACK').catch(()=>{});
   await owner.query('DROP OWNED BY coed_tu_login').catch(()=>{});
   await owner.query('DROP ROLE IF EXISTS coed_tu_login');
   await owner.query('DROP TABLE public.students,public.external_identity_links,public.users');
   await owner.end();
  }
 });
