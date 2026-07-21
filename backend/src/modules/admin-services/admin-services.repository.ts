// ─────────────────────────────────────────────────────────────────────────────
// Admin Services — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { decodeCursor } from '../../lib/pagination';
import type {
  ServiceCreateBody,
  ServiceListQuery,
  ServiceUpdateBody,
} from './admin-services.schemas';

export interface ServiceRow {
  id: string;
  vendor_type: string;
  vendor_id: string;
  vendor_name: string | null;
  category_id: string | null;
  category_name: string | null;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  gender_target: string;
  is_active: boolean;
  inclusions: string[];
  service_location: 'onsite' | 'home' | 'both';
  created_at: string;
  updated_at: string;
}

// Resolve the human-readable vendor name. For salons the vendor_id may be
// either a salon_locations.id (location-scoped service) OR the parent
// business_accounts.id (salon-wide service). COALESCE through both paths
// so the column never comes back NULL just because of the polymorphic shape.
const VENDOR_NAME_SQL = `
  CASE WHEN s.vendor_type = 'freelancer'
       THEN (SELECT business_name FROM public.freelancer_profiles WHERE id = s.vendor_id)
       ELSE COALESCE(
              (SELECT display_name        FROM public.salon_locations  WHERE id = s.vendor_id),
              (SELECT legal_business_name FROM public.business_accounts WHERE id = s.vendor_id)
            )
  END
`;

export const adminServicesRepository = {
  async list(q: ServiceListQuery): Promise<{ rows: ServiceRow[]; hasMore: boolean }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    // vendor_id matching is intentionally tolerant of the salon polymorphic
    // shape: services are sometimes tagged with vendor_id = salon_locations.id
    // (location-scoped) and other times with vendor_id = business_accounts.id
    // (salon-wide). Accept either when the caller identifies a salon_location
    // id so the admin view never shows a false-empty catalog.
    if (q.vendor_id) {
      const v = q.vendor_id;
      params.push(v, v, v);
      const a = params.length - 2;
      const b = params.length - 1;
      const c = params.length;
      conditions.push(
        `(s.vendor_id = $${a}
          OR (s.vendor_type = 'salon_location'
              AND s.vendor_id = (SELECT business_account_id FROM public.salon_locations WHERE id = $${b}))
          OR (s.vendor_type = 'salon_location'
              AND s.vendor_id IN (SELECT id FROM public.salon_locations WHERE business_account_id = $${c})))`,
      );
    }
    if (q.vendor_type) push('s.vendor_type = ?', q.vendor_type);
    if (q.category_id) push('s.category_id = ?', q.category_id);
    if (q.is_active !== undefined) push('s.is_active = ?', q.is_active);
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      conditions.push(`(LOWER(s.name) LIKE ${p} OR LOWER(COALESCE(s.description, '')) LIKE ${p})`);
    }
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (decoded?.created_at) {
        params.push(decoded.created_at, decoded.id);
        conditions.push(`(s.created_at, s.id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitParam = `$${params.length + 1}`;
    params.push(q.limit + 1);

    const result = await query<ServiceRow>(
      `SELECT s.id, s.vendor_type, s.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              s.category_id,
              c.name AS category_name,
              s.name, s.description,
              s.price::float8 AS price,
              s.duration_minutes,
              s.gender_target, s.is_active,
              COALESCE(s.inclusions, '[]'::jsonb) AS inclusions,
              s.service_location,
              s.created_at, s.updated_at
       FROM public.services s
       LEFT JOIN public.service_categories c ON c.id = s.category_id
       ${where}
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ${limitParam}`,
      params,
    );
    const hasMore = result.rows.length > q.limit;
    return { rows: hasMore ? result.rows.slice(0, q.limit) : result.rows, hasMore };
  },

  async getById(id: string): Promise<ServiceRow | null> {
    return queryOne<ServiceRow>(
      `SELECT s.id, s.vendor_type, s.vendor_id,
              ${VENDOR_NAME_SQL} AS vendor_name,
              s.category_id,
              c.name AS category_name,
              s.name, s.description,
              s.price::float8 AS price,
              s.duration_minutes,
              s.gender_target, s.is_active,
              COALESCE(s.inclusions, '[]'::jsonb) AS inclusions,
              s.service_location,
              s.created_at, s.updated_at
       FROM public.services s
       LEFT JOIN public.service_categories c ON c.id = s.category_id
       WHERE s.id = $1`,
      [id],
    );
  },

  async create(input: ServiceCreateBody): Promise<string> {
    try {
      const r = await queryOne<{ id: string }>(
        `INSERT INTO public.services
           (vendor_type, vendor_id, category_id, name, description,
            price, duration_minutes, gender_target, is_active, inclusions,
            service_location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
         RETURNING id`,
        [
          input.vendor_type, input.vendor_id, input.category_id ?? null,
          input.name, input.description ?? null,
          input.price, input.duration_minutes,
          input.gender_target, input.is_active ?? true,
          JSON.stringify(input.inclusions ?? []),
          input.service_location ?? 'onsite',
        ],
      );
      if (!r) throw new Error('Failed to insert service');
      return r.id;
    } catch (e) { mapPgError(e); }
  },

  async update(id: string, patch: ServiceUpdateBody): Promise<void> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.category_id !== undefined)      push('category_id', patch.category_id);
    if (patch.name !== undefined)             push('name', patch.name);
    if (patch.description !== undefined)      push('description', patch.description);
    if (patch.price !== undefined)            push('price', patch.price);
    if (patch.duration_minutes !== undefined) push('duration_minutes', patch.duration_minutes);
    if (patch.gender_target !== undefined)    push('gender_target', patch.gender_target);
    if (patch.is_active !== undefined)        push('is_active', patch.is_active);
    if (patch.service_location !== undefined) push('service_location', patch.service_location);
    if (patch.inclusions !== undefined) {
      params.push(JSON.stringify(patch.inclusions));
      sets.push(`inclusions = $${params.length}::jsonb`);
    }
    if (sets.length === 1) return;
    params.push(id);
    try {
      await query(`UPDATE public.services SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    } catch (e) { mapPgError(e); }
  },

  async softDelete(id: string): Promise<void> {
    try {
      await query(`UPDATE public.services SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
    } catch (e) { mapPgError(e); }
  },
};
