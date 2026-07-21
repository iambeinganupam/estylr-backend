// ─────────────────────────────────────────────────────────────────────────────
// Express App Factory — Production-Hardened
// ─────────────────────────────────────────────────────────────────────────────
// Creates and configures the Express app. Exported separately from server.ts
// so it can be imported for testing (Supertest) without starting the HTTP listener.
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/node';

import { logger } from './config/logger';
import { env } from './config/env';
import { corsMiddleware } from './middleware/cors.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { metricsMiddleware } from './middleware/metrics.middleware';
import { errorHandler } from './middleware/error-handler.middleware';
import { authenticatedRateLimiter } from './middleware/rate-limit.middleware';
import { checkDatabaseHealth } from './config/database';
import { registry as metricsRegistry } from './lib/metrics';
import {
  hppProtection,
  slowDownMiddleware,
  securityHeaders,
  requestSizeGuard,
  suspiciousRequestDetector,
  logRealIp,
} from './middleware/security.middleware';

// ── Module Controllers ──
import { authController } from './modules/auth/auth.controller';
import { businessController } from './modules/business/business.controller';
import { catalogController } from './modules/catalog/catalog.controller';
import { availabilityController } from './modules/availability/availability.controller';
import { bookingController } from './modules/booking/booking.controller';
import { discoveryController } from './modules/discovery/discovery.controller';
import { engagementController } from './modules/engagement/engagement.controller';
import { mediaController } from './modules/media/media.controller';
import { eventsController } from './modules/events/events.controller';
import { financeController } from './modules/finance/finance.controller';
import { analyticsController } from './modules/analytics/analytics.controller';
import { cmsController } from './modules/cms/cms.controller';
import { staffController } from './modules/staff/staff.controller';
import { eventManagerController } from './modules/event-manager/event-manager.controller';
import { adminController } from './modules/admin/admin.controller';
import { freelancerController } from './modules/freelancer/freelancer.controller';
import { assignmentsController } from './modules/assignments/assignments.controller';
import { plansController } from './modules/plans/plans.controller';
import { devicesController } from './modules/devices/devices.controller';
import { locationsController } from './modules/locations/locations.controller';
import { adminAuditLogController } from './modules/admin-audit-log/admin-audit-log.controller';
import { adminVendorsController } from './modules/admin-vendors/admin-vendors.controller';
import { adminStaffController } from './modules/admin-staff/admin-staff.controller';
import { adminCustomersController } from './modules/admin-customers/admin-customers.controller';
import { adminBookingsController } from './modules/admin-bookings/admin-bookings.controller';
import { adminCommissionsController } from './modules/admin-commissions/admin-commissions.controller';
import { adminRefundsController } from './modules/admin-refunds/admin-refunds.controller';
import { adminServicesController } from './modules/admin-services/admin-services.controller';
import { adminCategoriesController } from './modules/admin-categories/admin-categories.controller';
import { adminPlansController } from './modules/admin-plans/admin-plans.controller';
import { adminReviewsController } from './modules/admin-reviews/admin-reviews.controller';
import { adminMediaController } from './modules/admin-media/admin-media.controller';
import { adminTransactionsController } from './modules/admin-transactions/admin-transactions.controller';
import { adminSettingsController } from './modules/admin-settings/admin-settings.controller';
import { adminSettlementsController } from './modules/admin-settlements/admin-settlements.controller';
import { paymentsWebhookController } from './modules/payments/payments.webhook.controller';
import { paymentsController } from './modules/payments/payments.controller';
import { addressesController } from './modules/addresses/addresses.controller';
import { notificationsController } from './modules/notifications/notifications.controller';
import { customerFinanceController } from './modules/customer-finance/customer-finance.controller';
import { entitlementsController } from './modules/entitlements/entitlements.controller';
import { metaController } from './modules/meta/meta.controller';
import { kycController } from './modules/kyc/kyc.controller';
import { messagingController } from './modules/messaging/messaging.controller';
import { publicStatsController } from './modules/public-stats/public-stats.controller';

