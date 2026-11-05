import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import shared from '../src/shared/intake-control.js';
import service from '../src/api/services/intake-control-service.js';
import maintenance from '../src/maintenance.js';
import {readIntakeControlsSql} from '../scripts/operations/intake-controls-contract.mjs';
const now='2026-11-05T12:00:00.000Z',base={version:2,mode:'MANUAL_OPEN',opens_at:now,closes_at:null};
test('manual intake is explicit, unbounded and independent of the legacy finite evaluator',()=>{
 assert.equal(shared.evaluateIntake(base,now).is_open,true);
 assert.equal(shared.evaluateIntake(base,'2036-11-05T12:00:00Z').is_open,true);
 assert.equal(shared.evaluateIntake(base,now).closes_at,null);
 for(const bad of [null,{}, {...base,version:0},{...base,opens_at:null},{...base,closes_at:now},{...base,mode:'INVALID'}]){
  assert.equal(shared.evaluateIntake(bad,now).is_open,false);assert.equal(shared.evaluateIntake(bad,now).reason,'UNCONFIGURED');}
 assert.equal(shared.evaluateIntake({...base,mode:'CLOSED',opens_at:null},now).reason,'CLOSED');
});
test('scheduled start is inclusive, close exclusive, invalid intervals never mean manual open',()=>{
 const c={...base,mode:'SCHEDULED',closes_at:'2026-11-05T13:00:00Z'};
 assert.equal(shared.evaluateIntake(c,'2026-11-05T11:59:59.999Z').reason,'UPCOMING');assert.equal(shared.evaluateIntake(c,now).is_open,true);
 assert.equal(shared.evaluateIntake(c,c.closes_at).reason,'EXPIRED');assert.equal(shared.evaluateIntake({...c,closes_at:now},now).reason,'UNCONFIGURED');
});
test('commands reject invalid dates/offsets/extra fields and distinguish no deadline from missing configuration',()=>{
 const c={operation_id:randomUUID(),expected_version:1,mode:'SCHEDULED',opens_at:'2028-02-29T09:00+07:00',closes_at:'2028-03-01T09:00+07:00'};
 assert.equal(service.input(c).opens_at,'2028-02-29T02:00:00.000Z');
 for(const bad of ['2026-02-30T09:00+07:00','2028-02-29T24:00+07:00','2028-02-29T09:00+14:01','2028-02-29T09:00','2028-02-29T09:00+99:00'])assert.throws(()=>service.input({...c,opens_at:bad}),e=>e.statusCode===400);
 assert.throws(()=>service.input({...c,closes_at:c.opens_at}),e=>e.statusCode===400);
 assert.throws(()=>service.input({...c,mode:'MANUAL_OPEN'}),e=>e.statusCode===400);
 assert.deepEqual(service.input({operation_id:randomUUID(),expected_version:2,mode:'MANUAL_OPEN'}),{mode:'MANUAL_OPEN',opens_at:null,closes_at:null});
 assert.throws(()=>service.input({...c,coordinator_id:randomUUID()}),e=>e.statusCode===400);
});
test('maintenance grants only bounded controls and schedule reads, not new review/Committee or TU staff access',()=>{
 const id=randomUUID(),path='/api/v4/coordinator/intake/'+id;
 const call=(method,rawPath=path,query='')=>maintenance.maintenanceResponse({rawPath,rawQueryString:query,requestContext:{http:{method}}},'intake-pilot');
 assert.equal(call('GET'),null);assert.equal(call('POST'),null);
 for(const method of ['PATCH','PUT','DELETE'])assert.equal(call(method).statusCode,503);
 assert.equal(call('POST',path,'force=true').statusCode,503);
 assert.equal(call('POST','/api/v4/coordinator/schedules/'+id).statusCode,503);
 assert.equal(call('POST','/api/v4/coordinator/applications/'+id+'/forward').statusCode,503);
 assert.ok(readIntakeControlsSql().includes('phase1_controlled_submission_guard'));
});
