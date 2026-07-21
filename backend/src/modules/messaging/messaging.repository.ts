// ─────────────────────────────────────────────────────────────────────────────
// Messaging Module — Repository (pure SQL, no business logic)
// ─────────────────────────────────────────────────────────────────────────────
import type { PoolClient } from 'pg';
import { query, queryOne, withTransaction } from '../../config/database';

// ── Row types ─────────────────────────────────────────────────────────────────

export interface ThreadRow {
  id: string;
  customer_id: string;
  vendor_type: string;
  vendor_id: string;
  vendor_user_id: string;
  appointment_id: string | null;
  last_message_at: string | null;
  last_message_seq: number;
  created_at: string;
}

export interface ThreadSummaryRow {
  id: string;
  customer_id: string;
  vendor_type: string;
  vendor_id: string;
  vendor_user_id: string;
  appointment_id: string | null;
  last_message_at: string | null;
  last_message_seq: number;
  created_at: string;
  // Enriched fields
  peer_name: string | null;
  peer_avatar: string | null;
  last_message_preview: string | null;
  unread_count: number;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  seq: number;
  body: string;
  media_id: string | null;
  read_by_recipient_at: string | null;
  created_at: string;
}

// ── Thread CRUD ───────────────────────────────────────────────────────────────

/**
 * Idempotent: returns existing thread or inserts a new one.
 * The UNIQUE constraint is on (customer_id, vendor_type, vendor_id, appointment_id).
 * NULL appointment_id participates in the uniqueness check (IS NOT DISTINCT FROM).
 */
export async function findOrCreateThread(args: {
  customerId: string;
  vendorType: string;
  vendorId: string;
  vendorUserId: string;
  appointmentId?: string;
}): Promise<ThreadRow> {
  return withTransaction(async (client) => {
    // Try to find existing first to avoid bumping a sequence unnecessarily.
    const existing = await client.query<ThreadRow>(
      `SELECT * FROM public.message_threads
       WHERE customer_id   = $1
         AND vendor_type   = $2::vendor_type
         AND vendor_id     = $3
         AND appointment_id IS NOT DISTINCT FROM $4`,
      [args.customerId, args.vendorType, args.vendorId, args.appointmentId ?? null],
    );
    if (existing.rows[0]) return existing.rows[0];

    const inserted = await client.query<ThreadRow>(
      `INSERT INTO public.message_threads
         (customer_id, vendor_type, vendor_id, vendor_user_id, appointment_id)
       VALUES ($1, $2::vendor_type, $3, $4, $5)
       RETURNING *`,
      [args.customerId, args.vendorType, args.vendorId, args.vendorUserId, args.appointmentId ?? null],
    );
    return inserted.rows[0]!;
  });
}

export async function getThread(id: string): Promise<ThreadRow | null> {
  return queryOne<ThreadRow>(
    `SELECT * FROM public.message_threads WHERE id = $1`,
    [id],
  );
}