export function createApp(): express.Application {
  const app = express();

  // ── Trust Proxy (needed for correct IP behind load balancer) ──
  if (env.TRUST_PROXY) app.set('trust proxy', 1);


  // ── Real IP Extraction ──
  app.use(logRealIp);

  // ── Security Headers (Helmet + custom) ──
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
    hidePoweredBy: true,
  }));
  app.use(securityHeaders);

  // ── CORS ──
  app.use(corsMiddleware);

  // ── Body Parsing (with size limits) ──
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestSizeGuard);

  // ── HTTP Parameter Pollution Protection ──
  app.use(hppProtection);

  // ── Attack Pattern Detection ──
  app.use(suspiciousRequestDetector);

  // ── Cookie Parser (httpOnly refresh token) ──
  app.use(cookieParser(env.COOKIE_SECRET));

  // ── Compression ──
  app.use(compression());

  // ── Request ID (correlation) ──
  app.use(requestIdMiddleware);

  // ── Metrics (records counter + duration on every response) ──
  app.use(metricsMiddleware);

  // ── Structured HTTP Request Logging ──
  app.use(pinoHttp({
    logger,
    customProps: (req) => ({
      requestId: req.requestId,
    }),
    // Redact sensitive headers from HTTP logs
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[Redacted]',
    },
    autoLogging: {
      ignore: (req) => req.url === '/api/v1/health',
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} → ${res.statusCode}`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} → ${res.statusCode}: ${err.message}`,
  }));

  // ── Slow-Down (brute-force deterrent) ──
  app.use(slowDownMiddleware);

  // ── Global Rate Limiter ──
  app.use(authenticatedRateLimiter);

  // ── Static Uploads (dev only) ──
  if (env.STORAGE_PROVIDER === 'local') {
    app.use('/uploads', express.static(env.STORAGE_LOCAL_PATH));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ROUTES
  // ────────────────────────────────────────────────────────────────────────────

  const API_PREFIX = `/api/${env.API_VERSION}`;

  // ── Prometheus metrics (flat path, NOT under /api/v1) ──
  // Auth model:
  //   - METRICS_TOKEN set → require Bearer token
  //   - METRICS_TOKEN unset + production → 404 (never leak metrics unauth'd in prod)
  //   - METRICS_TOKEN unset + non-production → allow only loopback (dev convenience)
  app.get('/metrics', (req, res, next) => {
    const token = env.METRICS_TOKEN;
    if (token) {
      if (req.header('authorization') !== `Bearer ${token}`) {
        res.status(401).type('text/plain').send('unauthorized');
        return;
      }
    } else if (env.NODE_ENV === 'production') {
      res.status(404).type('text/plain').send('not found');
      return;
    } else {
      const ip = req.ip ?? '';
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
        res.status(401).type('text/plain').send('unauthorized');
        return;
      }
    }
    res.setHeader('Content-Type', metricsRegistry.contentType);
    metricsRegistry.metrics().then((m) => res.send(m)).catch(next);
  });

  // ── Liveness probe — does the process respond? No DB call. ──
  app.get('/live', (_req, res) => {
    res.status(200).json({ status: 'live', uptime_seconds: Math.floor(process.uptime()) });
  });

  // ── Readiness probe — DB reachable, ready to accept traffic. ──
  app.get('/ready', async (_req, res) => {
    const ok = await checkDatabaseHealth();
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'unready' });
  });

  // ── Health Check (excluded from auth + rate limiting) ──
  app.get(`${API_PREFIX}/health`, async (_req, res) => {
    const start = Date.now();
    const dbHealthy = await checkDatabaseHealth();
    const dbLatencyMs = Date.now() - start;

    const memUsage = process.memoryUsage();
    const status = dbHealthy ? 'healthy' : 'degraded';
    const statusCode = dbHealthy ? 200 : 503;

    res.status(statusCode).json({
      success: true,
      data: {
        status,
        version: env.APP_VERSION,
        api_version: env.API_VERSION,
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        services: {
          database: {
            status: dbHealthy ? 'connected' : 'disconnected',
            latency_ms: dbLatencyMs,
          },
        },
        memory: {
          rss_mb: Math.round(memUsage.rss / 1024 / 1024),
          heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
      },
    });
  });

  // ── Service Modules ──
  app.use(`${API_PREFIX}/public`, publicStatsController);
  app.use(`${API_PREFIX}/meta`, metaController);
  app.use(`${API_PREFIX}/auth`, authController);
  app.use(`${API_PREFIX}/business`, businessController);
  app.use(`${API_PREFIX}/catalog`, catalogController);
  app.use(`${API_PREFIX}/availability`, availabilityController);
  app.use(`${API_PREFIX}/booking`, bookingController);
  app.use(`${API_PREFIX}/discover`, discoveryController);
  app.use(`${API_PREFIX}/engagement`, engagementController);
  app.use(`${API_PREFIX}/media`, mediaController);
  app.use(`${API_PREFIX}/events`, eventsController);
  app.use(`${API_PREFIX}/finance`, financeController);
  app.use(`${API_PREFIX}/analytics`, analyticsController);
  app.use(`${API_PREFIX}/cms`, cmsController);
  app.use(`${API_PREFIX}/staff`, staffController);
  app.use(`${API_PREFIX}/event-manager`, eventManagerController);
  // ── Admin sub-modules (super_admin only — mounted before the legacy admin
  //    controller so their routes take precedence) ──
  app.use(`${API_PREFIX}/admin/audit-log`,   adminAuditLogController);
  app.use(`${API_PREFIX}/admin/vendors`,     adminVendorsController);
  app.use(`${API_PREFIX}/admin/staff`,       adminStaffController);
  app.use(`${API_PREFIX}/admin/customers`,   adminCustomersController);
  app.use(`${API_PREFIX}/admin/bookings`,    adminBookingsController);
  app.use(`${API_PREFIX}/admin/commissions`, adminCommissionsController);
  app.use(`${API_PREFIX}/admin/refunds`,     adminRefundsController);
  app.use(`${API_PREFIX}/admin/services`,    adminServicesController);
  app.use(`${API_PREFIX}/admin/categories`,  adminCategoriesController);
  app.use(`${API_PREFIX}/admin/plans`,        adminPlansController);
  app.use(`${API_PREFIX}/admin/reviews`,     adminReviewsController);
  app.use(`${API_PREFIX}/admin/media`,       adminMediaController);
  app.use(`${API_PREFIX}/admin/transactions`, adminTransactionsController);
  app.use(`${API_PREFIX}/admin/settings`,    adminSettingsController);
  app.use(`${API_PREFIX}/admin/settlements`, adminSettlementsController);
  app.use(`${API_PREFIX}/admin/locations`,   locationsController);
  // kycController is mounted with a specific prefix BEFORE the bare API_PREFIX
  // entitlementsController mount. entitlementsController uses router.use() to apply a
  // super_admin guard, which runs for all paths entering it — so vendor routes must
  // be registered with their own prefix before that point.
  app.use(`${API_PREFIX}/kyc`,              kycController);
  app.use(API_PREFIX,                        entitlementsController);
  app.use(`${API_PREFIX}/admin`,             adminController);
  app.use(`${API_PREFIX}/freelancer`, freelancerController);
  app.use(`${API_PREFIX}/assignments`, assignmentsController);
  app.use(`${API_PREFIX}/plans`, plansController);
  app.use(`${API_PREFIX}/devices`, devicesController);
  app.use(`${API_PREFIX}/payments`, paymentsWebhookController);
  app.use(`${API_PREFIX}/payments`, paymentsController);
  app.use(API_PREFIX, addressesController);
  app.use(API_PREFIX, notificationsController);
  app.use(API_PREFIX, messagingController);
  app.use(API_PREFIX, customerFinanceController);

  // ── 404 Handler ──
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested endpoint does not exist.',
      },
    });
  });

  // ── Sentry: Error Handler — MUST be before our errorHandler ──
  Sentry.setupExpressErrorHandler(app);

  // ── Global Error Handler (must be LAST) ──
  app.use(errorHandler);

  return app;
}
