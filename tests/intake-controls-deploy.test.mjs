import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stageEnvironment,promote,acknowledge,promotionProbe,assertControllerSource} from '../scripts/operations/intake-controls-deploy.mjs';
import controls from '../src/api/services/intake-control-service.js';
const scope={student_user_id:randomUUID(),coordinator_user_id:randomUUID(),cycle_id:randomUUID()};
test('historical single-account C7 controller cannot promote a broader or unknown audience',()=>{
 for(const audience of ['routed-tu-students','everyone',''])assert.throws(()=>stageEnvironment({COED_INTAKE_AUDIENCE:audience},scope,'intake-pilot'),/C7_AUDIENCE_DRIFT/);
});
const env={DB_USER:'coed_app',DB_NAME:'coed',CO_ED_APPLICATION_STORAGE:'s3',CO_ED_APPLICATION_BUCKET:'coed-v4-application-documents-130165494095-ap-southeast-2',
 TU_ONBOARDING_ENABLED:'true',COED_API_MAINTENANCE:'browse',AUTH_ISSUER:'preserved',DB_SECRET_ARN:'preserved'};
test('C7 stages retain every unrelated setting and cannot turn maintenance off, widen audience or embed credentials',()=>{
 for(const stage of ['browse','intake-draft','intake-upload','intake-pilot']){const result=stageEnvironment(env,scope,stage);
  assert.equal(result.COED_API_MAINTENANCE,stage);assert.equal(result.COED_INTAKE_CONTROLS_REQUIRED,'true');assert.deepEqual(JSON.parse(result.COED_INTAKE_PILOT),scope);
  const copy={...result};for(const key of ['COED_API_MAINTENANCE','COED_INTAKE_PILOT','COED_INTAKE_CONTROLS_REQUIRED'])delete copy[key];
  const old={...env};delete old.COED_API_MAINTENANCE;assert.deepEqual(copy,old);}
 assert.throws(()=>stageEnvironment(env,scope,'off'),/C7_STAGE_DENIED/);assert.throws(()=>stageEnvironment(env,{...scope,extra:randomUUID()},'intake-draft'),/C7_SCOPE_DENIED/);
 assert.throws(()=>stageEnvironment({...env,TU_API_APP_KEY:'synthetic'},scope,'browse'),/C7_UNSAFE_ENVIRONMENT/);
 assert.throws(()=>stageEnvironment({...env,CO_ED_APPLICATION_BUCKET:'another-bucket'},scope,'browse'),/C7_CONFIG_DRIFT/);
});
test('a closed parent round never displays manual mode as effectively open',async()=>{
 const service=new controls.IntakeControlService(),result=await service.present({query:async()=>({rows:[]})},{id:scope.cycle_id,name:'Synthetic',status:'CLOSED',can_control:false},
  {mode:'MANUAL_OPEN',version:2,opens_at:'2026-11-01T00:00:00Z',closes_at:null,server_time:'2026-11-06T00:00:00Z'});
 assert.equal(result.control.is_open,false);assert.equal(result.control.reason,'ROUND_CLOSED');assert.equal(result.can_control,false);
});
test('real owner/upload acceptance is required before any network operation promoting the pilot',async()=>{
 await assert.rejects(promote({status:'DRAFT_PILOT_CLOSED_CONTROL_OWNER_ACCEPTANCE_PENDING'},'intake-upload'),/C7_GENUINE_ACCEPTANCE_REQUIRED/);
 await assert.rejects(promote({status:'UPLOAD_PILOT_ACCEPTANCE_PENDING',ownerConfirmed:true},'intake-pilot'),/C7_GENUINE_ACCEPTANCE_REQUIRED/);
 assert.throws(()=>acknowledge({status:'PREPARED'},'owner'),/C7_OWNER_STAGE_REQUIRED/);
});

test('controller-only source binding preserves the original runtime source and rejects dirty, unbound or unrelated changes',()=>{
 const candidate={head:'a'.repeat(40)},current={head:'b'.repeat(40),dirty:false},binding={head:current.head,candidateSource:candidate.head};
 assertControllerSource(candidate,candidate);
 assertControllerSource(current,candidate,binding,['scripts/operations/intake-controls-deploy.mjs','tests/intake-controls-deploy.test.mjs']);
 for(const [c,b,paths] of [[{...current,dirty:true},binding,['tests/intake-controls-deploy.test.mjs']],
  [current,undefined,['tests/intake-controls-deploy.test.mjs']],[current,{...binding,candidateSource:'c'.repeat(40)},['tests/intake-controls-deploy.test.mjs']],
  [current,{...binding,head:'c'.repeat(40)},['tests/intake-controls-deploy.test.mjs']],[current,binding,[]],
  [current,binding,['src/maintenance.js']],[current,binding,['package-lock.json']],
  [current,binding,['tests/intake-controls-deploy.test.mjs','src/db/upgrades/022_coordinator_intake_controls.sql']]])
  assert.throws(()=>assertControllerSource(c,candidate,b,paths),/C7_SOURCE_CHANGED/);
});

test('promotion probes distinguish Gateway JWT rejection from direct Lambda maintenance without weakening any denial',async()=>{
 for(const stage of ['intake-upload','intake-pilot'])for(const gateway of [false,true]){
  const events=[],call=async event=>{events.push(event);return {statusCode:event.rawPath.endsWith('/forward')?(gateway?401:503):
   event.rawPath.endsWith('/submit')&&stage==='intake-upload'?503:401};};
  await promotionProbe(call,stage,scope.cycle_id,gateway);assert.equal(events.length,6);
  assert.ok(events.every(e=>!e.headers && !e.requestContext.authorizer));
  for(const openPath of ['/forward','/uploads','/submit','/me','/download','/application-options'])
   await assert.rejects(promotionProbe(async event=>event.rawPath.endsWith(openPath)?{statusCode:200}:call(event),stage,scope.cycle_id,gateway),/C7_(REVIEW_OPEN|STAGE_GATE_FAILED|ANONYMOUS_ALLOWED)/);
  await assert.rejects(promotionProbe(async event=>event.rawPath.endsWith('/forward')?{statusCode:gateway?503:401}:call(event),stage,scope.cycle_id,gateway),/C7_REVIEW_OPEN/);
 }
});
