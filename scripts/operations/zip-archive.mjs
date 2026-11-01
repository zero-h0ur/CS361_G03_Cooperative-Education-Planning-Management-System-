import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Windows uses its built-in .NET ZIP APIs; other platforms retain zip/unzip.
// Paths travel through environment variables, never interpolated PowerShell code.
function powershell(script, values) {
  return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; " + script],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...values } });
}

export function assertArchiveName(name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || /[\x00-\x1f\x7f\\:*?\[\]]/.test(name)
      || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe archive entry name: ${JSON.stringify(name)}`);
  }
  return name;
}

export function archiveFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      assertArchiveName(name);
      if (entry.isSymbolicLink()) throw new Error(`Archive input must not contain symlinks: ${name}`);
      if (entry.isDirectory()) return archiveFiles(root, name);
      if (!entry.isFile()) throw new Error(`Archive input must be a regular file: ${name}`);
      return [name];
    });
}

export function createZip(root, output, files = archiveFiles(root)) {
  root = realpathSync(root);
  output = resolve(output);
  if (existsSync(output)) throw new Error('Refusing to overwrite an existing archive.');
  const names = new Set();
  for (const name of files) {
    assertArchiveName(name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate archive entry: ${name}`);
    names.add(key);
    const path = join(root, name);
    const rel = relative(root, realpathSync(path));
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !lstatSync(path).isFile()) {
      throw new Error(`Archive file escapes its root or is not a regular file: ${name}`);
    }
  }
  if (!files.length) throw new Error('Refusing to create an empty release archive.');
  if (process.platform === 'win32') {
    powershell(`
      $archive=[IO.Compression.ZipFile]::Open($env:COED_ZIP_TARGET,[IO.Compression.ZipArchiveMode]::Create);
      try {
        foreach($name in (ConvertFrom-Json $env:COED_ZIP_NAMES)) {
          $source=[IO.Path]::Combine($env:COED_ZIP_ROOT,$name);
          [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$source,$name,[IO.Compression.CompressionLevel]::Optimal);
        }
      } finally { $archive.Dispose() }
    `, { COED_ZIP_ROOT: root, COED_ZIP_TARGET: output, COED_ZIP_NAMES: JSON.stringify(files) });
  } else {
    execFileSync('zip', ['-q', '-X', output, '--', ...files], { cwd: root });
  }
  return output;
}

export function listZipEntries(artifact) {
  const names = process.platform === 'win32'
    ? JSON.parse(powershell(`
        $archive=[IO.Compression.ZipFile]::OpenRead($env:COED_ZIP_TARGET);
        try { ConvertTo-Json -InputObject @($archive.Entries | ForEach-Object { $_.FullName }) -Compress }
        finally { $archive.Dispose() }
      `, { COED_ZIP_TARGET: resolve(artifact) }).trim())
    : execFileSync('unzip', ['-Z1', resolve(artifact)], { encoding: 'utf8' }).trim().split('\n');
  const unique = new Set();
  for (const name of names) {
    assertArchiveName(name);
    const key = name.toLowerCase();
    if (unique.has(key)) throw new Error(`Duplicate archive entry: ${name}`);
    unique.add(key);
  }
  return names;
}

export function readZipEntry(artifact, name) {
  assertArchiveName(name);
  if (process.platform !== 'win32') {
    return execFileSync('unzip', ['-p', resolve(artifact), name], { maxBuffer: 32 * 1024 * 1024 });
  }
  return Buffer.from(powershell(`
    $archive=[IO.Compression.ZipFile]::OpenRead($env:COED_ZIP_TARGET);
    try {
      $entry=$archive.GetEntry($env:COED_ZIP_ENTRY);
      if($null -eq $entry -or $entry.Length -gt 33554432) { throw 'Missing or oversized diagnostic ZIP entry.' }
      $source=$entry.Open(); $bytes=[IO.MemoryStream]::new();
      try { $source.CopyTo($bytes); [Console]::Write([Convert]::ToBase64String($bytes.ToArray())) }
      finally { $source.Dispose(); $bytes.Dispose() }
    } finally { $archive.Dispose() }
  `, { COED_ZIP_TARGET: resolve(artifact), COED_ZIP_ENTRY: name }).trim(), 'base64');
}
