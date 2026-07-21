// ─────────────────────────────────────────────────────────────────────────────
// Entitlements Module — Controller
// Admin-only endpoints to manage feature catalog, plan-tier values, and
// per-vendor overrides.
//
//   GET    /admin/features
//   POST   /admin/features
//   GET    /admin/features/:code
//   PATCH  /admin/features/:code
//   GET    /admin/features/:code/plans
//   PUT    /admin/features/:code/plans/:plan_code
//   DELETE /admin/features/:code/plans/:plan_code
//   GET    /admin/features/:code/overrides
//   POST   /admin/features/:code/overrides
//   DELETE /admin/overrides/:id
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { ResourceNotFoundError } from '../../lib/errors';
import * as svc from './entitlements.service';
import {
  createFeatureSchema,
  updateFeatureSchema,
  featureCodeParam,
  featureAndPlanParams,
  overrideIdParam,
  setPlanEntitlementSchema,
  createOverrideSchema,
  listFeaturesQuerySchema,
} from './entitlements.schemas';

export const entitlementsController = Router();

// Apply auth + super_admin guard only under /admin/* — the router is mounted at the
// bare API_PREFIX, so unscoped middleware here would intercept every /api/v1/* request.
entitlementsController.use('/admin', authMiddleware, roleGuard(USER_ROLE.SUPER_ADMIN));

// ── Feature catalog ──

entitlementsController.get(
  '/admin/features',
  validateQuery(listFeaturesQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { active_only: boolean };
    const features = await svc.listFeatures(q.active_only);
    success(res, features);
  }),
);

entitlementsController.post(
  '/admin/features',
  validateBody(createFeatureSchema),
  asyncHandler(async (req, res) => {
    const feature = await svc.createFeature(req.body);
    created(res, feature);
  }),
);

entitlementsController.get(
  '/admin/features/:code',
  validateParams(featureCodeParam),
  asyncHandler(async (req, res) => {
    const { code } = req.params as { code: string };
    const feature = await svc.findFeature(code);
    if (!feature) throw new ResourceNotFoundError('Feature');
    success(res, feature);
  }),
);

entitlementsController.patch(
  '/admin/features/:code',
  validateParams(featureCodeParam),
  validateBody(updateFeatureSchema),
  asyncHandler(async (req, res) => {
    const { code } = req.params as { code: string };
    const feature = await svc.updateFeature(code, req.body);
    success(res, feature);
  }),
);

// ── Plan-tier entitlements ──

entitlementsController.get(
  '/admin/features/:code/plans',
  validateParams(featureCodeParam),
  asyncHandler(async (req, res) => {
    const { code } = req.params as { code: string };
    const rows = await svc.listPlanEntitlementsForFeature(code);
    success(res, rows);
  }),
);

entitlementsController.put(
  '/admin/features/:code/plans/:plan_code',
  validateParams(featureAndPlanParams),
  validateBody(setPlanEntitlementSchema),
  asyncHandler(async (req, res) => {
    const { code, plan_code } = req.params as { code: string; plan_code: string };
    const row = await svc.setPlanEntitlement(plan_code, code, req.body.value);
    success(res, row);
  }),
);

entitlementsController.delete(
  '/admin/features/:code/plans/:plan_code',
  validateParams(featureAndPlanParams),
  asyncHandler(async (req, res) => {
    const { code, plan_code } = req.params as { code: string; plan_code: string };
    await svc.deletePlanEntitlement(plan_code, code);
    noContent(res);
  }),
);

// ── Vendor overrides ──

entitlementsController.get(
  '/admin/features/:code/overrides',
  validateParams(featureCodeParam),
  asyncHandler(async (req, res) => {
    const { code } = req.params as { code: string };
    const rows = await svc.listActiveOverridesForFeature(code);
    success(res, rows);
  }),
);

entitlementsController.post(
  '/admin/features/:code/overrides',
  validateParams(featureCodeParam),
  validateBody(createOverrideSchema),
  asyncHandler(async (req, res) => {
    const { code } = req.params as { code: string };
    const row = await svc.createOverride(
      { ...req.body, feature_code: code },
      req.auth!.userId,
    );
    created(res, row);
  }),
);

entitlementsController.delete(
  '/admin/overrides/:id',
  validateParams(overrideIdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    await svc.deleteOverride(id);
    noContent(res);
  }),
);
