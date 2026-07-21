// ─────────────────────────────────────────────────────────────────────────────
// Notifications Module — Repository (pure SQL, no business logic)
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';

// ── Row types ─────────────────────────────────────────────────────────────────

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  dedupe_key: string | null;
  channels: string[];
  delivery_status: 'pending' | 'partial' | 'delivered' | 'failed' | 'skipped';
  delivery_attempts: number;
  last_attempt_at: string | null;
  delivered_at: string | null;
  delivery_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferenceRow {
  user_id: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  type_overrides: Record<string, Record<string, boolean>>;
  updated_at: string;
}

// ── List + count ──────────────────────────────────────────────────────────────

export async function listForUser(
  userId: string,
  opts: { cursor?: string; limit: number; unread?: boolean },
): Promise<{ rows: NotificationRow[]; nextCursor: string | null }> {
  const params: unknown[] = [userId, opts.limit + 1];
  const conditions: string[] = ['user_id = $1'];

  if (opts.cursor) {
    params.push(opts.cursor);
    conditions.push(`created_at < $${params.length}`);
  }
  if (opts.unread === true) {
    conditions.push('is_read = FALSE');
  }

  const sql = `
    SELECT * FROM public.notifications
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await query<NotificationRow>(sql, params);
  const allRows = result.rows;
  const hasMore = allRows.length > opts.limit;
  const rows = hasMore ? allRows.slice(0, opts.limit) : allRows;
  const nextCursor = hasMore ? (rows[rows.length - 1]!.created_at) : null;

  return { rows, nextCursor };
}

export async function unreadCount(userId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM public.notifications WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  );
  return parseInt(row?.n ?? '0', 10);
}

// ── Mutation ──────────────────────────────────────────────────────────────────

/**
 * Marks notifications as read for a user.
 * If ids is provided, only those rows are updated; otherwise all unread rows.
 * Returns the count of updated rows.
 */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  let result;
  if (ids && ids.length > 0) {
    // Use ANY($2) with a UUID array cast
    result = await query(
      `UPDATE public.notifications
         SET is_read = TRUE, read_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_read = FALSE`,
      [userId, ids],
    );
  } else {
    result = await query(
      `UPDATE public.notifications
         SET is_read = TRUE, read_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
  }
  return result.rowCount ?? 0;
}

export interface InsertOneArgs {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  channels: string[];
}

/**
 * Inserts a notification row. On a dedupe key conflict (partial unique index),
 * swallows the error and returns the existing row instead.
 * Accepts an optional PoolClient for in-transaction callers.
 */
export async function insertOne(
  args: InsertOneArgs,
  client?: PoolClient,
): Promise<NotificationRow> {
  const sql = `
    INSERT INTO public.notifications
      (user_id, type, title, body, data, dedupe_key, channels, delivery_status)
    VALUES ($1, $2::notification_type, $3, $4, $5, $6, $7::text[], 'pending')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
    DO UPDATE SET updated_at = notifications.updated_at
    RETURNING *
  `;
  const params = [
    args.userId,
    args.type,
    args.title,
    args.body,
    args.data ? JSON.stringify(args.data) : null,
    args.dedupeKey ?? null,
    args.channels,
  ];

  let row: NotificationRow | null;
  if (client) {
    const res = await client.query<NotificationRow>(sql, params);
    row = res.rows[0] ?? null;
  } else {
    row = await queryOne<NotificationRow>(sql, params);
  }

  if (!row) throw new Error('insertOne: failed to insert or retrieve notification row');
  return row;
}

export async function findById(id: string): Promise<NotificationRow | null> {
  return queryOne<NotificationRow>(
    `SELECT * FROM public.notifications WHERE id = $1`,
    [id],
  );
}

// ── Outbox worker support ─────────────────────────────────────────────────────

/**
 * Fetches pending notifications for dispatch using SELECT FOR UPDATE SKIP LOCKED.
 * Must run inside a long-lived transaction held by the outbox worker.
 */
export async function fetchPendingForDispatch(
  batch: number,
  client: PoolClient,
): Promise<NotificationRow[]> {
  const res = await client.query<NotificationRow>(
    `SELECT * FROM public.notifications
       WHERE delivery_status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
    [batch],
  );
  return res.rows;
}

export async function markDispatched(
  id: string,
  status: 'delivered' | 'partial' | 'failed' | 'skipped',
  error?: string,
): Promise<void> {
  await query(
    `UPDATE public.notifications
       SET delivery_status   = $2,
           delivery_error    = $3,
           delivered_at      = CASE WHEN $2 = 'delivered' THEN NOW() ELSE NULL END,
           last_attempt_at   = NOW(),
           updated_at        = NOW()
       WHERE id = $1`,
    [id, status, error ?? null],
  );
}

export async function incrementAttempt(id: string, error?: string): Promise<void> {
  await query(
    `UPDATE public.notifications
       SET delivery_attempts = delivery_attempts + 1,
           last_attempt_at   = NOW(),
           delivery_error    = $2,
           updated_at        = NOW()
       WHERE id = $1`,
    [id, error ?? null],
  );
}

// ── Preferences ───────────────────────────────────────────────────────────────

/**
 * Returns preferences for a user, upserting defaults if missing.
 */
export async function getPreferences(userId: string): Promise<NotificationPreferenceRow> {
  return withTransaction(async (client) => {
    const row = await client.query<NotificationPreferenceRow>(
      `INSERT INTO public.notification_preferences (user_id)
         VALUES ($1)
         ON CONFLICT (user_id) DO UPDATE SET updated_at = notification_preferences.updated_at
         RETURNING *`,
      [userId],
    );
    return row.rows[0] as NotificationPreferenceRow;
  });
}

export interface PreferencesPatch {
  in_app_enabled?: boolean;
  push_enabled?: boolean;
  email_enabled?: boolean;
  sms_enabled?: boolean;
  type_overrides?: Record<string, Record<string, boolean>>;
}

export async function updatePreferences(
  userId: string,
  patch: PreferencesPatch,
): Promise<NotificationPreferenceRow> {
  const sets: string[] = [];
  const params: unknown[] = [userId];

  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (patch.in_app_enabled !== undefined) push('in_app_enabled', patch.in_app_enabled);
  if (patch.push_enabled   !== undefined) push('push_enabled',   patch.push_enabled);
  if (patch.email_enabled  !== undefined) push('email_enabled',  patch.email_enabled);
  if (patch.sms_enabled    !== undefined) push('sms_enabled',    patch.sms_enabled);
  if (patch.type_overrides !== undefined) push('type_overrides', JSON.stringify(patch.type_overrides));

  if (sets.length === 0) {
    // Nothing to update — return current row (upsert ensures it exists)
    return getPreferences(userId);
  }

  sets.push('updated_at = NOW()');

  const row = await queryOne<NotificationPreferenceRow>(
    `UPDATE public.notification_preferences
       SET ${sets.join(', ')}
       WHERE user_id = $1
       RETURNING *`,
    params,
  );

  // Fallback: if user had no preferences row yet, upsert and re-try
  if (!row) {
    await getPreferences(userId);
    return updatePreferences(userId, patch);
  }

  return row;
}
