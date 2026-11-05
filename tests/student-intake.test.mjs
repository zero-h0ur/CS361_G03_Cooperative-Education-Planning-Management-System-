import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import access from '../src/shared/application-access.js';
import maintenance from '../src/maintenance.js';
import policy from '../src/api/services/application-policy.js';
import budget from '../src/db/application-budget.js';
import {PassThrough} from 'node:stream';
import s3 from '../src/storage/s3-document-store.js';
const scope={student_user_id:randomUUID(),coordinator_user_id:randomUUID(),cycle_id:randomUUID()};
const actor={isAuthenticated:true,role:'STUDENT',accountStatus:'ACTIVE',userId:scope.student_user_id};
test('pilot capabilities require exact owner/cycle and stage; malformed config fails closed',()=>{
 for(const mode of access.INTAKE_MODES){const a=access.applicationAccess(mode,{actor,cycleId:scope.cycle_id,scope});
  assert.equal(a.can_edit,true);assert.equal(a.can_upload,mode!=='intake-draft');assert.equal(a.can_submit,mode==='intake-pilot');
  for(const change of [{actor:{...actor,userId:randomUUID()}},{cycleId:randomUUID()},{scope:{...scope,extra:true}},{actor:{...actor,accountStatus:'DISABLED'}}])
   assert.equal(access.applicationAccess(mode,{actor,cycleId:scope.cycle_id,scope,...change}).can_submit,false);
 }
 assert.equal(access.pilotScope('not-json'),null);
});
test('intake path gate never opens staff commands, legacy Plans or local binary writes',()=>{
 const app='/api/tu-proxy/api/v4/applications/'+randomUUID();
 for(const mode of access.INTAKE_MODES){const invoke=(method,path,rawQueryString='')=>maintenance.maintenanceResponse({rawPath:path,rawQueryString,requestContext:{http:{method}}},mode);
  assert.equal(invoke('PATCH',app),null);assert.equal(invoke('POST',app+'/submit')===null,mode==='intake-pilot');
  for(const path of ['/api/v3/plans',app+'/uploads/'+randomUUID()+'/content','/api/v4/coordinator/applications/'+randomUUID()+'/forward','/api/v4/coordinator/schedules/'+scope.cycle_id])assert.equal(invoke('POST',path).statusCode,503);
  assert.equal(invoke('PATCH',app,'role=ADMIN').statusCode,503);
 }
});
test('pending policy is UNKNOWN, not PASS; missing grade/files and known GPAX failure remain blocking',()=>{
 const app={status:'DRAFT',payload:{curriculum:'66',gpax:'3.2'}};
 const result=policy.readiness({app,official:{},window:{is_open:true},roundOpen:true,allowPendingAcademic:true});
 assert.equal(result.eligibility,'UNKNOWN');assert.equal(result.group_gpa,null);assert.equal(result.can_submit,false);
 assert.ok(result.review_flags.some(x=>x.code==='POLICY_PENDING'));assert.ok(!result.blockers.some(x=>x.code==='IDENTITY_PENDING'));
 assert.ok(result.blockers.some(x=>x.code==='DOCUMENT_REQUIRED'));assert.ok(result.blockers.some(x=>x.code==='COURSE_REQUIRED'));
 const failed=policy.readiness({app:{...app,payload:{...app.payload,gpax:'2.0'}},official:{},window:{is_open:true},roundOpen:true,allowPendingAcademic:true});
 assert.ok(failed.blockers.some(x=>x.code==='GPAX_BELOW_MINIMUM'));
 assert.ok(policy.readiness({app,official:{},window:{is_open:true},roundOpen:true}).blockers.some(x=>x.code==='POLICY_PENDING'));
});
test('one transaction deadline shrinks across SQL/storage calls and leaves raw cleanup usable',async()=>{
 let elapsed=0;const queries=[],raw={query:async(...args)=>{queries.push(args);return {rows:[]};}};
 const db=budget.applicationBudget(raw,{milliseconds:100,now:()=>elapsed});await db.query('SELECT 1');elapsed=90;
 await db.query('SELECT 2');assert.equal(queries[2][1][0],'10ms');elapsed=100;
 await assert.rejects(db.query('COMMIT'),e=>e.code==='APPLICATION_TIMEOUT');await raw.query('ROLLBACK');
 assert.equal(queries.at(-1)[0],'ROLLBACK');
});
test('S3 abort applies to a slow response body and prevents a late immutable write',async()=>{
 const stream=new PassThrough(),control=new AbortController();
 const store=new s3.S3DocumentStore({bucket:'coed-local-test',region:'ap-southeast-2',client:{send:async()=>({ContentLength:10,Body:stream})}});
 const pending=store.readStaging('staging/'+randomUUID(),10,{signal:control.signal});
 setTimeout(()=>control.abort(),10);await assert.rejects(pending);assert.equal(stream.destroyed,true);
});
