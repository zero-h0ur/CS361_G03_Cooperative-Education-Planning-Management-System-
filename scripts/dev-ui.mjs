import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Local UI Preview | CO-ED</title><link rel="icon" href="/resources/images/logomini.png">
<link rel="stylesheet" href="/preview.css"><script src="/preview.js" defer></script></head>
<body class="authenticated-page"><aside id="previewControls" class="preview-controls" aria-label="เครื่องมือ Preview"></aside>
<div id="authenticatedApp" aria-live="polite"></div></body></html>`;

export async function createPreviewServer() {
  // In-memory build: no dist files, runtime-config or Cognito SDK initialization.
  const result = await build({ entryPoints: [resolve(workspace, 'scripts/ui-preview/app.js')],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: ['es2020'],
    outfile: resolve(workspace, 'tmp/ui-preview/preview.js'), metafile: true, logLevel: 'silent' });
  const assets = new Map(result.outputFiles.map((file) => [`/${file.path.split(/[\\/]/).at(-1)}`,
    { body: file.contents, type: file.path.endsWith('.css') ? 'text/css' : 'text/javascript' }]));
  assets.set('/', { body: html, type: 'text/html; charset=utf-8' });
  assets.set('/app.html', assets.get('/'));
  assets.set('/resources/images/logomini.png', {
    body: await readFile(resolve(workspace, 'resources/images/logomini.png')), type: 'image/png'
  });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
    }
    const asset = assets.get(new URL(request.url, 'http://localhost').pathname);
    if (!asset) { response.writeHead(404); response.end('Not available in Local UI Preview'); return; }
    response.writeHead(200, { 'Content-Type': asset.type });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  });
  return { server, inputs: Object.keys(result.metafile.inputs) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createPreviewServer();
  server.on('error', (error) => { console.error(`UI Preview: ${error.message}`); process.exitCode = 1; });
  server.listen(8081, '127.0.0.1', () => {
    console.log('Local UI Preview (synthetic data only): http://localhost:8081/app.html#/student/plan');
    console.log('Profile: http://localhost:8081/app.html#/student/profile');
    console.log('No Cognito/API configuration needed. Ctrl+C to stop.');
  });
}
