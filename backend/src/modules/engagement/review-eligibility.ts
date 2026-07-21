// ─────────────────────────────────────────────────────────────────────────────
// canReview — gates polymorphic review submissions.
// ─────────────────────────────────────────────────────────────────────────────
// 'vendor' and 'service_line' kinds: customer must have a completed appointment
// for the target (vendor id or service id respectively). The repo's
// countCompletedAppointmentsForTarget query encodes this.
// 'product' kind: until R3 wires real product-purchase eligibility, gating is
// via the FEATURE_PRODUCT_REVIEWS_OPEN env flag. Defaults to closed.

import { REVIEW_TARGET_KIND, type ReviewTargetKind } from '../../lib/constants';

export interface ReviewEligibilityRepo {
  countCompletedAppointmentsForTarget(args: {
    userId: string; kind: ReviewTargetKind; targetId: string;
  }): Promise<number>;
}

export async function canReview(
  repo: ReviewEligibilityRepo,
  input: { userId: string; kind: ReviewTargetKind; targetId: string },
): Promise<boolean> {
  if (input.kind === REVIEW_TARGET_KIND.PRODUCT) {
    return process.env.FEATURE_PRODUCT_REVIEWS_OPEN === 'true';
  }
  const n = await repo.countCompletedAppointmentsForTarget(input);
  return n > 0;
}
