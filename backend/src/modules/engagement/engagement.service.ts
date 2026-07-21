// ─────────────────────────────────────────────────────────────────────────────
// Engagement Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { engagementRepository } from './engagement.repository';
import {
  ConflictError, ResourceNotFoundError,
  ReviewNotEligibleError, TenantMismatchError,
} from '../../lib/errors';
import { queryOne } from '../../config/database';
import { encodeCursor, decodeCursor } from '../../lib/cursor';
import { canReview } from './review-eligibility';
import { REVIEW_TARGET_KIND, type ReviewTargetKind } from '../../lib/constants';

// Pulls the most-recent completed appointment a customer has against a given
// review target. For 'vendor' and 'service_line' kinds, eligibility already
// guarantees ≥ 1 row exists; this query returns one specific id to satisfy
// the NOT NULL appointment_id constraint on reviews. For 'product', returns null.
async function pickAppointmentIdForReview(
  customerId: string,
  kind: ReviewTargetKind,
  targetId: string,
): Promise<string | null> {
  if (kind === REVIEW_TARGET_KIND.VENDOR) {
    const r = await queryOne<{ id: string }>(
      `SELECT id FROM public.appointments
        WHERE customer_id = $1 AND vendor_id = $2 AND status = 'completed'
        ORDER BY start_time DESC LIMIT 1`,
      [customerId, targetId],
    );
    return r?.id ?? null;
  }
  if (kind === REVIEW_TARGET_KIND.SERVICE_LINE) {
    const r = await queryOne<{ id: string }>(
      `SELECT id FROM public.appointments
        WHERE customer_id = $1 AND service_id = $2 AND status = 'completed'
        ORDER BY start_time DESC LIMIT 1`,
      [customerId, targetId],
    );
    return r?.id ?? null;
  }
  return null;
}

// Polymorphic review input — R1 customer review submission across vendor /
// service_line / product targets.
export interface CreateReviewInput {
  customerId: string;
  targetKind: ReviewTargetKind;
  targetId: string;
  rating: number;
  title?: string;
  comment?: string;
  photos: Array<{ url: string; w: number; h: number }>;
}

