// ─────────────────────────────────────────────────────────────────────────────
// Audit log helper — single entry point for admin write actions
// ─────────────────────────────────────────────────────────────────────────────
// Every super-admin write path that mutates a primary entity calls
// `recordAudit({ ... })` to append a row to `audit_log`. The table is
// append-only at the DB layer (see migration 040), so a successful write
// here is the durable record of the action.
//
// Failure semantics: the audit insert is **best-effort**. If it throws we
// log a high-severity error and swallow — losing audit fidelity is bad, but
// failing the user's actual mutation because the audit row could not be
// persisted is worse. Operators should monitor these errors via Sentry.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { query } from '../config/database';
import { logger } from '../config/logger';
import { captureError } from '../config/sentry';
import type { AuditAction, AuditEntity } from './constants';

export interface AuditRecord {
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
  /**
   * Express request — used to extract admin_user_id, IP, user-agent and
   * request id. Pass the original `req` from the controller; the helper
   * pulls only the fields it needs and never retains the reference.
   */
  req: Request;
}

/**
 * Append one row to `audit_log`. Best-effort: errors are logged, never thrown.
 *
 * Call this from the **service** layer (not the controller) so the audit row
 * is written in the same logical step as the mutation it describes. Wrap both
 * in a transaction if you need atomicity.
 */
export async function recordAudit(rec: AuditRecord): Promise<void> {
  const adminUserId = rec.req.auth?.userId;
  if (!adminUserId) {
    logger.error({ action: rec.action }, 'audit_log skipped — no req.auth.userId');
    return;
  }

  try {
    await query(
      `INSERT INTO public.audit_log
         (admin_user_id, action, entity_type, entity_id,
          payload_before, payload_after, reason,
          ip_address, user_agent, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        adminUserId,
        rec.action,
        rec.entityType,
        rec.entityId ?? null,
        rec.before === undefined ? null : JSON.stringify(rec.before),
        rec.after  === undefined ? null : JSON.stringify(rec.after),
        rec.reason ?? null,
        // Express populates req.ip when `trust proxy` is set; fall back to socket.
        rec.req.ip ?? rec.req.socket?.remoteAddress ?? null,
        rec.req.headers['user-agent'] ?? null,
        rec.req.requestId ?? null,
      ],
    );
  } catch (err) {
    logger.error(
      { err, action: rec.action, entityType: rec.entityType, entityId: rec.entityId },
      'audit_log insert failed',
    );
    // CRITICAL: do NOT rethrow — audit failures must never break the parent operation.
    captureError(err as Error, { action: rec.action, entityType: rec.entityType, entityId: rec.entityId });
  }
}
