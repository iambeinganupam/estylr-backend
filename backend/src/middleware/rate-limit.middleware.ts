// ─────────────────────────────────────────────────────────────────────────────
// Middleware: Rate Limiting — Per-endpoint limits
// ─────────────────────────────────────────────────────────────────────────────
// Rate limits per API Bible §19:
// Auth: 5/60s | Booking intents: 3/60s | Reviews: 1/60s
// Discovery: 60/60s | Media upload: 10/60s
// Authenticated general: 120/60s | Anonymous: 30/60s
// ─────────────────────────────────────────────────────────────────────────────

import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Factory: create a rate limiter with custom settings.
 */
function createLimiter(options: { windowMs?: number; max: number; message?: string }) {
  return rateLimit({
    windowMs: options.windowMs ?? env.RATE_LIMIT_WINDOW_MS,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: options.message ?? 'Too many requests. Please try again later.',
      },
    },
    keyGenerator: (req) => {
      // Use authenticated user ID if available, otherwise IP
      return req.auth?.userId ?? req.ip ?? 'unknown';
    },
  });
}

// ── Pre-built rate limiters for specific endpoint groups ──

/** Auth endpoints: 5 requests per 60 seconds */
export const authRateLimiter = createLimiter({
  max: 5,
  message: 'Too many authentication attempts. Please wait before trying again.',
});

/** Booking intent creation: 3 per 60 seconds */
export const bookingRateLimiter = createLimiter({
  max: 3,
  message: 'Too many booking attempts. Please wait before trying again.',
});

/** Review submission: 1 per 60 seconds */
export const reviewRateLimiter = createLimiter({
  max: 1,
  message: 'Please wait before submitting another review.',
});

/** Discovery search: 60 per 60 seconds (allow fast map panning) */
export const searchRateLimiter = createLimiter({
  max: 60,
});

/** Media upload: 10 per 60 seconds */
export const uploadRateLimiter = createLimiter({
  max: 10,
  message: 'Too many upload requests. Please wait.',
});

/** Authenticated general: 120 per 60 seconds */
export const authenticatedRateLimiter = createLimiter({
  max: env.RATE_LIMIT_MAX_REQUESTS,
});

/** Anonymous general: 30 per 60 seconds */
export const anonymousRateLimiter = createLimiter({
  max: 30,
});
