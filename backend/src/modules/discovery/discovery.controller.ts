// ─────────────────────────────────────────────────────────────────────────────
// Discovery Module — Controller (DISC-01 through DISC-08)
// DISC-01: GET /search          — Search vendors
// DISC-02: GET /categories      — List service categories
// DISC-03: GET /by-slug/:slug   — Vendor lookup by URL slug
// DISC-04: GET /featured        — Featured vendors (grooming-audience filter)
// DISC-05: GET /trending        — Trending vendors (grooming-audience + booking volume)
// DISC-06: GET /:vendorType/:vendorId  — Vendor deep profile (wildcard — must stay last among GETs)
// DISC-07: GET /vendors/:id/reviews   — Paginated vendor reviews
// DISC-08: POST /vendors/:vendorType/:vendorId/view — Track profile view
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { optionalAuth } from '../../middleware/auth.middleware';
import { validateQuery, validateParams } from '../../middleware/validate.middleware';
import { success } from '../../lib/response';
import { discoveryService } from './discovery.service';
import {
  searchSchema, vendorDetailParam, vendorReviewsParam, vendorReviewsQuery,
  trackViewParam, bySlugParam, bySlugQuery, featuredQuery, trendingQuery,
  categoriesQuery, categoryBySlugParam, autocompleteQuery, slugParam, nearYouQuery,
} from './discovery.schemas';
import { z } from 'zod';

export const discoveryController = Router();

// ── DISC-01: Search Vendors (v2 — geo + facets + cursor + new sorts) ──
discoveryController.get(
  '/search',
  optionalAuth,
  validateQuery(searchSchema),
  asyncHandler(async (req, res) => {
    const { items, nextCursor } = await discoveryService.searchVendorsV2(req.query as any);
    success(res, items, { nextCursor } as any);
  }),
);

// ── DISC-02: Get Service Categories ──
// Optional `?audience=` query: 'grooming' (default), 'wedding', or 'both'.
// Widening is handled in the repository — a caller asking for 'grooming'
// also gets rows explicitly tagged 'both'.
discoveryController.get(
  '/categories',
  optionalAuth,
  validateQuery(categoriesQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof categoriesQuery>;
    const categories = await discoveryService.getCategories({ audience: q.audience });
    success(res, categories);
  }),
);

// ── DISC-02b: Get a Single Category by Slug ──
// Backs the portal's /services/[slug] page. Registered BEFORE
// /:vendorType/:vendorId so the wildcard doesn't capture this path.
discoveryController.get(
  '/categories/:slug',
  optionalAuth,
  validateParams(categoryBySlugParam),
  asyncHandler(async (req, res) => {
    const { slug } = req.params as unknown as z.infer<typeof categoryBySlugParam>;
    const category = await discoveryService.getCategoryBySlug(slug);
    success(res, category);
  }),
);

// ── DISC-03: Get Vendor by Slug ──
// Must be registered before /:vendorType/:vendorId to prevent the wildcard
// from capturing /by-slug/* first.
discoveryController.get(
  '/by-slug/:slug',
  optionalAuth,
  validateParams(bySlugParam),
  validateQuery(bySlugQuery),
  asyncHandler(async (req, res) => {
    const { slug } = req.params as unknown as z.infer<typeof bySlugParam>;
    const q = req.query as unknown as z.infer<typeof bySlugQuery>;
    const detail = await discoveryService.getVendorBySlug(slug, q.vendor_type);
    success(res, detail);
  }),
);

// ── DISC-04: Featured Vendors ──
discoveryController.get(
  '/featured',
  optionalAuth,
  validateQuery(featuredQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof featuredQuery>;
    const items = await discoveryService.getFeaturedVendors({
      vendorType: q.vendor_type, limit: q.limit,
    });
    success(res, items);
  }),
);

// ── DISC-05: Trending Vendors ──
discoveryController.get(
  '/trending',
  optionalAuth,
  validateQuery(trendingQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof trendingQuery>;
    const items = await discoveryService.getTrendingVendors({
      vendorType: q.vendor_type, limit: q.limit,
    });
    success(res, items);
  }),
);

// ── Autocomplete (trigram-ranked vendors + services + categories) ──
// Public typeahead. Registered before /:vendorType/:vendorId so the wildcard
// doesn't capture this path.
discoveryController.get(
  '/autocomplete',
  validateQuery(autocompleteQuery),
  asyncHandler(async (req, res) => {
    const data = await discoveryService.autocomplete(req.query as any);
    success(res, data);
  }),
);

// ── R1 Vendor Profile Aggregate (by slug) ──
// Public read-only aggregate that powers the customer portal's vendor detail
// page. Must be registered BEFORE /:vendorType/:vendorId so the wildcard
// doesn't capture /vendors/:slug/profile first.
discoveryController.get(
  '/vendors/:slug/profile',
  validateParams(slugParam),
  asyncHandler(async (req, res) => {
    const { slug } = req.params as unknown as z.infer<typeof slugParam>;
    const data = await discoveryService.getVendorProfileBySlug(slug);
    success(res, data);
  }),
);

// ── R1 Near-You geo listing ──
// Mounted BEFORE /:vendorType/:vendorId so the wildcard doesn't capture it.
discoveryController.get(
  '/near-you',
  validateQuery(nearYouQuery),
  asyncHandler(async (req, res) => {
    success(res, await discoveryService.nearYou(req.query as unknown as z.infer<typeof nearYouQuery>));
  }),
);

// ── R1 City Landing payload ──
// Mounted BEFORE /:vendorType/:vendorId so the wildcard doesn't capture it.
discoveryController.get(
  '/city/:slug',
  validateParams(slugParam),
  asyncHandler(async (req, res) => {
    const params = req.params as unknown as z.infer<typeof slugParam>;
    success(res, await discoveryService.cityLanding(params.slug));
  }),
);

// ── DISC-06: Get Vendor Deep Profile ──
discoveryController.get(
  '/:vendorType/:vendorId',
  optionalAuth,
  validateParams(vendorDetailParam),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = req.params as unknown as z.infer<typeof vendorDetailParam>;
    const detail = await discoveryService.getVendorDetail(vendorType, vendorId);
    success(res, detail);
  }),
);

// ── DISC-07: Get Vendor Reviews (Paginated) ──
discoveryController.get(
  '/vendors/:id/reviews',
  optionalAuth,
  validateParams(vendorReviewsParam),
  validateQuery(vendorReviewsQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof vendorReviewsQuery>;
    // Determine vendor type from the vendor record
    const { items, hasMore } = await discoveryService.getVendorReviews(
      String(req.params.id), 'freelancer', q.sort, q.limit,
    );
    success(res, items, { has_more: hasMore });
  }),
);

// ── DISC-08: Track Vendor Profile View ──
// Public, fire-and-forget. Customer apps + the public portal call this when
// rendering a vendor profile page. The salon dashboard reads the aggregated
// counter via GET /business/profile/engagement. Rate limiting is handled by
// the global IP limiter; we don't dedup further server-side in v1.
discoveryController.post(
  '/vendors/:vendorType/:vendorId/view',
  optionalAuth,
  validateParams(trackViewParam),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = req.params as unknown as z.infer<typeof trackViewParam>;
    const result = await discoveryService.trackVendorView(vendorType, vendorId);
    success(res, result);
  }),
);
