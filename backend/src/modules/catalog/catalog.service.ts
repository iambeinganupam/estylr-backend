// ─────────────────────────────────────────────────────────────────────────────
// Catalog Module — Service Layer
// ─────────────────────────────────────────────────────────────────────────────

import { catalogRepository } from './catalog.repository';
import { ResourceNotFoundError, ValidationError } from '../../lib/errors';

// Service-mode value is canonical end-to-end: DB column `services.service_location`
// and API field `serviceMode` share the same value set `'onsite' | 'home' | 'both'`.
// Only the field name camelCases at the API boundary per the R1 naming hygiene
// policy (errata §8.5.1). No value translation map needed — pass through.

// Resolve a (category, subcategory) name pair into the most-specific
// service_categories row. Used by createService/updateService so the
// `services.category_id` FK is populated from the same taxonomy that the
// frontend pickers read from. Match is case-insensitive within the caller's
// visibility scope (global rows OR rows owned by this vendor).
//
// Resolution order:
//   1. If `category_id` is explicitly provided by the client → trust it
//      verbatim (validated to exist + be visible).
//   2. Else look up the subcategory name under the matching category name.
//      Most-specific wins (the leaf), so analytics joins land on the
//      finest-grained label.
//   3. Else look up the category name as a top-level row.
//   4. Else return null (category_id stays NULL on the service).
async function resolveTaxonomyId(
  vendorType: string,
  vendorId: string,
  input: { category_id?: string; category?: string; subcategory?: string },
): Promise<{ categoryId: string | null; categoryName: string | null }> {
  const allVisible = await catalogRepository.listCategoriesForVendor(vendorType, vendorId);
  const lookup = (name: string, parentId: string | null) =>
    allVisible.find(
      (r) =>
        r.parent_id === parentId &&
        r.name.trim().toLowerCase() === name.trim().toLowerCase(),
    ) ?? null;

  if (input.category_id) {
    const row = allVisible.find((r) => r.id === input.category_id);
    if (!row) {
      throw new ValidationError({ category_id: 'Unknown category' });
    }
    return { categoryId: row.id, categoryName: row.name };
  }

  if (input.category && input.subcategory) {
    const parent = lookup(input.category, null);
    if (parent) {
      const leaf = lookup(input.subcategory, parent.id);
      if (leaf) return { categoryId: leaf.id, categoryName: leaf.name };
      // Subcategory not in taxonomy yet (vendor-typed free text): fall back
      // to the parent so the FK still lands somewhere meaningful.
      return { categoryId: parent.id, categoryName: parent.name };
    }
  }

  if (input.category) {
    const row = lookup(input.category, null);
    if (row) return { categoryId: row.id, categoryName: row.name };
  }

  return { categoryId: null, categoryName: input.category ?? null };
}

