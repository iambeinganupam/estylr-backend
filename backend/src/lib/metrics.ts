import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: 'kshuri_' });

export const httpRequestsTotal = new Counter({
  name: 'kshuri_http_requests_total',
  help: 'Total number of HTTP requests processed.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'kshuri_http_request_duration_seconds',
  help: 'HTTP request duration in seconds, observed at response end.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const dbQueryDurationSeconds = new Histogram({
  name: 'kshuri_db_query_duration_seconds',
  help: 'Postgres query duration in seconds, observed at completion.',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/** Extract the SQL verb for a low-cardinality `operation` label. */
export function sqlOperation(text: string): string {
  const m = text.trimStart().match(/^(SELECT|INSERT|UPDATE|DELETE|WITH|BEGIN|COMMIT|ROLLBACK)/i);
  return m ? m[1]!.toUpperCase() : 'OTHER';
}

// ── Business-Domain Counters ──

export const bookingIntentsTotal = new Counter({
  name: 'kshuri_booking_intents_total',
  help: 'Booking intent outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const otpAttemptsTotal = new Counter({
  name: 'kshuri_otp_attempts_total',
  help: 'OTP verification attempt outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const paymentAttemptsTotal = new Counter({
  name: 'kshuri_payment_attempts_total',
  help: 'Payment attempt outcomes',
  labelNames: ['outcome', 'provider'] as const,
  registers: [registry],
});

export const authLoginsTotal = new Counter({
  name: 'kshuri_auth_logins_total',
  help: 'Login outcomes',
  labelNames: ['role', 'outcome'] as const,
  registers: [registry],
});

export const kycDecisionsTotal = new Counter({
  name: 'kshuri_kyc_decisions_total',
  help: 'KYC decision outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});
