// ─────────────────────────────────────────────────────────────────────────────
// KYC Module — Repository (raw SQL only, no business logic)
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';

export interface KycSubmissionRow {
  id: string;
  vendor_type: 'freelancer' | 'salon_location';
  vendor_id: string;
  user_id: string;
  document_type: 'aadhaar' | 'pan';
  document_number: string;
  document_media_id: string;
  selected_plan_code: string;
  status: 'submitted' | 'auto_passed' | 'auto_flagged' | 'approved' | 'rejected';
  auto_check_results: unknown[];
  auto_confidence: 'high' | 'medium' | 'low' | null;
  auto_checked_at: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Mask document number for non-admin contexts.
// Aadhaar: XXXX-XXXX-1234 (last 4 visible)
// PAN: XXXXX1234X (middle 4 digits + last char visible)
function maskDocNumber(docType: 'aadhaar' | 'pan', raw: string): string {
  if (docType === 'aadhaar') {
    return `XXXX-XXXX-${raw.slice(-4)}`;
  }
  // PAN format: AAAAANNNNA (5 alpha, 4 digits, 1 alpha)
  return `XXXXX${raw.slice(5, 9)}${raw.slice(-1)}`;
}

function maskRow(row: KycSubmissionRow): KycSubmissionRow {
  return { ...row, document_number: maskDocNumber(row.document_type, row.document_number) };
}

const SUBMISSION_COLS = `
  id, vendor_type, vendor_id, user_id, document_type, document_number,
  document_media_id, selected_plan_code, status, auto_check_results,
  auto_confidence, auto_checked_at, reviewer_id, reviewed_at,
  rejection_reason, created_at, updated_at
`;

export async function createSubmission(
  args: {
    vendorType: 'freelancer' | 'salon_location';
    vendorId: string;
    userId: string;
    documentType: 'aadhaar' | 'pan';
    documentNumber: string;
    mediaId: string;
    selectedPlanCode: string;
  },
  client?: PoolClient,
): Promise<KycSubmissionRow> {
  const exec = client
    ? (sql: string, params: unknown[]) => client.query<KycSubmissionRow>(sql, params)
    : (sql: string, params: unknown[]) => query<KycSubmissionRow>(sql, params);

  try {
    const result = await exec(
      `INSERT INTO public.kyc_submissions
         (vendor_type, vendor_id, user_id, document_type, document_number,
          document_media_id, selected_plan_code)
       VALUES ($1::vendor_type, $2, $3, $4::kyc_document_type, $5, $6, $7)
       RETURNING ${SUBMISSION_COLS}`,
      [
        args.vendorType, args.vendorId, args.userId,
        args.documentType, args.documentNumber, args.mediaId, args.selectedPlanCode,
      ],
    );
    return result.rows[0]!;
  } catch (e) { mapPgError(e); throw e; }
}

export async function findOpenSubmissionForVendor(
  vendorType: 'freelancer' | 'salon_location',
  vendorId: string,
): Promise<KycSubmissionRow | null> {
  return queryOne<KycSubmissionRow>(
    `SELECT ${SUBMISSION_COLS} FROM public.kyc_submissions
     WHERE vendor_type = $1::vendor_type AND vendor_id = $2
       AND status IN ('submitted','auto_passed','auto_flagged')`,
    [vendorType, vendorId],
  );
}

export async function findLatestForVendor(
  vendorType: 'freelancer' | 'salon_location',
  vendorId: string,
  forAdmin = false,
): Promise<KycSubmissionRow | null> {
  const row = await queryOne<KycSubmissionRow>(
    `SELECT ${SUBMISSION_COLS} FROM public.kyc_submissions
     WHERE vendor_type = $1::vendor_type AND vendor_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [vendorType, vendorId],
  );
  if (!row) return null;
  return forAdmin ? row : maskRow(row);
}

export async function findById(id: string, forAdmin = true): Promise<KycSubmissionRow | null> {
  const row = await queryOne<KycSubmissionRow>(
    `SELECT ${SUBMISSION_COLS} FROM public.kyc_submissions WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return forAdmin ? row : maskRow(row);
}

export async function setAutoCheckResults(
  id: string,
  results: unknown[],
  confidence: 'high' | 'medium' | 'low',
): Promise<void> {
  await query(
    `UPDATE public.kyc_submissions
     SET auto_check_results = $2, auto_confidence = $3, auto_checked_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(results), confidence],
  );
}

export async function updateStatus(
  id: string,
  status: 'submitted' | 'auto_passed' | 'auto_flagged' | 'approved' | 'rejected',
  client?: PoolClient,
): Promise<void> {
  const exec = client
    ? (sql: string, params: unknown[]) => client.query(sql, params)
    : (sql: string, params: unknown[]) => query(sql, params);
  await exec(
    `UPDATE public.kyc_submissions SET status = $2, updated_at = NOW() WHERE id = $1`,
    [id, status],
  );
}

export interface PendingKycRow extends KycSubmissionRow {
  // Vendor entity
  vendor_name?: string | null;
  brand_name?: string | null;
  gstin?: string | null;
  trade_license?: string | null;
  // Owner identity (from users)
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  owner_email?: string | null;
  owner_phone?: string | null;
  owner_role?: string | null;
  owner_created_at?: string | null;
  // Primary outlet / freelancer address
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  gender_preference?: string | null;
  // Plan
  plan_name?: string | null;
  plan_monthly_fee_inr?: number | null;
  plan_commission_percent?: number | null;
  // Document
  document_url?: string | null;
}

/**
 * Pending KYC for admin review. The polymorphic shape of the queue means we
 * fan out a row's `vendor_id` against either `business_accounts` (for salons —
 * vendor_id IS the business_account.id, the location lives on a separate row)
 * or `freelancer_profiles` (for freelancers — vendor_id IS the profile.id).
 *
 * Salons may have multiple locations; we surface the earliest-created one as
 * the "primary" outlet so the reviewer always sees an address.
 */
export async function listPending(): Promise<PendingKycRow[]> {
  const result = await query<PendingKycRow>(
    `SELECT
       ks.id, ks.vendor_type, ks.vendor_id, ks.user_id, ks.document_type, ks.document_number,
       ks.document_media_id, ks.selected_plan_code, ks.status, ks.auto_check_results,
       ks.auto_confidence, ks.auto_checked_at, ks.reviewer_id, ks.reviewed_at,
       ks.rejection_reason, ks.created_at, ks.updated_at,

       COALESCE(ba.legal_business_name, fp.business_name)         AS vendor_name,
       COALESCE(ba.brand_name, fp.display_name)                   AS brand_name,
       ba.gstin                                                   AS gstin,
       ba.trade_license                                           AS trade_license,

       u.first_name                                               AS owner_first_name,
       u.last_name                                                AS owner_last_name,
       u.email                                                    AS owner_email,
       u.phone_number                                             AS owner_phone,
       u.role::text                                               AS owner_role,
       u.created_at                                               AS owner_created_at,

       COALESCE(sl.address_line1, fp.address_line1)               AS address_line1,
       COALESCE(sl.address_line2, NULL)                           AS address_line2,
       COALESCE(sl.city, fp.city)                                 AS city,
       COALESCE(sl.state, fp.state)                               AS state,
       COALESCE(sl.postal_code, fp.postal_code)                   AS postal_code,
       COALESCE(sl.gender_preference, fp.gender_preference)       AS gender_preference,

       sp.display_name                                            AS plan_name,
       sp.monthly_fee_inr                                         AS plan_monthly_fee_inr,
       sp.commission_percent                                      AS plan_commission_percent,

       mi.file_url                                                AS document_url

     FROM public.kyc_submissions ks
     LEFT JOIN public.users u                  ON u.id = ks.user_id
     LEFT JOIN public.business_accounts ba     ON ks.vendor_type = 'salon_location' AND ba.id = ks.vendor_id
     LEFT JOIN LATERAL (
       SELECT * FROM public.salon_locations
       WHERE business_account_id = ks.vendor_id
       ORDER BY created_at ASC
       LIMIT 1
     ) sl ON ks.vendor_type = 'salon_location'
     LEFT JOIN public.freelancer_profiles fp   ON ks.vendor_type = 'freelancer' AND fp.id = ks.vendor_id
     LEFT JOIN public.subscription_plans sp    ON sp.code = ks.selected_plan_code
     LEFT JOIN public.media_items mi           ON mi.id = ks.document_media_id
     WHERE ks.status IN ('submitted','auto_passed','auto_flagged')
     ORDER BY ks.created_at ASC`,
    [],
  );
  return result.rows;
}

export async function decide(
  id: string,
  action: 'approve' | 'reject',
  reviewerId: string,
  reason?: string,
  client?: PoolClient,
): Promise<KycSubmissionRow | null> {
  const status = action === 'approve' ? 'approved' : 'rejected';
  const exec = client
    ? (sql: string, params: unknown[]) => client.query(sql, params)
    : (sql: string, params: unknown[]) => query(sql, params);
  try {
    const result = await exec(
      `UPDATE public.kyc_submissions
       SET status = $2, reviewer_id = $3, reviewed_at = NOW(),
           rejection_reason = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING ${SUBMISSION_COLS}`,
      [id, status, reviewerId, reason ?? null],
    );
    return (result.rows[0] as KycSubmissionRow) ?? null;
  } catch (e) { mapPgError(e); throw e; }
}

export async function markVendorVerified(
  vendorType: 'freelancer' | 'salon_location',
  vendorId: string,
  planCode: string,
  client?: PoolClient,
): Promise<void> {
  const exec = client
    ? (sql: string, params: unknown[]) => client.query(sql, params)
    : (sql: string, params: unknown[]) => query(sql, params);

  if (vendorType === 'freelancer') {
    await exec(
      `UPDATE public.freelancer_profiles
       SET is_verified = TRUE, current_plan_code = $2, updated_at = NOW()
       WHERE id = $1`,
      [vendorId, planCode],
    );
  } else {
    // salon_location: update the business_account that owns this location.
    // vendorId may be either a salon_locations.id or a business_accounts.id.
    await exec(
      `UPDATE public.business_accounts ba
       SET current_plan_code = $2, updated_at = NOW()
       WHERE ba.id = $1
          OR ba.id = (SELECT business_account_id FROM public.salon_locations WHERE id = $1)`,
      [vendorId, planCode],
    );
    // Also mark the salon_location verified.
    await exec(
      `UPDATE public.salon_locations
       SET is_verified = TRUE, updated_at = NOW()
       WHERE id = $1
          OR business_account_id = $1`,
      [vendorId],
    );
  }
}

/** Returns user ids of all super_admin users — used to fan-out kyc_submitted notifications. */
export async function listSuperAdminUserIds(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `SELECT id FROM public.users WHERE role = 'super_admin' AND is_active = TRUE AND deleted_at IS NULL`,
    [],
  );
  return result.rows.map((r) => r.id);
}
