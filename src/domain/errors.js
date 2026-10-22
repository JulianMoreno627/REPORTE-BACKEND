export class DomainError extends Error {
  constructor(message, { status = 400, code = 'DOMAIN_ERROR', details } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(message, details) {
    super(message, { status: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Inicia sesión para continuar') {
    super(message, { status: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'No tienes permiso para realizar esta acción') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends DomainError {
  constructor(resource = 'Recurso') {
    super(`${resource} no encontrado`, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends DomainError {
  constructor(message, code = 'CONFLICT') {
    super(message, { status: 409, code });
  }
}

export class TooManyRequestsError extends DomainError {
  constructor(message, retryAfterSeconds) {
    super(message, { status: 429, code: 'TOO_MANY_REQUESTS' });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
