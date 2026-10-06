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

function createLambdaHandler({ dal } = {}) {
  const requestHandler = createRequestHandler(dal);

  return async function lambdaHandler(event = {}) {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const request = {
      method,
      url: buildRequestUrl(event)
    };

    return new Promise((resolve, reject) => {
      let statusCode = 200;
      let headers = {};

      const response = {
        writeHead(nextStatusCode, nextHeaders = {}) {
          statusCode = nextStatusCode;
          headers = { ...headers, ...nextHeaders };
        },
        end(body = '') {
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
