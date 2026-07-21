// ─────────────────────────────────────────────────────────────────────────────
// Structured Logger — Pino (Production-Grade)
// ─────────────────────────────────────────────────────────────────────────────
// • JSON output in production → ships to any log aggregator (Datadog, ELK, etc.)
// • PII redaction — tokens, passwords, OTPs never written to logs
// • Request correlation via requestId
// • Performance timing via res.responseTime
// ─────────────────────────────────────────────────────────────────────────────

import pino from 'pino';
import { env } from './env';

const isProduction = env.NODE_ENV === 'production';

// Paths to redact automatically from all log entries
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.new_password',
  'req.body.otp_code',
  'req.body.reset_token',
  'req.body.id_token',
  'req.body.account_number',
  'req.body.ifsc_code',
  'req.body.stripe_payment_method_id',
  'req.body.payment_gateway_ref',
  'res.headers["set-cookie"]',
  // Custom env-defined paths
  ...env.LOG_REDACT_PATHS.split(',').map((p) => p.trim()).filter(Boolean),
];

export const logger = pino({
  level: env.LOG_LEVEL,

  // ── PII Redaction ──
  redact: {
    paths: REDACT_PATHS,
    censor: '[Redacted]',
  },

  // ── Serializers ──
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },

  ...(isProduction
    ? {
        // ── Production: JSON for log aggregation ──
        formatters: {
          level: (label) => ({ level: label }),
          bindings: (bindings) => ({
            pid: bindings['pid'],
            host: bindings['hostname'],
            env: env.NODE_ENV,
            version: env.APP_VERSION,
          }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        // Base fields on every log entry
        base: {
          service: 'kshuri-api',
          version: env.APP_VERSION,
          environment: env.NODE_ENV,
        },
      }
    : {
        // ── Development: pretty-print ──
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: '{requestId} {msg}',
          },
        },
      }),
});

/**
 * Child logger with request-scoped bindings (requestId, userId, tenantId).
 * Creates a lightweight child that inherits all parent settings.
 */
export function createChildLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}

/**
 * Structured audit log — critical user actions always go to a dedicated stream.
 * In production, pipe this to an audit-specific log group in your aggregator.
 */
export function auditLog(action: string, context: {
  userId: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): void {
  logger.info({
    audit: true,
    action,
    ...context,
  }, `AUDIT: ${action}`);
}
