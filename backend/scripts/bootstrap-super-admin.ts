#!/usr/bin/env tsx
/**
 * Interactive CLI to bootstrap a super_admin user.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx backend/scripts/bootstrap-super-admin.ts
 *
 * In production, additionally requires --force:
 *   NODE_ENV=production DATABASE_URL=... npx tsx backend/scripts/bootstrap-super-admin.ts --force
 *
 * The script:
 *   1. Prompts for email + password (password hidden during input).
 *   2. Validates the email format + password strength.
 *   3. Hashes the password with bcrypt (env.BCRYPT_ROUNDS).
 *   4. Inserts a row in `public.users` with role='super_admin'.
 *   5. Emits an `audit_log` row with action='super_admin.bootstrap'.
 *   6. Exits with non-zero status on any failure.
 *
 * Refuses to run if a super_admin already exists (idempotent guard).
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env';
import { pool, queryOne, withTransaction } from '../src/config/database';
import { logger } from '../src/config/logger';

function readPasswordHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean };
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    let buf = '';
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '') { process.exit(130); }  // Ctrl+C
        if (ch === '' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (env.NODE_ENV === 'production' && !args.has('--force')) {
    console.error('Refusing to bootstrap a super_admin in production without --force.');
    process.exit(1);
  }

  // Idempotent guard: refuse if a super_admin already exists.
  const existing = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM public.users WHERE role = 'super_admin' AND deleted_at IS NULL`,
    [],
  );
  if (existing && Number(existing.count) > 0) {
    console.error(`Refusing to bootstrap: ${existing.count} super_admin user(s) already exist.`);
    console.error('Use the admin UI or a targeted SQL update to add additional super_admins.');
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  try {
    const email = (await rl.question('Email: ')).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('Invalid email format.');
      process.exit(1);
    }

    const password = await readPasswordHidden('Password (min 12 chars, mixed case + digit): ');
    if (
      password.length < 12 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password)
    ) {
      console.error('Password too weak. Need >=12 chars, mixed case, and a digit.');
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const userId = await withTransaction(async (client) => {
      const userRow = await client.query<{ id: string }>(
        `INSERT INTO public.users (email, password_hash, role, is_active, is_email_verified)
         VALUES ($1, $2, 'super_admin', TRUE, TRUE)
         RETURNING id`,
        [email, passwordHash],
      );
      const id = userRow.rows[0]?.id;
      if (!id) throw new Error('INSERT into users returned no id');

      await client.query(
        `INSERT INTO public.audit_log
           (admin_user_id, action, entity_type, entity_id, payload_after)
         VALUES ($1, 'super_admin.bootstrap', 'user', $1, $2::jsonb)`,
        [id, JSON.stringify({ email, via: 'cli', nodeEnv: env.NODE_ENV })],
      );

      return id;
    });

    console.log(`Created super_admin user: ${userId} (${email}).`);
    console.log('Audit log emitted. You can now log in via the admin dashboard.');
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((e) => {
  logger.error({ err: e }, 'bootstrap-super-admin failed');
  console.error('Bootstrap failed:', (e as Error)?.message ?? e);
  process.exit(1);
});
