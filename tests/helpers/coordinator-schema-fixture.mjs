// Synthetic reconstruction from inspected catalog metadata, NOT recovered 014/015.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {readReviewedMigrations} from '../../scripts/operations/reviewed-migrations.mjs';
import {EXTERNAL_HISTORY,recordedCatalog} from '../../scripts/operations/coordinator-schema-lineages.mjs';
export async function bootstrapCoordinatorFixture(db,profile,{history=true}={}) {
  const migrations=readReviewedMigrations();
  for(const row of migrations.filter(r=>r.name.slice(0,3)<=(profile==='external015'?'012':'013')))await db.query(row.sql);
  if(profile==='external015'){
    const sql=readFileSync(new URL('../fixtures/coordinator-external013-verified.sql',import.meta.url));
    if(createHash('sha256').update(sql).digest('hex')!==EXTERNAL_HISTORY[12][1])throw new Error('FIXTURE_013_HASH_MISMATCH');
    await db.query(sql.toString('utf8'));
    // Reconstruct the observed final catalog; do not label this the missing SQL.
    await db.query(`ALTER TABLE phase1_applications DROP CONSTRAINT phase1_applications_status_check;
      ALTER TABLE phase1_applications ADD CHECK(status IN ('DRAFT','SUBMITTED','NEEDS_REVISION'));
      ALTER TABLE phase1_submissions DROP CONSTRAINT phase1_submissions_application_id_key;
      ALTER TABLE phase1_submissions ADD CONSTRAINT phase1_submission_revision_unique UNIQUE(application_id,application_version)`);
    const columns=recordedCatalog.columns.filter(c=>c.table_name==='phase1_reviews').map(c=>
      c.column_name+' '+c.data_type+(c.not_null?' NOT NULL':'')+(c.default_expression?' DEFAULT '+c.default_expression:''));
    await db.query('CREATE TABLE phase1_reviews('+columns.join(',')+')');
    for(const c of recordedCatalog.constraints.filter(c=>c.table_name==='phase1_reviews'))await db.query('ALTER TABLE phase1_reviews ADD CONSTRAINT '+c.name+' '+c.definition);
    // Reparse the observed CHECK expressions too: PostgreSQL versions can
    // deparse BETWEEN/associative AND differently from the original source.
    for(const c of recordedCatalog.constraints.filter(c=>c.name==='chk_audit_events_notes'))await db.query('ALTER TABLE '+c.table_name+' DROP CONSTRAINT '+c.name+'; ALTER TABLE '+c.table_name+' ADD CONSTRAINT '+c.name+' '+c.definition);
    const schema=(await db.query('SELECT current_schema() AS name')).rows[0].name;
    for(const index of recordedCatalog.indexes){
      if(!(await db.query('SELECT to_regclass($1) AS name',[schema+'.'+index.name])).rows[0].name)await db.query(index.definition.replaceAll('public.',schema+'.'));
    }
    for(const f of recordedCatalog.functions)await db.query(f.definition.replaceAll('public.',schema+'.'));
    for(const t of recordedCatalog.triggers){
      const exists=(await db.query('SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2',[t.table_name,t.name])).rows.length;
      if(!exists)await db.query(t.definition.replaceAll('public.',schema+'.'));
    }
  }
  if(history){
    await db.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum char(64) NOT NULL)');
    const rows=profile==='external015'?EXTERNAL_HISTORY:migrations.filter(r=>r.name.slice(0,3)<='013').map(r=>[r.name,r.checksum]);
    for(const row of rows)await db.query('INSERT INTO schema_migrations VALUES($1,$2)',row);
  }
}

