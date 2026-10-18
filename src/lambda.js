const { createRequestHandler } = require('./api/app');

function buildRequestUrl(event = {}) {
  const rawPath = typeof event.rawPath === 'string'
    ? event.rawPath
    : (typeof event.path === 'string' ? event.path : '/');
  const rawQueryString = typeof event.rawQueryString === 'string'
    ? event.rawQueryString
    : '';

  return rawQueryString ? `${rawPath}?${rawQueryString}` : rawPath;
}

function createLambdaHandler({ dal, ...options } = {}) {
  const requestHandler = createRequestHandler(dal, options);

  return async function lambdaHandler(event = {}) {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const request = {
      method,
      url: buildRequestUrl(event),
      headers: event.headers && typeof event.headers === 'object' ? event.headers : {},
      requestContext: event.requestContext && typeof event.requestContext === 'object'
        ? event.requestContext
        : {},
      body: event.body,
      isBase64Encoded: Boolean(event.isBase64Encoded)
    };

    return new Promise((resolve, reject) => {
      let statusCode = 200;
      let headers = {};

      const response = {
        // Mirrors Node's ServerResponse: the router stops the middleware chain once a
        // response has ended. Without this flag a 401/403 from auth/authz middleware is
        // returned to the client but the protected route handler still runs.
        writableEnded: false,
        writeHead(nextStatusCode, nextHeaders = {}) {
          if (this.writableEnded) return;
          statusCode = nextStatusCode;
          headers = { ...headers, ...nextHeaders };
        },
        end(body = '') {
          if (this.writableEnded) return;
          this.writableEnded = true;
          resolve({
            statusCode,
            headers,
            body: String(body),
            isBase64Encoded: false
          });
        }
      };

      Promise.resolve(requestHandler(request, response)).catch(reject);
    });
  };
}

const handler = createLambdaHandler();

module.exports = {
  buildRequestUrl,
  createLambdaHandler,
  handler
};
