/**
 * Lightweight modular router for CO-ED V3 API.
 * Provides route dispatching, parameter parsing, and middleware extension points.
 */

const { NotFoundError, MethodNotAllowedError } = require('./errors');
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
   * Registers a route with method, pattern (RegExp or string), and handler.
   */
  register(method, pattern, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('Route handler must be a function.');
    }
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      handler
    });
    return this;
  }

  get(pattern, handler) {
    return this.register('GET', pattern, handler);
  }

  post(pattern, handler) {
    return this.register('POST', pattern, handler);
  }

  put(pattern, handler) {
    return this.register('PUT', pattern, handler);
  }

  patch(pattern, handler) {
    return this.register('PATCH', pattern, handler);
  }

  delete(pattern, handler) {
    return this.register('DELETE', pattern, handler);
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
        throw new NotFoundError('Route not found.', 'ROUTE_NOT_FOUND');
      }

      // 2. Check if any route matches the requested HTTP method
      const allowedMethods = Array.from(new Set(matchedRoutes.map(m => m.route.method)));
      const methodMatch = matchedRoutes.find(m => m.route.method === method);

      if (!methodMatch) {
        throw new MethodNotAllowedError('Method not allowed.', allowedMethods, 'METHOD_NOT_ALLOWED');
      }

      // 3. Execute middlewares
      for (const middleware of this.middlewares) {
        await middleware(request, response, { pathname, url, method, dal });
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
    const { ValidationError } = require('./errors');
    throw new ValidationError('Invalid path parameter.');
  }
}

function assertAllowedQueryParameters(searchParams, allowed, InvalidInputError) {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      if (InvalidInputError) {
        throw new InvalidInputError(`Unsupported query parameter: ${key}.`);
      }
      const { ValidationError } = require('./errors');
      throw new ValidationError(`Unsupported query parameter: ${key}.`);
    }
  }
}

module.exports = {
  Router,
  decodePathParameter,
  assertAllowedQueryParameters
};
