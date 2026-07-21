// ─────────────────────────────────────────────────────────────────────────────
// Analytics Module — Controller (ANLY-01 through ANLY-05)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateQuery } from '../../middleware/validate.middleware';
import { success } from '../../lib/response';
import { analyticsService } from './analytics.service';
import { z } from 'zod';
import { kpiSchema, trendSchema, staffPerfSchema, customerSchema } from './analytics.schemas';

export const analyticsController = Router();
analyticsController.use(authMiddleware);
analyticsController.use(roleGuard('freelancer', 'business_admin', 'staff', 'super_admin'));
analyticsController.use(tenantMiddleware);

/**
 * Resolve the vendor id this caller is acting as, in the same shape the
 * transactions + appointments tables are keyed on:
 *
 *   • freelancer  → freelancer_profile.id  (one user → one profile)
 *   • salon admin → salon_location.id      (one business → many locations;
 *                                           appointments + transactions land
 *                                           on the *location*, not the parent
 *                                           business_account)
 *
 * Earlier impl returned `businessId` (= business_account.id) for salons, so
 * every analytics SQL filter missed every row — KPIs all read zero even
 * after live bookings. See sibling resolveVendor used by finance + booking
 * + availability.
 */
function getVendorId(req: import('express').Request): string {
  return (
    req.tenant?.freelancerProfileId ||
    req.tenant?.locationId ||
    req.tenant?.businessId
  ) as string;
}

// ── ANLY-01: KPI Summary (Dashboard Cards) ──
analyticsController.get(
  '/kpi',
  validateQuery(kpiSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof kpiSchema>;
    const vendorId = getVendorId(req);
    const kpi = await analyticsService.getKPI(vendorId, q.range, q.start, q.end);
    success(res, kpi);
  }),
);

// ── ANLY-02: Revenue Time Series (Charts) ──
analyticsController.get(
  '/revenue-series',
  validateQuery(trendSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof trendSchema>;
    const vendorId = getVendorId(req);
    const series = await analyticsService.getRevenueSeries(vendorId, q.range);
    success(res, series);
  }),
);

// ── ANLY-03: Booking Trend Series ──
analyticsController.get(
  '/booking-trends',
  validateQuery(trendSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof trendSchema>;
    const vendorId = getVendorId(req);
    const trends = await analyticsService.getBookingTrends(vendorId, q.range);
    success(res, trends);
  }),
);

// ── ANLY-04: Staff Performance Table (Harmony Hub) ──
analyticsController.get(
  '/staff-performance',
  validateQuery(staffPerfSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof staffPerfSchema>;
    const vendorId = getVendorId(req);
    const perf = await analyticsService.getStaffPerformance(vendorId, q.range, q.limit);
    success(res, perf);
  }),
);

// ── ANLY-05: Customer Insights ──
analyticsController.get(
  '/customers',
  validateQuery(customerSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof customerSchema>;
    const vendorId = getVendorId(req);
    const insights = await analyticsService.getCustomerInsights(vendorId, q.range);
    success(res, insights);
  }),
);

// ── Bonus: Top Services (useful for dashboard) ──
analyticsController.get(
  '/top-services',
  validateQuery(trendSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof trendSchema>;
    const vendorId = getVendorId(req);
    const services = await analyticsService.getTopServices(vendorId, q.range);
    success(res, services);
  }),
);