export const engagementService = {
  async createReview(input: CreateReviewInput) {
    const eligible = await canReview(engagementRepository, {
      userId: input.customerId, kind: input.targetKind, targetId: input.targetId,
    });
    if (!eligible) throw new ReviewNotEligibleError();

    const vendor = await engagementRepository.resolveVendorForTarget({
      kind: input.targetKind, targetId: input.targetId,
    });
    if (!vendor) throw new ResourceNotFoundError('Target');

    const pickedAppointmentId = await pickAppointmentIdForReview(
      input.customerId, input.targetKind, input.targetId,
    );
    if (input.targetKind !== REVIEW_TARGET_KIND.PRODUCT && !pickedAppointmentId) {
      throw new ReviewNotEligibleError();
    }

    return engagementRepository.insertReview({
      customerId: input.customerId,
      vendorId: vendor.vendorId,
      vendorType: vendor.vendorType,
      targetKind: input.targetKind,
      targetId: input.targetId,
      appointmentId: pickedAppointmentId!,
      rating: input.rating, title: input.title, comment: input.comment, photos: input.photos,
    });
  },

  async replyToReview(reviewId: string, vendorId: string, replyText: string) {
    const review = await engagementRepository.replyToReview(reviewId, vendorId, replyText);
    if (!review) throw new ResourceNotFoundError('Review');
    return review;
  },

  async getPendingReviews(customerId: string) {
    return engagementRepository.getPendingReviews(customerId);
  },

  async deleteReview(reviewId: string, customerId: string) {
    const deleted = await engagementRepository.deleteReview(reviewId, customerId);
    if (!deleted) throw new ResourceNotFoundError('Review');
  },

  async toggleFavorite(customerId: string, vendorType: string, vendorId: string) {
    return engagementRepository.toggleFavorite(customerId, vendorType, vendorId);
  },

  async listFavorites(customerId: string) {
    return engagementRepository.listFavorites(customerId);
  },

  async listNotifications(userId: string, isRead?: boolean, limit?: number) {
    return engagementRepository.listNotifications(userId, isRead, limit);
  },

  async markNotificationRead(notificationId: string, userId: string) {
    const n = await engagementRepository.markNotificationRead(notificationId, userId);
    if (!n) throw new ResourceNotFoundError('Notification');
    return n;
  },

  async markAllNotificationsRead(userId: string) {
    await engagementRepository.markAllRead(userId);
  },

  async getUnreadCount(userId: string) {
    return engagementRepository.getUnreadCount(userId);
  },

  // Returns reviews for a vendor with rating-distribution summary, but only
  // when the caller actually owns that vendor. A salon admin's auth carries
  // `businessId`, so we resolve which salon_locations belong to their business.
  // A freelancer's `freelancerProfileId` must match the requested vendor_id.
  async getVendorReviews(args: {
    vendorType: 'freelancer' | 'salon_location';
    vendorId: string;
    limit: number;
    requesterRole: string;
    businessAccountId?: string;
    freelancerProfileId?: string;
  }) {
    const { vendorType, vendorId, limit, requesterRole, businessAccountId, freelancerProfileId } = args;

    if (vendorType === 'salon_location') {
      if (requesterRole !== 'business_admin' && requesterRole !== 'staff') {
        throw new TenantMismatchError();
      }
      if (!businessAccountId) throw new TenantMismatchError();
      const owns = await queryOne<{ id: string }>(
        `SELECT id FROM public.salon_locations
          WHERE id = $1 AND business_account_id = $2`,
        [vendorId, businessAccountId],
      );
      if (!owns) throw new TenantMismatchError();
    } else {
      if (requesterRole !== 'freelancer') throw new TenantMismatchError();
      if (!freelancerProfileId || freelancerProfileId !== vendorId) {
        throw new TenantMismatchError();
      }
    }

    const [items, summary] = await Promise.all([
      engagementRepository.listVendorReviews(vendorType, vendorId, limit),
      engagementRepository.getVendorRatingSummary(vendorType, vendorId),
    ]);
    return {
      items,
      summary: summary ?? {
        total_count: 0, avg_rating: 0,
        rating_5: 0, rating_4: 0, rating_3: 0, rating_2: 0, rating_1: 0,
      },
    };
  },

  // ── Skill Endorsements ──
  async endorseSkill(skillId: string, endorserUserId: string) {
    const skill = await engagementRepository.getSkillWithOwner(skillId);
    if (!skill) throw new ResourceNotFoundError('Skill');
    if (skill.owner_user_id === endorserUserId) {
      throw new ConflictError('You cannot endorse your own skill.');
    }

    const { created } = await engagementRepository.endorseSkill(skillId, endorserUserId);
    const endorsement_count = await engagementRepository.getSkillEndorsementCount(skillId);
    return { skill_id: skillId, endorsed: true, created, endorsement_count };
  },

  async unendorseSkill(skillId: string, endorserUserId: string) {
    const skill = await engagementRepository.getSkillWithOwner(skillId);
    if (!skill) throw new ResourceNotFoundError('Skill');

    const { removed } = await engagementRepository.unendorseSkill(skillId, endorserUserId);
    const endorsement_count = await engagementRepository.getSkillEndorsementCount(skillId);
    return { skill_id: skillId, endorsed: false, removed, endorsement_count };
  },

  async getSkillEndorsementStatus(skillId: string, viewerUserId: string) {
    const skill = await engagementRepository.getSkillWithOwner(skillId);
    if (!skill) throw new ResourceNotFoundError('Skill');

    const [endorsed, endorsement_count] = await Promise.all([
      engagementRepository.hasEndorsedSkill(skillId, viewerUserId),
      engagementRepository.getSkillEndorsementCount(skillId),
    ]);
    return {
      skill_id: skillId,
      endorsed,
      endorsement_count,
      is_owner: skill.owner_user_id === viewerUserId,
    };
  },

  // ── R1 polymorphic reviews — list / helpful / report / aggregates ──

  async listReviewsPaginated(args: {
    targetKind: ReviewTargetKind; targetId: string;
    sort: 'recent' | 'helpful' | 'rating_high' | 'rating_low';
    withPhotos: boolean; limit: number; cursor: string | null;
  }) {
    const cur = decodeCursor(args.cursor);
    const { rows, scoreField } = await engagementRepository.listReviews({ ...args, cursor: cur });
    const hasMore = rows.length > args.limit;
    const items = hasMore ? rows.slice(0, args.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ score: Number(last[scoreField]), id: last.id })
      : null;
    return { items, nextCursor };
  },

  async toggleReviewHelpful(reviewId: string, userId: string) {
    // Reject self-votes: a customer cannot upvote their own review. Also reject
    // hidden reviews (is_visible = FALSE) — they shouldn't be discoverable.
    const owner = await queryOne<{ customer_id: string; is_visible: boolean }>(
      `SELECT customer_id, is_visible FROM public.reviews WHERE id = $1`,
      [reviewId],
    );
    if (!owner || !owner.is_visible) throw new ResourceNotFoundError('Review not found');
    if (owner.customer_id === userId) {
      throw new ReviewNotEligibleError('You cannot vote on your own review');
    }
    return engagementRepository.toggleHelpful(reviewId, userId);
  },

  async reportReview(reviewId: string, reporterId: string, reason: string) {
    // Reject reports on hidden reviews; reject self-reports.
    const owner = await queryOne<{ customer_id: string; is_visible: boolean }>(
      `SELECT customer_id, is_visible FROM public.reviews WHERE id = $1`,
      [reviewId],
    );
    if (!owner || !owner.is_visible) throw new ResourceNotFoundError('Review not found');
    if (owner.customer_id === reporterId) {
      throw new ReviewNotEligibleError('You cannot report your own review');
    }
    return engagementRepository.insertReport({ reviewId, reporterId, reason });
  },

  async reviewAggregates(targetKind: ReviewTargetKind, targetIds: string[]) {
    const rows = await engagementRepository.reviewAggregates({ targetKind, targetIds });
    return rows.map((r: any) => ({
      targetId: r.target_id,
      ratingAvg: Number(r.rating_avg),
      ratingCount: r.rating_count,
      breakdown: { 1: r.r1, 2: r.r2, 3: r.r3, 4: r.r4, 5: r.r5 },
      photoCount: r.photo_count,
    }));
  },
};
