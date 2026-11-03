import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {bootstrapCoordinatorFixture,seedLegacyCoordinatorReviews} from './helpers/coordinator-schema-fixture.mjs';
import {readReviewedMigrations} from '../scripts/operations/reviewed-migrations.mjs';
import {EXTERNAL_HISTORY,ALIGNMENT_NAME,assertHistory,catalog,assertExternalCatalog,recordedCatalog} from '../scripts/operations/coordinator-schema-lineages.mjs';
import {upgradeCoordinatorSchema} from '../scripts/operations/coordinator-schema-upgrade.mjs';
import contract from '../src/db/coordinator-schema-contract.js';
import coordinator from '../src/api/services/coordinator-workspace-service.js';
import committee from '../src/api/services/committee-workspace.js';
const url=process.env.COORDINATOR_TEST_DATABASE_URL;
const migrations=readReviewedMigrations(),alignment=migrations.find(m=>m.name===ALIGNMENT_NAME);

test('explicit histories are exact; verified 013 fixture is not a fabricated 014/015 source',()=>{
  const rows=EXTERNAL_HISTORY.map(([version,checksum])=>({version,checksum}));
  assertHistory(rows,'external015');
  for(const changed of [[],rows.slice(0,-1),[...rows,{version:'999.sql',checksum:'0'.repeat(64)}],rows.map((r,i)=>i===14?{...r,checksum:'0'.repeat(64)}:r)])
    assert.throws(()=>assertHistory(changed,'external015'),/HISTORY_MISMATCH/);
  assert.throws(()=>assertHistory(rows,'workspace013'),/HISTORY_MISMATCH/);
  assert.equal(createHash('sha256').update(readFileSync(new URL('./fixtures/coordinator-external013-verified.sql',import.meta.url))).digest('hex'),EXTERNAL_HISTORY[12][1]);
});
test('readiness fails closed with safe 503, no DDL or raw database diagnostics',async()=>{
  for(const db of [{query:async()=>({rows:[{coordinator_schema_ready:false}]})},{query:async()=>{throw Object.assign(new Error('PRIVATE_CANARY'),{code:'42P01'});}}])
    await assert.rejects(contract.assertCoordinatorSchema(db),e=>e.statusCode===503 && e.code==='COORDINATOR_SCHEMA_UPGRADE_REQUIRED' && !e.message.includes('CANARY'));
});

