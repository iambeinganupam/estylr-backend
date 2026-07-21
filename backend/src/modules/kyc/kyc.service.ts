// ─────────────────────────────────────────────────────────────────────────────
// KYC Module — Service (business logic, no HTTP concerns)
// ─────────────────────────────────────────────────────────────────────────────

import * as repo from './kyc.repository';
import { plansRepository } from '../plans/plans.repository';
import { dispatch } from '../notifications/notifications.service';
import { getKycVerifiers, aggregateConfidence } from '../../adapters/kyc';
import { withTransaction } from '../../config/database';
import { mediaRepository } from '../media/media.repository';
import {
  KycSubmissionNotFoundError,
  KycPendingError,
  KycRejectedError,
  ConflictError,
  ResourceNotFoundError,
} from '../../lib/errors';
import { kycDecisionsTotal } from '../../lib/metrics';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import type { Request } from 'express';

type VendorType = 'freelancer' | 'salon_location';

export async function submitKyc(args: {
  vendorType: VendorType;
  vendorId: string;
  userId: string;
  documentType: 'aadhaar' | 'pan';
  documentNumber: string;
  mediaId: string;
  planCode: string;
}) {
  // 1. Verify the plan exists + is active.
  const plan = await plansRepository.getByCode(args.planCode);
  if (!plan || !plan.is_active) throw new ResourceNotFoundError(`plan '${args.planCode}'`);

  // 2. Verify the uploaded document exists and belongs to this vendor.
  //    Direct findById is the right method here: listByVendor intentionally
  //    excludes media_type='kyc' so KYC documents never leak into the
  //    portfolio gallery, but THIS code path explicitly *wants* the KYC
  //    row it just uploaded. Routing through findById keeps the gallery
  //    safe while letting submit find its own document.
  const media = (await mediaRepository.findById(
    args.mediaId,
    args.vendorType,
    args.vendorId,
  )) as { id: string; file_url: string; mime_type: string; file_key?: string | null; uploaded_by?: string } | null;
  if (!media) throw new ResourceNotFoundError('media');

  // 3. Block if there's already an open submission.
  const existing = await repo.findOpenSubmissionForVendor(args.vendorType, args.vendorId);
  if (existing) throw new ConflictError('You already have a KYC submission under review.');

  return withTransaction(async (client) => {
    // 4. Insert the submission row atomically.
    const sub = await repo.createSubmission({
      vendorType: args.vendorType,
      vendorId: args.vendorId,
      userId: args.userId,
      documentType: args.documentType,
      documentNumber: args.documentNumber,
      mediaId: args.mediaId,
      selectedPlanCode: args.planCode,
    }, client);

    // 5. Run automated checks (outside TX isolation — I/O bound, best-effort).
    //    We update auto_check_results + auto_confidence AFTER insert so the row
    //    is committed even if the verifier crashes.
    const verifiers = getKycVerifiers().filter((v) => v.supports(args.documentType));
    const checkInput = {
      docType: args.documentType,
      documentNumber: args.documentNumber,
      // imagePath: omitted in v1 — OCR verifier is disabled until local storage is wired
      mimeType: (media as { mime_type?: string }).mime_type,
    };
    const allResults = (
      await Promise.all(verifiers.map((v) => v.verify(checkInput)))
    ).flat();
    const confidence = aggregateConfidence(allResults);
    const newStatus = (confidence === 'high') ? 'auto_passed' : 'auto_flagged';

    // Update the auto-check columns and status using the same client (same TX).
    await client.query(
      `UPDATE public.kyc_submissions
       SET auto_check_results = $2, auto_confidence = $3, auto_checked_at = NOW(),
           status = $4, updated_at = NOW()
       WHERE id = $1`,
      [sub.id, JSON.stringify(allResults), confidence, newStatus],
    );

    // 6. Notify all super admins of the new submission (in the same TX).
    const adminUserIds = await repo.listSuperAdminUserIds();
    for (const adminUserId of adminUserIds) {
      await dispatch(
        {
          userId: adminUserId,
          type: 'kyc_submitted',
          data: {
            submission_id: sub.id,
            vendor_type: args.vendorType,
            vendor_id: args.vendorId,
            document_type: args.documentType,
            plan_code: args.planCode,
            confidence,
          },
          dedupeKey: `kyc:${sub.id}:submitted:${adminUserId}`,
        },
        client,
      );
    }

    return { ...sub, status: newStatus as repo.KycSubmissionRow['status'], auto_check_results: allResults, auto_confidence: confidence };
  });
}

