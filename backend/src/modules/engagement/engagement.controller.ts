// ─────────────────────────────────────────────────────────────────────────────
// Engagement Module — Controller (ENG-01 through ENG-09)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { engagementService } from './engagement.service';
import { z } from 'zod';
import {
  replyReviewSchema, reviewIdParam,
  favoriteSchema, notificationListSchema, notificationIdParam,
  listVendorReviewsSchema, skillEndorsementParamSchema,
  createReviewBody, listReviewsQuery, reportReviewBody, reviewAggregatesQuery,
} from './engagement.schemas';

export const engagementController = Router();

// ── R1 polymorphic reviews — PUBLIC list + aggregates (no auth) ──
// Mounted ABOVE the router-level authMiddleware so the portal RSC layer can
// read reviews without a session.
engagementController.get(
  '/reviews',
  validateQuery(listReviewsQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listReviewsQuery>;
    const r = await engagementService.listReviewsPaginated({
      targetKind: q.target_kind,
      targetId:   q.target_id,
      sort:       q.sort,
      withPhotos: !!q.with_photos,
      limit:      q.limit,
      cursor:     q.cursor ?? null,
    });
    success(res, r.items, { next_cursor: r.nextCursor });
  }),
);

engagementController.get(
  '/reviews/aggregates',
  validateQuery(reviewAggregatesQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof reviewAggregatesQuery>;
    const items = await engagementService.reviewAggregates(q.target_kind, q.target_ids);
    success(res, items);
  }),
);

engagementController.use(authMiddleware);

// ── ENG-01: Submit Review (R1 polymorphic — vendor / service_line / product) ──
engagementController.post(
  '/reviews',
  roleGuard('customer'),
  validateBody(createReviewBody),
  asyncHandler(async (req, res) => {
    const review = await engagementService.createReview({
      customerId: req.auth!.userId,
      targetKind: req.body.target_kind,
      targetId:   req.body.target_id,
      rating:     req.body.rating,
      title:      req.body.title,
      comment:    req.body.comment,
      photos:     req.body.photos,
    });
    created(res, review);
  }),
);

// ── R1: Toggle helpful flag on a review ──
// roleGuard('customer'): only customers vote — vendor/staff/admin must not
// influence helpfulness counts on their own dashboards. Self-vote (reviewer
// upvoting their own review) is rejected by toggleReviewHelpful at the service
// layer.
engagementController.post(
  '/reviews/:id/helpful',
  roleGuard('customer'),
  validateParams(reviewIdParam),
  asyncHandler(async (req, res) => {
    const r = await engagementService.toggleReviewHelpful(String(req.params.id), req.auth!.userId);
    success(res, r);
  }),
);

// ── R1: Report a review for moderation ──
// roleGuard('customer'): only customers report reviews. Admin moderation lives
// in the separate admin-reviews module and bypasses RLS via service-key.
engagementController.post(
  '/reviews/:id/report',
  roleGuard('customer'),
  validateParams(reviewIdParam),
  validateBody(reportReviewBody),
  asyncHandler(async (req, res) => {
    const r = await engagementService.reportReview(String(req.params.id), req.auth!.userId, req.body.reason);
    created(res, r);
  }),
);

// ── ENG-02: Reply to Review (Vendor) ──
engagementController.put(
  '/reviews/:id/reply',
  roleGuard('freelancer', 'business_admin'),
  tenantMiddleware,
  validateParams(reviewIdParam),
  validateBody(replyReviewSchema),
  asyncHandler(async (req, res) => {
    const vendorId = (req.tenant?.freelancerProfileId || req.tenant?.businessId) as string;
    const review = await engagementService.replyToReview(
      String(req.params.id), vendorId, req.body.reply_text,
    );
    success(res, review);
  }),
);

