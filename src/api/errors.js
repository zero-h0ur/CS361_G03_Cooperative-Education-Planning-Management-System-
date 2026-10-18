/**
 * Shared API Error classes and error mapping for CO-ED V3.
 * Conforms to Issue #55 response/error contract.
 */

class AppError extends Error {
  constructor(message, code = 'INTERNAL_ERROR', statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

class ValidationError extends AppError {
  constructor(message = 'Invalid request input.', details = null, code = 'VALIDATION_ERROR') {
    super(message, code, 400, details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.', code = 'UNAUTHORIZED') {
    super(message, code, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied.', code = 'FORBIDDEN') {
    super(message, code, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found.', code = 'RECORD_NOT_FOUND') {
    super(message, code, 404);
  }
}

class MethodNotAllowedError extends AppError {
  constructor(message = 'Method not allowed.', allowedMethods = ['GET'], code = 'METHOD_NOT_ALLOWED') {
    super(message, code, 405);
    this.allowedMethods = allowedMethods;
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict or concurrent update.', code = 'CONFLICT') {
    super(message, code, 409);
  }
}

class InvalidStateTransitionError extends AppError {
  constructor(message = 'Invalid state transition for the current workflow state.', code = 'INVALID_STATE_TRANSITION') {
    super(message, code, 422);
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable.', code = 'SERVICE_UNAVAILABLE') {
    super(message, code, 503);
  }
}

/**
 * Maps any error (DAL error, AppError, or generic Error) to a standardized HTTP response format.
 *
 * @param {Error} error
 * @param {object} [dal]
 * @returns {{ status: number, code: string, message: string, headers: object, details: any }}
 */
function mapError(error, dal = {}) {
  // 1. AppError and subclasses
  if (error instanceof AppError) {
    const headers = {};
    if (error instanceof MethodNotAllowedError && Array.isArray(error.allowedMethods)) {
      headers.Allow = error.allowedMethods.join(', ');
    }
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      headers,
      details: error.details
    };
  }

  // 2. DAL InvalidInputError -> 400
  if (dal.InvalidInputError && error instanceof dal.InvalidInputError) {
    return {
      status: 400,
      code: error.code || 'INVALID_INPUT',
      message: error.message,
      headers: {},
      details: null
    };
  }

  // 3. DAL RecordNotFoundError -> 404
  if (dal.RecordNotFoundError && error instanceof dal.RecordNotFoundError) {
    return {
      status: 404,
      code: error.code || 'RECORD_NOT_FOUND',
      message: error.message,
      headers: {},
      details: null
    };
  }

  // 4. DAL Database errors -> 503 or 500
  if (dal.DALError && error instanceof dal.DALError) {
    if (error.code === 'CONNECTION_ERROR' || error.code === 'SCHEMA_NOT_READY') {
      return {
        status: 503,
        code: error.code,
        message: 'Service temporarily unavailable.',
        headers: {},
        details: null
      };
    }
    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error.',
      headers: {},
      details: null
    };
  }

  // 5. Generic or unexpected errors -> 500 (sanitize internals)
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error.',
    headers: {},
    details: null
  };
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  MethodNotAllowedError,
  ConflictError,
  InvalidStateTransitionError,
  ServiceUnavailableError,
  mapError
};