export async function approve(submissionId: string, reviewerId: string, req?: Request) {
  return withTransaction(async (client) => {
    const sub = await repo.findById(submissionId, true);
    if (!sub) throw new KycSubmissionNotFoundError(submissionId);
    if (sub.status === 'approved' || sub.status === 'rejected') {
      throw new ConflictError(`Submission already ${sub.status}.`);
    }

    await repo.decide(submissionId, 'approve', reviewerId, undefined, client);
    await repo.markVendorVerified(sub.vendor_type, sub.vendor_id, sub.selected_plan_code, client);

    await dispatch(
      {
        userId: sub.user_id,
        type: 'kyc_approved',
        data: { submission_id: sub.id, plan_code: sub.selected_plan_code },
        dedupeKey: `kyc:${sub.id}:approved`,
      },
      client,
    );

    kycDecisionsTotal.inc({ outcome: 'approved' });

    if (req) {
      await recordAudit({
        action: AUDIT_ACTION.KYC_APPROVE,
        entityType: AUDIT_ENTITY.KYC,
        entityId: submissionId,
        after: { status: 'approved', vendor_type: sub.vendor_type, vendor_id: sub.vendor_id },
        req,
      });
    }

    return { ...sub, status: 'approved' as const, reviewer_id: reviewerId };
  });
}

export async function reject(submissionId: string, reviewerId: string, reason: string, req?: Request) {
  return withTransaction(async (client) => {
    const sub = await repo.findById(submissionId, true);
    if (!sub) throw new KycSubmissionNotFoundError(submissionId);
    if (sub.status === 'approved' || sub.status === 'rejected') {
      throw new ConflictError(`Submission already ${sub.status}.`);
    }

    await repo.decide(submissionId, 'reject', reviewerId, reason, client);

    await dispatch(
      {
        userId: sub.user_id,
        type: 'kyc_rejected',
        data: { submission_id: sub.id, reason },
        dedupeKey: `kyc:${sub.id}:rejected`,
      },
      client,
    );

    kycDecisionsTotal.inc({ outcome: 'rejected' });

    if (req) {
      await recordAudit({
        action: AUDIT_ACTION.KYC_REJECT,
        entityType: AUDIT_ENTITY.KYC,
        entityId: submissionId,
        after: { status: 'rejected', reason },
        req,
      });
    }

    return { ...sub, status: 'rejected' as const, reviewer_id: reviewerId, rejection_reason: reason };
  });
}

export async function listPending() {
  return repo.listPending();
}

export async function getStatus(vendorType: VendorType, vendorId: string): Promise<{
  status: 'not_started' | repo.KycSubmissionRow['status'];
  submission?: repo.KycSubmissionRow;
  plan: { code: string; display_name: string };
}> {
  const [latest, effectivePlan] = await Promise.all([
    repo.findLatestForVendor(vendorType, vendorId, false),
    plansRepository.getEffectivePlan(vendorType, vendorId).catch(() => null),
  ]);

  return {
    status: latest?.status ?? 'not_started',
    submission: latest ?? undefined,
    plan: {
      code: effectivePlan?.code ?? 'pay_as_you_go',
      display_name: effectivePlan?.display_name ?? 'Pay as you go',
    },
  };
}

/** Used by kycGuard middleware — lightweight check, no masking needed internally. */
export async function getLatestForGuard(
  vendorType: VendorType,
  vendorId: string,
): Promise<repo.KycSubmissionRow | null> {
  return repo.findLatestForVendor(vendorType, vendorId, true);
}

/** Re-export error classes so kycGuard can import from one place. */
export { KycPendingError, KycRejectedError };