// ── ENG-03: Get Pending Reviews (Customer) ──
engagementController.get(
  '/reviews/pending',
  roleGuard('customer'),
  asyncHandler(async (req, res) => {
    const pending = await engagementService.getPendingReviews(req.auth!.userId);
    success(res, pending);
  }),
);

// ── ENG-10: List Vendor's Reviews (Salon admin / Freelancer) ──
// Returns the vendor's own reviews + a rating distribution for the dashboard
// Reviews tab. Tenant ownership of `vendor_id` is enforced server-side.
//
// Path renamed from `/reviews` → `/reviews/vendor` (R1 Task 3.5) so it does
// not collide with the public polymorphic `GET /reviews` listing above.
// Express picks the FIRST registered match, so the public route's
// validateQuery(listReviewsQuery) would 400 every legacy call without
// target_kind+target_id. Distinct path = distinct contract.
engagementController.get(
  '/reviews/vendor',
  roleGuard('business_admin', 'staff', 'freelancer'),
  tenantMiddleware,
  validateQuery(listVendorReviewsSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listVendorReviewsSchema>;
    const result = await engagementService.getVendorReviews({
      vendorType: q.vendor_type,
      vendorId: q.vendor_id,
      limit: q.limit,
      requesterRole: req.auth!.role,
      businessAccountId: req.tenant?.businessId,
      freelancerProfileId: req.tenant?.freelancerProfileId,
    });
    success(res, result);
  }),
);

// ── ENG-04: Toggle Favorite ──
engagementController.post(
  '/favorites',
  roleGuard('customer'),
  validateBody(favoriteSchema),
  asyncHandler(async (req, res) => {
    const result = await engagementService.toggleFavorite(
      req.auth!.userId, req.body.vendor_type, req.body.vendor_id,
    );
    success(res, result);
  }),
);

// ── ENG-05: List My Favorites ──
engagementController.get(
  '/favorites',
  roleGuard('customer'),
  asyncHandler(async (req, res) => {
    const favorites = await engagementService.listFavorites(req.auth!.userId);
    success(res, favorites);
  }),
);

// ── ENG-06: Get Notifications ──
engagementController.get(
  '/notifications',
  validateQuery(notificationListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof notificationListSchema>;
    const notifications = await engagementService.listNotifications(
      req.auth!.userId, q.is_read, q.limit,
    );
    success(res, notifications);
  }),
);

// ── ENG-07: Mark Notification Read ──
engagementController.patch(
  '/notifications/:id/read',
  validateParams(notificationIdParam),
  asyncHandler(async (req, res) => {
    await engagementService.markNotificationRead(String(req.params.id), req.auth!.userId);
    noContent(res);
  }),
);

// ── ENG-08: Mark All Notifications Read ──
engagementController.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await engagementService.markAllNotificationsRead(req.auth!.userId);
    noContent(res);
  }),
);

// ── ENG-09: Get Unread Count ──
engagementController.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    const count = await engagementService.getUnreadCount(req.auth!.userId);
    success(res, { count });
  }),
);

// ── ENG-11/12/13: Skill Endorsements (any authenticated user, not the owner) ──
engagementController.post(
  '/skills/:skillId/endorse',
  validateParams(skillEndorsementParamSchema),
  asyncHandler(async (req, res) => {
    const result = await engagementService.endorseSkill(
      String(req.params.skillId),
      req.auth!.userId,
    );
    success(res, result);
  }),
);

engagementController.delete(
  '/skills/:skillId/endorse',
  validateParams(skillEndorsementParamSchema),
  asyncHandler(async (req, res) => {
    const result = await engagementService.unendorseSkill(
      String(req.params.skillId),
      req.auth!.userId,
    );
    success(res, result);
  }),
);

engagementController.get(
  '/skills/:skillId/endorsement',
  validateParams(skillEndorsementParamSchema),
  asyncHandler(async (req, res) => {
    const result = await engagementService.getSkillEndorsementStatus(
      String(req.params.skillId),
      req.auth!.userId,
    );
    success(res, result);
  }),
);
