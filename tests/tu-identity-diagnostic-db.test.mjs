import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFileSync} from 'node:fs';
import {inspectIdentity} from '../scripts/operations/tu-identity-diagnostic/query.mjs';
import {T,reason} from '../scripts/operations/tu-identity-diagnostic/contract.mjs';
const url=process.env.IDENTITY_DIAG_TEST_DATABASE_URL;
test('identity diagnostic actual PostgreSQL: target-only flags, every denial branch, SELECT-only and preserved rows',
 {skip:!url && !process.env.CI},async t=>{
 const u=new URL(url);assert.equal(u.hostname,'127.0.0.1');assert.ok(['55440','15440'].includes(u.port));assert.equal(u.pathname,'/coed');
 assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.PRESENT_SCHEMA_DISPOSABLE,'true');
 const owner=new pg.Client({connectionString:url});await owner.connect();let login;
 assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
 assert.equal((await owner.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='coed_tu_login'")).rows[0].n,0);
 const subject='9900000001',cognito='https://cognito-idp.ap-southeast-2.amazonaws.com/SYNTHETIC';
 const student=(number=subject,user='u1',name='Synthetic')=>owner.query(`INSERT INTO public.students VALUES
  ($1,$2,$3,$4,null,'synthetic@example.invalid','CS','regular','CS',2569,'ACTIVE',1,null,null,null)`,['s'+user,user,number,name]);
 const user=(id='u1',role='STUDENT',status='ACTIVE')=>owner.query('INSERT INTO public.users VALUES($1,$2,$3)',[id,role,status]);
 const link=(issuer=T.issuer,sub=subject,id='l1',uid='u1',status='ACTIVE')=>owner.query('INSERT INTO public.external_identity_links VALUES($1,$2,$3,$4,$5)',[id,uid,issuer,sub,status]);
 const snapshot=async()=>{const rows=[];for(const table of ['users','students','external_identity_links'])
  rows.push((await owner.query('SELECT * FROM public.'+table+' ORDER BY id')).rows);return JSON.stringify(rows);};
 const inspect=async expected=>{
  const before=await snapshot(),f=await inspectIdentity(login,subject);assert.equal(reason(f),expected);
  assert.equal(await snapshot(),before);assert.ok(!JSON.stringify(f).includes(subject));return f;
 };
 const reset=()=>owner.query('TRUNCATE public.students,public.users,public.external_identity_links');
 try{
  await owner.query('CREATE TABLE public.users(id text,role text,account_status text)');
  await owner.query('CREATE TABLE public.external_identity_links(id text,user_id text,external_issuer text,external_subject text,status text)');
  await owner.query('CREATE TABLE public.students(id text,user_id text,student_number text,full_name text,preferred_name text,institutional_email text,department text,program text,major text,academic_year int,enrollment_status text,version int,contact_email text,contact_phone text,contact_address text)');
  await owner.query(readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8'));
  await owner.query("ALTER ROLE coed_tu_login LOGIN PASSWORD 'synthetic-diag-local-only'");
  login=new pg.Client({host:'127.0.0.1',port:Number(u.port),database:'coed',user:T.user,password:'synthetic-diag-local-only'});await login.connect();
  await t.test('unprovisioned target and existing Cognito-only student remain unlinked',async()=>{
   let f=await inspect('UNLINKED_IDENTITY');assert.equal(f.matching_students,0);
   await user();await student();await link(cognito,'SYNTHETIC_COGNITO_SUB');
   f=await inspect('UNLINKED_IDENTITY');assert.equal(f.matching_students,1);assert.equal(f.active_cognito_link,true);assert.equal(f.active_tu_link,false);
  });
  await t.test('exact linked owner passes identity checks and unrelated data never appears',async()=>{
   await reset();await user();await student();await link();await user('other');await student('9900000002','other','PRIVATE_CANARY');
   const f=await inspect('IDENTITY_CHECKS_PASSED');assert.equal(f.candidate_users,1);assert.ok(!JSON.stringify(f).includes('PRIVATE_CANARY'));
  });
  await t.test('revoked, multiple active links, disabled account and wrong role are distinct',async()=>{
   await reset();await user();await student();await link(T.issuer,subject,'l1','u1','REVOKED');await inspect('REVOKED_IDENTITY');
   await owner.query("UPDATE public.external_identity_links SET status='ACTIVE'");await link(cognito,'other','l2');await inspect('DUPLICATE_ACTIVE_IDENTITIES');
   await owner.query("DELETE FROM public.external_identity_links WHERE id='l2'");await owner.query("UPDATE public.users SET account_status='DISABLED'");await inspect('ACCOUNT_DISABLED');
   await owner.query("UPDATE public.users SET account_status='ACTIVE',role='COORDINATOR'");await inspect('WRONG_ROLE');
  });
  await t.test('missing/incomplete profile, Unicode padding, owner mismatch and invalid version are distinct',async()=>{
   await reset();await user();await link();await inspect('INCOMPLETE_PROVISIONING');
   await student(subject,'u1',null);await inspect('INCOMPLETE_PROFILE');
   await owner.query("UPDATE public.students SET full_name=$1",['\u00a0Synthetic']);await inspect('INCOMPLETE_PROFILE');
   await owner.query("UPDATE public.students SET full_name='Synthetic',academic_year=null");await inspect('INCOMPLETE_PROFILE');
   await owner.query("UPDATE public.students SET academic_year=2569,student_number='9900000002'");await inspect('STUDENT_OWNER_MISMATCH');
   await owner.query('UPDATE public.students SET student_number=$1,version=0',[subject]);await inspect('PROFILE_VERSION_INVALID');
  });
  await t.test('ambiguous links are capped and never choose a student',async()=>{
   await reset();await user();await student();await link();await user('u2');await student('9900000002','u2');await link(T.issuer,subject,'l2','u2');
   const f=await inspect('DUPLICATE_IDENTITY');assert.equal(f.tu_links,2);assert.equal(f.candidate_users,2);
  });
  await t.test('real role cannot write and transaction read-only is verified',async()=>{
   await login.query('BEGIN READ ONLY');
   await assert.rejects(login.query('UPDATE public.users SET role=role WHERE false'),e=>['42501','25006'].includes(e.code));
   await login.query('ROLLBACK');
   await assert.rejects(inspectIdentity(owner,subject),e=>e.safeCode==='DIAG_CONNECTION_INVALID');
  });
 }finally{
  if(login)await login.end();await owner.query('ROLLBACK').catch(()=>{});
  await owner.query('DROP OWNED BY coed_tu_login').catch(()=>{});await owner.query('DROP ROLE IF EXISTS coed_tu_login');
  await owner.query('DROP TABLE IF EXISTS public.students,public.external_identity_links,public.users');await owner.end();
 }
});
