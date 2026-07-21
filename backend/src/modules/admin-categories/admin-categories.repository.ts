// ─────────────────────────────────────────────────────────────────────────────
// Admin Categories — Repository (raw SQL only; no business logic)
//
// Scope: GLOBAL rows only (vendor_id IS NULL). Vendor-scoped custom rows
// are owned by the catalog module and never touched here. Soft-delete is the
// default removal path — taxonomy history is load-bearing for analytics and
// for any services.category_id FK that already points at the row.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';

export interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  aliases: string[] | null;
  sort_order: number;
  is_active: boolean;
  audience: string | null;
  vendor_type: string | null;
  vendor_id: string | null;
  created_at: string;
  updated_at: string;
}

export const adminCategoriesRepository = {
  async list(filters: {
    audience?: string;
    parent_id?: string | null;
    include_inactive?: boolean;
    search?: string;
  }): Promise<CategoryRow[]> {
    const conditions: string[] = ['vendor_id IS NULL'];
    const params: unknown[] = [];
    let i = 1;

    if (!filters.include_inactive) {
      conditions.push(`is_active = TRUE`);
    }
    if (filters.audience) {
      conditions.push(`COALESCE(audience, 'grooming') = $${i++}`);
      params.push(filters.audience);
    }
    if (filters.parent_id === null) {
      conditions.push(`parent_id IS NULL`);
    } else if (typeof filters.parent_id === 'string') {
      conditions.push(`parent_id = $${i++}`);
      params.push(filters.parent_id);
    }
    if (filters.search) {
      conditions.push(`(LOWER(name) LIKE $${i} OR slug LIKE $${i})`);
      params.push(`%${filters.search.toLowerCase()}%`);
      i++;
    }

    const result = await query<CategoryRow>(
      `SELECT id, parent_id, name, slug, description, icon, icon_url, aliases,
              sort_order, is_active, audience, vendor_type, vendor_id,
              created_at, updated_at
         FROM public.service_categories
        WHERE ${conditions.join(' AND ')}
        ORDER BY sort_order, LOWER(name)`,
      params,
    );
    return result.rows;
  },

  async getById(id: string): Promise<CategoryRow | null> {
    return queryOne<CategoryRow>(
      `SELECT id, parent_id, name, slug, description, icon, icon_url, aliases,
              sort_order, is_active, audience, vendor_type, vendor_id,
              created_at, updated_at
         FROM public.service_categories
        WHERE id = $1`,
      [id],
    );
  },

  async create(data: {
    parent_id: string | null;
    name: string;
    slug: string | null;
    audience: string | null;
    description: string | null;
    icon: string | null;
    aliases: string[] | null;
    sort_order: number | null;
    is_active: boolean | null;
  }): Promise<CategoryRow> {
    try {
      const row = await queryOne<CategoryRow>(
        // Slug auto-derives from name when omitted (same expression as 073).
        // sort_order defaults to 100 (after the curated 10–90 range) so new
        // admin-curated rows land at the end and can be reordered cheaply.
        //
        // $2 carries an explicit ::varchar cast at BOTH use sites — the column
        // wants varchar and REGEXP_REPLACE wants text, and without consistent
        // casts PostgreSQL's prepared-statement parser raises 42P08
        // "inconsistent types deduced for parameter $2" because it sees the
        // two conflicting hints and refuses to pick one.
        `INSERT INTO public.service_categories
           (parent_id, name, slug, audience, description, icon, aliases,
            sort_order, is_active, vendor_type, vendor_id)
         VALUES (
           $1,
           $2::varchar,
           COALESCE(
             $3,
             TRIM(BOTH '-' FROM LOWER(
               REGEXP_REPLACE(REGEXP_REPLACE($2::varchar, '''', '', 'g'), '[^a-zA-Z0-9]+', '-', 'g')
             ))
           ),
           COALESCE($4, 'grooming'),
           $5,
           $6,
           COALESCE($7::text[], ARRAY[]::text[]),
           COALESCE($8, 100),
           COALESCE($9, TRUE),
           NULL,
           NULL
         )
         RETURNING id, parent_id, name, slug, description, icon, icon_url,
                   aliases, sort_order, is_active, audience, vendor_type,
                   vendor_id, created_at, updated_at`,
        [
          data.parent_id,
          data.name,
          data.slug,
          data.audience,
          data.description,
          data.icon,
          data.aliases,
          data.sort_order,
          data.is_active,
        ],
      );
      // queryOne returns CategoryRow | null; INSERT...RETURNING always yields a row.
      return row as CategoryRow;
    } catch (e) {
      mapPgError(e);
      throw e; // unreachable — mapPgError throws
    }
  },

  async update(id: string, fields: Record<string, unknown>): Promise<CategoryRow | null> {
    const ALLOWED = [
      'parent_id', 'name', 'slug', 'audience', 'description', 'icon',
      'aliases', 'sort_order', 'is_active',
    ] as const;
    const { setClause, values } = buildUpdateSet(fields, ALLOWED, { paramOffset: 1 });
    try {
      return await queryOne<CategoryRow>(
        `UPDATE public.service_categories
            SET ${setClause}, updated_at = NOW()
          WHERE id = $1
            AND vendor_id IS NULL
          RETURNING id, parent_id, name, slug, description, icon, icon_url,
                    aliases, sort_order, is_active, audience, vendor_type,
                    vendor_id, created_at, updated_at`,
        [id, ...values],
      );
    } catch (e) {
      mapPgError(e);
      throw e;
    }
  },

  /** Soft-delete: is_active = FALSE. Existing services.category_id FKs
   *  remain valid; the row simply stops appearing in browse / picker lists.
   *  Hard-delete would cascade-break audit history. */
  async softDelete(id: string): Promise<CategoryRow | null> {
    return queryOne<CategoryRow>(
      `UPDATE public.service_categories
          SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 AND vendor_id IS NULL
        RETURNING id, parent_id, name, slug, description, icon, icon_url,
                  aliases, sort_order, is_active, audience, vendor_type,
                  vendor_id, created_at, updated_at`,
      [id],
    );
  },

  /** Count active children of a root + count services that reference it.
   *  Used by the service layer to decide whether soft-delete is safe to
   *  perform without manual ack from the admin. */
  async countDependents(id: string): Promise<{ active_subs: number; service_refs: number }> {
    const row = await queryOne<{ active_subs: string; service_refs: string }>(
      `SELECT
         (SELECT COUNT(*)::int FROM public.service_categories
           WHERE parent_id = $1 AND vendor_id IS NULL AND is_active = TRUE) AS active_subs,
         (SELECT COUNT(*)::int FROM public.services
           WHERE category_id = $1 AND is_active = TRUE) AS service_refs`,
      [id],
    );
    return {
      active_subs: Number(row?.active_subs ?? 0),
      service_refs: Number(row?.service_refs ?? 0),
    };
  },

  /** Promote a vendor-scoped custom category to global. Sets vendor_type
   *  and vendor_id to NULL, preserving the row's id so existing
   *  services.category_id FKs inherit global status silently. Idempotent —
   *  already-global rows return unchanged. */
  async promoteToGlobal(id: string): Promise<CategoryRow | null> {
    return queryOne<CategoryRow>(
      `UPDATE public.service_categories
          SET vendor_type = NULL, vendor_id = NULL, updated_at = NOW()
        WHERE id = $1
        RETURNING id, parent_id, name, slug, description, icon, icon_url,
                  aliases, sort_order, is_active, audience, vendor_type,
                  vendor_id, created_at, updated_at`,
      [id],
    );
  },

  /** Bulk reorder under a single parent. Atomic via withTransaction so a
   *  half-applied reorder can't leave gaps. sort_order spread is 10·index
   *  so future single-row inserts can land between siblings without a
   *  re-shuffle. */
  async reorder(parent_id: string | null, ids: string[]): Promise<number> {
    let updated = 0;
    await withTransaction(async (client) => {
      for (let i = 0; i < ids.length; i++) {
        const result = await client.query(
          `UPDATE public.service_categories
              SET sort_order = $1, updated_at = NOW()
            WHERE id = $2
              AND vendor_id IS NULL
              AND ((parent_id IS NULL AND $3::uuid IS NULL) OR parent_id = $3)`,
          [(i + 1) * 10, ids[i], parent_id],
        );
        updated += result.rowCount ?? 0;
      }
    });
    return updated;
  },
};
