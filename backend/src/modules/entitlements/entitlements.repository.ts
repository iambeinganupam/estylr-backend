// ─────────────────────────────────────────────────────────────────────────────
// Entitlements Module — Repository
// Pure SQL. No business logic.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { FeatureDefinitionNotFoundError } from '../../lib/errors';

// ── Row types ──

export interface FeatureDefinitionRow {
  code: string;
  display_name: string;
  description: string | null;
  value_kind: 'boolean' | 'count' | 'enum';
  enum_values: string[] | null;
  default_value: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanEntitlementRow {
  plan_code: string;
  feature_code: string;
  value: unknown;
  updated_at: string;
}

export interface VendorOverrideRow {
  id: string;
  vendor_type: string;
  vendor_id: string;
  feature_code: string;
  value: unknown;
  reason: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ResolvedEntitlement {
  value: unknown;
  source: 'override' | 'plan' | 'default';
  expires_at?: string | null;
}

// ── Feature definitions ──

export async function listFeatures(activeOnly = false): Promise<FeatureDefinitionRow[]> {
  const sql = activeOnly
    ? `SELECT * FROM public.feature_definitions WHERE is_active = TRUE ORDER BY code`
    : `SELECT * FROM public.feature_definitions ORDER BY code`;
  const result = await query<FeatureDefinitionRow>(sql);
  return result.rows;
}

export async function findFeature(code: string): Promise<FeatureDefinitionRow | null> {
  return queryOne<FeatureDefinitionRow>(
    `SELECT * FROM public.feature_definitions WHERE code = $1`,
    [code],
  );
}

export async function createFeature(args: {
  code: string;
  display_name: string;
  description?: string;
  value_kind: 'boolean' | 'count' | 'enum';
  enum_values?: string[];
  default_value: unknown;
}): Promise<FeatureDefinitionRow> {
  const row = await queryOne<FeatureDefinitionRow>(
    `INSERT INTO public.feature_definitions
       (code, display_name, description, value_kind, enum_values, default_value)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      args.code,
      args.display_name,
      args.description ?? null,
      args.value_kind,
      args.enum_values ?? null,
      JSON.stringify(args.default_value),
    ],
  );
  return row!;
}

export async function updateFeature(
  code: string,
  patch: {
    display_name?: string;
    description?: string;
    default_value?: unknown;
    is_active?: boolean;
  },
): Promise<FeatureDefinitionRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.display_name !== undefined) { sets.push(`display_name = $${idx++}`); values.push(patch.display_name); }
  if (patch.description  !== undefined) { sets.push(`description = $${idx++}`);   values.push(patch.description); }
  if (patch.default_value !== undefined) { sets.push(`default_value = $${idx++}::jsonb`); values.push(JSON.stringify(patch.default_value)); }
  if (patch.is_active    !== undefined) { sets.push(`is_active = $${idx++}`);     values.push(patch.is_active); }

  if (sets.length === 0) {
    return findFeature(code);
  }

  values.push(code);
  return queryOne<FeatureDefinitionRow>(
    `UPDATE public.feature_definitions SET ${sets.join(', ')} WHERE code = $${idx} RETURNING *`,
    values as unknown[],
  );
}

// ── Plan entitlements ──

export async function listPlanEntitlementsForFeature(
  featureCode: string,
): Promise<Array<{ plan_code: string; value: unknown }>> {
  const result = await query<{ plan_code: string; value: unknown }>(
    `SELECT plan_code, value FROM public.plan_entitlements WHERE feature_code = $1 ORDER BY plan_code`,
    [featureCode],
  );
  return result.rows;
}

export async function setPlanEntitlement(
  planCode: string,
  featureCode: string,
  value: unknown,
): Promise<PlanEntitlementRow> {
  const row = await queryOne<PlanEntitlementRow>(
    `INSERT INTO public.plan_entitlements (plan_code, feature_code, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (plan_code, feature_code) DO UPDATE SET value = EXCLUDED.value
     RETURNING *`,
    [planCode, featureCode, JSON.stringify(value)],
  );
  return row!;
}

export async function deletePlanEntitlement(
  planCode: string,
  featureCode: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM public.plan_entitlements WHERE plan_code = $1 AND feature_code = $2`,
    [planCode, featureCode],
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Vendor overrides ──

export async function listActiveOverridesForFeature(
  featureCode: string,
): Promise<VendorOverrideRow[]> {
  const result = await query<VendorOverrideRow>(
    `SELECT * FROM public.vendor_entitlement_overrides
     WHERE feature_code = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`,
    [featureCode],
  );
  return result.rows;
}

export async function createOverride(
  args: {
    vendor_type: 'freelancer' | 'salon_location';
    vendor_id: string;
    feature_code: string;
    value: unknown;
    reason: string;
    expires_at?: string;
  },
  createdBy: string,
): Promise<VendorOverrideRow> {
  const row = await queryOne<VendorOverrideRow>(
    `INSERT INTO public.vendor_entitlement_overrides
       (vendor_type, vendor_id, feature_code, value, reason, expires_at, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (vendor_type, vendor_id, feature_code)
     DO UPDATE SET value = EXCLUDED.value, reason = EXCLUDED.reason,
                   expires_at = EXCLUDED.expires_at, created_by = EXCLUDED.created_by
     RETURNING *`,
    [
      args.vendor_type,
      args.vendor_id,
      args.feature_code,
      JSON.stringify(args.value),
      args.reason,
      args.expires_at ?? null,
      createdBy,
    ],
  );
  return row!;
}

export async function deleteOverride(id: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM public.vendor_entitlement_overrides WHERE id = $1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Resolver — 3-step precedence lookup ──

export async function resolveOne(
  vendorType: string,
  vendorId: string,
  planCode: string,
  featureCode: string,
): Promise<ResolvedEntitlement> {
  // Step 1: active vendor override
  const override = await queryOne<{ value: unknown; expires_at: string | null }>(
    `SELECT value, expires_at FROM public.vendor_entitlement_overrides
     WHERE vendor_type = $1
       AND vendor_id = $2
       AND feature_code = $3
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [vendorType, vendorId, featureCode],
  );
  if (override) {
    return { value: override.value, source: 'override', expires_at: override.expires_at };
  }

  // Step 2: plan-tier value
  const planRow = await queryOne<{ value: unknown }>(
    `SELECT value FROM public.plan_entitlements
     WHERE plan_code = $1 AND feature_code = $2`,
    [planCode, featureCode],
  );
  if (planRow) {
    return { value: planRow.value, source: 'plan' };
  }

  // Step 3: feature default
  const featureRow = await queryOne<{ default_value: unknown }>(
    `SELECT default_value FROM public.feature_definitions WHERE code = $1`,
    [featureCode],
  );
  if (!featureRow) {
    throw new FeatureDefinitionNotFoundError(featureCode);
  }
  return { value: featureRow.default_value, source: 'default' };
}
