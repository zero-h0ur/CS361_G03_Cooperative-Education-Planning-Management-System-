import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocuments, markdownAnchors, markdownLinks } from '../scripts/verify-doc-links.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'coed-doc-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) await writeFile(join(root, name), body);
  return root;
}

test('finds heading fragments including code, Unicode and duplicate headings', () => {
  const anchors = markdownAnchors('# Intro\n## `Code` และข้อมูล\n## Repeat\n## Repeat\n');
  assert.deepEqual([...anchors], ['intro', 'code-และข้อมูล', 'repeat', 'repeat-1']);
});

test('ignores fenced examples, inline code and comments, not real links', () => {
  const text = '```md\n[example](missing.md)\n```\n~~~\n[example](also-missing)\n~~~\n' +
    '`[literal](not-a-link)`\n<!-- [hidden](missing) -->\n[real](ok.md)\n';
  assert.deepEqual(markdownLinks(text).map(link => link.target), ['ok.md']);
});

test('handles inline images, escaped paths and explicit reference links', () => {
  const links = markdownLinks('![image](art.png) [path](file%20name.md) [Title][ref]\n[ref]: target.md#heading\n');
  assert.deepEqual(links.map(link => link.target), ['art.png', 'file%20name.md', 'target.md#heading']);
});

test('walks linked Markdown, detects broken files/anchors and terminates cycles', async t => {
  const root = await fixture(t, {
    'README.md': '# Home\n[child](child.md#details) [broken](missing.md)\n',
    'child.md': '# Details\n[home](README.md#no-such-heading)\n'
  });
  const result = await checkDocuments({ root, entries: ['README.md'] });
  assert.equal(result.documents, 2);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.some(error => error.includes('missing.md')));
  assert.ok(result.errors.some(error => error.includes('#no-such-heading')));
});

test('validates local image and space-encoded file without making HTTP requests', async t => {
  const root = await fixture(t, {
    'README.md': '# Home\n![a](art.png) [space](space%20name.md#valid) [remote](https://invalid.example/anything)\n',
    'space name.md': '# Valid\n[home](README.md#home)\n', 'art.png': 'synthetic placeholder'
  });
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  t.after(() => { globalThis.fetch = original; });
  const result = await checkDocuments({ root, entries: ['README.md'] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.documents, 2); assert.equal(result.externalLinks, 1);
});

test('rejects unsafe protocols, credential URLs, escapes and undefined references', async t => {
  const root = await fixture(t, {
    'README.md': '[bad](javascript:alert) [secret](https://user:secret@invalid.example/)\n' +
      '[escape](../outside.md) [relative](//invalid.example/path) [missing][unknown]\n'
  });
  const result = await checkDocuments({ root, entries: ['README.md'] });
  assert.equal(result.errors.length, 5);
  assert.equal(result.errors.join('\n').includes('secret@'), false);
});

test('rejects symlinks that escape the checked repository', async t => {
  const root = await fixture(t, { 'README.md': '[outside](linked.md)\n' });
  await symlink(join(root, '..'), join(root, 'linked.md'));
  const result = await checkDocuments({ root, entries: ['README.md'] });
  assert.ok(result.errors.some(error => error.includes('outside repository')));
});

test('checks the published README and its reachable repository documentation', async () => {
  const result = await checkDocuments();
  assert.deepEqual(result.errors, []);
  assert.ok(result.documents > 0);
  assert.ok(result.localLinks > 0);
});

test('delivery index covers the accepted V3 implementation gates and follow-ups', async () => {
  const index = await readFile(new URL('../docs/evidence/v3-delivery-index.md', import.meta.url), 'utf8');
  const expected = [...Array.from({ length: 30 }, (_, i) => 55 + i), 108, 110, 116, 119, 121, 124];
  for (const issue of expected) {
    assert.ok(index.includes(`/issues/${issue})`), `Missing owning issue ${issue}`);
  }
  assert.ok(index.includes('/issues/84#issuecomment-6293912895'));
  assert.ok(index.includes('/actions/runs/39386303149'));
  assert.ok(index.includes('26a90ec3fe479671683d746642496d4563c51e61'));
});
