// ─────────────────────────────────────────────────────────────────────────────
// Catalog Module — Controller
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { tenantMiddleware } from '../../middleware/tenant.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { catalogService } from './catalog.service';
import { VENDOR_TYPE } from '../../lib/constants';
import {
  createServiceSchema,
  updateServiceSchema,
  staffOverrideSchema,
  serviceIdParam,
  serviceStaffParam,
  catalogQuerySchema,
  createCategorySchema,
  categoryQuerySchema,
  publicServiceIdParam,
  publicProductIdParam,
} from './catalog.schemas';
import type { z } from 'zod';
// KYC guard — applied conservatively to vendor catalog write routes only.
// Read-only routes (GET) are intentionally left ungated so vendors can view
// their catalog during onboarding.
import { kycGuard } from '../../middleware/kyc-guard.middleware';
// Plan guard — gates "create custom category" on a feature entitlement so
// the capability can be moved between plan tiers (free / pro / etc.) by
// editing the entitlements table, not by shipping new code.
import { planGuard } from '../../middleware/plan-guard.middleware';

export const catalogController = Router();

// ── Public read-only routes (R1) ─────────────────────────────────────────
// Mounted BEFORE authMiddleware so the Next.js portal can read service +
// product detail without an auth token. Reads pass through Zod param
// validation and catalogService's API DTO mapper (price → priceInr,
// service_location → serviceMode, etc.). Per R1 errata §8.5.
catalogController.get(
  '/services/:id/public',
  validateParams(publicServiceIdParam),
  asyncHandler(async (req, res) => {
    const data = await catalogService.getPublicService(String(req.params.id));
    success(res, data);
  }),
);

catalogController.get(
  '/products/:id/public',
  validateParams(publicProductIdParam),
  asyncHandler(async (req, res) => {
    const data = await catalogService.getPublicProduct(String(req.params.id));
    success(res, data);
  }),
);

catalogController.use(authMiddleware);
catalogController.use(roleGuard('freelancer', 'business_admin', 'staff'));
catalogController.use(tenantMiddleware);

/** Resolve vendor context from request */
function resolveVendor(req: import('express').Request): { vendorType: string; vendorId: string } {
  if (req.auth!.role === 'freelancer') {
    return { vendorType: VENDOR_TYPE.FREELANCER, vendorId: req.tenant!.freelancerProfileId! };
  }
  return { vendorType: VENDOR_TYPE.SALON_LOCATION, vendorId: req.tenant!.locationId || req.tenant!.businessId! };
}

// ── CAT-01: List Services ──
catalogController.get(
  '/services',
  validateQuery(catalogQuerySchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const services = await catalogService.listServices(vendorType, vendorId, req.query as Record<string, string | undefined>);
    success(res, services);
  }),
);

// ── CAT-02: Create Service ──
catalogController.post(
  '/services',
  kycGuard, // vendor must have approved KYC before creating catalog items
  validateBody(createServiceSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const service = await catalogService.createService(vendorType, vendorId, req.body);
    created(res, service);
  }),
);

// ── CAT-03: Update Service ──
catalogController.put(
  '/services/:id',
  kycGuard, // KYC guard — vendor must be verified to update services
  validateParams(serviceIdParam),
  validateBody(updateServiceSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const service = await catalogService.updateService(String(req.params.id), vendorType, vendorId, req.body);
    success(res, service);
  }),
);

// ── CAT-04: Delete Service (soft) ──
catalogController.delete(
  '/services/:id',
  kycGuard, // KYC guard — vendor must be verified to delete services
  validateParams(serviceIdParam),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    await catalogService.deleteService(String(req.params.id), vendorType, vendorId);
    noContent(res);
  }),
);

// ── CAT-05: Staff Override ──
catalogController.put(
  '/services/:serviceId/overrides/:staffId',
  roleGuard('business_admin'),
  validateParams(serviceStaffParam),
  validateBody(staffOverrideSchema),
  asyncHandler(async (req, res) => {
    const result = await catalogService.setStaffOverride(
      String(req.params.serviceId),
      String(req.params.staffId),
      req.body.price,
      req.body.duration_minutes,
    );
    success(res, result ?? { message: 'Override removed.' });
  }),
);

// ── Products ──

import {
  createProductSchema,
  updateProductSchema,
  productIdParam,
} from './catalog.schemas';

// ── CAT-06: List Products ──
catalogController.get(
  '/products',
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const products = await catalogService.listProducts(vendorType, vendorId);
    success(res, products);
  }),
);

// ── CAT-07: Create Product ──
catalogController.post(
  '/products',
  kycGuard, // KYC guard — vendor must be verified to create products
  validateBody(createProductSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const product = await catalogService.createProduct(vendorType, vendorId, req.body);
    created(res, product);
  }),
);

// ── CAT-08: Update Product ──
catalogController.put(
  '/products/:id',
  kycGuard, // KYC guard — vendor must be verified to update products
  validateParams(productIdParam),
  validateBody(updateProductSchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const product = await catalogService.updateProduct(String(req.params.id), vendorType, vendorId, req.body);
    success(res, product);
  }),
);

// ── CAT-09: Delete Product ──
catalogController.delete(
  '/products/:id',
  kycGuard, // KYC guard — vendor must be verified to delete products
  validateParams(productIdParam),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    await catalogService.deleteProduct(String(req.params.id), vendorType, vendorId);
    noContent(res);
  }),
);

// ── CAT-10: List Categories (global + this vendor's customs) ──
// Read-only, no KYC gate — vendors need to browse the taxonomy during
// onboarding before KYC clears. Optional `?audience=` query filters by the
// audience the picker is being rendered for (vendor onboarding defaults to
// 'grooming'; event-side flows pass 'wedding' or omit for 'both').
catalogController.get(
  '/categories',
  validateQuery(categoryQuerySchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const q = req.query as unknown as z.infer<typeof categoryQuerySchema>;
    const categories = await catalogService.listCategoriesForVendor(vendorType, vendorId, {
      audience: q.audience,
    });
    success(res, categories);
  }),
);

// ── CAT-10b: List Categories as a Nested Tree ──
// Same data as CAT-10 but pre-built into a roots-with-subcategories shape so
// pickers don't need to repeat tree construction on the client. Used by the
// shared <CategoryPicker /> component.
catalogController.get(
  '/categories/tree',
  validateQuery(categoryQuerySchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const q = req.query as unknown as z.infer<typeof categoryQuerySchema>;
    const tree = await catalogService.getCategoryTreeForVendor(vendorType, vendorId, {
      audience: q.audience,
    });
    success(res, tree);
  }),
);

// ── CAT-11: Create a Vendor-Scoped Category / Subcategory ──
// Gated by plan entitlement `custom_categories` so this capability can be
// promoted to a paid tier later without a code change. KYC-gated so only
// verified vendors can pollute their taxonomy.
catalogController.post(
  '/categories',
  kycGuard,
  planGuard('custom_categories'),
  validateBody(createCategorySchema),
  asyncHandler(async (req, res) => {
    const { vendorType, vendorId } = resolveVendor(req);
    const category = await catalogService.createVendorCategory(vendorType, vendorId, req.body);
    created(res, category);
  }),
);

