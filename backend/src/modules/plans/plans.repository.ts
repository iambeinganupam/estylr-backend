// ─────────────────────────────────────────────────────────────────────────────
// Plans Module — Repository (raw SQL only, no business logic)
//
// Two read paths the rest of the system depends on:
//
//   • listActivePlans()      — catalog rendering on the salon dashboard
//   • getEffectivePlan(...)  — "what plan is this vendor on right now?"
//                              the answer that commission calculation needs
//
// `getEffectivePlan` resolves the active subscription if one exists and
// hasn't expired; otherwise it falls back to the catalog's `is_default`
// row (pay-as-you-go in the seeded data). This keeps the application
// layer free of "is the subscription expired" branching.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import { ResourceNotFoundError } from '../../lib/errors';
import type { VendorType } from '../../lib/constants';

export interface PlanRow {
  id: string;
  code: string;
  display_name: string;
  tagline: string | null;
  monthly_fee_inr: string;            // NUMERIC comes back as string from pg
  commission_percent: string;
  included_bookings_per_month: number | null;
  features: unknown[];
  is_active: boolean;
  is_default: boolean;
  is_publicly_selectable: boolean;
  sort_order: number;
}

export interface EffectivePlan extends PlanRow {
  /** The vendor's `subscription_active_until` snapshot, or null when
   *  they're on the default fallback plan. */
  subscription_active_until: string | null;
  /** True when the row was resolved via the vendor's active subscription
   *  (vs. the catalog default). Useful for telemetry / UI hints. */
  is_subscribed: boolean;
}

const planSelect = `
  id, code, display_name, tagline,
  monthly_fee_inr, commission_percent, included_bookings_per_month,
  features, is_active, is_default, is_publicly_selectable, sort_order
`;

export const plansRepository = {
  async listActive(): Promise<PlanRow[]> {
    const result = await query<PlanRow>(
      `SELECT ${planSelect}
       FROM public.subscription_plans
       WHERE is_active = TRUE
       ORDER BY sort_order, monthly_fee_inr`,
    );
    return result.rows;
  },

  async getByCode(code: string): Promise<PlanRow | null> {
    return queryOne<PlanRow>(
      `SELECT ${planSelect}
       FROM public.subscription_plans
       WHERE code = $1 AND is_active = TRUE`,
      [code],
    );
  },

  async getDefault(): Promise<PlanRow | null> {
    return queryOne<PlanRow>(
      `SELECT ${planSelect}
       FROM public.subscription_plans
       WHERE is_default = TRUE AND is_active = TRUE
       LIMIT 1`,
    );
  },

  /**
   * Resolve the vendor's currently effective plan.
   *
   *   1. If subscription_active_until > NOW() AND there's a matching plan
   *      code on the vendor row → that plan is active.
   *   2. Otherwise → catalog default (pay-as-you-go in seeded data).
   *
   * Vendor row holds `subscription_active_until` only — there is no
   * `subscription_plan_code` column today; we look up the most recent
   * `subscription_fee` ledger entry to figure out *which* paid plan they
   * bought. This keeps the schema small and avoids a denormalised column
   * that can drift out of sync with the ledger.
   */
  async getEffectivePlan(
    vendorType: VendorType,
    vendorId: string,
  ): Promise<EffectivePlan> {
    const expiry = await queryOne<{ subscription_active_until: string | null }>(
      vendorType === 'salon_location'
        // For salon_locations the subscription lives on business_accounts
        // (one subscription per business, all locations inherit). The
        // caller's `vendorId` may be either a salon_locations.id or the
        // business_accounts.id — resolve both shapes via UNION.
        ? `WITH target AS (
             SELECT business_account_id AS ba_id FROM public.salon_locations WHERE id = $1
             UNION ALL
             SELECT id AS ba_id FROM public.business_accounts WHERE id = $1
           )
           SELECT ba.subscription_active_until
           FROM target t JOIN public.business_accounts ba ON ba.id = t.ba_id
           LIMIT 1`
        : `SELECT subscription_active_until
           FROM public.freelancer_profiles
           WHERE id = $1`,
      [vendorId],
    );

    const activeUntil = expiry?.subscription_active_until ?? null;
    const isSubscribed = !!activeUntil && new Date(activeUntil).getTime() > Date.now();

    if (isSubscribed) {
      // Look up the most recent subscription_fee ledger entry to learn
      // which plan was purchased. notes column carries the plan code.
      const recent = await queryOne<{ notes: string | null }>(
        `SELECT notes
         FROM public.vendor_dues_ledger
         WHERE vendor_type = $1 AND vendor_id = $2 AND entry_type = 'subscription_fee'
         ORDER BY created_at DESC
         LIMIT 1`,
        [vendorType, vendorId],
      );
      const planCode = recent?.notes ?? null;
      if (planCode) {
        const plan = await this.getByCode(planCode);
        if (plan) {
          return { ...plan, subscription_active_until: activeUntil, is_subscribed: true };
        }
      }
    }

    // Fallback: catalog default (pay-as-you-go).
    const fallback = await this.getDefault();
    if (!fallback) {
      throw new ResourceNotFoundError('default subscription plan');
    }
    return { ...fallback, subscription_active_until: null, is_subscribed: false };
  },

  /**
   * Set the vendor's subscription window. The ledger entry that records
   * the invoice is written by `plansService.subscribe`, not here — keeps
   * this repo free of business logic.
   */
  async setSubscriptionWindow(
    vendorType: VendorType,
    vendorId: string,
    activeUntil: Date,
  ): Promise<void> {
    try {
      if (vendorType === 'salon_location') {
        // `vendorId` may be a salon_locations.id OR a business_accounts.id —
        // update the BA matched via either path. Single statement so it's atomic.
        await query(
          `UPDATE public.business_accounts ba
           SET subscription_active_until = $2, updated_at = NOW()
           WHERE ba.id = $1
              OR ba.id = (SELECT business_account_id FROM public.salon_locations WHERE id = $1)`,
          [vendorId, activeUntil],
        );
      } else {
        await query(
          `UPDATE public.freelancer_profiles
           SET subscription_active_until = $2, updated_at = NOW()
           WHERE id = $1`,
          [vendorId, activeUntil],
        );
      }
    } catch (e) { mapPgError(e); }
  },
};
