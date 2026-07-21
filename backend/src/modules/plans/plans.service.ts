// ─────────────────────────────────────────────────────────────────────────────
// Plans Module — Service
//
// Two callable surfaces:
//
//   list()       — used by the Settings → Plan tab to render plan cards.
//                  Numerics are coerced from pg's string output here so
//                  the controller / api-client never has to remember.
//   subscribe()  — switch a vendor onto a paid plan. Side effects:
//                  • extends `subscription_active_until` by 30 days
//                  • inserts a `subscription_fee` ledger row (vendor owes
//                    us the monthly fee — collected via PLATFORM_COLLECTION_VPA)
//
// `subscribe` is idempotent-ish: calling it twice in the same window
// extends the window further and accrues another month's fee. UI must
// disable the button when the user is already on the requested plan.
// ─────────────────────────────────────────────────────────────────────────────

import { plansRepository, type PlanRow, type EffectivePlan } from './plans.repository';
import { financeRepository } from '../finance/finance.repository';
import { ResourceNotFoundError, ConflictError } from '../../lib/errors';
import { LEDGER_ENTRY_TYPE, type VendorType } from '../../lib/constants';

const SUBSCRIPTION_PERIOD_DAYS = 30;

/** Coerce pg-string numerics to JS numbers for the wire response. */
export interface PlanView {
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
}

function toView(row: PlanRow): PlanView {
  return {
    id: row.id,
    code: row.code,
    display_name: row.display_name,
    tagline: row.tagline,
    monthly_fee_inr: Number(row.monthly_fee_inr),
    commission_percent: Number(row.commission_percent),
    included_bookings_per_month: row.included_bookings_per_month,
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    is_active: row.is_active,
    is_default: row.is_default,
    is_publicly_selectable: row.is_publicly_selectable,
    sort_order: row.sort_order,
  };
}

export interface EffectivePlanView extends PlanView {
  subscription_active_until: string | null;
  is_subscribed: boolean;
}

function toEffectiveView(row: EffectivePlan): EffectivePlanView {
  return {
    ...toView(row),
    subscription_active_until: row.subscription_active_until,
    is_subscribed: row.is_subscribed,
  };
}

export const plansService = {
  async list(): Promise<PlanView[]> {
    const rows = await plansRepository.listActive();
    return rows.map(toView);
  },

  async getEffectivePlan(vendorType: VendorType, vendorId: string): Promise<EffectivePlanView> {
    const row = await plansRepository.getEffectivePlan(vendorType, vendorId);
    return toEffectiveView(row);
  },

  /**
   * Subscribe a vendor to a paid plan.
   *
   * Default plan (pay-as-you-go) is not subscribable — vendors fall back
   * to it automatically when no active subscription exists. Attempting to
   * "subscribe" to it returns a ConflictError so the UI surfaces the
   * mistake instead of silently no-op-ing.
   */
  async subscribe(
    vendorType: VendorType,
    vendorId: string,
    planCode: string,
    opts: { waiveFirstMonth?: boolean } = {},
  ): Promise<{ plan: PlanView; active_until: string }> {
    const plan = await plansRepository.getByCode(planCode);
    if (!plan) throw new ResourceNotFoundError('Plan');
    if (plan.is_default) {
      throw new ConflictError(
        'The default plan is automatic — no subscription needed. To downgrade from a paid plan, let the current cycle expire.',
      );
    }

    const monthlyFee = Number(plan.monthly_fee_inr);
    const activeUntil = new Date(Date.now() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    await plansRepository.setSubscriptionWindow(vendorType, vendorId, activeUntil);

    if (!opts.waiveFirstMonth && monthlyFee > 0) {
      await financeRepository.appendDuesLedgerEntry({
        vendorType,
        vendorId,
        transactionId: null,
        entryType: LEDGER_ENTRY_TYPE.SUBSCRIPTION_FEE,
        amount: monthlyFee,
        notes: plan.code,
        externalRef: null,
        createdBy: null,
      });
    }

    return { plan: toView(plan), active_until: activeUntil.toISOString() };
  },
};