export async function seedLegacyCoordinatorReviews(db,profile,coordinator){
  const cycle=randomUUID(),members=Array.from({length:3},randomUUID),cohort=randomUUID(),policy=randomUUID();
  for(const id of members)await db.query("INSERT INTO users(id,role) VALUES($1,'COMMITTEE')",[id]);
  await db.query("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Synthetic alignment',2569,1,'OPEN','synthetic','public','mock')",[cycle]);
  await db.query("INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three) VALUES($1,$2,'CS','regular',$3,$4,$5,$6)",[cohort,cycle,coordinator,...members]);
  await db.query("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '3 days',now()-interval '2 days')",[cycle]);
  if(profile==='workspace013')await db.query(`INSERT INTO coordinator_round_schedules(cycle_id,review_opens_at,review_closes_at,confirmation_opens_at,confirmation_closes_at,version,updated_by)
    VALUES($1,now()-interval '1 day',now()+interval '1 day',now()+interval '2 days',now()+interval '3 days',7,$2)`,[cycle,coordinator]);
  else await db.query("UPDATE phase1_cycle_windows SET confirmation_opens_at=now()+interval '2 days',confirmation_closes_at=now()+interval '3 days' WHERE cycle_id=$1",[cycle]);
  await db.query("INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data) VALUES($1,$2,'66',1,2568,'synthetic',true,true,'{}')",[policy,cycle]);
  const records=[];
  for(const variant of ['received','returned','resubmitted']){
    const user=randomUUID(),student=randomUUID(),app=randomUUID(),first=randomUUID();
    await db.query("INSERT INTO users(id,role) VALUES($1,'STUDENT')",[user]);
    await db.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES($1,$2,$3,$3,'Synthetic student','fixture@example.invalid','CS','regular','CS',2569,'ACTIVE','synthetic','private','mock')`,[student,user,'S'+student]);
    await db.query('INSERT INTO phase1_applications(id,student_id,cycle_id) VALUES($1,$2,$3)',[app,student,cycle]);
    const snapshot={official:{student_number:'S'+student,full_name:'Synthetic student',curriculum:'66'},payload:{skills_detail:'Original free text'},documents:[]};
    await db.query(`INSERT INTO phase1_submissions(id,application_id,application_version,policy_id,snapshot,checksum,submitted_by)
      VALUES($1,$2,2,$3,$4,$5,$6)`,[first,app,policy,JSON.stringify(snapshot),'a'.repeat(64),user]);
    await db.query("UPDATE phase1_applications SET status='SUBMITTED',version=2,submitted_at=now() WHERE id=$1",[app]);
    const state=variant==='received'?(profile==='external015'?'RECEIVED':'FORWARDED'):'RETURNED',reason=state==='RETURNED'?'Synthetic correction':null;
    if(profile==='external015')await db.query('INSERT INTO phase1_reviews(application_id,submission_id,cohort_id,status,reviewed_by,reason) VALUES($1,$2,$3,$4,$5,$6)',[app,first,cohort,state,coordinator,reason]);
    else await db.query('INSERT INTO phase1_reviews(application_id,submission_id,cohort_id,state,version,actor_id,reason) VALUES($1,$2,$3,$4,1,$5,$6)',[app,first,cohort,state,coordinator,reason]);
    let latest=first;
    if(variant!=='received')await db.query("UPDATE phase1_applications SET status='NEEDS_REVISION',submitted_at=NULL,version=3 WHERE id=$1",[app]);
    if(variant==='resubmitted'){
      latest=randomUUID();await db.query(`INSERT INTO phase1_submissions(id,application_id,application_version,policy_id,snapshot,checksum,submitted_by)
        VALUES($1,$2,4,$3,$4,$5,$6)`,[latest,app,policy,JSON.stringify({...snapshot,payload:{skills_detail:'Corrected student text'}}),'b'.repeat(64),user]);
      await db.query("UPDATE phase1_applications SET status='SUBMITTED',version=4,submitted_at=now() WHERE id=$1",[app]);
    }
    records.push({variant,app,first,latest,user});
  }
  return {cycle,cohort,members,records};
}

export async function grantExternalFixtureRuntime(db,schema,role){
  // Shared 001-012 privilege contract plus the observed external ACL, using a
  // new NOLOGIN role in an isolated synthetic schema only.
  const prefix=readFileSync(new URL('../../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8').split('REVOKE ALL PRIVILEGES ON public.phase1_reviews')[0]
    .replace(/^\\set[^\n]*\n/m,'').replace(/^BEGIN;\r?$/m,'').replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema).replaceAll("'public'","'"+schema+"'").replaceAll('coed_app',role);
  await db.query(prefix);
  const acl=JSON.parse(readFileSync(new URL('../fixtures/coordinator-lineage015-acl.json',import.meta.url),'utf8'));
  for(const row of acl.tableAcl)for(const [key,sql] of [['can_select','SELECT'],['can_insert','INSERT'],['can_update','UPDATE'],['can_delete','DELETE'],['can_truncate','TRUNCATE']])
    if(row[key])await db.query('GRANT '+sql+' ON '+schema+'.'+row.table_name+' TO '+role);
  for(const row of acl.columnAcl)for(const [key,sql] of [['can_insert','INSERT'],['can_update','UPDATE']])
    if(row[key])await db.query('GRANT '+sql+'('+row.column_name+') ON '+schema+'.'+row.table_name+' TO '+role);
}
