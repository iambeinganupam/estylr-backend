// ─────────────────────────────────────────────────────────────────────────────
// Notification Dispatcher — Outbox Worker
// Polls for pending notifications on a fixed interval and dispatches them.
// Uses SELECT FOR UPDATE SKIP LOCKED so multiple pods don't double-process.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '../config/env';
import { logger } from '../config/logger';
import { withTransaction } from '../config/database';
import * as notificationsRepo from '../modules/notifications/notifications.repository';
import * as notificationsService from '../modules/notifications/notifications.service';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // overlap guard — previous tick still working
  running = true;
  try {
    // Phase 1: claim a batch using SKIP LOCKED inside a short transaction.
    // The transaction commits immediately after SELECT, releasing the row-level
    // locks. Two workers cannot claim the same row because SKIP LOCKED prevents
    // the second worker's SELECT from seeing rows locked by the first, and the
    // first worker's COMMIT happens before processOne runs.
    //
    // processOne updates the rows (markDispatched, incrementAttempt) via the
    // regular pool. Keeping those updates inside the same long-running
    // transaction would cause a deadlock: the UPDATE would wait for the FOR
    // UPDATE lock to be released, which only happens after the UPDATE completes.
    let batch: notificationsRepo.NotificationRow[] = [];
    await withTransaction(async (client) => {
      batch = await notificationsRepo.fetchPendingForDispatch(
        env.NOTIFICATION_DISPATCH_BATCH_SIZE,
        client,
      );
    });

    if (batch.length === 0) return;

    // Phase 2: process each row outside the transaction.
    logger.debug({ count: batch.length }, 'notification-dispatcher: processing batch');
    for (const row of batch) {
      try {
        await notificationsService.processOne(row.id);
      } catch (err) {
        // processOne owns retry counter; outer error is logged but not re-thrown
        logger.warn({ err, id: row.id }, 'notification-dispatcher: processOne threw');
      }
    }
  } catch (err) {
    logger.error({ err }, 'notification-dispatcher: tick error');
  } finally {
    running = false;
  }
}

export function startNotificationDispatcher(): void {
  if (timer) return;
  const interval = env.NOTIFICATION_DISPATCH_INTERVAL_MS;
  logger.info(
    { intervalMs: interval, batchSize: env.NOTIFICATION_DISPATCH_BATCH_SIZE },
    'notification-dispatcher: starting',
  );
  // First tick after a short delay to let the rest of the server warm up
  setTimeout(() => {
    void tick();
    timer = setInterval(() => { void tick(); }, interval);
  }, 2000);
}

export function stopNotificationDispatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// Exported for tests:
export const __forTests = { tick };
