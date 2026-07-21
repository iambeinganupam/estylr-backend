// ─────────────────────────────────────────────────────────────────────────────
// Background Jobs — Cron Scheduling
// ─────────────────────────────────────────────────────────────────────────────

import cron from 'node-cron';
import { query, withTransaction } from '../config/database';
import { logger } from '../config/logger';
import { captureError } from '../config/sentry';
import {
  startNotificationDispatcher,
  stopNotificationDispatcher,
} from './notification-dispatcher.job';
import {
  startRefundDispatcher,
  stopRefundDispatcher,
} from './refund-dispatcher.job';
import { ensureCacheInvalidationChannel } from '../modules/entitlements/entitlements.service';

let expireIntentsTask: cron.ScheduledTask | null = null;
let refreshViewsTask: cron.ScheduledTask | null = null;
let otpJanitorTask: cron.ScheduledTask | null = null;
let passwordResetJanitorTask: cron.ScheduledTask | null = null;

/**
 * Run `task` inside a Postgres advisory transaction lock. If another pod
 * already holds the lock, the function returns silently (the other pod will
 * run the task). Errors from the task are captured in Sentry but never
 * propagate — cron failures must not crash the process.
 */
export async function runWithLock(lockId: number, task: () => Promise<void>): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ got: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1) AS got',
      [lockId],
    );
    if (!rows[0]?.got) {
      logger.debug({ lockId }, 'cron: lock held by another pod; skipping');
      return;
    }
    try {
      await task();
    } catch (e) {
      captureError(e as Error);
      logger.error({ err: e, lockId }, 'cron: task failed');
    }
  });
}

/**
 * Start all background jobs.
 */
export function startBackgroundJobs(): void {
  // ── Expire stale booking intents — every 1 minute ──
  expireIntentsTask = cron.schedule('*/1 * * * *', () => runWithLock(1002, async () => {
    const result = await query(
      `UPDATE public.booking_intents
       SET status = 'expired'
       WHERE status IN ('draft', 'locked')
         AND expires_at < NOW()`,
    );
    if (result.rowCount && result.rowCount > 0) {
      logger.info({ expired: result.rowCount }, 'Expired stale booking intents');
    }
  }));

  // ── Refresh materialized views — every 5 minutes ──
  refreshViewsTask = cron.schedule('*/5 * * * *', () => runWithLock(1001, async () => {
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vendor_discovery');
    logger.debug('Refreshed mv_vendor_discovery materialized view');
  }));

  // ── OTP code janitor — every 5 minutes ──
  otpJanitorTask = cron.schedule('*/5 * * * *', () => runWithLock(1003, async () => {
    await query("DELETE FROM public.otp_codes WHERE expires_at < NOW() - INTERVAL '1 minute'");
  }));

  // ── Password reset token janitor — every 5 minutes ──
  passwordResetJanitorTask = cron.schedule('*/5 * * * *', () => runWithLock(1004, async () => {
    await query("DELETE FROM public.password_reset_tokens WHERE expires_at < NOW() - INTERVAL '24 hours'");
  }));

  // ── Notification outbox dispatcher — interval-based (not cron) ──
  if (process.env.NODE_ENV !== 'test') {
    startNotificationDispatcher();
    // ── Refund execution dispatcher — interval-based (not cron) ──
    startRefundDispatcher();
    // ── Entitlements cache LISTEN/NOTIFY channel ──
    ensureCacheInvalidationChannel().catch((err) => {
      logger.error({ err }, 'Failed to open entitlements LISTEN channel');
    });
  }

  logger.info('Background jobs started');
}

/**
 * Stop all background jobs.
 */
export function stopBackgroundJobs(): void {
  expireIntentsTask?.stop();
  refreshViewsTask?.stop();
  otpJanitorTask?.stop();
  passwordResetJanitorTask?.stop();
  stopNotificationDispatcher();
  stopRefundDispatcher();
  logger.info('Background jobs stopped');
}
