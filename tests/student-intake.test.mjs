import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import access from '../src/shared/application-access.js';
import maintenance from '../src/maintenance.js';
import policy from '../src/api/services/application-policy.js';
import budget from '../src/db/application-budget.js';
import {PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import s3 from '../src/storage/s3-document-store.js';
const scope={student_user_id:randomUUID(),coordinator_user_id:randomUUID(),cycle_id:randomUUID()};
const actor={isAuthenticated:true,role:'STUDENT',accountStatus:'ACTIVE',userId:scope.student_user_id};

test('CI provisions a dedicated disposable intake database before running the mandatory integration suite',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/v4-verification.yml',import.meta.url),'utf8');
 const regression=workflow.split('  regression:')[1]?.split('  observed-schema-upgrade:')[0] || '';
 const match=regression.match(/^\s+STUDENT_INTAKE_TEST_DATABASE_URL:\s*(\S+)\s*$/m);assert.ok(match,'CI must configure the intake database URL');
 const url=new URL(match[1]);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/coed_intake_test');
 assert.match(regression,/^\s+INTAKE_DISPOSABLE:\s*['"]true['"]\s*$/m);
 const create=regression.indexOf("client.query('CREATE DATABASE coed_intake_test')"),run=regression.indexOf('npm test');
 assert.ok(create>=0&&run>create,'provision the isolated intake database before full regression');
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.ok(pkg.scripts.test.includes('npm run test:student-intake'));
 for(const file of ['student-intake-db.test.mjs','intake-controls-upgrade-db.test.mjs'])assert.ok(pkg.scripts['test:student-intake'].includes(file));
});
test('pilot capabilities require exact owner/cycle and stage; malformed config fails closed',()=>{
 for(const mode of access.INTAKE_MODES){const a=access.applicationAccess(mode,{actor,cycleId:scope.cycle_id,scope});
  assert.equal(a.can_edit,true);assert.equal(a.can_upload,mode!=='intake-draft');assert.equal(a.can_submit,mode==='intake-pilot');
  for(const change of [{actor:{...actor,userId:randomUUID()}},{cycleId:randomUUID()},{scope:{...scope,extra:true}},{actor:{...actor,accountStatus:'DISABLED'}}])
   assert.equal(access.applicationAccess(mode,{actor,cycleId:scope.cycle_id,scope,...change}).can_submit,false);
 }
 assert.equal(access.pilotScope('not-json'),null);
});
test('routed audience requires server membership proof, preserves stage/round and rejects unknown audience',()=>{
 const other={...actor,userId:randomUUID()};
 for(const mode of access.INTAKE_MODES){
  const context={actor:other,cycleId:scope.cycle_id,scope,audience:'routed-tu-students',routedStudent:true};
  const allowed=access.applicationAccess(mode,context);
  assert.equal(allowed.can_create,true);assert.equal(allowed.can_submit,mode==='intake-pilot');
  for(const change of [{routedStudent:false},{cycleId:randomUUID()},{audience:'everyone'},
   {actor:{...other,accountStatus:'DISABLED'}},{actor:{...other,isAuthenticated:false}},{scope:{...scope,extra:true}}])
   assert.equal(access.applicationAccess(mode,{...context,...change}).can_create,false);
 }
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
