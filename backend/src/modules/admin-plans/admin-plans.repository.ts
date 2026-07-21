// ─────────────────────────────────────────────────────────────────────────────
// Admin Plans — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import type { PlanCreateBody, PlanUpdateBody } from './admin-plans.schemas';

export interface PlanRow {
  id: string;
  code: string;
  display_name: string;
  tagline: string | null;
  monthly_fee_inr: number;
  commission_percent: number;
  included_bookings_per_month: number | null;
  features: string[];
  is_active: boolean;
  is_default: boolean;
  is_publicly_selectable: boolean;
  sort_order: number;
  subscriber_count: number;
  created_at: string;
  updated_at: string;
}

const ROW_SQL = `
  SELECT p.id, p.code, p.display_name, p.tagline,
         p.monthly_fee_inr::float8 AS monthly_fee_inr,
         p.commission_percent::float8 AS commission_percent,
         p.included_bookings_per_month,
         COALESCE(p.features, '[]'::jsonb) AS features,
         p.is_active, p.is_default, p.is_publicly_selectable, p.sort_order,
         (
           SELECT COUNT(*)::int FROM (
             SELECT id FROM public.business_accounts WHERE subscription_active_until > NOW()
             UNION ALL
             SELECT id FROM public.freelancer_profiles WHERE subscription_active_until > NOW()
           ) sub
         ) AS subscriber_count,
         p.created_at, p.updated_at
  FROM public.subscription_plans p
`;

export const adminPlansRepository = {
  async list(): Promise<PlanRow[]> {
    const result = await query<PlanRow>(`${ROW_SQL} ORDER BY p.sort_order, p.display_name`);
    return result.rows;
  },

  async getById(id: string): Promise<PlanRow | null> {
    return queryOne<PlanRow>(`${ROW_SQL} WHERE p.id = $1`, [id]);
  },

  async create(input: PlanCreateBody): Promise<string> {
    try {
      if (input.is_default) {
        // Only one default plan — flip any existing default off first.
        await query(`UPDATE public.subscription_plans SET is_default = FALSE WHERE is_default = TRUE`);
      }
      const r = await queryOne<{ id: string }>(
        `INSERT INTO public.subscription_plans
           (code, display_name, tagline, monthly_fee_inr, commission_percent,
            included_bookings_per_month, features, is_active, is_default,
            is_publicly_selectable, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
         RETURNING id`,
        [
          input.code, input.display_name, input.tagline ?? null,
          input.monthly_fee_inr, input.commission_percent,
          input.included_bookings_per_month ?? null,
          JSON.stringify(input.features ?? []),
          input.is_active, input.is_default,
          input.is_publicly_selectable ?? false,
          input.sort_order,
        ],
      );
      if (!r) throw new Error('Failed to insert subscription plan');
      return r.id;
    } catch (e) { mapPgError(e); }
  },

  async update(id: string, patch: PlanUpdateBody): Promise<void> {
    try {
      if (patch.is_default === true) {
        await query(`UPDATE public.subscription_plans SET is_default = FALSE WHERE is_default = TRUE AND id <> $1`, [id]);
      }
      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      const push = (col: string, value: unknown, cast?: string) => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast ?? ''}`);
      };
      if (patch.display_name !== undefined)                push('display_name', patch.display_name);
      if (patch.tagline !== undefined)                     push('tagline', patch.tagline);
      if (patch.monthly_fee_inr !== undefined)             push('monthly_fee_inr', patch.monthly_fee_inr);
      if (patch.commission_percent !== undefined)          push('commission_percent', patch.commission_percent);
      if (patch.included_bookings_per_month !== undefined) push('included_bookings_per_month', patch.included_bookings_per_month);
      if (patch.features !== undefined)                    push('features', JSON.stringify(patch.features), '::jsonb');
      if (patch.is_active !== undefined)                   push('is_active', patch.is_active);
      if (patch.is_default !== undefined)                  push('is_default', patch.is_default);
      if (patch.is_publicly_selectable !== undefined)      push('is_publicly_selectable', patch.is_publicly_selectable);
      if (patch.sort_order !== undefined)                  push('sort_order', patch.sort_order);
      if (sets.length === 1) return;
      params.push(id);
      await query(`UPDATE public.subscription_plans SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    } catch (e) { mapPgError(e); }
  },

  async softDelete(id: string): Promise<void> {
    try {
      await query(`UPDATE public.subscription_plans SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
    } catch (e) { mapPgError(e); }
  },
};
