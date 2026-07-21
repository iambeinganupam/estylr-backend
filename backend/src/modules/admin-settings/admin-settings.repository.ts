// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';
import type { SettingsUpdateBody } from './admin-settings.schemas';

export interface SettingsRow {
  default_commission: number;
  gst_rate: number;
  currency: string;
  payout_cycle: string;
  kyc_required_docs: string[];
  kyc_auto_expiry_days: number;
  default_category_id: string | null;
  max_services_per_vendor: number;
  feature_flags: Record<string, boolean>;
  platform_name: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

const COLS = `
  default_commission::float8 AS default_commission,
  gst_rate::float8 AS gst_rate,
  currency, payout_cycle,
  kyc_required_docs, kyc_auto_expiry_days,
  default_category_id, max_services_per_vendor,
  feature_flags, platform_name, timezone,
  created_at, updated_at
`;

export const adminSettingsRepository = {
  async get(): Promise<SettingsRow> {
    const row = await queryOne<SettingsRow>(
      `SELECT ${COLS} FROM public.platform_settings WHERE id = 'singleton'`,
    );
    if (!row) {
      // Defensive: seed if the migration's INSERT didn't run for some reason.
      try {
        await query(`INSERT INTO public.platform_settings (id) VALUES ('singleton') ON CONFLICT DO NOTHING`);
      } catch (e) { mapPgError(e); }
      const seeded = await queryOne<SettingsRow>(
        `SELECT ${COLS} FROM public.platform_settings WHERE id = 'singleton'`,
      );
      if (!seeded) throw new Error('platform_settings singleton missing and could not be seeded');
      return seeded;
    }
    return row;
  },

  async update(patch: SettingsUpdateBody): Promise<SettingsRow> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    const push = (col: string, value: unknown, cast?: string) => {
      params.push(value);
      sets.push(`${col} = $${params.length}${cast ?? ''}`);
    };
    if (patch.default_commission !== undefined)      push('default_commission', patch.default_commission);
    if (patch.gst_rate !== undefined)                push('gst_rate', patch.gst_rate);
    if (patch.currency !== undefined)                push('currency', patch.currency);
    if (patch.payout_cycle !== undefined)            push('payout_cycle', patch.payout_cycle);
    if (patch.kyc_required_docs !== undefined)       push('kyc_required_docs', JSON.stringify(patch.kyc_required_docs), '::jsonb');
    if (patch.kyc_auto_expiry_days !== undefined)    push('kyc_auto_expiry_days', patch.kyc_auto_expiry_days);
    if (patch.default_category_id !== undefined)     push('default_category_id', patch.default_category_id);
    if (patch.max_services_per_vendor !== undefined) push('max_services_per_vendor', patch.max_services_per_vendor);
    if (patch.feature_flags !== undefined)           push('feature_flags', JSON.stringify(patch.feature_flags), '::jsonb');
    if (patch.platform_name !== undefined)           push('platform_name', patch.platform_name);
    if (patch.timezone !== undefined)                push('timezone', patch.timezone);

    if (sets.length > 1) {
      try {
        await query(`UPDATE public.platform_settings SET ${sets.join(', ')} WHERE id = 'singleton'`, params);
      } catch (e) { mapPgError(e); }
    }
    return this.get();
  },
};
