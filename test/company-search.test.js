import test from 'node:test';
import assert from 'node:assert/strict';

import { companies } from '../data/companies.js';
import {
  normalizeQuery,
  resolveMaxItems,
  searchCompanies
} from '../services/company-search.js';

test('normalizeQuery trims input and ignores English letter case', () => {
  assert.equal(normalizeQuery('  aGoDa  '), 'agoda');
});

test('searchCompanies searches by company name and position', () => {
  const byName = searchCompanies(companies, { query: 'G-Able', maxItems: 20 });
  const byPosition = searchCompanies(companies, { query: 'วิศวกรซอฟต์แวร์', maxItems: 20 });

  assert.deepEqual(byName.items.map(({ id }) => id), ['g-able']);
  assert.ok(byPosition.items.length >= 3);
  assert.ok(byPosition.items.every(({ position }) => position === 'วิศวกรซอฟต์แวร์'));
});

test('searchCompanies returns an empty page when no company matches', () => {
  const result = searchCompanies(companies, { query: 'ไม่มีบริษัทนี้' });

  assert.deepEqual(result.items, []);
  assert.equal(result.pagination.total, 0);
  assert.equal(result.pagination.hasNextPage, false);
});

test('MAX_ITEMS controls the number of results per page', () => {
  const firstPage = searchCompanies(companies, { maxItems: 3, page: 1 });
  const secondPage = searchCompanies(companies, { maxItems: 3, page: 2 });

  assert.equal(firstPage.items.length, 3);
  assert.equal(firstPage.pagination.pageSize, 3);
  assert.equal(firstPage.pagination.hasNextPage, true);
  assert.notDeepEqual(firstPage.items, secondPage.items);
});

test('resolveMaxItems falls back for invalid values and caps large values', () => {
  assert.equal(resolveMaxItems('invalid'), 6);
  assert.equal(resolveMaxItems('0'), 6);
  assert.equal(resolveMaxItems('500'), 50);
});