for(const profile of ['workspace013','external015'])test(profile+' upgrade: preservation, trial, history, replay, concurrency and drift',{skip:!url},async t=>{
  const target=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.match(target.pathname,/_test$/);assert.notEqual(url,process.env.DATABASE_URL);
  const schema='align_'+randomUUID().replaceAll('-',''),admin=new pg.Pool({connectionString:url});
  let pool;
  try {
    await admin.query('CREATE SCHEMA '+schema);
    pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema+',public'});
    await bootstrapCoordinatorFixture(pool,profile);
    if(profile==='external015'){
      const actual=await catalog(pool);
      // Metadata-only diagnostics identify which reconstructed contract differs.
      for(const key of ['tables','columns','constraints','indexes','triggers','functions']){
        assert.equal(actual[key].length,recordedCatalog[key].length,key+' count');
        for(let i=0;i<actual[key].length;i++)assert.deepEqual(actual[key][i],recordedCatalog[key][i],key+' '+i);
      }
      assertExternalCatalog(actual);
    }
    const user=randomUUID();await pool.query("INSERT INTO users(id,role) VALUES($1,'COORDINATOR')",[user]);
    const fixture=await seedLegacyCoordinatorReviews(pool,profile,user);
    const legacy=(await pool.query('SELECT to_jsonb(r) AS data FROM phase1_reviews r ORDER BY application_id')).rows;
    const snapshots=(await pool.query('SELECT to_jsonb(s) AS data FROM phase1_submissions s ORDER BY id')).rows;
    const oldWindow=(await pool.query('SELECT opens_at,closes_at,version FROM phase1_cycle_windows WHERE cycle_id=$1',[fixture.cycle])).rows[0];
    const history=(await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
    await t.test('unupgraded Backend is unavailable, not an empty or fake workspace',async()=>{
      await assert.rejects(contract.assertCoordinatorSchema(pool),e=>e.statusCode===503);
    });
    const client=await pool.connect();
    try {
      await t.test('failed effective ACL check rolls SQL, import, grants and new history back',async()=>{
        const role='align_acl_'+randomUUID().replaceAll('-','');await admin.query('CREATE ROLE '+role+' NOLOGIN');
        try{
          await pool.query('GRANT USAGE ON SCHEMA '+schema+' TO '+role+'; GRANT UPDATE(role) ON users TO '+role);
          await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'apply',runtimeRole:role}),/EXCESS_EFFECTIVE_PRIVILEGES/);
          assert.equal((await pool.query("SELECT to_regclass(format('%I.coordinator_reviews',current_schema())) AS name")).rows[0].name,null);
          assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,history);
          assert.equal((await pool.query("SELECT has_column_privilege($1,'users','role','UPDATE') AS allowed",[role])).rows[0].allowed,true);
        }finally{await pool.query('REVOKE ALL ON users FROM '+role+'; REVOKE UPDATE(role) ON users FROM '+role+'; REVOKE ALL ON SCHEMA '+schema+' FROM '+role);await admin.query('DROP ROLE '+role);}
      });
      await t.test('inspection is read-only, trial rolls all DDL/history back',async()=>{
        const inspected=await upgradeCoordinatorSchema(client,{profile});assert.equal(inspected.changed,false);
        const trial=await upgradeCoordinatorSchema(client,{profile,mode:'trial'});assert.equal(trial.rolledBack,true);
        assert.equal((await pool.query("SELECT to_regclass(format('%I.coordinator_reviews',current_schema())) AS name")).rows[0].name,null);
        assert.deepEqual((await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows,history);
      });
      await t.test('changed checksum, unknown history and partial schema never apply',async()=>{
        await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',['0'.repeat(64),history.at(-1).version]);
        await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'apply'}),/HISTORY_MISMATCH/);
        await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2',[history.at(-1).checksum,history.at(-1).version]);
        await pool.query('CREATE TABLE coordinator_reviews(bad text)');
        await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'trial'}),/PARTIAL|CATALOG_MISMATCH/);
        await pool.query('DROP TABLE coordinator_reviews');
        const trigger=profile==='workspace013'?'phase1_review_guard':'phase1_review_scope';
        await pool.query('ALTER TABLE phase1_reviews DISABLE TRIGGER '+trigger);
        await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'trial'}),/CATALOG_MISMATCH/);
        await pool.query('ALTER TABLE phase1_reviews ENABLE TRIGGER '+trigger);
        await pool.query('ALTER TABLE phase1_reviews ENABLE ROW LEVEL SECURITY');
        await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'trial'}),/OWNER_OR_RLS_DRIFT/);
        await pool.query('ALTER TABLE phase1_reviews DISABLE ROW LEVEL SECURITY');
      });
      await t.test('ambiguous review ownership aborts and rolls back every new object',async()=>{
        // Corrupt only a synthetic fixture inside this transaction, then restore.
        const app=fixture.records[0].app;
        // A review referencing a student's foreign scope is rejected by the old
        // scope guard too; use an unsupported status/snapshot combination instead.
        const client2=await pool.connect();try{
          await client2.query('BEGIN');
          await client2.query('ALTER TABLE phase1_applications DISABLE TRIGGER phase1_application_guard');
          await client2.query("UPDATE phase1_applications SET status='DRAFT',submitted_at=NULL WHERE id=$1",[app]);
          await client2.query('SAVEPOINT bad_import');
          await assert.rejects(client2.query(alignment.sql),/AMBIGUOUS_REVIEW/);
          await client2.query('ROLLBACK');
        }finally{client2.release();}
        assert.equal((await pool.query("SELECT to_regclass(format('%I.coordinator_reviews',current_schema())) AS name")).rows[0].name,null);
      });
      await t.test('two runners serialize, exactly one 016 record, subsequent replay verifies',async()=>{
        const other=await pool.connect();try{
          const results=await Promise.all([upgradeCoordinatorSchema(client,{profile,mode:'apply'}),upgradeCoordinatorSchema(other,{profile,mode:'apply'})]);
          assert.equal(results.filter(r=>r.changed).length,1);assert.equal(results.filter(r=>r.replay).length,1);
        }finally{other.release();}
        await contract.assertCoordinatorSchema(pool);
        const after=(await pool.query('SELECT version,checksum FROM schema_migrations ORDER BY version')).rows;
        assert.deepEqual(after.slice(0,-1),history);assert.deepEqual(after.at(-1),{version:alignment.name,checksum:alignment.checksum});
        assert.equal((await pool.query('SELECT role FROM users WHERE id=$1',[user])).rows[0].role,'COORDINATOR');
        assert.equal((await upgradeCoordinatorSchema(client,{profile,mode:'apply'})).changed,false);
      });
      await t.test('all legacy fields/snapshots retained; RECEIVED mapping and new counter are explicit',async()=>{
        assert.deepEqual((await pool.query('SELECT to_jsonb(r) AS data FROM phase1_reviews r ORDER BY application_id')).rows,legacy);
        assert.deepEqual((await pool.query('SELECT to_jsonb(s) AS data FROM phase1_submissions s ORDER BY id')).rows,snapshots);
        assert.deepEqual((await pool.query('SELECT opens_at,closes_at,version FROM phase1_cycle_windows WHERE cycle_id=$1',[fixture.cycle])).rows[0],oldWindow);
        for(const record of fixture.records){
          const row=(await pool.query('SELECT * FROM coordinator_reviews WHERE application_id=$1',[record.app])).rows[0];
          assert.equal(row.state,{received:'FORWARDED',returned:'RETURNED',resubmitted:'PENDING'}[record.variant]);
          assert.equal(row.version,1);assert.equal(row.submission_id,record.latest);
          assert.equal(row.source_provenance.review.submission_id,record.first);
          if(profile==='external015')assert.equal(row.source_provenance.counter,'new-canonical-counter');
        }
        const window=(await pool.query('SELECT review_opens_at,review_closes_at FROM phase1_cycle_windows WHERE cycle_id=$1',[fixture.cycle])).rows[0];
        assert.equal(Boolean(window.review_closes_at),profile==='workspace013');
        await assert.rejects(pool.query('UPDATE phase1_reviews SET reason=reason WHERE false'),/archive is read only/);
        const actor={isAuthenticated:true,userId:user,role:'COORDINATOR',accountStatus:'ACTIVE'},service=new coordinator.CoordinatorWorkspaceService({pool});
        const detail=await service.detail(actor,fixture.records[2].app);assert.equal(detail.state,'PENDING');
        assert.equal(detail.can_review,profile==='workspace013');
        const view=await new committee.CommitteeWorkspaceService({pool}).read({...actor,userId:fixture.members[0],role:'COMMITTEE'});
        assert.deepEqual(view.students.map(s=>s.id),[fixture.records[0].app]);
      });
      await t.test('damaged installed guard or disabled trigger is rejected on replay',async()=>{
        await pool.query('ALTER TABLE coordinator_reviews DISABLE TRIGGER coordinator_review_guard');
        await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'apply'}),e=>e.statusCode===503);
        await pool.query('ALTER TABLE coordinator_reviews ENABLE TRIGGER coordinator_review_guard');
        const original=(await pool.query("SELECT pg_get_functiondef('guard_coordinator_review()'::regprocedure) AS sql")).rows[0].sql;
        await pool.query("CREATE OR REPLACE FUNCTION guard_coordinator_review() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'");
        await assert.rejects(upgradeCoordinatorSchema(client,{profile,mode:'apply'}),/GUARD_BODY_MISMATCH/);
        await pool.query(original);
        await pool.query('ALTER TABLE coordinator_reviews ALTER COLUMN source_provenance TYPE text USING source_provenance::text');
        await assert.rejects(contract.assertCoordinatorSchema(pool),e=>e.statusCode===503);
        await pool.query('ALTER TABLE coordinator_reviews ALTER COLUMN source_provenance TYPE jsonb USING source_provenance::jsonb');
        await contract.assertCoordinatorSchema(pool);
      });
    }finally{client.release();}
  }finally{await pool?.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
