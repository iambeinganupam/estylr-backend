// ─────────────────────────────────────────────────────────────────────────────
// Middleware: X-Request-Id injection + validation
// ─────────────────────────────────────────────────────────────────────────────
// Accepts a client-supplied request id ONLY if it parses as a UUID. Otherwise
// generates a fresh one. Prevents log-injection attacks where a malicious
// header value (with newlines or control characters) gets embedded into
// structured logs and Sentry contexts.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const accepted = typeof incoming === 'string' && UUID_REGEX.test(incoming) ? incoming : randomUUID();
  req.requestId = accepted;
  res.setHeader('X-Request-Id', accepted);
  next();
}
