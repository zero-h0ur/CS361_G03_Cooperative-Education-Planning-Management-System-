// B2b data-only importer: retained reviewed schema, no DDL/reset/general seed.
import { createHash } from 'node:crypto';
import { TARGET as BASE, credentials, reject } from './b2-bootstrap.mjs';
import { validTestSubject } from './identity-input.mjs';

export const T = Object.freeze({ ...BASE, fn: 'coed-loadtest-import-b2b', role: 'coed-loadtest-import-b2b-role',
  appSecret: 'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/loadtest/postgres/app-vYon7i' });
export const ISSUER = 'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Um6nksXa1';
const canonical = v => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(canonical) :
  v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const hash = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex');
const same = (a,b) => hash(a) === hash(b);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
export function validateBindings(input) {
  if (!exact(input,['issuer','accounts']) || input.issuer !== ISSUER || !Array.isArray(input.accounts) || input.accounts.length !== 10) reject('B2B_BINDINGS_REJECTED');
  const seen = new Set();
  const accounts = [...input.accounts].sort((a,b) => String(a?.alias).localeCompare(String(b?.alias)));
  accounts.forEach((a,i) => {
    if (!exact(a,['alias','subject']) || a.alias !== `loadtest${String(i+1).padStart(2,'0')}` ||
        !validTestSubject(a.subject) || seen.has(a.subject)) reject('B2B_BINDINGS_REJECTED');
    seen.add(a.subject);
  });
  return { issuer: input.issuer, accounts };
}
export function id(key) {
  const h = hash(`coed-loadtest-db-v1:${T.run}:${key}`);
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function expectedRows(bindings,data) {
  if(!exact(data,['companies','positions']) || data.companies?.length!==400 || data.positions?.length!==800)reject('B2B_DATASET_REJECTED');
  const b = validateBindings(bindings), source = `loadtest:${T.run}`;
  const rows = { companies: data.companies.map(c => ({...c, updated_at:new Date(c.updated_at)})),
    positions: data.positions.map(p => ({...p, updated_at:new Date(p.updated_at)})),
    rounds:[{id:id('round'),name:`LOADTEST-${T.run}`,academic_year:2569,semester:1,status:'OPEN',end_date:null,source,visibility:'public',data_status:'mock'}],
    users:[], external_identity_links:[], students:[], plans:[] };
  for (const a of b.accounts) {
    rows.users.push({id:id(`${a.alias}:user`),role:'STUDENT',account_status:'ACTIVE',version:1});
    rows.external_identity_links.push({id:id(`${a.alias}:link`),user_id:id(`${a.alias}:user`),external_issuer:b.issuer,external_subject:a.subject,status:'ACTIVE'});
    rows.students.push({id:id(`${a.alias}:student`),user_id:id(`${a.alias}:user`),anonymous_ref:`LOADTEST-${a.alias}`,
      student_number:`99000000${a.alias.slice(-2)}`,full_name:`LOADTEST Student ${a.alias.slice(-2)}`,
      institutional_email:`${a.alias}@example.invalid`,department:'LOADTEST-DEPT',program:'LOADTEST-PROGRAM',major:'LOADTEST-MAJOR',
      academic_year:2569,enrollment_status:'ACTIVE',source,visibility:'private',data_status:'mock'});
    rows.plans.push({id:id(`${a.alias}:plan`),student_id:id(`${a.alias}:student`),round_id:id('round'),cycle_id:id('round'),
      company_id:null,position_id:null,notes:'LOADTEST initial synthetic Draft',status:'DRAFT',version:1,legacy_compatibility:false,source,visibility:'private',data_status:'mock'});
  }
  return rows;
}
export function validateConfig(c, now = Date.now()) {
  if (!exact(c,['host','database','owner','ownerSecret','appSecret','startedAt','expiresAt','payloadHash','bindingHash']) ||
      c.host!==T.host || c.database!==T.database || c.owner!==T.owner || c.ownerSecret!==T.ownerSecret || c.appSecret!==T.appSecret ||
      !Number.isSafeInteger(c.startedAt) || !Number.isSafeInteger(c.expiresAt) || c.startedAt>now+5000 ||
      c.expiresAt<=now || c.expiresAt-c.startedAt>3600000 || c.expiresAt<=c.startedAt ||
      !/^[a-f0-9]{64}$/.test(c.payloadHash) || !/^[a-f0-9]{64}$/.test(c.bindingHash)) reject('B2B_CONFIG_REJECTED');
}
export async function snapshot(client, history) {
  const observed=(await client.query('SELECT version,checksum FROM public.schema_migrations ORDER BY version')).rows;
  if (!same(observed,history)) reject('B2B_HISTORY_DRIFT');
  const roles=(await client.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS membership FROM pg_roles WHERE rolname='coed_app'`)).rows;
  if (roles.length!==1 || Object.entries(roles[0]).some(([k,v])=>k!=='rolname' && v)) reject('B2B_ROLE_DRIFT');
  const excessive=(await client.query(`SELECT has_schema_privilege('coed_app','public','CREATE') OR
    has_database_privilege('coed_app',current_database(),'CREATE') OR
    has_table_privilege('coed_app','public.users','INSERT,DELETE,TRUNCATE') OR
    has_column_privilege('coed_app','public.users','role','UPDATE') OR
    has_table_privilege('coed_app','public.external_identity_links','INSERT,UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.audit_events','UPDATE,DELETE,TRUNCATE') OR
    has_table_privilege('coed_app','public.plan_operations','UPDATE,DELETE,TRUNCATE') AS bad`)).rows[0].bad;
  if(excessive)reject('B2B_GRANTS_DRIFT');
  const data={history:observed,roles,historyDetails:(await client.query('SELECT version,checksum,applied_at FROM public.schema_migrations ORDER BY version')).rows};
  for(const [key,sql] of Object.entries({
    relations:`SELECT c.relname,c.relkind,c.relowner::regrole::text,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`,
    columns:`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    constraints:`SELECT c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname`,
    triggers:`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
    functions:`SELECT p.oid::regprocedure::text AS name,p.proowner::regrole::text,p.proacl::text,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY name`,
    schemas:`SELECT nspname,nspowner::regrole::text,nspacl::text FROM pg_namespace WHERE nspname='public'`,
    database:`SELECT datname,datdba::regrole::text,datacl::text FROM pg_database WHERE datname=current_database()`
  })) data[key]=(await client.query(sql)).rows;
  return hash(data);
}
const quote = name => '"'+name.replaceAll('"','""')+'"';
export async function counts(client) {
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows;
  const result={};
  for(const {tablename} of tables) result[tablename]=Number((await client.query(`SELECT count(*)::int AS n FROM public.${quote(tablename)}`)).rows[0].n);
  return result;
}
export async function verifyRows(client,bindings,dataset) {
  const rows=expectedRows(bindings,dataset), n=await counts(client);
  for(const [table,expected] of Object.entries(rows)) {
    const keys=Object.keys(expected[0]);
    const observed=(await client.query(`SELECT ${keys.map(quote).join(',')} FROM public.${quote(table)} ORDER BY id`)).rows;
    if(!same(observed,[...expected].sort((a,b)=>a.id.localeCompare(b.id))))reject('B2B_DATA_DRIFT');
  }
  for(const [table,count] of Object.entries(n)) if(count!==(rows[table]?.length || 0))reject('B2B_FOREIGN_DATA');
  const ready=Number((await client.query(`SELECT count(*)::int AS n FROM plans p JOIN rounds r ON r.id=p.cycle_id
    WHERE p.status='DRAFT' AND p.version=1 AND r.status='OPEN' AND r.id=$1`,[id('round')])).rows[0].n);
  if(ready!==10)reject('B2B_CYCLE_NOT_EDITABLE');
  return {companies:n.companies,positions:n.positions,users:n.users,students:n.students,links:n.external_identity_links,
    drafts:n.plans,openCycles:n.rounds,allDraftsEditable:true};
}
export async function importData(client,{bindings,history,baseline,command,dataset}) {
  if(!['preflight','trial','apply','verify'].includes(command))reject('B2B_COMMAND_REJECTED');
  validateBindings(bindings);expectedRows(bindings,dataset);
  await client.query(command==='verify' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s'; SET LOCAL idle_in_transaction_session_timeout='90s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('coed-loadtest-b2b'))");
    if(command!=='verify') {
      const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
      await client.query(`LOCK TABLE ${tables.map(t=>'public.'+quote(t.tablename)).join(',')} IN EXCLUSIVE MODE`);
    }
    const before=await snapshot(client,history);
    if(baseline && baseline!==before)reject('B2B_BASELINE_DRIFT');
    const n=await counts(client), empty=Object.values(n).every(v=>v===0);
    if(command==='preflight') {
      if(!empty)reject('B2B_NONEMPTY_TARGET');
      await client.query('ROLLBACK'); return {baseline:before,empty:true};
    }
    if(!baseline)reject('B2B_BASELINE_REQUIRED');
    let replay=false;
    if(command!=='verify' && empty) {
      for(const [table,records] of Object.entries(expectedRows(bindings,dataset))) {
        const keys=Object.keys(records[0]);
        // Table/column identifiers are fixed by our code. All values parameterized.
        for(const row of records) await client.query(`INSERT INTO public.${quote(table)} (${keys.map(quote).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));
      }
    } else replay=true;
    const result=await verifyRows(client,bindings,dataset);
    if(await snapshot(client,history)!==before)reject('B2B_CATALOG_CHANGED');
    await client.query(command==='apply' ? 'COMMIT' : 'ROLLBACK');
    return {...result,baseline:before,committed:command==='apply',idempotentReplay:replay};
  } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;}
}
export function createImporter({config,payload,secretReader,connect,runtimeCheck,now=Date.now}) {
  return async event => {
    let client,stage='validation';
    try {
      validateConfig(config,now());
      if(hash(payload)!==config.payloadHash || !Array.isArray(payload.history) || payload.history.length!==17 ||
          !exact(event,['command','payloadHash','baseline','bindings']) || event.payloadHash!==config.payloadHash ||
          !['preflight','trial','apply','verify'].includes(event.command) ||
          !(event.baseline===null || /^[a-f0-9]{64}$/.test(event.baseline)))reject('B2B_COMMAND_REJECTED');
      const bindings=validateBindings(event.bindings);
      if(hash(bindings)!==config.bindingHash)reject('B2B_BINDING_DIGEST_MISMATCH');
      stage='owner-secret';
      const owner=credentials(await secretReader(T.ownerSecret),'owner');
      stage='owner-connect';
      client=await connect(owner);
      stage='connected-target';
      const target=(await client.query('SELECT current_database() AS db,current_user AS usr')).rows[0];
      if(target.db!==T.database || target.usr!==T.owner)reject('B2B_CONNECTED_TARGET_REJECTED');
      stage='data-command';
      const result=await importData(client,{bindings,history:payload.history,baseline:event.baseline,command:event.command,dataset:payload.dataset});
      await client.end();client=null;
      if(event.command==='verify') {
        stage='app-secret';const app=credentials(await secretReader(T.appSecret),'app');
        stage='app-connect';
        client=await connect(app);
        const rt=(await client.query('SELECT current_database() AS db,current_user AS usr')).rows[0];
        if(rt.db!==T.database || rt.usr!==T.user)reject('B2B_RUNTIME_TARGET_REJECTED');
        stage='runtime-check';result.runtime=await runtimeCheck(client,bindings);
      }
      return {ok:true,status:`B2B_${event.command.toUpperCase()}_OK`,...result};
    } catch(e) {
      // Classify authorization text in memory; NEVER return the raw message.
      const denialCategory=e.name==='AccessDeniedException' ?
        /vpc endpoint policy/i.test(e.message || '')?'VPC_ENDPOINT_POLICY':
        /service control policy/i.test(e.message || '')?'SERVICE_CONTROL_POLICY':
        /permissions boundary/i.test(e.message || '')?'PERMISSIONS_BOUNDARY':
        /resource.based policy/i.test(e.message || '')?'RESOURCE_POLICY':
        /identity.based policy/i.test(e.message || '')?'IDENTITY_POLICY':
        /kms|decrypt/i.test(e.message || '')?'KMS_POLICY':'UNSPECIFIED' : undefined;
      return {ok:false,code:/^B2B?_[A-Z_]+$/.test(e.code || '')?e.code:'B2B_DATABASE_OR_SECRET_FAILED',stage,
        errorName:/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(e.name || '')?e.name:undefined,
        denialCategory,
        sqlState:/^[0-9A-Z]{5}$/.test(e.code || '')?e.code:undefined};
    } finally {if(client)await client.end().catch(()=>{});}
  };
}
