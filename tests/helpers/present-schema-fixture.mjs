// Reconstructs the OBSERVED catalog in a disposable test schema, not old014/015 SQL.
import {readObservedBaseline,identifier} from '../../scripts/operations/present-schema-baseline.mjs';
export async function createObservedFixture(client,schema,seedBeforeTriggers){
 if(process.env.NODE_ENV!=='test' || !/^present_[a-f0-9]+$/.test(schema))throw Error('DISPOSABLE_FIXTURE_REQUIRED');
 const target=(await client.query('SELECT current_database() AS name,current_schema() AS schema')).rows[0];
 if(!target.name.endsWith('_test') || target.schema!==schema)throw Error('DISPOSABLE_FIXTURE_REQUIRED');
 if((await client.query('SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()')).rows[0].n)
  throw Error('EMPTY_FIXTURE_SCHEMA_REQUIRED');
 const {catalog:c,migrations}=readObservedBaseline(),q=identifier;
 const adapt=sql=>sql.replaceAll('public.',q(schema)+'.');
 for(const table of c.tables){
  if(table.kind!=='r' || table.row_security || table.force_rls || table.owner!=='postgres')throw Error('UNSUPPORTED_FIXTURE_TABLE');
  const columns=c.columns.filter(col=>col.table_name===table.name).map(col=>{
   if(col.identity || col.generated)throw Error('UNSUPPORTED_FIXTURE_COLUMN');
   return q(col.name)+' '+adapt(col.type)+(col.not_null?' NOT NULL':'')+(col.default_expression?' DEFAULT '+adapt(col.default_expression):'');
  });
  await client.query(`CREATE TABLE ${q(schema)}.${q(table.name)} (${columns.join(',')})`);
 }
 // Reparse of deparsed BETWEEN/NOT IN flattens AND ASTs. Recreate these three
 // authentic001-013 predicates in their source form so the fixture's catalog
 // matches the observed definitions exactly; operational guards stay strict.
 const sourcePredicates={
  selection_cohorts_check1:'CHECK (coordinator_id NOT IN (committee_one,committee_two,committee_three))',
  selection_opinions_comment_check:'CHECK (length(comment) BETWEEN 1 AND 2000 AND comment=btrim(comment))',
  students_contact_email_format:`CHECK (contact_email IS NULL OR (char_length(contact_email) BETWEEN 3 AND 254
    AND contact_email=btrim(contact_email) AND contact_email !~ '[[:cntrl:][:space:]]'
    AND contact_email ~ '^[^@]+@[^@]+\\.[^@]+$'))`
 };
 for(const type of ['p','u','c','x','f'])for(const constraint of c.constraints.filter(row=>row.type===type))
  await client.query(`ALTER TABLE ${q(schema)}.${q(constraint.table_name)} ADD CONSTRAINT ${q(constraint.name)} ${adapt(sourcePredicates[constraint.name] || constraint.definition)}`);
 const backed=new Set(c.constraints.filter(row=>['p','u','x'].includes(row.type)).map(row=>row.name));
 for(const index of c.indexes.filter(row=>!backed.has(row.name)))await client.query(adapt(index.definition));
 for(const routine of c.routines)await client.query(adapt(routine.definition));
 // Historical rows can predate the currently broken trigger. Seed only synthetic
 // fixture rows BEFORE installing the observed triggers; never disable live guards.
 if(seedBeforeTriggers)await seedBeforeTriggers(client);
 for(const trigger of c.triggers){
  await client.query(adapt(trigger.definition));
  if(trigger.enabled!=='O')throw Error('UNSUPPORTED_FIXTURE_TRIGGER_STATE');
 }
 for(const grant of c.table_acl.filter(row=>row.grantee!=='postgres'))
  await client.query(`GRANT ${grant.privilege} ON ${q(schema)}.${q(grant.table_name)} TO ${grant.grantee==='PUBLIC'?'PUBLIC':q(grant.grantee)}${grant.grantable?' WITH GRANT OPTION':''}`);
 for(const grant of c.column_acl.filter(row=>row.grantee!=='postgres'))
  await client.query(`GRANT ${grant.privilege} (${q(grant.column_name)}) ON ${q(schema)}.${q(grant.table_name)} TO ${grant.grantee==='PUBLIC'?'PUBLIC':q(grant.grantee)}${grant.grantable?' WITH GRANT OPTION':''}`);
 // Default function EXECUTE is PUBLIC; the snapshot also has an explicit runtime grant.
 for(const grant of c.routine_acl.filter(row=>!['postgres','PUBLIC'].includes(row.grantee)))
  await client.query(`GRANT EXECUTE ON FUNCTION ${q(schema)}.${q(grant.name)}(${grant.arguments}) TO ${q(grant.grantee)}`);
 await client.query(`GRANT USAGE ON SCHEMA ${q(schema)} TO coed_app`);
 for(const row of migrations)await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[row.version,row.checksum]);
}
