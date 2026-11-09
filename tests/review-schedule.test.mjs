import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import maintenance from '../src/maintenance.js';
import {readReviewScheduleUpgrade} from '../scripts/operations/review-schedule-contract.mjs';
const ids=[randomUUID(),randomUUID(),randomUUID()];
test('review-only migration pins both lineages and preserves dates, constraints and permanent grants',()=>{
 const sql=readReviewScheduleUpgrade();assert.match(sql,/observed023-to024/);assert.match(sql,/confirmation_opens_at DROP NOT NULL/);
 assert.doesNotMatch(sql,/UPDATE |DELETE |GRANT |DROP CONSTRAINT/);
});
test('review-only maintenance exception is exact, staged, and requires the private scope; legacy schedule stays blocked',()=>{
 const keys=['COED_COORDINATOR_REVIEW_ENABLED','COED_INTAKE_PILOT'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const path=`/api/v4/coordinator/schedules/${ids[0]}/review`,event={rawPath:path,requestContext:{http:{method:'POST'}}};
 try{
  process.env.COED_COORDINATOR_REVIEW_ENABLED='true';
  // Scope format is the same private JSON binding as all other intake commands.
  process.env.COED_INTAKE_PILOT=JSON.stringify({student_user_id:ids[1],coordinator_user_id:ids[2],cycle_id:ids[0]});
  assert.equal(maintenance.maintenanceResponse(event,'intake-pilot'),null);
  for(const mode of ['browse','verify','intake-draft','intake-upload'])assert.equal(maintenance.maintenanceResponse(event,mode).statusCode,503);
  for(const edit of [{rawPath:path.replace('/review','')},{rawQueryString:'role=ADMIN'},{requestContext:{http:{method:'GET'}}},{rawPath:path+'/extra'}])
   assert.equal(maintenance.maintenanceResponse({...event,...edit},'intake-pilot').statusCode,503);
  delete process.env.COED_COORDINATOR_REVIEW_ENABLED;assert.equal(maintenance.maintenanceResponse(event,'intake-pilot').statusCode,503);
  process.env.COED_COORDINATOR_REVIEW_ENABLED='true';process.env.COED_INTAKE_PILOT='{}';assert.equal(maintenance.maintenanceResponse(event,'intake-pilot').statusCode,503);
 }finally{for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
});
