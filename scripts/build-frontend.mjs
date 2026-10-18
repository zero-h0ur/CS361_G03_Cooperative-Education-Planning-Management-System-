import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const workspace = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(workspace, 'dist');
const staticFiles = [
  'index.html',
  'requirements.html',
  'company-directory.html',
  'faq.html',
  'style.css',
  'runtime-config.js',
  'company-directory.js',
  'company-directory-helpers.js',
  'app.html'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(resolve(outputDirectory, 'assets'), { recursive: true });

await Promise.all([
  ...staticFiles.map((file) => cp(resolve(workspace, file), resolve(outputDirectory, file))),
  cp(resolve(workspace, 'resources'), resolve(outputDirectory, 'resources'), {
    recursive: true
  })
]);

await build({
  entryPoints: [resolve(workspace, 'src/frontend/app.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: resolve(outputDirectory, 'assets/authenticated-shell.js'),
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
  legalComments: 'none',
  logLevel: 'info'
});
