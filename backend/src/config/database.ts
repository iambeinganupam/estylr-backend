// ─────────────────────────────────────────────────────────────────────────────
// Database Configuration — Raw PostgreSQL via `pg`
// ─────────────────────────────────────────────────────────────────────────────
// Uses node-postgres (pg) directly for maximum portability.
// Works with: Supabase-hosted PG, AWS RDS, self-hosted, Docker, etc.
// No ORM — raw SQL with parameterized queries for full control.
// ─────────────────────────────────────────────────────────────────────────────

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from './logger';
import { dbQueryDurationSeconds, sqlOperation } from '../lib/metrics';

// ── Connection Pool ──
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DB_POOL_MIN,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
  // Bound any single statement to 30s — analytics queries that scan
  // millions of rows must use pagination, not block a connection.
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 60_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

// ── Query Helpers ──

/**
 * Execute a parameterized SQL query using a connection from the pool.
 * Automatically releases the connection back to the pool.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const start = Date.now();
  let result: QueryResult<T>;
  try {
    result = await pool.query<T>(text, params);
  } finally {
    const duration = Date.now() - start;
    dbQueryDurationSeconds.observe({ operation: sqlOperation(text) }, duration / 1000);
  }
  const duration = Date.now() - start;

  if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace') {
    const querySnippet = env.NODE_ENV === 'production' ? '[redacted in production]' : text.substring(0, 200);
    logger.debug({
      query: querySnippet,
      params: params?.length,
      rows: result.rowCount,
      duration_ms: duration,
    }, 'SQL query executed');
  }

  return result;
}

/**
 * Execute a single-row query. Returns the first row or null.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Execute a query expecting exactly one row. Throws if not found.
 */
export async function queryOneOrThrow<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
  errorMessage = 'Resource not found',
): Promise<T> {
  const row = await queryOne<T>(text, params);
  if (!row) {
    // Import dynamically to avoid circular dependency
    const { ResourceNotFoundError } = await import('../lib/errors');
    throw new ResourceNotFoundError(errorMessage);
  }
  return row;
}

/**
 * Execute multiple statements within a database transaction.
 * Automatically commits on success, rolls back on failure.
 *
 * Usage:
 * ```ts
 * const result = await withTransaction(async (client) => {
 *   await client.query('INSERT INTO ...');
 *   await client.query('UPDATE ...');
 *   return { success: true };
 * });
 * ```
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check — verifies the database is reachable.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

/**
 * Gracefully close the connection pool.
 */
export async function closeDatabasePool(): Promise<void> {
  await pool.end();
  logger.info('PostgreSQL pool closed');
}
