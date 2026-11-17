import { randomUUID } from 'node:crypto';
import { ServerTiming } from './ServerTiming.js';
import { DomainError, ForbiddenError, TooManyRequestsError, UnauthorizedError } from '../domain/errors.js';

export function instrumentation(metricsService) {
  return (req, res, next) => {
    const timing = new ServerTiming();
    res.locals.timing = timing;
    res.setHeader('X-Request-Id', req.get('X-Request-Id') ?? randomUUID());

    const writeHead = res.writeHead;
    res.writeHead = function writeHeadWithTiming(...args) {
      if (!res.headersSent) res.setHeader('Server-Timing', timing.header());
      return writeHead.apply(this, args);
    };

    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : (res.statusCode === 404 ? 'not-found' : 'static');
      metricsService.recordRequest({ method: req.method, route, status: res.statusCode, durationMs: timing.elapsedMs });
    });
    next();
  };
}

export function cors(allowedOrigins) {
  const patterns = allowedOrigins.map((allowed) => (allowed.includes('*')
    ? new RegExp(`^${allowed.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[^/]*')}$`)
    : allowed));
  const isAllowed = (origin) => patterns.some((pattern) => (typeof pattern === 'string' ? pattern === origin : pattern.test(origin)));

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Server-Timing,X-Request-Id,X-Cache,Retry-After,ETag');
      res.setHeader('Timing-Allow-Origin', origin);
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

export function authenticate(authService, { required = true, allowQueryToken = false } = {}) {
  return async (req, _res, next) => {
    const [scheme, headerToken] = (req.get('Authorization') ?? '').split(' ');
    const token = scheme === 'Bearer' ? headerToken : (allowQueryToken ? req.query.token : null);
    if (!token) {
      if (required) return next(new UnauthorizedError());
      return next();
    }
    try {
      req.user = await authService.authenticate(token);
      next();
    } catch (error) {
      next(required ? error : undefined);
    }
  };
}

export function requireOfficial(req, _res, next) {
  if (!req.user?.canManageIncidents()) return next(new ForbiddenError('Esta sección es solo para funcionarios de la alcaldía'));
  next();
}

export function rateLimitByIp(limiter, message = 'Demasiadas solicitudes desde tu red, espera un momento') {
  return (req, res, next) => {
    const result = limiter.consume(req.ip);
    res.setHeader('RateLimit-Remaining', result.remaining);
    if (!result.allowed) return next(new TooManyRequestsError(message, Math.ceil(result.retryAfterMs / 1000)));
    next();
  };
}

export function notFound(req, _res, next) {
  next(new DomainError(`Ruta no encontrada: ${req.method} ${req.path}`, { status: 404, code: 'NOT_FOUND' }));
}

export function errorHandler(logger = console) {
  return (error, req, res, _next) => {
    if (error instanceof TooManyRequestsError && error.retryAfterSeconds) res.setHeader('Retry-After', error.retryAfterSeconds);

    let status = error.status ?? 500;
    let body = { code: error.code ?? 'INTERNAL_ERROR', message: error.message, details: error.details };
    if (error.type === 'entity.too.large') {
      status = 413;
      body = { code: 'PAYLOAD_TOO_LARGE', message: 'El archivo o los datos enviados son demasiado grandes' };
    } else if (error.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'INVALID_JSON', message: 'El cuerpo de la petición no es JSON válido' };
    } else if (!(error instanceof DomainError)) {
      logger.error(`[${req.method} ${req.originalUrl}]`, error);
      status = 500;
      body = { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' };
    }
    res.status(status).json({ error: body });
  };
}
