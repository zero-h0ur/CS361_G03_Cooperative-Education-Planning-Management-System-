import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertArchiveName, createZip, listZipEntries, readZipEntry, archiveFiles } from '../scripts/operations/zip-archive.mjs';

test('ZIP round trip works without zip/unzip on Windows, including paths with spaces and quotes', () => {
  const directory = mkdtempSync(join(tmpdir(), "coed ZIP & 'quote' -"));
  try {
    const input = join(directory, 'input');
    mkdirSync(join(input, 'src'), { recursive: true });
    const bytes = Buffer.from([0, 255, 3, 13, 10]);
    writeFileSync(join(input, 'src', 'binary.bin'), bytes);
    writeFileSync(join(input, 'hello.txt'), 'สวัสดี\n');
    writeFileSync(join(input, 'ภาษาไทย.txt'), 'Unicode path');
    const artifact = createZip(input, join(directory, 'test archive.zip'));
    assert.deepEqual(listZipEntries(artifact).sort(), ['hello.txt', 'src/binary.bin', 'ภาษาไทย.txt']);
    assert.deepEqual(readZipEntry(artifact, 'src/binary.bin'), bytes);
    assert.equal(readZipEntry(artifact, 'hello.txt').toString('utf8'), 'สวัสดี\n');
    assert.equal(readZipEntry(artifact, 'ภาษาไทย.txt').toString('utf8'), 'Unicode path');
    assert.throws(() => createZip(input, artifact), /overwrite/);
    assert.throws(() => createZip(input, join(directory, 'duplicate.zip'), ['hello.txt', 'hello.txt']), /Duplicate/);
    assert.throws(() => createZip(input, join(directory, 'empty.zip'), []), /empty/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('archive paths reject traversal, drive paths, separators and wildcard ambiguity', () => {
  for (const value of ['../file', 'src/../file', '/root', 'C:/file', 'src\\file', 'a\nfile', './file', 'src//file', 'a*', 'a[0]', '']) {
    assert.throws(() => assertArchiveName(value), /Unsafe archive/);
  }
  assert.equal(assertArchiveName('resources/logo.png'), 'resources/logo.png');
});

test('ZIP refuses symlink/junction input and files outside the allowlisted root', () => {
  const directory = mkdtempSync(join(tmpdir(), 'coed-archive-link-'));
  try {
    const input = join(directory, 'input'), outside = join(directory, 'outside');
    mkdirSync(input); mkdirSync(outside);
    writeFileSync(join(outside, 'private.txt'), 'SYNTHETIC_DO_NOT_PACKAGE');
    symlinkSync(outside, join(input, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => archiveFiles(input), /symlinks/);
    assert.throws(() => createZip(input, join(directory, 'bad.zip'), ['escape/private.txt']), /escapes its root/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
