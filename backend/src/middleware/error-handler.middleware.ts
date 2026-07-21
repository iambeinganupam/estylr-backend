// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Global Error Handler (BP-04)
// ─────────────────────────────────────────────────────────────────────────────
// Catches all thrown errors and formats them into the standard error envelope.
// AppError subclasses → proper status code + error body
// Unknown errors → sanitized 500 response (no stack traces to client)
// All 500s are captured in Sentry for alerting.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/node';
import { AppError } from '../lib/errors';
import { logger } from '../config/logger';
import { env } from '../config/env';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';
  const userId = req.auth?.userId;

  // ── Known operational error (AppError subclass) ──
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({
        err,
        requestId,
        method: req.method,
        url: req.originalUrl,
        userId,
        code: err.code,
      }, `[${err.code}] ${err.message}`);

      // 5xx AppErrors are still unexpected — capture in Sentry
      Sentry.withScope((scope) => {
        scope.setTag('error_code', err.code);
        scope.setTag('status_code', String(err.statusCode));
        scope.setExtra('requestId', requestId);
        scope.setExtra('url', req.originalUrl);
        if (userId) scope.setUser({ id: userId });
        Sentry.captureException(err);
      });
    } else {
      // 4xx client errors — warn level, no Sentry (expected business errors)
      logger.warn({
        code: err.code,
        requestId,
        method: req.method,
        url: req.originalUrl,
        userId,
      }, `[${err.code}] ${err.message}`);
    }

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        ...(env.NODE_ENV !== 'production' && err.statusCode >= 500
          ? { stack: err.stack }
          : {}),
      },
    });
    return;
  }

  // ── Unknown / unhandled error ──
  // CRITICAL: Never expose internal error details to the client in production.
  const errMessage = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : undefined;

  logger.error({
    err,
    stack: errStack,
    requestId,
    method: req.method,
    url: req.originalUrl,
    userId,
  }, 'Unhandled error');

  // Capture all unknown errors in Sentry with maximum context
  Sentry.withScope((scope) => {
    scope.setTag('unhandled', 'true');
    scope.setExtra('requestId', requestId);
    scope.setExtra('method', req.method);
    scope.setExtra('url', req.originalUrl);
    if (userId) scope.setUser({ id: userId });
    Sentry.captureException(err);
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      ...(env.NODE_ENV !== 'production' ? { debug: errMessage, stack: errStack } : {}),
    },
  });
}

/**
 * Wrap async route handlers to catch promise rejections.
 * Express 4 does not natively catch async errors — this wrapper does.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
