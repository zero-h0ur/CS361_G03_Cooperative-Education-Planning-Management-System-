import test from 'node:test';
import assert from 'node:assert/strict';
import {readObservedBaseline,catalogHash,PROFILE} from '../scripts/operations/present-schema-baseline.mjs';
import {readUpgradeFiles,verifyRecordedHistory,upgradeObservedSchema,VERSION,SQL_SHA256,BEFORE_CATALOG_SHA256} from '../scripts/operations/present-schema-upgrade.mjs';

test('observed metadata is checksum-pinned, schema-only and not fabricated historical SQL',()=>{
 const baseline=readObservedBaseline();
 assert.equal(baseline.migrations.length,16);assert.equal(baseline.catalog.tables.length,39);
 assert.equal(catalogHash(baseline.catalog),BEFORE_CATALOG_SHA256);
 assert.match(baseline.catalog.notice,/NOT recovered historical SQL/);
 assert.ok(!baseline.catalog.tables.some(t=>t.name==='phase1_submission_deliveries'));
});
test('old recorded names and hashes remain exact; same bytes under another name are not silently aliased',()=>{
 const history=readObservedBaseline().migrations;verifyRecordedHistory(history);
 const changed=structuredClone(history);changed[13].version='014_phase1_schedules_and_confirmations.sql';
 assert.throws(()=>verifyRecordedHistory(changed),/OBSERVED_HISTORY_MISMATCH/);
 assert.throws(()=>verifyRecordedHistory(history.slice(1)),/OBSERVED_HISTORY_MISMATCH/);
 assert.throws(()=>verifyRecordedHistory([...history,{version:'016_unreviewed.sql',checksum:'0'.repeat(64)}]),/OBSERVED_HISTORY_MISMATCH/);
 verifyRecordedHistory([...history,{version:VERSION,checksum:SQL_SHA256}],{upgraded:true});
});
test('new upgrade sources are pinned and exclude business DML/history rewrites',()=>{
 const {sql,acl}=readUpgradeFiles();
 assert.match(sql,/OBSERVED_UPGRADE_GATE_REQUIRED/);assert.match(sql,/r\.state='RETURNED'/);
 assert.doesNotMatch(sql,/r\.status='RETURNED'/);
 assert.doesNotMatch(sql,/^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE)\b/im);
 assert.doesNotMatch((sql+acl).replace(/--[^\n]*/g,''),/UPDATE\s+(?:public\.)?schema_migrations|CREATE\s+ROLE|CASCADE\b/i);
 assert.match(acl,/GRANT INSERT\(submission_id/);
});
test('context and maintenance checks reject before any SQL without ambient URL fallback',async()=>{
 let calls=0;const client={query:async()=>{calls++;}};
 await assert.rejects(upgradeObservedSchema(),/EXPLICIT_OBSERVED_UPGRADE_CONTEXT_REQUIRED/);
 await assert.rejects(upgradeObservedSchema({client,profile:'external015',expectedDatabase:'coed'}),/EXPLICIT_OBSERVED_UPGRADE_CONTEXT_REQUIRED/);
 await assert.rejects(upgradeObservedSchema({client,profile:PROFILE,expectedDatabase:'coed',mode:'apply'}),/MAINTENANCE_APPROVAL_REQUIRED/);
 assert.equal(calls,0);
});
