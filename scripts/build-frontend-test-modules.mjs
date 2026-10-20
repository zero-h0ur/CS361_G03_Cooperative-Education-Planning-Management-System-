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
    resolve(workspace, 'src/frontend/auth/auth-storage.js'),
    resolve(workspace, 'src/frontend/public-navbar.js'),
    resolve(workspace, 'src/frontend/directory-client.js'),
    resolve(workspace, 'src/frontend/student/profile-client.js'),
    resolve(workspace, 'src/frontend/student/student-dashboard-view.js'),
    resolve(workspace, 'src/frontend/student/plan-submission-client.js'),
    resolve(workspace, 'src/frontend/student/student-plan-view.js'),
    resolve(workspace, 'src/frontend/student/plan-editor-view.js'),
    resolve(workspace, 'src/frontend/advisor/advisor-client.js'),
    resolve(workspace, 'src/frontend/advisor/advisor-views.js'),
    resolve(workspace, 'src/frontend/staff/staff-review-client.js'),
    resolve(workspace, 'src/frontend/staff/staff-review-views.js'),
    resolve(workspace, 'src/frontend/routes.js'),
    resolve(workspace, 'src/frontend/staff/staff-client.js'),
    resolve(workspace, 'src/frontend/staff/staff-route-state.js'),
    resolve(workspace, 'src/frontend/staff/staff-student-management-view.js'),
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

await build({
  entryPoints: [resolve(workspace, 'src/frontend/auth/amplify-client.js')],
  bundle: true, platform: 'node', format: 'cjs', target: ['node18'],
  external: ['aws-amplify', 'aws-amplify/*'],
  outfile: resolve(outputDirectory, 'auth/amplify-client.cjs'), logLevel: 'silent'
});

await build({
  entryPoints: [resolve(workspace, 'scripts/ui-preview/fixtures.js')],
  bundle: true, platform: 'node', format: 'cjs', target: ['node18'],
  outfile: resolve(outputDirectory, 'preview-fixtures.cjs'), logLevel: 'silent'
});
