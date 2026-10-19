import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createPreviewServer } from '../scripts/dev-ui.mjs';
import { build } from 'esbuild';

test('loopback preview serves only allowlisted UI assets and rejects API calls', async () => {
  const { server, inputs } = await createPreviewServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/app.html?scenario=approved', '/preview.js', '/preview.css', '/resources/images/logomini.png', '/resources/images/student-campus-banner.png']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
    }
    const html = await (await fetch(base)).text();
    assert.match(html, /Local UI Preview/);
    assert.doesNotMatch(html, /runtime-config/);
    for (const path of ['/api/v3/me', '/api/v3/plans', '/runtime-config.js', '/.env', '/index.html', '/scripts/ui-preview/app.js']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + '/api/v3/plans', { method: 'POST' })).status, 405);
    assert.equal(inputs.some((path) => /amplify-client|aws-amplify|src\/frontend\/app\.js/.test(path.replaceAll('\\', '/'))), false);
    const build = await readFile(new URL('../scripts/build-frontend.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(build, /ui-preview|dev-ui|PREVIEW/);
    assert.match(build, /src\/frontend\/app.js/);
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});

test('production dependency graph contains no Preview entry point or fixtures', async () => {
  for (const entry of ['src/frontend/app.js', 'navbar-auth.js']) {
    const result = await build({ entryPoints: [entry], bundle: true, write: false,
      outfile: 'tmp/ui-preview/production-check.js', metafile: true, logLevel: 'silent' });
    assert.equal(Object.keys(result.metafile.inputs).some((path) => /ui-preview|dev-ui/.test(path)), false);
  }
});
