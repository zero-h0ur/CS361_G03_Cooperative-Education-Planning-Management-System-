import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const workspace = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(workspace, 'tmp/frontend-test-modules');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [
    resolve(workspace, 'src/frontend/auth/auth-errors.js'),
    resolve(workspace, 'src/frontend/auth/session-client.js'),
    resolve(workspace, 'src/frontend/student/profile-client.js'),
    resolve(workspace, 'src/frontend/student/student-dashboard-view.js'),
    resolve(workspace, 'src/frontend/student/plan-submission-client.js'),
    resolve(workspace, 'src/frontend/student/student-plan-view.js'),
    resolve(workspace, 'src/frontend/shell-app.js')
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  outdir: outputDirectory,
  outExtension: { '.js': '.cjs' },
  logLevel: 'silent'
});
