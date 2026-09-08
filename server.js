import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { companies } from './data/companies.js';
import {
  parsePositiveInteger,
  resolveMaxItems,
  searchCompanies
} from './services/company-search.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultPort = 3000;

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8']
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

function isPathInsideProject(filePath) {
  return filePath === projectRoot || filePath.startsWith(`${projectRoot}${path.sep}`);
}

function isPrivatePath(pathname) {
  const firstSegment = pathname.split('/').filter(Boolean)[0] ?? '';
  const privateDirectories = new Set(['data', 'node_modules', 'services', 'test']);
  const privateRootFiles = new Set(['package-lock.json', 'package.json', 'server.js']);

  return firstSegment.startsWith('.')
    || privateDirectories.has(firstSegment)
    || privateRootFiles.has(firstSegment);
}

async function sendStaticFile(response, pathname) {
  if (isPrivatePath(pathname)) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL path' });
    return;
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  let filePath = path.resolve(projectRoot, relativePath);

  if (!isPathInsideProject(filePath)) {
    sendJson(response, 403, { error: 'Forbidden path' });
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (fileStats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    const file = await readFile(filePath);
    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase())
      ?? 'application/octet-stream';

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': contentType
    });
    response.end(file);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    console.error('Static file error:', error);
    sendJson(response, 500, { error: 'Unable to read the requested file' });
  }
}

export function createAppServer({ maxItems = process.env.MAX_ITEMS } = {}) {
  const configuredMaxItems = resolveMaxItems(maxItems);

  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (requestUrl.pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'co-ed-compute-prototype',
        config: { maxItems: configuredMaxItems }
      });
      return;
    }

    if (requestUrl.pathname === '/api/companies') {
      const result = searchCompanies(companies, {
        query: requestUrl.searchParams.get('q') ?? '',
        page: requestUrl.searchParams.get('page') ?? 1,
        maxItems: configuredMaxItems
      });

      sendJson(response, 200, result);
      return;
    }

    await sendStaticFile(response, requestUrl.pathname);
  });
}

function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isExecutedDirectly()) {
  const port = parsePositiveInteger(process.env.PORT, defaultPort);
  const server = createAppServer();

  server.listen(port, () => {
    console.log(`CO-ED local application: http://localhost:${port}`);
    console.log(`MAX_ITEMS=${resolveMaxItems(process.env.MAX_ITEMS)}`);
  });
}
