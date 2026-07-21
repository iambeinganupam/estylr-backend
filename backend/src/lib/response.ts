// ─────────────────────────────────────────────────────────────────────────────
// Response Helpers — Standard Envelope
// ─────────────────────────────────────────────────────────────────────────────
// Every API response uses these helpers to ensure consistent shape.
// Success: { success: true, data, meta? }
// Error:   { success: false, error: { code, message, details? } }
// ─────────────────────────────────────────────────────────────────────────────

import { Response } from 'express';

interface PaginationMeta {
  page?: number;
  limit?: number;
  total?: number;
  next_cursor?: string | null;
  has_more?: boolean;
}

/**
 * 200 OK — Successful read, update, or action.
 */
export function success<T>(res: Response, data: T, meta?: PaginationMeta): void {
  const body: Record<string, unknown> = { success: true, data };
  if (meta) {
    body.meta = meta;
  }
  res.status(200).json(body);
}

/**
 * 201 Created — Successfully created a new resource.
 */
export function created<T>(res: Response, data: T): void {
  res.status(201).json({ success: true, data });
}

/**
 * 204 No Content — Successful delete or action with no response body.
 */
export function noContent(res: Response): void {
  res.status(204).send();
}

/**
 * Paginated response with cursor-based meta.
 */
export function paginated<T>(
  res: Response,
  data: T[],
  meta: PaginationMeta,
): void {
  res.status(200).json({
    success: true,
    data,
    meta,
  });
}
