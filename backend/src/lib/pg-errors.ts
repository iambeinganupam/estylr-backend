import { ConflictError, DatabaseError, ResourceNotFoundError, ValidationError } from './errors';

export interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
  column?: string;
  message?: string;
}

/** True when the value looks like a `pg` driver error (has a string `code`). */
export function isPgError(e: unknown): e is PgError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

/**
 * Map a pg SQLSTATE code to an AppError subclass.
 *
 * Returns `never` — always throws. Non-pg errors re-throw unchanged so
 * generic exceptions bubble up to the global handler intact.
 *
 * Common SQLSTATE codes (full list at https://www.postgresql.org/docs/15/errcodes-appendix.html):
 *   23505  unique_violation       → ConflictError
 *   23503  foreign_key_violation  → ResourceNotFoundError
 *   23502  not_null_violation     → ValidationError
 *   23514  check_violation        → ValidationError
 *   40001  serialization_failure  → DatabaseError (transient)
 *   40P01  deadlock_detected      → DatabaseError (transient)
 *   others                        → DatabaseError
 */
export function mapPgError(e: unknown): never {
  if (!isPgError(e)) {
    throw e;
  }
  switch (e.code) {
    case '23505':
      throw new ConflictError(
        e.detail ? `Unique constraint violated: ${e.detail}` : 'Conflict with current resource state.',
      );
    case '23503':
      throw new ResourceNotFoundError(e.table || 'related-resource');
    case '23502':
      throw new ValidationError({ field: e.column ?? '*', message: 'Required field missing.' });
    case '23514':
      throw new ValidationError({ field: e.constraint ?? '*', message: 'Value violates a check constraint.' });
    case '40001':
      throw new DatabaseError('Transient DB error (serialization failure); retry.');
    case '40P01':
      throw new DatabaseError('Transient DB error (deadlock detected); retry.');
    default:
      throw new DatabaseError(`Database operation failed (code: ${e.code}).`);
  }
}
