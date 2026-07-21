import { ValidationError } from './errors';

/**
 * Build a parameterized SET clause from a partial fields object, enforcing
 * a column-name allowlist. Column names that are NOT in the allowlist are
 * silently dropped (not surfaced as errors — callers may pass extra Zod
 * output keys). If NO valid keys remain, a ValidationError is thrown.
 *
 * - By default, $1 is reserved for the WHERE clause and SET values start at $2.
 * - Pass `paramOffset: N` when the query has multiple WHERE params; bindings
 *   then start at $(N+1). E.g. for `WHERE id = $1 AND event_id = $2`, pass
 *   `paramOffset: 2` so the SET clause starts at $3.
 * - undefined values are skipped (no-op fields).
 *
 * @example
 *   // Single WHERE param (most common):
 *   const { setClause, values } = buildUpdateSet(req.body, ['first_name', 'last_name'] as const);
 *   await query(`UPDATE users SET ${setClause} WHERE id = $1`, [userId, ...values]);
 *
 *   // Two WHERE params:
 *   const { setClause, values } = buildUpdateSet(req.body, ['notes'] as const, { paramOffset: 2 });
 *   await query(`UPDATE event_attendees SET ${setClause} WHERE id = $1 AND event_id = $2`, [attId, eventId, ...values]);
 */
export function buildUpdateSet<T extends string>(
  fields: Partial<Record<T, unknown>>,
  allowed: readonly T[],
  options: { paramOffset?: number } = {},
): { setClause: string; values: unknown[] } {
  const offset = options.paramOffset ?? 1;
  const allowedSet = new Set<string>(allowed);
  const entries = Object.entries(fields).filter(
    ([k, v]) => v !== undefined && allowedSet.has(k),
  );
  if (entries.length === 0) {
    throw new ValidationError({ field: '*', message: 'No valid fields to update.' });
  }
  const setClause = entries.map(([k], i) => `${k} = $${i + offset + 1}`).join(', ');
  const values = entries.map(([, v]) => v);
  return { setClause, values };
}