export const catalogService = {
  async listServices(vendorType: string, vendorId: string, filters?: Record<string, string | undefined>) {
    return catalogRepository.listServices(vendorType, vendorId, filters);
  },

  async createService(vendorType: string, vendorId: string, data: Record<string, unknown>) {
    const { categoryId, categoryName } = await resolveTaxonomyId(vendorType, vendorId, {
      category_id: typeof data.category_id === 'string' ? data.category_id : undefined,
      category: typeof data.category === 'string' ? data.category : undefined,
      subcategory: typeof data.subcategory === 'string' ? data.subcategory : undefined,
    });
    return catalogRepository.createService(vendorType, vendorId, {
      ...data,
      category_id: categoryId,
      // Persist the resolved name so legacy readers (discovery filter chips,
      // materialised views that GROUP BY services.category) keep working.
      category: categoryName ?? data.category ?? null,
    });
  },

  async getService(serviceId: string, vendorType: string, vendorId: string) {
    const service = await catalogRepository.getServiceById(serviceId, vendorType, vendorId);
    if (!service) throw new ResourceNotFoundError('Service');
    return service;
  },

  async updateService(serviceId: string, vendorType: string, vendorId: string, data: Record<string, unknown>) {
    await this.getService(serviceId, vendorType, vendorId);
    // Re-resolve the FK only when the client actually touched category /
    // subcategory / category_id this time around — sparse updates that
    // didn't include them shouldn't disturb the existing FK.
    const touchesTaxonomy =
      'category' in data || 'subcategory' in data || 'category_id' in data;
    let resolved: Record<string, unknown> = data;
    if (touchesTaxonomy) {
      const { categoryId, categoryName } = await resolveTaxonomyId(vendorType, vendorId, {
        category_id: typeof data.category_id === 'string' ? data.category_id : undefined,
        category: typeof data.category === 'string' ? data.category : undefined,
        subcategory: typeof data.subcategory === 'string' ? data.subcategory : undefined,
      });
      resolved = {
        ...data,
        category_id: categoryId,
        category: categoryName ?? data.category ?? null,
      };
    }
    const updated = await catalogRepository.updateService(serviceId, vendorType, vendorId, resolved);
    return updated ?? this.getService(serviceId, vendorType, vendorId);
  },

  async deleteService(serviceId: string, vendorType: string, vendorId: string) {
    await this.getService(serviceId, vendorType, vendorId);
    await catalogRepository.softDeleteService(serviceId, vendorType, vendorId);
  },

  async setStaffOverride(serviceId: string, staffId: string, price: number | null, durationMinutes: number | null) {
    return catalogRepository.upsertStaffOverride(serviceId, staffId, price, durationMinutes);
  },

  // ── Products ──

  async listProducts(vendorType: string, vendorId: string) {
    return catalogRepository.listProducts(vendorType, vendorId);
  },

  async createProduct(vendorType: string, vendorId: string, data: Record<string, unknown>) {
    return catalogRepository.createProduct(vendorType, vendorId, data);
  },

  async getProduct(productId: string, vendorType: string, vendorId: string) {
    const product = await catalogRepository.getProductById(productId, vendorType, vendorId);
    if (!product) throw new ResourceNotFoundError('Product');
    return product;
  },

  async updateProduct(productId: string, vendorType: string, vendorId: string, data: Record<string, unknown>) {
    await this.getProduct(productId, vendorType, vendorId);
    const updated = await catalogRepository.updateProduct(productId, vendorType, vendorId, data);
    return updated ?? this.getProduct(productId, vendorType, vendorId);
  },

  async deleteProduct(productId: string, vendorType: string, vendorId: string) {
    await this.getProduct(productId, vendorType, vendorId);
    await catalogRepository.deleteProduct(productId, vendorType, vendorId);
  },

  // ── Categories ────────────────────────────────────────────────────────────
  async listCategoriesForVendor(
    vendorType: string,
    vendorId: string,
    opts?: { audience?: string },
  ) {
    return catalogRepository.listCategoriesForVendor(vendorType, vendorId, opts);
  },

  /** Tree shape: roots with `subcategories` array nested under them. Both
   *  global rows and this vendor's customs are merged into a single tree
   *  (customs appear alongside globals under their declared parent root).
   *  Audience filter, when supplied, narrows which roots are returned. */
  async getCategoryTreeForVendor(
    vendorType: string,
    vendorId: string,
    opts?: { audience?: string },
  ) {
    const flat = await catalogRepository.listCategoriesForVendor(vendorType, vendorId, opts);
    type Node = (typeof flat)[number] & { subcategories: Node[] };
    const map = new Map<string, Node>();
    const roots: Node[] = [];
    for (const row of flat) {
      map.set(row.id, { ...row, subcategories: [] });
    }
    for (const row of flat) {
      const node = map.get(row.id)!;
      if (row.parent_id && map.has(row.parent_id)) {
        map.get(row.parent_id)!.subcategories.push(node);
      } else if (row.parent_id === null) {
        roots.push(node);
      }
      // Orphan rows (parent_id set but parent excluded by filter) silently
      // drop — they'd render confusingly without context.
    }
    return roots;
  },

  async createVendorCategory(
    vendorType: string,
    vendorId: string,
    data: { name: string; parent_id?: string; audience?: string },
  ) {
    // Validate parent_id: must exist, be active, and either be global or
    // owned by the caller. Prevents one vendor attaching a subcategory under
    // another vendor's private category.
    let parentAudience: string | null = null;
    if (data.parent_id) {
      const parent = await catalogRepository.getCategoryById(data.parent_id);
      if (!parent || parent.is_active === false) {
        throw new ValidationError({ parent_id: 'Parent category not found' });
      }
      if (parent.parent_id !== null) {
        // Keep the taxonomy 2 levels deep — easier picker, matches the
        // salon/freelancer current UX expectations.
        throw new ValidationError({ parent_id: "Can't nest subcategories beyond two levels" });
      }
      const isGlobal = parent.vendor_id === null;
      const isOwn = parent.vendor_type === vendorType && parent.vendor_id === vendorId;
      if (!isGlobal && !isOwn) {
        throw new ValidationError({
          parent_id: 'You can only add subcategories under global or your own categories',
        });
      }
      parentAudience = parent.audience;
    }
    // Audience resolution: explicit > parent's > column default ('grooming').
    const audience = data.audience ?? parentAudience ?? undefined;
    return catalogRepository.createVendorCategory(vendorType, vendorId, {
      name: data.name,
      parent_id: data.parent_id ?? null,
      audience: audience ?? null,
    });
  },

  // ── Public Reads (customer-facing detail pages) ────────────────────────────
  // Map repo snake_case rows to API camelCase DTOs. `serviceMode` value is a
  // pass-through (same enum end-to-end per errata §8.5.1). Pricing/ratings
  // come back from `pg` as NUMERIC strings → coerce via Number.
  async getPublicService(id: string) {
    const row = await catalogRepository.getPublicServiceById(id);
    if (!row) throw new ResourceNotFoundError('Service not found');
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      priceInr: Math.round(Number(row.price)),
      durationMin: row.duration_minutes,
      genderTarget: row.gender_target,
      serviceMode: row.service_location,                                            // 'onsite' | 'home' | 'both'
      photos: row.photos ?? [],
      category: row.category_id
        ? { id: row.category_id, slug: row.category_slug!, name: row.category_name! }
        : null,
      vendor: {
        id: row.vendor_id,
        slug: row.vendor_slug,
        name: row.vendor_name,
        type: row.vendor_type,
        ratingAvg: Number(row.vendor_rating_avg),
        ratingCount: row.vendor_rating_count,
      },
      reviewAggregate: {
        ratingAvg: Number(row.service_rating_avg),
        ratingCount: row.service_rating_count,
      },
    };
  },

  async getPublicProduct(id: string) {
    const row = await catalogRepository.getPublicProductById(id);
    if (!row) throw new ResourceNotFoundError('Product not found');
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      priceInr: Math.round(Number(row.price)),
      photos: [],
      category: row.category,
      vendor: {
        id: row.vendor_id,
        slug: row.vendor_slug,
        name: row.vendor_name,
        type: row.vendor_type,
        ratingAvg: Number(row.vendor_rating_avg),
        ratingCount: row.vendor_rating_count,
      },
      reviewAggregate: {
        ratingAvg: Number(row.product_rating_avg),
        ratingCount: row.product_rating_count,
      },
    };
  },
};

