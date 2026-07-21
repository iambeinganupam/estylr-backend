#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Migration Runner — node-pg-migrate compatible
// ─────────────────────────────────────────────────────────────────────────────
// Usage:
//   npx tsx scripts/migrate.ts up        — apply all pending migrations
//   npx tsx scripts/migrate.ts down      — roll back last migration (dev/test only)
//   npx tsx scripts/migrate.ts reset     — drop public schema and re-apply all (dev/test only)
//   npx tsx scripts/migrate.ts status    — show applied vs pending
// ─────────────────────────────────────────────────────────────────────────────

import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import 'dotenv/config';

export type MigrationType = 'schema' | 'seed-dev';

/**
 * Read the type header from a migration's SQL body.
 * - `-- TYPE: schema` (default) → applies in every env.
 * - `-- TYPE: seed-dev` → applies only in development/test, gated by SEED_DEV_DATA=true.
 * Case-insensitive on both keyword and value.
 */
export function classifyMigration(sql: string): MigrationType {
  const m = sql.match(/^--\s*TYPE:\s*(schema|seed-dev)\b/im);
  return (m?.[1]?.toLowerCase() as MigrationType | undefined) ?? 'schema';
}

/**
 * Decide whether a migration of the given type should run in this env.
 * Schema migrations always run. Seed-dev migrations run only in development
 * or test environments AND only when SEED_DEV_DATA=true is set.
 */
export function shouldApplyMigration(
  type: MigrationType,
  nodeEnv: string,
  seedDevDataFlag: boolean,
): boolean {
  if (type === 'schema') return true;
  if (type !== 'seed-dev') return false;
  if (!seedDevDataFlag) return false;
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/**
 * Decide whether `migrate down` is permitted in this environment.
 * Production schema rollback must be a NEW forward migration, not an automatic down.
 * See docs/MIGRATION_OPERATIONS.md.
 */
export function shouldAllowDown(nodeEnv: string): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL env var is required');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const pool = new Pool({ connectionString: DATABASE_URL });

const command = process.argv[2] ?? 'status';

async function ensureMigrationsTable(client: import('pg').PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    VARCHAR(255) NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client: import('pg').PoolClient): Promise<Set<string>> {
  const res = await client.query('SELECT filename FROM public.schema_migrations ORDER BY id');
  return new Set(res.rows.map((r: { filename: string }) => r.filename));
}

function getMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .sort();
}

async function runUp(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files = getMigrationFiles();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('✅ All migrations are up to date.');
      return;
    }

    const nodeEnv = process.env.NODE_ENV ?? 'development';
    const seedDevFlag = process.env.SEED_DEV_DATA === 'true';

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      const type = classifyMigration(sql);

      if (!shouldApplyMigration(type, nodeEnv, seedDevFlag)) {
        console.log(`[skip] ${file} (type=${type}, NODE_ENV=${nodeEnv}, SEED_DEV_DATA=${seedDevFlag})`);
        continue;
      }

      console.log(`⏩ Applying: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        console.log(`✅ Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Failed: ${file}\n   ${msg}`);
        process.exit(1);
      }
    }
    console.log(`\n🎉 ${pending.length} migration(s) applied successfully.`);
  } finally {
    client.release();
  }
}

async function runDown(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!shouldAllowDown(nodeEnv)) {
    console.error(
      `Refusing to run \`migrate down\` in NODE_ENV=${nodeEnv}.\n` +
      `Production schema rollback must be a NEW forward migration, never an automatic down.\n` +
      `See docs/MIGRATION_OPERATIONS.md.`,
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const res = await client.query(
      'SELECT filename FROM public.schema_migrations ORDER BY id DESC LIMIT 1',
    );
    if (res.rows.length === 0) {
      console.log('Nothing to roll back — no migrations have been applied.');
      return;
    }

    const upFile: string = res.rows[0].filename as string;
    const downFile = upFile.replace(/\.up\.sql$/, '.down.sql');
    const downPath = path.join(MIGRATIONS_DIR, downFile);

    if (!fs.existsSync(downPath)) {
      console.error(`❌ Down migration not found: ${downFile}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(downPath, 'utf-8');
    console.log(`⏪ Rolling back: ${upFile}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'DELETE FROM public.schema_migrations WHERE filename = $1',
        [upFile],
      );
      await client.query('COMMIT');
      console.log(`✅ Rolled back: ${upFile}`);
    } catch (err) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Failed to roll back: ${upFile}\n   ${msg}`);
      process.exit(1);
    }
  } finally {
    client.release();
  }
}

async function runReset(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    console.error(
      `Refusing to run \`migrate reset\` in NODE_ENV=${nodeEnv}.\n` +
      `reset drops the entire public schema and is only safe in development/test.\n` +
      `See docs/MIGRATION_OPERATIONS.md.`,
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('⚠️  Dropping public schema and recreating from scratch…');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('✅ Schema dropped and recreated.');
  } finally {
    client.release();
  }

  // Re-apply all up migrations via the standard runUp path.
  await runUp();
}

async function runStatus(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files = getMigrationFiles();

    console.log('\n── Schema Migration Status ──');
    console.log('Applied (✅) | Pending (⏳)\n');
    for (const f of files) {
      const mark = applied.has(f) ? '✅' : '⏳';
      console.log(`  ${mark}  ${f}`);
    }
    console.log(`\nTotal: ${files.length} | Applied: ${applied.size} | Pending: ${files.length - applied.size}`);
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  try {
    switch (command) {
      case 'up':
        await runUp();
        break;
      case 'down':
        await runDown();
        break;
      case 'reset':
        await runReset();
        break;
      case 'status':
        await runStatus();
        break;
      default:
        console.error(`Unknown command: ${command}. Use: up | down | reset | status`);
        process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

// Only run the CLI when invoked directly. Importing this module for its
// pure exports (classifyMigration / shouldApplyMigration / shouldAllowDown
// in tests/unit/migrate-runner.test.ts) must NOT trigger the runner — it
// would call process.exit and try to connect to a DB that isn't there.
const invokedScript = process.argv[1] ?? '';
if (invokedScript.endsWith('migrate.ts') || invokedScript.endsWith('migrate.js')) {
  main().catch((err) => {
    console.error('Migration runner error:', err);
    process.exit(1);
  });
}
