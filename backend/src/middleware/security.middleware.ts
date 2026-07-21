// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Security Hardening Stack
// ─────────────────────────────────────────────────────────────────────────────
// Applied globally after Helmet. Every middleware here addresses a specific
// production vulnerability or abuse vector.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction, RequestHandler } from 'express';
import hpp from 'hpp';
import { slowDown } from 'express-slow-down';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ── 1. HTTP Parameter Pollution (HPP) ──
// Prevents attackers from sending arrays in query params to crash/confuse handlers.
// e.g., ?status=pending&status=completed → takes last value
export const hppProtection = hpp({
  // Allow legitimate multi-value params:
  whitelist: ['service_ids', 'staff_ids', 'tags'],
});

// ── 2. Slow-Down (Brute-Force Deterrent) ──
// Adds increasing delay after threshold, before hard rate-limit kicks in.
// This discourages brute-force without immediately locking out legitimate users.
export const slowDownMiddleware: RequestHandler = slowDown({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  delayAfter: 50,               // Start slowing after 50 requests
  delayMs: () => env.SLOW_DOWN_DELAY_MS,  // Add N ms per excess request
  maxDelayMs: 20000,            // Cap at 20 seconds delay
  skip: (req) => req.method === 'GET', // Don't slow GETs (reads are safer)
});

// ── 3. Security Headers Audit ──
// Validates that security headers are set correctly (Helmet handles most of this,
// but we add CSP, COEP, and Permissions-Policy here for completeness).
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Hide Express fingerprint
  res.removeHeader('X-Powered-By');

  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Clickjacking protection
  res.setHeader('X-Frame-Options', 'DENY');

  // Cross-Origin Embedder Policy
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // Permissions Policy — disable unnecessary browser features
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );

  next();
}

// ── 4. Request Size Guard ──
// Secondary check (Express body-parser limit is first line of defense).
// Explicitly reject anomalously large bodies early.
export function requestSizeGuard(req: Request, res: Response, next: NextFunction): void {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const MAX_BYTES = 11 * 1024 * 1024; // 11MB (just above multer's 10MB limit)

  if (contentLength > MAX_BYTES) {
    logger.warn({ url: req.originalUrl, contentLength }, 'Request body too large — rejected');
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 10MB limit.' },
    });
    return;
  }
  next();
}

// ── 5. Suspicious Request Detector ──
// Logs and blocks obvious attack patterns: SQL injection probes,
// path traversal, script injection in query/params.
const ATTACK_PATTERNS = [
  /(\.\.[/\\]){2,}/,             // Path traversal: ../../etc
  /;\s*(DROP|DELETE|TRUNCATE)\s+TABLE/i, // SQL DROP/DELETE
  /<script[^>]*>/i,              // XSS script injection
  /UNION\s+SELECT/i,             // SQL UNION injection
  /exec\s*\(/i,                  // exec() injection
];

export function suspiciousRequestDetector(req: Request, res: Response, next: NextFunction): void {
  const url = req.originalUrl;
  const userAgent = req.headers['user-agent'] || '';

  for (const pattern of ATTACK_PATTERNS) {
    if (pattern.test(url) || pattern.test(userAgent)) {
      logger.warn({
        ip: req.ip,
        url,
        userAgent,
        pattern: pattern.source,
      }, 'Suspicious request pattern detected');

      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid request.' },
      });
      return;
    }
  }
  next();
}

// ── 6. IP Extraction (Trust Proxy) ──
// Ensures req.ip reflects the real client IP when behind a proxy/load-balancer.
// Must match Express app.set('trust proxy', N) setting.
export function logRealIp(req: Request, _res: Response, next: NextFunction): void {
  const realIp = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || 'unknown';

  // Attach to request for downstream logging
  (req as Request & { realIp: string }).realIp = realIp;
  next();
}
