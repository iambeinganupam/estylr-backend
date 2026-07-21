// ─────────────────────────────────────────────────────────────────────────────
// Notifications Module — Service
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolClient } from 'pg';
import * as repo from './notifications.repository';
import * as devicesRepo from '../devices/devices.repository';
import {
  getPushChannel,
  getEmailChannel,
  renderTemplate,
  type NotificationType,
} from '../../adapters/notifications';
import { queryOne } from '../../config/database';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { ListNotificationsQuery, UpdatePreferencesInput } from './notifications.schemas';
import type { NotificationRow, NotificationPreferenceRow } from './notifications.repository';

type Channel = 'in_app' | 'push' | 'email' | 'sms';

export interface DispatchInput {
  userId: string;
  type: NotificationType;
  data?: Record<string, unknown>;
  /** If provided, overrides preference-resolved channels (intersected with enabled). */
  channels?: Channel[];
  dedupeKey?: string;
}

// ── Channel resolution ────────────────────────────────────────────────────────

function resolveChannels(
  prefs: NotificationPreferenceRow,
  type: NotificationType,
  override?: Channel[],
): Channel[] {
  if (override && override.length > 0) {
    // Use caller-specified channels, intersected with globally-enabled ones.
    return override.filter((ch) => {
      switch (ch) {
        case 'in_app': return prefs.in_app_enabled;
        case 'push':   return prefs.push_enabled;
        case 'email':  return prefs.email_enabled;
        case 'sms':    return prefs.sms_enabled;
        default:       return false;
      }
    });
  }

  // Default: in_app always included (when enabled) + push/email/sms if globally enabled
  // AND not explicitly disabled via type_overrides.
  const typeOpts = prefs.type_overrides?.[type] ?? {};

  const resolved: Channel[] = [];

  if (prefs.in_app_enabled && typeOpts['in_app'] !== false) resolved.push('in_app');
  if (prefs.push_enabled   && typeOpts['push']   !== false) resolved.push('push');
  if (prefs.email_enabled  && typeOpts['email']  !== false) resolved.push('email');
  if (prefs.sms_enabled    && typeOpts['sms']    !== false) resolved.push('sms');

  // Always include in_app as a minimum if enabled
  if (resolved.length === 0 && prefs.in_app_enabled) resolved.push('in_app');

  return resolved;
}

// ── Public service functions ──────────────────────────────────────────────────

/**
 * Creates a notification row in the DB. The actual sending happens later via
 * the outbox worker (processOne). Accepts an optional PoolClient for callers
 * that want to dispatch within their own transaction (e.g. KYC, booking).
 */
export async function dispatch(
  input: DispatchInput,
  client?: PoolClient,
): Promise<NotificationRow> {
  const rendered = renderTemplate(input.type, input.data ?? {});
  const prefs = await repo.getPreferences(input.userId);
  const channels = resolveChannels(prefs, input.type, input.channels);

  return repo.insertOne(
    {
      userId: input.userId,
      type: input.type,
      title: rendered.title,
      body: rendered.body,
      data: input.data,
      dedupeKey: input.dedupeKey,
      channels,
    },
    client,
  );
}

export async function markRead(userId: string, ids?: string[]): Promise<number> {
  return repo.markRead(userId, ids);
}

export async function unreadCount(userId: string): Promise<number> {
  return repo.unreadCount(userId);
}

export async function listForUser(
  userId: string,
  q: ListNotificationsQuery,
): Promise<{ rows: NotificationRow[]; nextCursor: string | null }> {
  return repo.listForUser(userId, { cursor: q.cursor, limit: q.limit, unread: q.unread });
}

export async function getPreferences(userId: string): Promise<NotificationPreferenceRow> {
  return repo.getPreferences(userId);
}

export async function updatePreferences(
  userId: string,
  patch: UpdatePreferencesInput,
): Promise<NotificationPreferenceRow> {
  return repo.updatePreferences(userId, patch);
}

// ── Outbox worker ─────────────────────────────────────────────────────────────

type ProcessStatus = 'delivered' | 'failed' | 'partial' | 'skipped';

/**
 * Processes one pending notification — sends to each channel, aggregates result.
 * Used by the outbox worker (next wave). Lives here so callers can import the
 * service layer without reaching into the worker.
 */
export async function processOne(
  notificationId: string,
): Promise<{ status: ProcessStatus; error?: string }> {
  const row = await repo.findById(notificationId);
  if (!row) return { status: 'failed', error: 'notification not found' };

  // Permanent failure: max attempts exceeded (guard in case worker retries).
  if (row.delivery_attempts >= env.NOTIFICATION_MAX_ATTEMPTS) {
    await repo.markDispatched(notificationId, 'failed', 'max attempts exceeded');
    return { status: 'failed', error: 'max attempts exceeded' };
  }

  await repo.incrementAttempt(notificationId);

  const rendered = renderTemplate(row.type as NotificationType, (row.data ?? {}) as Record<string, unknown>);
  const channelResults: Array<{ channel: Channel; ok: boolean; error?: string }> = [];

  for (const ch of row.channels as Channel[]) {
    try {
      switch (ch) {
        case 'in_app': {
          // Already in DB — considered delivered.
          channelResults.push({ channel: ch, ok: true });
          break;
        }

        case 'push': {
          const tokens = await devicesRepo.listActiveTokensForUser(row.user_id);
          if (tokens.length === 0) {
            channelResults.push({ channel: ch, ok: true }); // No tokens — not a failure.
            break;
          }
          const result = await getPushChannel().send({
            tokens,
            title: rendered.title,
            body: rendered.body,
            data: (row.data ?? {}) as Record<string, unknown>,
          });
          const allFailed = result.failed.length === tokens.length;
          channelResults.push({
            channel: ch,
            ok: !allFailed,
            error: allFailed ? result.failed.map((f) => f.error).join('; ') : undefined,
          });
          break;
        }

        case 'email': {
          const userRow = await queryOne<{ email: string }>(
            `SELECT email FROM public.users WHERE id = $1`,
            [row.user_id],
          );
          if (!userRow?.email) {
            channelResults.push({ channel: ch, ok: true }); // No email — skip gracefully.
            break;
          }
          await getEmailChannel().send({
            to: userRow.email,
            subject: rendered.email_subject,
            html: rendered.email_html,
            text: rendered.body,
          });
          channelResults.push({ channel: ch, ok: true });
          break;
        }

        case 'sms': {
          // SMS out of scope in v1 — mark as skipped.
          channelResults.push({ channel: ch, ok: true });
          break;
        }

        default: {
          channelResults.push({ channel: ch as Channel, ok: true });
        }
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.warn({ notificationId, channel: ch, err }, 'notification channel send failed');
      channelResults.push({ channel: ch, ok: false, error: errMsg });
    }
  }

  const succeeded = channelResults.filter((r) => r.ok).length;
  const total = channelResults.length;
  const errors = channelResults.filter((r) => !r.ok).map((r) => r.error).filter(Boolean).join('; ');

  let finalStatus: ProcessStatus;
  if (total === 0 || succeeded === total) {
    finalStatus = 'delivered';
  } else if (succeeded === 0) {
    finalStatus = 'failed';
  } else {
    finalStatus = 'partial';
  }

  await repo.markDispatched(notificationId, finalStatus, errors || undefined);
  return { status: finalStatus, error: errors || undefined };
}
