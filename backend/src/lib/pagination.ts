// ─────────────────────────────────────────────────────────────────────────────
// Pagination Constants & Schemas
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** Canonical limit field for list query schemas. Caps at MAX_PAGE_SIZE. */
export const paginationLimitSchema = z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);

/** Canonical offset field for offset-based pagination. */
export const paginationOffsetSchema = z.coerce.number().int().min(0).default(0);

// ─────────────────────────────────────────────────────────────────────────────
// Cursor-Based Pagination Utilities
// ─────────────────────────────────────────────────────────────────────────────
// Cursor-based pagination is stable under concurrent inserts (unlike offset).
// The cursor encodes the last-seen row's sort key as a Base64 JSON string.
// ─────────────────────────────────────────────────────────────────────────────

export interface CursorPayload {
  id: string;
  created_at?: string;
  [key: string]: unknown;
}

/**
 * Encode a cursor payload to a Base64 string for use in API responses.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a Base64 cursor string back to its payload.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as Record<string, unknown>).id === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Apply cursor-based pagination to a SQL query.
 *
 * Returns SQL WHERE clause fragment and additional params for the cursor.
 * The caller is responsible for integrating into the full query.
 *
 * @param cursor - The cursor string from the client (may be undefined)
 * @param sortColumn - The column to sort by (default: 'created_at')
 * @param sortDirection - ASC or DESC
 * @param paramOffset - The starting $N index for query parameters
 *
 * @returns { whereClause, params, orderClause }
 */
export function buildCursorPagination(options: {
  cursor?: string;
  limit: number;
  sortColumn?: string;
  sortDirection?: 'ASC' | 'DESC';
  paramOffset?: number;
}): {
  whereClause: string;
  params: unknown[];
  orderClause: string;
  limitClause: string;
} {
  const {
    cursor,
    limit,
    sortColumn = 'created_at',
    sortDirection = 'DESC',
    paramOffset = 1,
  } = options;

  const params: unknown[] = [];
  let whereClause = '';
  const operator = sortDirection === 'DESC' ? '<' : '>';

  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded?.created_at) {
      whereClause = `AND (${sortColumn}, id) ${operator} ($${paramOffset}, $${paramOffset + 1})`;
      params.push(decoded.created_at, decoded.id);
    }
  }

  const orderClause = `ORDER BY ${sortColumn} ${sortDirection}, id ${sortDirection}`;
  const limitClause = `LIMIT ${limit + 1}`; // Fetch one extra to determine if there are more

  return { whereClause, params, orderClause, limitClause };
}

/**
 * Process query results to extract pagination meta.
 * Removes the extra row (if present) and generates next_cursor.
 */
export function processCursorResults<T extends { id: string; created_at?: string }>(
  rows: T[],
  limit: number,
): {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
} {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  const lastItem = data[data.length - 1];
  const nextCursor = hasMore && lastItem
    ? encodeCursor({ id: lastItem.id, created_at: lastItem.created_at })
    : null;

  return {
    data,
    next_cursor: nextCursor,
    has_more: hasMore,
  };
}

/**
 * Clamp and validate the limit parameter.
 */
export function clampLimit(limit: number | undefined, defaultLimit = 20, maxLimit = 50): number {
  const val = limit ?? defaultLimit;
  return Math.min(Math.max(1, val), maxLimit);
}
