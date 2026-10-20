import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCatalogue, parseCsv, validatePayload, stableId } from '../scripts/import-companies-csv.mjs';
import { buildImportSql } from '../scripts/operations/partner-import-sql.mjs';
const raw = [
  'ลำดับ,ชื่อสถานประกอบการ/หน่วยงาน,ตำแหน่งงาน,จำนวนอัตรา,ช่องทางการติดต่อ,ระยะเวลา',
  '1,บริษัท Synthetic Nimble จำกัด,"Developer, Tester",5,PERSON_CANARY person@example.invalid,',
  'Code,ชื่อสถานประกอบการ (ภาษาไทย),ที่ตั้ง',
  'C01,บริษัท Synthetic Nimble จำกัด,นนทบุรี',
  'C02,ธนาคาร Synthetic จำกัด,Unknown location'
].join('\n');
const options = { importedAt: '2026-10-21T00:00:00.000Z' };
test('CSV parser supports quoted fields/newlines and refuses broken quotes', () => {
  assert.deepEqual(parseCsv('"a,b","c\nline"'), [['a,b', 'c\nline']]);
  assert.throws(() => parseCsv('"broken'));
});
test('import uses stable UUIDs and exact matching, not brand substring matching', () => {
  const payload = buildCatalogue(raw, options);
  assert.equal(payload.companies.length, 2);
  assert.equal(payload.positions.length, 2);
  assert.ok(payload.positions.every(p => p.company_id === payload.companies[0].id));
  assert.equal(payload.companies[1].location, null);
  assert.equal(payload.positions[0].duration, null);
  assert.equal(payload.positions[0].quota, '5');
  assert.match(stableId('test'), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(payload, buildCatalogue(raw, options));
});
test('contact columns never enter either JSON or SQL', () => {
  const payload = buildCatalogue(raw, options), sql = buildImportSql(payload);
  assert.ok(!JSON.stringify(payload).includes('PERSON_CANARY'));
  assert.ok(!sql.includes('person@example.invalid'));
  assert.ok(sql.includes('ON CONFLICT(id) DO UPDATE'));
  assert.ok(sql.includes('ROLLBACK;'));
  assert.ok(sql.includes('Private records changed'));
});
test('unmatched announcements stop instead of adding invented addresses', () => {
  assert.throws(() => buildCatalogue(raw.replace('1,บริษัท Synthetic Nimble จำกัด', '1,Other Company'), options), /Unmatched/);
});
test('rejects injected fields, markup and unsafe image URLs', () => {
  const payload = buildCatalogue(raw, options);
  payload.companies[0].email = 'not-allowed';
  assert.throws(() => validatePayload(payload));
  delete payload.companies[0].email;
  payload.positions[0].title = '<img src=x>';
  assert.throws(() => validatePayload(payload));
});
test('rejects respondent metadata at the root and contact values in location fields', () => {
  const payload = buildCatalogue(raw, options);
  payload.respondent = 'private-contact';
  assert.throws(() => validatePayload(payload));
  delete payload.respondent;
  payload.companies[0].location = 'private@example.invalid';
  assert.throws(() => validatePayload(payload));
});
test('public registry artifact has no positions, contacts, quotas or respondent data', () => {
  const catalogue = JSON.parse(fs.readFileSync(new URL('../data/companies.json', import.meta.url)));
  assert.equal(catalogue.companies.length, 103);
  assert.ok(catalogue.companies.every(c => !('positions' in c) && !('contact' in c)));
  for (const name of ['companies-data.js', 'data/raw-companies-2569.csv', 'data/form-responses-2569.csv']) {
    assert.equal(fs.existsSync(new URL('../' + name, import.meta.url)), false);
  }
});
