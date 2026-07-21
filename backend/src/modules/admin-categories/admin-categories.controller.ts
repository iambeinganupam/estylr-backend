// ─────────────────────────────────────────────────────────────────────────────
// Admin Categories — Controller
//
// super_admin governance for the global service_categories taxonomy. Mounted
// at /api/v1/admin/categories. Mirrors the 4-file pattern used by
// admin-services so dashboards can share form scaffolding.
//
// Endpoints:
//   GET    /admin/categories            list (flat, filters)
//   GET    /admin/categories/tree       list (nested roots + subs)
//   GET    /admin/categories/:id        single row
//   POST   /admin/categories            create root or sub
//   PATCH  /admin/categories/:id        rename / reorder / change audience /
//                                       activate-deactivate / re-parent
//   POST   /admin/categories/reorder    bulk sort_order under a parent
//   DELETE /admin/categories/:id        soft delete (?force=true to override
//                                       the dependents guard)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../middleware/validate.middleware';
import { created, noContent, success } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { adminCategoriesService } from './admin-categories.service';
import {
  categoryCreateSchema,
  categoryIdParam,
  categoryListQuerySchema,
  categoryReorderSchema,
  categoryTreeQuerySchema,
  categoryUpdateSchema,
} from './admin-categories.schemas';

export const adminCategoriesController = Router();
adminCategoriesController.use(authMiddleware);
adminCategoriesController.use(roleGuard(USER_ROLE.SUPER_ADMIN));

// ── List (flat) ─────────────────────────────────────────────────────────────
adminCategoriesController.get(
  '/',
  validateQuery(categoryListQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof categoryListQuerySchema>;
    const rows = await adminCategoriesService.list(q);
    success(res, rows);
  }),
);

// ── List (tree) ─────────────────────────────────────────────────────────────
// Registered BEFORE /:id to keep `/tree` from being captured as an id param.
adminCategoriesController.get(
  '/tree',
  validateQuery(categoryTreeQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof categoryTreeQuerySchema>;
    const tree = await adminCategoriesService.tree(q);
    success(res, tree);
  }),
);

// ── Bulk reorder ────────────────────────────────────────────────────────────
// Same registered-before-/:id reasoning as /tree above.
adminCategoriesController.post(
  '/reorder',
  validateBody(categoryReorderSchema),
  asyncHandler(async (req, res) => {
    const result = await adminCategoriesService.reorder(req.body);
    success(res, result);
  }),
);

// ── Single ──────────────────────────────────────────────────────────────────
adminCategoriesController.get(
  '/:id',
  validateParams(categoryIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminCategoriesService.get(String(req.params.id));
    success(res, row);
  }),
);

// ── Create ──────────────────────────────────────────────────────────────────
adminCategoriesController.post(
  '/',
  validateBody(categoryCreateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminCategoriesService.create(req.body, req);
    created(res, row);
  }),
);

// ── Promote (ADM-09b ported from legacy admin module) ──────────────────────
// Flips a vendor-scoped custom row to global. Preserves the id so existing
// services.category_id FKs inherit global status silently.
adminCategoriesController.post(
  '/:id/promote',
  validateParams(categoryIdParam),
  asyncHandler(async (req, res) => {
    const row = await adminCategoriesService.promote(String(req.params.id), req);
    success(res, row);
  }),
);

// ── Update ──────────────────────────────────────────────────────────────────
adminCategoriesController.patch(
  '/:id',
  validateParams(categoryIdParam),
  validateBody(categoryUpdateSchema),
  asyncHandler(async (req, res) => {
    const row = await adminCategoriesService.update(String(req.params.id), req.body, req);
    success(res, row);
  }),
);

// ── Soft delete (with ?force=true escape hatch for dependents guard) ────────
adminCategoriesController.delete(
  '/:id',
  validateParams(categoryIdParam),
  asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    await adminCategoriesService.softDelete(String(req.params.id), { force }, req);
    noContent(res);
  }),
);
