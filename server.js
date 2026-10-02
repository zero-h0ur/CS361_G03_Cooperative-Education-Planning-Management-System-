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
import {
  queryStudents,
  getStudentById,
  queryCompanies,
  getCompanyById,
  queryPositions,
  getPositionById,
  queryCycles,
  getActiveCycle,
  getCycleById,
  queryPlans,
  getPlanById,
  createPlan,
  updatePlanStatus,
  getSystemSummary
} from './services/dynamic-data-service.js';

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
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf-8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        request.destroy();
        reject(new Error('Payload too large'));
      }
    });
    request.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    request.on('error', reject);
  });
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
    const pathname = requestUrl.pathname;
    const method = request.method ?? 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      response.end();
      return;
    }

    // Health Check
    if (pathname === '/api/health') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      sendJson(response, 200, {
        status: 'ok',
        service: 'co-ed-v2-system',
        version: '2.0.0',
        config: { maxItems: configuredMaxItems }
      });
      return;
    }

    // Legacy V1 Company Search Endpoint
    if (pathname === '/api/companies') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const result = searchCompanies(companies, {
        query: requestUrl.searchParams.get('q') ?? '',
        page: requestUrl.searchParams.get('page') ?? 1,
        maxItems: configuredMaxItems
      });
      sendJson(response, 200, result);
      return;
    }

    // -------------------------------------------------------------
    // V2 DYNAMIC DATA REST API
    // -------------------------------------------------------------

    // 1. Dashboard summary
    if (pathname === '/api/v2/summary' && method === 'GET') {
      sendJson(response, 200, getSystemSummary());
      return;
    }

    // 2. Students endpoints
    if (pathname === '/api/v2/students' && method === 'GET') {
      const result = queryStudents({
        query: requestUrl.searchParams.get('q') ?? '',
        eligibility: requestUrl.searchParams.get('eligibility') ?? 'all',
        year: requestUrl.searchParams.get('year') ?? 'all',
        curriculum: requestUrl.searchParams.get('curriculum') ?? 'all',
        major: requestUrl.searchParams.get('major') ?? 'all',
        page: requestUrl.searchParams.get('page') ?? 1,
        pageSize: requestUrl.searchParams.get('pageSize') ?? configuredMaxItems,
        sortBy: requestUrl.searchParams.get('sortBy') ?? 'name',
        sortOrder: requestUrl.searchParams.get('sortOrder') ?? 'asc'
      });
      sendJson(response, 200, result);
      return;
    }

    const studentMatch = pathname.match(/^\/api\/v2\/students\/([^/]+)$/);
    if (studentMatch && method === 'GET') {
      const studentId = studentMatch[1];
      const student = getStudentById(studentId);
      if (!student) {
        sendJson(response, 404, { error: `ไม่พบข้อมูลนักศึกษารหัส ${studentId}` });
        return;
      }
      sendJson(response, 200, student);
      return;
    }

    // 3. Companies endpoints (V2 enriched)
    if (pathname === '/api/v2/companies' && method === 'GET') {
      const result = queryCompanies({
        query: requestUrl.searchParams.get('q') ?? '',
        category: requestUrl.searchParams.get('category') ?? 'all',
        location: requestUrl.searchParams.get('location') ?? 'all',
        hasMOU: requestUrl.searchParams.get('hasMOU') ?? 'all',
        page: requestUrl.searchParams.get('page') ?? 1,
        pageSize: requestUrl.searchParams.get('pageSize') ?? configuredMaxItems,
        sortBy: requestUrl.searchParams.get('sortBy') ?? 'name',
        sortOrder: requestUrl.searchParams.get('sortOrder') ?? 'asc'
      });
      sendJson(response, 200, result);
      return;
    }

    const companyMatch = pathname.match(/^\/api\/v2\/companies\/([^/]+)$/);
    if (companyMatch && method === 'GET') {
      const companyId = companyMatch[1];
      const company = getCompanyById(companyId);
      if (!company) {
        sendJson(response, 404, { error: `ไม่พบข้อมูลสถานประกอบการรหัส ${companyId}` });
        return;
      }
      sendJson(response, 200, company);
      return;
    }

    // 4. Positions endpoints
    if (pathname === '/api/v2/positions' && method === 'GET') {
      const result = queryPositions({
        query: requestUrl.searchParams.get('q') ?? '',
        field: requestUrl.searchParams.get('field') ?? 'all',
        workMode: requestUrl.searchParams.get('workMode') ?? 'all',
        companyId: requestUrl.searchParams.get('companyId') ?? 'all',
        status: requestUrl.searchParams.get('status') ?? 'all',
        minStipend: requestUrl.searchParams.get('minStipend') ?? 0,
        page: requestUrl.searchParams.get('page') ?? 1,
        pageSize: requestUrl.searchParams.get('pageSize') ?? configuredMaxItems,
        sortBy: requestUrl.searchParams.get('sortBy') ?? 'title',
        sortOrder: requestUrl.searchParams.get('sortOrder') ?? 'asc'
      });
      sendJson(response, 200, result);
      return;
    }

    const positionMatch = pathname.match(/^\/api\/v2\/positions\/([^/]+)$/);
    if (positionMatch && method === 'GET') {
      const positionId = positionMatch[1];
      const position = getPositionById(positionId);
      if (!position) {
        sendJson(response, 404, { error: `ไม่พบข้อมูลตำแหน่งงานรหัส ${positionId}` });
        return;
      }
      sendJson(response, 200, position);
      return;
    }

    // 5. Cycles endpoints
    if (pathname === '/api/v2/cycles' && method === 'GET') {
      const result = queryCycles({
        status: requestUrl.searchParams.get('status') ?? 'all',
        academicYear: requestUrl.searchParams.get('academicYear') ?? 'all',
        page: requestUrl.searchParams.get('page') ?? 1,
        pageSize: requestUrl.searchParams.get('pageSize') ?? 10
      });
      sendJson(response, 200, result);
      return;
    }

    if (pathname === '/api/v2/cycles/active' && method === 'GET') {
      sendJson(response, 200, getActiveCycle());
      return;
    }

    const cycleMatch = pathname.match(/^\/api\/v2\/cycles\/([^/]+)$/);
    if (cycleMatch && method === 'GET') {
      const cycleId = cycleMatch[1];
      const cycle = getCycleById(cycleId);
      if (!cycle) {
        sendJson(response, 404, { error: `ไม่พบข้อมูลรอบสหกิจรหัส ${cycleId}` });
        return;
      }
      sendJson(response, 200, cycle);
      return;
    }

    // 6. Plans endpoints (GET, POST, PATCH)
    if (pathname === '/api/v2/plans' && method === 'GET') {
      const result = queryPlans({
        query: requestUrl.searchParams.get('q') ?? '',
        status: requestUrl.searchParams.get('status') ?? 'all',
        cycleId: requestUrl.searchParams.get('cycleId') ?? 'all',
        companyId: requestUrl.searchParams.get('companyId') ?? 'all',
        studentId: requestUrl.searchParams.get('studentId') ?? 'all',
        page: requestUrl.searchParams.get('page') ?? 1,
        pageSize: requestUrl.searchParams.get('pageSize') ?? configuredMaxItems,
        sortBy: requestUrl.searchParams.get('sortBy') ?? 'submittedAt',
        sortOrder: requestUrl.searchParams.get('sortOrder') ?? 'desc'
      });
      sendJson(response, 200, result);
      return;
    }

    if (pathname === '/api/v2/plans' && method === 'POST') {
      try {
        const body = await readJsonBody(request);
        const newPlan = createPlan(body);
        sendJson(response, 201, {
          message: 'ยื่นแผนสหกิจศึกษาสำเร็จ',
          plan: newPlan
        });
      } catch (error) {
        sendJson(response, 400, { error: error?.message ?? 'ข้อมูลไม่ถูกต้อง' });
      }
      return;
    }

    const planMatch = pathname.match(/^\/api\/v2\/plans\/([^/]+)$/);
    if (planMatch) {
      const planId = planMatch[1];

      if (method === 'GET') {
        const plan = getPlanById(planId);
        if (!plan) {
          sendJson(response, 404, { error: `ไม่พบข้อมูลแผนสหกิจรหัส ${planId}` });
          return;
        }
        sendJson(response, 200, plan);
        return;
      }

      if (method === 'PATCH') {
        try {
          const body = await readJsonBody(request);
          const updatedPlan = updatePlanStatus(planId, body);
          sendJson(response, 200, {
            message: 'อัปเดตสถานะแผนสหกิจศึกษาเรียบร้อย',
            plan: updatedPlan
          });
        } catch (error) {
          sendJson(response, 400, { error: error?.message ?? 'ไม่สามารถอัปเดตได้' });
        }
        return;
      }
    }

    // Static Files for GET
    if (method === 'GET') {
      await sendStaticFile(response, pathname);
      return;
    }

    // Any other method not handled
    response.setHeader('Allow', 'GET, POST, PATCH, OPTIONS');
    sendJson(response, 405, { error: 'Method not allowed' });
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
    console.log(`CO-ED V2 local application: http://localhost:${port}`);
    console.log(`MAX_ITEMS=${resolveMaxItems(process.env.MAX_ITEMS)}`);
  });
}