export async function isParticipant(threadId: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM public.message_threads
       WHERE id = $1 AND (customer_id = $2 OR vendor_user_id = $2)
     ) AS found`,
    [threadId, userId],
  );
  return row?.found ?? false;
}

export async function listThreadsForUser(
  userId: string,
  opts: { limit: number },
): Promise<ThreadSummaryRow[]> {
  // Fetch threads where the user is either customer or vendor.
  // Enrich with peer display name, last message preview, and unread count.
  const result = await query<ThreadSummaryRow>(
    `SELECT
       t.*,
       -- Peer identity. Caller is the customer ⇒ peer is the vendor;
       -- otherwise (caller is the vendor user) peer is the customer.
       -- Vendor display name comes from freelancer_profiles or salon_locations
       -- depending on vendor_type. Customer display name is first+last from customer_profiles.
       CASE WHEN t.customer_id = $1
            THEN COALESCE(fp.business_name, sl.display_name)
            ELSE NULLIF(TRIM(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')), '')
       END AS peer_name,
       CASE WHEN t.customer_id = $1
            THEN COALESCE(fp.logo_url, sl.logo_url)
            ELSE cp.avatar_url
       END AS peer_avatar,
       -- Last message preview (most recent by seq)
       (SELECT LEFT(m.body, 100) FROM public.messages m
        WHERE m.thread_id = t.id
        ORDER BY m.seq DESC LIMIT 1) AS last_message_preview,
       -- Unread: messages sent by the OTHER party that have no read receipt
       (SELECT COUNT(*)::int FROM public.messages m
        WHERE m.thread_id = t.id
          AND m.sender_id <> $1
          AND m.read_by_recipient_at IS NULL) AS unread_count
     FROM public.message_threads t
     LEFT JOIN public.freelancer_profiles fp
       ON t.vendor_type = 'freelancer' AND fp.id = t.vendor_id
     LEFT JOIN public.salon_locations sl
       ON t.vendor_type = 'salon_location' AND sl.id = t.vendor_id
     LEFT JOIN public.customer_profiles cp
       ON cp.user_id = t.customer_id
     WHERE t.customer_id = $1 OR t.vendor_user_id = $1
     ORDER BY t.last_message_at DESC NULLS LAST
     LIMIT $2`,
    [userId, opts.limit],
  );
  return result.rows;
}

// ── Message operations ────────────────────────────────────────────────────────

/**
 * Atomically bumps last_message_seq on the thread and inserts the message
 * using the new seq — all in a single CTE round-trip.
 * Accepts an optional client for callers that need this inside their own TX
 * (e.g. the service wrapping notification dispatch in the same transaction).
 */
export async function appendMessage(
  args: {
    threadId: string;
    senderId: string;
    body: string;
    mediaId?: string;
  },
  client?: PoolClient,
): Promise<MessageRow> {
  const sql = `
    WITH bumped AS (
      UPDATE public.message_threads
         SET last_message_seq = last_message_seq + 1,
             last_message_at  = NOW()
       WHERE id = $1
       RETURNING last_message_seq AS seq
    ),
    inserted AS (
      INSERT INTO public.messages (thread_id, sender_id, seq, body, media_id)
      SELECT $1, $2, seq, $3, $4 FROM bumped
      RETURNING *
    )
    SELECT * FROM inserted
  `;
  const params = [args.threadId, args.senderId, args.body, args.mediaId ?? null];

  let row: MessageRow | null;
  if (client) {
    const res = await client.query<MessageRow>(sql, params);
    row = res.rows[0] ?? null;
  } else {
    row = await queryOne<MessageRow>(sql, params);
  }

  if (!row) throw new Error('appendMessage: failed to insert message');
  return row;
}

/** Returns messages in descending seq order (newest first). */
export async function listMessages(
  threadId: string,
  opts: { limit: number; beforeSeq?: number },
): Promise<MessageRow[]> {
  const params: unknown[] = [threadId, opts.limit];
  let seqClause = '';
  if (opts.beforeSeq !== undefined) {
    params.push(opts.beforeSeq);
    seqClause = `AND seq < $${params.length}`;
  }

  const result = await query<MessageRow>(
    `SELECT * FROM public.messages
     WHERE thread_id = $1 ${seqClause}
     ORDER BY seq DESC
     LIMIT $2`,
    params,
  );
  return result.rows;
}

/** Returns messages with seq > sinceSeq in ascending order (for cursor polling). */
export async function listMessagesSince(
  threadId: string,
  sinceSeq: number,
): Promise<MessageRow[]> {
  const result = await query<MessageRow>(
    `SELECT * FROM public.messages
     WHERE thread_id = $1 AND seq > $2
     ORDER BY seq ASC`,
    [threadId, sinceSeq],
  );
  return result.rows;
}

/**
 * Marks all messages sent by the OTHER user (not recipientUserId) with
 * seq <= uptoSeq as read. Returns count of updated rows.
 */
export async function markRead(
  threadId: string,
  recipientUserId: string,
  uptoSeq: number,
): Promise<number> {
  const result = await query(
    `UPDATE public.messages
       SET read_by_recipient_at = NOW()
     WHERE thread_id             = $1
       AND sender_id            <> $2
       AND seq                  <= $3
       AND read_by_recipient_at IS NULL`,
    [threadId, recipientUserId, uptoSeq],
  );
  return result.rowCount ?? 0;
}

/** Total unread messages across all of a user's threads (sent by others). */
export async function unreadCountForUser(userId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM public.messages m
     JOIN public.message_threads t ON t.id = m.thread_id
     WHERE (t.customer_id = $1 OR t.vendor_user_id = $1)
       AND m.sender_id <> $1
       AND m.read_by_recipient_at IS NULL`,
    [userId],
  );
  return parseInt(row?.n ?? '0', 10);
}

/** Unread count for a specific thread (messages sent by others). */
export async function unreadCountForThread(threadId: string, userId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM public.messages
     WHERE thread_id             = $1
       AND sender_id            <> $2
       AND read_by_recipient_at IS NULL`,
    [threadId, userId],
  );
  return parseInt(row?.n ?? '0', 10);
}

/** Resolve the user_id that owns a freelancer profile. */
export async function resolveFreelancerUserId(profileId: string): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM public.freelancer_profiles WHERE id = $1`,
    [profileId],
  );
  return row?.user_id ?? null;
}

/** Resolve the owner_user_id for a salon_location (via business_accounts). */
export async function resolveSalonLocationUserId(locationId: string): Promise<string | null> {
  const row = await queryOne<{ owner_user_id: string }>(
    `SELECT ba.owner_user_id
     FROM public.salon_locations sl
     JOIN public.business_accounts ba ON ba.id = sl.business_account_id
     WHERE sl.id = $1`,
    [locationId],
  );
  return row?.owner_user_id ?? null;
}
