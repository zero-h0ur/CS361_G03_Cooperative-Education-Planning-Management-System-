import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import issuerModule from '../src/tu-session-issuer.js';
import {CONTRACT} from '../src/auth/tu-session-contract.js';
const url=process.env.TU_DELIVERY_TEST_DATABASE_URL;
test('private issuer uses exact ownership and an actual SELECT-only PostgreSQL role',{skip:!url && !process.env.CI},async t=>{
  assert.ok(url);const target=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
  assert.match(target.pathname,/_test$/);assert.notEqual(url,process.env.DATABASE_URL);assert.equal(process.env.NODE_ENV,'test');
  const schema='tu_split_'+randomUUID().replaceAll('-',''),role='tu_login_'+randomUUID().replaceAll('-','');
  const owner=new pg.Pool({connectionString:url}),db=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public`});let runtime;
  const sql=readFileSync(new URL('../scripts/operations/tu-login-role.sql',import.meta.url),'utf8')
    .replaceAll('coed_tu_login',role).replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema).replaceAll("'public'","'"+schema+"'");
  try{
    await owner.query('CREATE SCHEMA '+schema);
    for(const m of readReviewedMigrations())await db.query(m.sql);
    await db.query(sql);await db.query(sql);
    runtime=new pg.Pool({connectionString:url,options:`-c search_path=${schema},public -c role=${role}`});
    const user=randomUUID(),student=randomUUID(),link=randomUUID(),subject='9900000001';
    await db.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')",[user]);
    await db.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES($1,$2,'SYNTHETIC_SPLIT',$3,'Synthetic Student','synthetic@example.invalid','CS','regular','CS',2567,'ACTIVE','synthetic','private','mock')`,[student,user,subject]);
    await db.query("INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,'urn:coed:tu-auth',$3)",[link,user,subject]);
    const keys=generateKeyPairSync('rsa',{modulusLength:2048}),arn='arn:aws:lambda:ap-southeast-2:111111111111:function:coed-tu-session-issuer:candidate';
    let signed=0;const issuer=issuerModule.createTuSessionIssuer({pool:runtime,targetArn:arn,getKeys:async()=>{signed++;return keys;},logger:()=>{}});
    const invoke=number=>issuer({contract:CONTRACT,subject:number,verifiedAt:Date.now(),requestId:randomUUID()},{invokedFunctionArn:arn,functionVersion:'1'});
    const success=await invoke(subject);assert.equal(success.ok,true);assert.equal(success.session.user.id,user);assert.equal(success.session.profile.id,student);assert.equal(signed,1);
    await t.test('runtime cannot mutate accounts, profiles, links, roles or persistent schema',async()=>{
      for(const command of ["UPDATE users SET account_status='DISABLED' WHERE false",'DELETE FROM students WHERE false',
        'INSERT INTO users(id,role) SELECT id,role FROM users WHERE false','DELETE FROM external_identity_links WHERE false',
        `CREATE TABLE ${schema}.not_allowed(id int)`,`ALTER ROLE ${role} SUPERUSER`])
        await assert.rejects(runtime.query(command),e=>e.code==='42501');
    });
    await t.test('unlinked, disabled and revoked ownership never signs',async()=>{
      assert.equal((await invoke('9900000002')).error.status,403);
      await db.query("UPDATE users SET account_status='DISABLED' WHERE id=$1",[user]);assert.equal((await invoke(subject)).error.status,403);
      await db.query("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[user]);
      await db.query("UPDATE external_identity_links SET status='REVOKED',revoked_at=now(),revoked_by=$2 WHERE id=$1",[link,user]);
      assert.equal((await invoke(subject)).error.status,403);assert.equal(signed,1);
    });
    await t.test('effective PUBLIC function or schema-write grants block the role grant script without revoking shared grants',async()=>{
      await db.query(`CREATE FUNCTION ${schema}.dangerous_synthetic() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
      const c=await db.connect();try{await assert.rejects(c.query(sql),/Excess effective/);await c.query('ROLLBACK');}finally{c.release();}
      const allowed=(await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,schema+'.dangerous_synthetic()'])).rows[0];
      assert.equal(allowed.allowed,true); // The refusing script did not silently alter PUBLIC.
      await db.query(`DROP FUNCTION ${schema}.dangerous_synthetic()`);
      await db.query('GRANT CREATE ON SCHEMA '+schema+' TO PUBLIC');
      const d=await db.connect();try{await assert.rejects(d.query(sql),/Excess effective/);await d.query('ROLLBACK');}finally{d.release();}
      await db.query('REVOKE CREATE ON SCHEMA '+schema+' FROM PUBLIC');
    });
  }finally{
    await runtime?.end();await db.end();await owner.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
    if((await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){await owner.query('DROP OWNED BY '+role);await owner.query('DROP ROLE '+role);}
    await owner.end();
  }
});
