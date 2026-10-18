/**
 * Lightweight modular router for CO-ED V3 API.
 * Provides route dispatching, parameter parsing, and middleware extension points.
 */

const { NotFoundError, MethodNotAllowedError, ValidationError } = require('./errors');
const { sendError } = require('./response');

class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  /**
   * Registers a middleware function to run before route handlers.
   * Signature: async (request, response, context) => void
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new TypeError('Middleware must be a function.');
    }
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Registers a route with method, pattern (RegExp or string), optional
   * route-scoped middlewares, and a final handler.
   * Example: router.get('/api/v3/me', authenticate, handler)
   */
  register(method, pattern, ...handlers) {
    const handler = handlers.pop();
    if (typeof handler !== 'function') {
      throw new TypeError('Route handler must be a function.');
    }
    if (handlers.some(middleware => typeof middleware !== 'function')) {
      throw new TypeError('Middleware must be a function.');
    }
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      middlewares: handlers,
      handler
    });
    return this;
  }

  get(pattern, ...handlers) {
    return this.register('GET', pattern, ...handlers);
  }

  post(pattern, ...handlers) {
    return this.register('POST', pattern, ...handlers);
  }

  put(pattern, ...handlers) {
    return this.register('PUT', pattern, ...handlers);
  }

  patch(pattern, ...handlers) {
    return this.register('PATCH', pattern, ...handlers);
  }

  delete(pattern, ...handlers) {
    return this.register('DELETE', pattern, ...handlers);
  }

  /**
   * Finds matching routes for a given pathname.
   *
   * @param {string} pathname
   * @returns {Array<{ route: object, params: Array<string> }>}
   */
  findMatches(pathname) {
    const matches = [];
    for (const route of this.routes) {
      if (typeof route.pattern === 'string') {
        if (route.pattern === pathname) {
          matches.push({ route, params: [] });
        }
      } else if (route.pattern instanceof RegExp) {
        const match = pathname.match(route.pattern);
        if (match) {
          matches.push({ route, params: match.slice(1) });
        }
      }
    }
    return matches;
  }

  /**
   * Dispatches an incoming HTTP request.
   *
   * @param {object} request
   * @param {object} response
   * @param {object} [dal]
   */
  async handle(request, response, dal = {}) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = url.pathname.length > 1
        ? url.pathname.replace(/\/$/, '')
        : url.pathname;
      const method = (request.method || 'GET').toUpperCase();

      // 1. Find matching routes by path
      const matchedRoutes = this.findMatches(pathname);

      if (matchedRoutes.length === 0) {
        // Preserve V2 behavior: non-GET requests to unknown paths return 405 with Allow: GET.
        if (method !== 'GET') {
          throw new MethodNotAllowedError('Method not allowed.', ['GET'], 'METHOD_NOT_ALLOWED');
        }
        throw new NotFoundError('Route not found.', 'ROUTE_NOT_FOUND');
      }

      // 2. Check if any route matches the requested HTTP method
      const allowedMethods = Array.from(new Set(matchedRoutes.map(m => m.route.method)));
      const methodMatch = matchedRoutes.find(m => m.route.method === method);

      if (!methodMatch) {
        throw new MethodNotAllowedError('Method not allowed.', allowedMethods, 'METHOD_NOT_ALLOWED');
      }

      // 3. Execute global middlewares, then route-scoped middlewares (e.g. authentication)
      const middlewares = [...this.middlewares, ...methodMatch.route.middlewares];
      for (const middleware of middlewares) {
        await middleware(request, response, {
          pathname,
          url,
          method,
          params: methodMatch.params,
          dal
        });
        // If middleware ended the response (e.g. auth failure), stop
        if (response.writableEnded) {
          return;
        }
      }

      // 4. Execute route handler
      await methodMatch.route.handler(request, response, {
        pathname,
        url,
        params: methodMatch.params,
        dal
      });
    } catch (error) {
      sendError(response, error, null, null, {}, null, dal);
    }
  }
}

function decodePathParameter(value, InvalidInputError) {
  try {
    return decodeURIComponent(value);
  } catch {
    if (InvalidInputError) {
      throw new InvalidInputError('Invalid path parameter.');
    }
    throw new ValidationError('Invalid path parameter.');
  }
}

function assertAllowedQueryParameters(searchParams, allowed, InvalidInputError) {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      if (InvalidInputError) {
        throw new InvalidInputError(`Unsupported query parameter: ${key}.`);
      }
      throw new ValidationError(`Unsupported query parameter: ${key}.`);
    }
  }
}

const MAX_JSON_BODY_BYTES = 64 * 1024;

function parseRawJsonObject(rawText) {
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new ValidationError('Request body must be a valid JSON object.');
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return parsed;
}

async function parseJsonBody(request) {
  if (!request || typeof request !== 'object') {
    throw new ValidationError('Request body must be a valid JSON object.');
  }

  if (request.body !== undefined) {
    if (request.body === null) {
      throw new ValidationError('Request body must be a valid JSON object.');
    }
    if (typeof request.body === 'string') {
      const text = request.isBase64Encoded
        ? Buffer.from(request.body, 'base64').toString('utf8')
        : request.body;
      return parseRawJsonObject(text);
    }
    if (Buffer.isBuffer(request.body)) {
      return parseRawJsonObject(request.body.toString('utf8'));
    }
    if (typeof request.body === 'object' && !Array.isArray(request.body)) {
      return request.body;
    }
    throw new ValidationError('Request body must be a JSON object.');
  }

  if (typeof request.on === 'function') {
    const raw = await new Promise((resolve, reject) => {
      const chunks = [];
      let totalBytes = 0;
      request.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        totalBytes += buf.length;
        if (totalBytes > MAX_JSON_BODY_BYTES) {
          reject(new ValidationError('Request body exceeds maximum allowed size.'));
          return;
        }
        chunks.push(buf);
      });
      request.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      request.on('error', reject);
    });
    return parseRawJsonObject(raw);
  }

  throw new ValidationError('Request body is required.');
}

module.exports = {
  Router,
  decodePathParameter,
  assertAllowedQueryParameters,
  parseJsonBody
};
