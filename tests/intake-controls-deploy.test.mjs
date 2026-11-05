import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stageEnvironment,promote,acknowledge} from '../scripts/operations/intake-controls-deploy.mjs';
import controls from '../src/api/services/intake-control-service.js';
const scope={student_user_id:randomUUID(),coordinator_user_id:randomUUID(),cycle_id:randomUUID()};
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
