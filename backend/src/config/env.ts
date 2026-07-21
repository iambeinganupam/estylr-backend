// ─────────────────────────────────────────────────────────────────────────────
// Environment Configuration — Zod-Validated
// Fails fast on startup if required env vars are missing or invalid.
//
// Loading order (dotenv-flow convention — later files override earlier):
//   1. .env                          committed defaults (non-secret only)
//   2. .env.${NODE_ENV}              per-env committed defaults
//   3. .env.local                    gitignored, developer machine
//   4. .env.${NODE_ENV}.local        gitignored, developer per-env
//   5. process.env (already-set)     never overridden — production secrets
//                                    injected by Render/Vercel/CI take priority
//
// In tests, `tests/setup.ts` pre-populates process.env before this file is
// imported, so dotenv-flow's `default_node_env` becomes irrelevant for the
// test path. The `override: false` behavior (default) preserves test fixtures.
// ─────────────────────────────────────────────────────────────────────────────

import { config as loadDotenvFlow } from 'dotenv-flow';
import { z } from 'zod';

// Skip loading from disk in NODE_ENV=test — the test runner has already
// populated process.env, and dotenv files on disk could shadow fixtures.
if (process.env.NODE_ENV !== 'test') {
  loadDotenvFlow({ silent: true, default_node_env: 'development' });
}

