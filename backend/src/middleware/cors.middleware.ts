// ─────────────────────────────────────────────────────────────────────────────
// Middleware: CORS configuration
// ─────────────────────────────────────────────────────────────────────────────

import cors from 'cors';
import { env } from '../config/env';

const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
// Allow http(s)://localhost or 127.0.0.1 on any port for local development.
// Explicit pattern; the NODE_ENV bypass that previously short-circuited the
// whitelist has been removed (it leaked into staging if NODE_ENV was set).
const LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server, curl).
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (LOCALHOST_REGEX.test(origin)) return callback(null, true);

    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-Tenant-Id',
    'X-Location-Id',
    'X-Kshuri-Audience',
    'Idempotency-Key',
  ],
  exposedHeaders: ['X-Request-Id', 'X-Deprecated'],
  maxAge: 86400,
});
