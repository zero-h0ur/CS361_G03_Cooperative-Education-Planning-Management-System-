/**
 * Standardized HTTP response helpers and envelopes for CO-ED V3.
 * Conforms to Issue #55 shared response/error contract.
 */

const { mapError } = require('./errors');

function formatSuccess(data, pagination = null) {
  const payload = { data };
  if (pagination) {
    payload.pagination = pagination;
  }
  return payload;
}

function formatError(code, message, details = null) {
  const errorObj = { code, message };
  if (details !== null && details !== undefined) {
    errorObj.details = details;
  }
  return { error: errorObj };
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendSuccess(response, data, statusCode = 200, pagination = null, headers = {}) {
  sendJson(response, statusCode, formatSuccess(data, pagination), headers);
}

function sendError(response, errorOrStatus, code, message, headers = {}, details = null, dal = {}) {
  // Overload 1: error object passed as first param
  if (errorOrStatus instanceof Error) {
    const mapped = mapError(errorOrStatus, dal);
    sendJson(
      response,
      mapped.status,
      formatError(mapped.code, mapped.message, mapped.details),
      { ...mapped.headers, ...headers }
    );
    return;
  }

  // Overload 2: explicit statusCode, code, message
  const statusCode = Number(errorOrStatus) || 500;
  sendJson(
    response,
    statusCode,
    formatError(code || 'INTERNAL_ERROR', message || 'Internal server error.', details),
    headers
  );
}

module.exports = {
  formatSuccess,
  formatError,
  sendJson,
  sendSuccess,
  sendError
};
