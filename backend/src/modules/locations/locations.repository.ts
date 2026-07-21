// ─────────────────────────────────────────────────────────────────────────────
// Locations module — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Source for the City filter combobox used across the admin dashboard. Per
// Open Question 5 in the spec we use the union of:
//   • salon_locations.city
//   • freelancer_profiles.city
// A curated cities table is a v2 concern.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from '../../config/database';

export const locationsRepository = {
  async listDistinctCities(opts: { search?: string; limit: number }): Promise<string[]> {
    const params: unknown[] = [];
    let where = '';
    if (opts.search) {
      params.push(`%${opts.search.toLowerCase()}%`);
      where = `WHERE LOWER(city) LIKE $${params.length}`;
    }
    params.push(opts.limit);
    const limitParam = `$${params.length}`;

    const result = await query<{ city: string }>(
      `WITH cities AS (
         SELECT NULLIF(TRIM(city), '') AS city
         FROM public.salon_locations
         WHERE city IS NOT NULL
         UNION
         SELECT NULLIF(TRIM(city), '') AS city
         FROM public.freelancer_profiles
         WHERE city IS NOT NULL
       )
       SELECT DISTINCT city
       FROM cities
       WHERE city IS NOT NULL
       ${where}
       ORDER BY city ASC
       LIMIT ${limitParam}`,
      params,
    );

    return result.rows.map((r) => r.city);
  },
};
