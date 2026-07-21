// ─────────────────────────────────────────────────────────────────────────────
// Sentry — Error Monitoring & Performance Tracing
// ─────────────────────────────────────────────────────────────────────────────
// MUST be imported FIRST in server.ts before any other imports.
// Sentry instruments the Node.js runtime at startup.
// ─────────────────────────────────────────────────────────────────────────────

import * as Sentry from '@sentry/node';
import { env } from './env';

/**
 * Initialise Sentry. Call this at the very top of server.ts.
 * In non-production or when SENTRY_DSN is unset, Sentry is a no-op.
 */
export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    return; // No DSN → skip silently (dev / CI)
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_VERSION,

    // ── Integrations ──
    integrations: [],

    // ── Sampling ──
    // Capture 100% of transactions in non-prod; tune down in production
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: 0,

    // ── PII Scrubbing ──
    // Never send passwords, tokens, or card numbers to Sentry
    beforeSend(event) {
      scrubSensitiveData(event);
      return event;
    },

    // ── Ignore noise ──
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
    ],
  });
}

/**
 * Attach Sentry request handler — must be FIRST middleware in Express.
 */
export { Sentry };

/**
 * Capture an error manually (for non-thrown errors).
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    Sentry.captureException(error);
  });
}

/**
 * Set authenticated user context on Sentry scope.
 * Call after auth middleware resolves req.auth.
 */
export function setSentryUser(userId: string, role: string): void {
  Sentry.setUser({ id: userId, role });
}

// ── Private: PII scrubber ──
const SENSITIVE_KEYS = [
  'password', 'new_password', 'token', 'access_token', 'refresh_token',
  'otp_code', 'reset_token', 'stripe_payment_method_id', 'payment_gateway_ref',
  'account_number', 'ifsc_code', 'id_token', 'authorization',
];

function scrubSensitiveData(event: Sentry.ErrorEvent): void {
  if (event.request?.data) {
    scrubObject(event.request.data as Record<string, unknown>);
  }
  if (event.request?.cookies) {
    scrubObject(event.request.cookies as Record<string, unknown>);
  }
  if (event.request?.headers) {
    scrubObject(event.request.headers as Record<string, unknown>);
  }
}

function scrubObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEYS.some(s => key.toLowerCase().includes(s))) {
      obj[key] = '[Filtered]';
    } else if (obj[key] && typeof obj[key] === 'object') {
      scrubObject(obj[key] as Record<string, unknown>);
    }
  }
}