const envSchema = z.object({
  // ── Server ──
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_VERSION: z.string().default('v1'),
  APP_VERSION: z.string().default('1.0.0'),
  TRUST_PROXY: z.string().optional().default('false').transform(s => s === 'true'),

  // ── Sentry ──
  SENTRY_DSN: z.string().url().optional(),

  // ── Metrics ──
  // Bearer token for GET /metrics. Required in production — if unset, the
  // endpoint returns 404 in NODE_ENV=production so it doesn't leak runtime state.
  METRICS_TOKEN: z.string().min(16).optional(),

  // ── Database ──
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DB_SSL: z.string().optional().default('false').transform(s => s === 'true'),

  // ── JWT ──
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // ── Google OAuth ──
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ── OTP Provider (Firebase phone auth) ──
  OTP_PROVIDER: z.enum(['console', 'firebase']).default('console'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // ── Email Provider ──
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional().default('onboarding@resend.dev'),

  // ── App URLs (used in email links) ──
  APP_URL: z.string().url().default('http://localhost:3001'),

  // ── SMS Provider ──
  SMS_PROVIDER: z.enum(['console', 'twilio', 'msg91']).default('console'),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().default('KSHURI'),

  // ── Payment Gateway ──
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'razorpay']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),

  // ── Billing / GST ──
  // GST rate applied to settled bills. Indian salon services default to 18%.
  // Stored frozen on each transaction at bill-generation time, so changing
  // this value never rewrites historical bills.
  BILL_TAX_RATE: z.coerce.number().min(0).max(100).default(18),

  // ── Vendor Dues / Settlement ──
  // Hard cap on outstanding commission a vendor can carry before they're
  // blocked from accepting / creating new bookings. Defaults to ₹500 for
  // Phase 1 ("Manual Payments (UPI)"); super admin tunes this in production.
  DUES_BLOCK_THRESHOLD_INR: z.coerce.number().min(0).default(500),
  // Platform's collection VPA — vendors send dues + subscription fees here.
  // For Phase 1 this is a single super-admin-managed UPI ID; later we'll
  // route per-region or per-bank. Display name accompanies it on the QR.
  PLATFORM_COLLECTION_VPA: z.string().optional(),
  PLATFORM_COLLECTION_NAME: z.string().default('eStylr Platform'),

  // ── File Storage ──
  STORAGE_PROVIDER: z.enum(['local', 'cloudinary', 'supabase', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./uploads'),
  // Cloudinary (free tier — default cloud provider)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().optional().default('kshuri'),
  // Supabase Storage
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // AWS S3 — credentials resolved via the AWS default provider chain
  // (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars, or an attached IAM role).
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_REGION: z.string().optional(),
  // Optional CDN / custom-domain base (e.g. https://cdn.estylr.com) fronting the
  // bucket. When unset, virtual-hosted-style S3 URLs are returned.
  AWS_S3_PUBLIC_BASE_URL: z.string().url().optional(),

  // ── Logging ──
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_REDACT_PATHS: z.string().default('req.headers.authorization,req.headers.cookie,req.body.password,req.body.otp_code'),

  // ── Security ──
  SLOW_DOWN_DELAY_MS: z.coerce.number().default(500),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),

  // ── Rate Limiting ──
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),

  // ── CORS ──
  CORS_ORIGINS: z.string().default(
    'http://localhost:5173,http://localhost:8080,http://localhost:8081,http://localhost:8082,http://localhost:3000,http://localhost:3001'
  ),

  // ── Geocoding ──
  GEOCODING_PROVIDER:       z.enum(['nominatim', 'google', 'console']).default('nominatim'),
  NOMINATIM_USER_AGENT:     z.string().min(5).default('estylr-platform (support@estylr.com)'),
  GOOGLE_GEOCODING_API_KEY: z.string().optional(),

  // ── Cookies (httpOnly refresh token) ──
  // Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  COOKIE_SECRET: z
    .string()
    .min(32, 'COOKIE_SECRET must be at least 32 characters')
    .refine(
      (s) => s !== 'change-me-in-production-minimum-32-chars-here!!',
      { message: 'COOKIE_SECRET is set to the placeholder value — generate a real one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"' },
    ),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z.string().optional().default('false').transform(s => s === 'true'),

  // ── Notification Dispatch ──
  NOTIFICATION_PUSH_PROVIDER:        z.enum(['expo', 'fcm', 'console']).default('console'),
  NOTIFICATION_EMAIL_PROVIDER:       z.enum(['resend', 'console']).default('console'),
  NOTIFICATION_RESEND_API_KEY:       z.string().optional(),
  EMAIL_FROM_ADDRESS:                z.string().email().default('noreply@estylr.com'),
  NOTIFICATION_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  NOTIFICATION_DISPATCH_BATCH_SIZE:  z.coerce.number().int().min(1).max(200).default(50),
  NOTIFICATION_MAX_ATTEMPTS:         z.coerce.number().int().min(1).max(20).default(5),

  // ── Refund Dispatch ──
  REFUND_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  REFUND_DISPATCH_BATCH_SIZE:  z.coerce.number().int().min(1).max(200).default(20),
  REFUND_MAX_ATTEMPTS:         z.coerce.number().int().min(1).max(20).default(5),

  // ── KYC Verification ──
  KYC_MAX_DOC_SIZE_MB:        z.coerce.number().int().min(1).max(20).default(5),
  KYC_OCR_ENABLED:            z.string().default('true').transform((s) => s === 'true'),
  KYC_IMAGE_QUALITY_ENABLED:  z.string().default('true').transform((s) => s === 'true'),
  KYC_REMOTE_PROVIDER:        z.enum(['none','karza','digilocker']).default('none'),
  KARZA_API_KEY:              z.string().optional(),
  DIGILOCKER_API_KEY:         z.string().optional(),

  // ── Entitlements Cache ──
  // TTL for the in-process entitlement resolver cache. Set to 0 to disable caching.
  ENTITLEMENTS_CACHE_TTL_MS:  z.coerce.number().int().min(0).max(600000).default(60000),
}).superRefine((env, ctx) => {
  // Firebase OTP
  if (env.OTP_PROVIDER === 'firebase') {
    for (const k of ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const) {
      if (!env[k]) {
        ctx.addIssue({ code: 'custom', message: `${k} required when OTP_PROVIDER=firebase`, path: [k] });
      }
    }
  }
  // Resend email
  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    ctx.addIssue({ code: 'custom', message: 'RESEND_API_KEY required when EMAIL_PROVIDER=resend', path: ['RESEND_API_KEY'] });
  }
  // Razorpay payment
  if (env.PAYMENT_PROVIDER === 'razorpay') {
    if (!env.RAZORPAY_KEY_ID)     ctx.addIssue({ code: 'custom', message: 'RAZORPAY_KEY_ID required when PAYMENT_PROVIDER=razorpay',     path: ['RAZORPAY_KEY_ID'] });
    if (!env.RAZORPAY_KEY_SECRET) ctx.addIssue({ code: 'custom', message: 'RAZORPAY_KEY_SECRET required when PAYMENT_PROVIDER=razorpay', path: ['RAZORPAY_KEY_SECRET'] });
  }
  // Stripe payment
  if (env.PAYMENT_PROVIDER === 'stripe') {
    if (!env.STRIPE_SECRET_KEY)      ctx.addIssue({ code: 'custom', message: 'STRIPE_SECRET_KEY required when PAYMENT_PROVIDER=stripe',      path: ['STRIPE_SECRET_KEY'] });
    if (!env.STRIPE_WEBHOOK_SECRET)  ctx.addIssue({ code: 'custom', message: 'STRIPE_WEBHOOK_SECRET required when PAYMENT_PROVIDER=stripe',  path: ['STRIPE_WEBHOOK_SECRET'] });
  }
  // Cloudinary storage
  if (env.STORAGE_PROVIDER === 'cloudinary') {
    for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const) {
      if (!env[k]) ctx.addIssue({ code: 'custom', message: `${k} required when STORAGE_PROVIDER=cloudinary`, path: [k] });
    }
  }
  // S3 storage
  if (env.STORAGE_PROVIDER === 's3') {
    for (const k of ['AWS_S3_BUCKET', 'AWS_S3_REGION'] as const) {
      if (!env[k]) ctx.addIssue({ code: 'custom', message: `${k} required when STORAGE_PROVIDER=s3`, path: [k] });
    }
  }
  // Supabase storage
  if (env.STORAGE_PROVIDER === 'supabase') {
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
      if (!env[k]) ctx.addIssue({ code: 'custom', message: `${k} required when STORAGE_PROVIDER=supabase`, path: [k] });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error('❌ Invalid environment variables:\n' + formatted);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
