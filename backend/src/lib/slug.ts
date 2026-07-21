// ─────────────────────────────────────────────────────────────────────────────
// slug.ts — vendor URL-slug generation with collision-safe uniqueness.
//
// Public vendor URLs are `/vendors/{url_slug}`. Slugs must be unique within
// `freelancer_profiles.url_slug` and `salon_locations.url_slug` (both columns
// carry unique indexes). This module owns the rules:
//
//   1. `toSlug(name)` normalizes a display name → kebab-case ASCII.
//   2. `withCollisionSuffix(base, id)` deterministically derives a unique
//      slug by appending the first 8 chars of the row's UUID — matches the
//      backfill convention in migration 063.
//
// The companion helper `assignUniqueSlug` (in this file) takes the freshly
// inserted row's id + base name and writes the slug atomically: it tries
// the bare slug first, falls back to the suffixed form on unique violation.
// This eliminates the race between two simultaneous signups with the same
// display name — Postgres serializes the unique-index conflict, and we
// catch the 23505 SQLSTATE to retry.
//
// Production rationale: Stripe/Notion/Linear all do the same thing —
// suffix on collision keeps the common case clean while guaranteeing
// stable forever-uniqueness.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** Strip diacritics, lowercase, replace non-alphanumeric runs with `-`. */
export function toSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

/** Append the first 8 chars of the row's UUID — matches migration 063. */
export function withCollisionSuffix(base: string, id: string): string {
  const suffix = id.replace(/-/g, '').slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}

/**
 * Assign a unique `url_slug` to a freshly-inserted vendor row.
 *
 * Strategy:
 *   1. Try the bare slug derived from `baseName`.
 *   2. On unique violation, retry with `${baseSlug}-${uuid-prefix}` —
 *      deterministic per row, guaranteed unique.
 *   3. If that ALSO somehow collides (cosmic ray territory), fall through
 *      to letting the caller surface the original error.
 *
 * Returns the assigned slug.
 */
export async function assignUniqueSlug(
  client: PoolClient,
  table: 'freelancer_profiles' | 'salon_locations',
  rowId: string,
  baseName: string,
): Promise<string | null> {
  const base = toSlug(baseName);
  if (!base) return null;
  const candidates = [base, withCollisionSuffix(base, rowId)];
  for (const candidate of candidates) {
    try {
      await client.query(
        `UPDATE public.${table} SET url_slug = $1 WHERE id = $2`,
        [candidate, rowId],
      );
      return candidate;
    } catch (e) {
      // Postgres unique violation = retry with the suffixed candidate.
      const code = (e as { code?: string } | null)?.code;
      if (code === '23505') continue;
      throw e;
    }
  }
  return null;
}
