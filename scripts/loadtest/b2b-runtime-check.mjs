// Real runtime repositories/services against test DB, all writes ROLLED BACK.
// No Gateway/JWT/Cognito authentication or production API invocation is claimed.
import { randomUUID } from 'node:crypto';
import identity from '../../src/auth/identity-resolver.js';
import planModule from '../../src/api/services/student-plan-service.js';
import authorization from '../../src/api/services/authorization-service.js';
import directoryModule from '../../src/db/repositories/directory-repository.js';
import { id, validateBindings } from './b2b-import.mjs';
import { reject } from './b2-bootstrap.mjs';

export async function runtimeCheck(client,input) {
  const bindings=validateBindings(input);
  const basic={query:(...args)=>client.query(...args)};
  const resolver=new identity.IdentityResolver({pool:basic});
  const auth=new authorization.AuthorizationService({pool:basic});
  let operationId, rollbacks=0;
  const wrapped={query:async(sql,params)=>{
    if(sql==='COMMIT') {
      const r=(await client.query(`SELECT (SELECT count(*)::int FROM plan_operations WHERE operation_id=$1 AND result_version=2) AS receipts,
        (SELECT count(*)::int FROM audit_events WHERE operation_id=$1 AND action='PLAN_DRAFT_UPDATED') AS audit`,[operationId])).rows[0];
      if(r.receipts!==1 || r.audit!==1)reject('B2B_RUNTIME_RECEIPT_FAILED');
      rollbacks++;return client.query('ROLLBACK');
    }
    return client.query(sql,params);
  },release:()=>{}};
  const pool={...basic,connect:async()=>wrapped};
  const service=new planModule.StudentPlanService({pool});
  const directory=new directoryModule.DirectoryRepository({pool:basic});
  const listed=await directory.list({q:'',location:'',role:'',duration:'',recruitingOnly:false,page:1,pageSize:20},false);
  if(listed.pagination.total!==400 || listed.items.length!==20)reject('B2B_RUNTIME_DIRECTORY_FAILED');
  if((await directory.detail(listed.items[0].id,false)).id!==listed.items[0].id)reject('B2B_RUNTIME_DIRECTORY_FAILED');
  if((await directory.detail(listed.items[0].id,true)).positions.length!==2)reject('B2B_RUNTIME_DIRECTORY_FAILED');
  for(const a of bindings.accounts) {
    const actor={...await resolver.resolveIdentity(bindings.issuer,a.subject),isAuthenticated:true};
    if(actor.userId!==id(`${a.alias}:user`) || actor.studentId!==id(`${a.alias}:student`))reject('B2B_RUNTIME_IDENTITY_FAILED');
    const planId=id(`${a.alias}:plan`);
    await auth.authorize(actor,'plan:update_content',{planId});
    const own=await service.listOwnPlans(actor);
    if(own.items.length!==1 || own.items[0].id!==planId || own.items[0].status!=='DRAFT' || own.items[0].version!==1)reject('B2B_RUNTIME_OWN_PLAN_FAILED');
    // The selected workload PATCHes existing drafts, not GET cycle options.
    // That separate endpoint also reads selection_cohorts; do not broaden grants.
    const cycles=(await client.query('SELECT id,status,end_date FROM rounds WHERE id=$1',[own.items[0].cycle_id])).rows;
    if(cycles.length!==1 || cycles[0].id!==id('round') || cycles[0].status!=='OPEN' || cycles[0].end_date!==null)reject('B2B_RUNTIME_CYCLE_FAILED');
    operationId=randomUUID();
    const changed=await service.updateOwnPlan(actor,planId,{notes:'LOADTEST B2b rollback-only PATCH readiness',expected_version:1,operation_id:operationId});
    if(changed.plan.version!==2)reject('B2B_RUNTIME_PATCH_FAILED');
    if((await service.getOwnPlan(actor,planId)).version!==1)reject('B2B_RUNTIME_ROLLBACK_FAILED');
  }
  const first={...await resolver.resolveIdentity(bindings.issuer,bindings.accounts[0].subject),isAuthenticated:true};
  let foreignDenied=false;
  try {await auth.authorize(first,'plan:update_content',{planId:id('loadtest02:plan')});}
  catch(e){foreignDenied=e.statusCode===403 || e.status===403 || e.code==='FORBIDDEN';}
  if(!foreignDenied)reject('B2B_RUNTIME_OWNERSHIP_FAILED');
  const after=(await client.query(`SELECT (SELECT count(*)::int FROM plan_operations) AS operations,
    (SELECT count(*)::int FROM audit_events) AS audit,(SELECT count(*)::int FROM plans WHERE status='DRAFT' AND version=1) AS drafts`)).rows[0];
  if(after.operations!==0 || after.audit!==0 || after.drafts!==10 || rollbacks!==10)reject('B2B_RUNTIME_ROLLBACK_FAILED');
  for(const sql of ["CREATE TABLE public.b2b_forbidden(id int)","UPDATE users SET role='ADMIN'",
    'DELETE FROM external_identity_links','DELETE FROM audit_events','UPDATE schema_migrations SET checksum=checksum']) {
    await client.query('BEGIN');let denied=false;
    try {await client.query(sql);}catch(e){denied=e.code==='42501';}
    finally {await client.query('ROLLBACK');}
    if(!denied)reject('B2B_RUNTIME_PERMISSION_FAILED');
  }
  return {databaseLogin:true,directoryListDetail:true,exactIdentities:10,ownDrafts:10,openCycle:true,
    rollbackOnlyPatches:10,versionAndAudit:true,crossStudentDenied:true,privilegedWritesDenied:true,
    retainedPatchWrites:0,genuineCognitoAuthentication:false};
}
