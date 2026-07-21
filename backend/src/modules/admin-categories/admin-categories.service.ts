// ─────────────────────────────────────────────────────────────────────────────
// Admin Categories — Service (business logic)
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { adminCategoriesRepository, type CategoryRow } from './admin-categories.repository';
import {
  ConflictError,
  ResourceNotFoundError,
  ValidationError,
} from '../../lib/errors';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import type {
  CategoryCreateBody,
  CategoryListQuery,
  CategoryReorderBody,
  CategoryUpdateBody,
} from './admin-categories.schemas';

/** Tree-shaped category for the /tree endpoint. Mirrors the catalog
 *  tree shape so the same React component can render either. */
export type CategoryTreeNode = CategoryRow & { subcategories: CategoryTreeNode[] };

export const adminCategoriesService = {
  async list(filters: CategoryListQuery): Promise<CategoryRow[]> {
    return adminCategoriesRepository.list({
      audience: filters.audience,
      parent_id: filters.parent_id,
      include_inactive: filters.include_inactive,
      search: filters.search,
    });
  },

  async tree(filters: CategoryListQuery): Promise<CategoryTreeNode[]> {
    // Tree always pulls both roots + subs in one query (no parent_id filter
    // applied at repo) so we can build a connected hierarchy. Audience +
    // include_inactive still apply.
    const flat = await adminCategoriesRepository.list({
      audience: filters.audience,
      include_inactive: filters.include_inactive,
      search: filters.search,
    });
    const map = new Map<string, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];
    for (const row of flat) map.set(row.id, { ...row, subcategories: [] });
    for (const row of flat) {
      const node = map.get(row.id)!;
      if (row.parent_id && map.has(row.parent_id)) {
        map.get(row.parent_id)!.subcategories.push(node);
      } else if (row.parent_id === null) {
        roots.push(node);
      }
    }
    return roots;
  },

  async get(id: string): Promise<CategoryRow> {
    const row = await adminCategoriesRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Category');
    if (row.vendor_id !== null) {
      // Vendor-scoped customs are owned by the catalog module; refuse to
      // expose them via the admin API to avoid cross-module ownership drift.
      throw new ResourceNotFoundError('Category');
    }
    return row;
  },

  async create(body: CategoryCreateBody, req?: Request): Promise<CategoryRow> {
    // Validate parent_id (if present): must exist as a global root.
    let inheritedAudience: string | null = null;
    if (body.parent_id) {
      const parent = await adminCategoriesRepository.getById(body.parent_id);
      if (!parent || parent.vendor_id !== null) {
        throw new ValidationError({ parent_id: 'Parent category not found.' });
      }
      if (parent.parent_id !== null) {
        throw new ValidationError({ parent_id: "Can't nest subcategories beyond two levels." });
      }
      inheritedAudience = parent.audience;
    }
    const created = await adminCategoriesRepository.create({
      parent_id: body.parent_id ?? null,
      name: body.name,
      slug: body.slug ?? null,
      // Explicit > inherited > column default ('grooming')
      audience: body.audience ?? inheritedAudience ?? null,
      description: body.description ?? null,
      icon: body.icon ?? null,
      aliases: body.aliases ?? null,
      sort_order: body.sort_order ?? null,
      is_active: body.is_active ?? null,
    });
    if (req) {
      await recordAudit({
        action: AUDIT_ACTION.CATEGORY_CREATE,
        entityType: AUDIT_ENTITY.CATEGORY,
        entityId: created.id,
        after: created,
        req,
      });
    }
    return created;
  },

  async update(id: string, body: CategoryUpdateBody, req?: Request): Promise<CategoryRow> {
    const existing = await this.get(id);

    if (body.parent_id !== undefined) {
      // Re-parenting validations: must target a global root, can't depth>2,
      // can't be the row's own id (no self-parent).
      if (body.parent_id === id) {
        throw new ValidationError({ parent_id: 'A category cannot be its own parent.' });
      }
      if (body.parent_id !== null) {
        const parent = await adminCategoriesRepository.getById(body.parent_id);
        if (!parent || parent.vendor_id !== null) {
          throw new ValidationError({ parent_id: 'Parent category not found.' });
        }
        if (parent.parent_id !== null) {
          throw new ValidationError({ parent_id: "Can't nest subcategories beyond two levels." });
        }
      }
    }

    const updated = await adminCategoriesRepository.update(id, body as Record<string, unknown>);
    if (!updated) throw new ResourceNotFoundError('Category');
    if (req) {
      await recordAudit({
        action: AUDIT_ACTION.CATEGORY_UPDATE,
        entityType: AUDIT_ENTITY.CATEGORY,
        entityId: id,
        before: existing,
        after: updated,
        req,
      });
    }
    return updated;
  },

  /** Soft delete with safety gate: refuses if the row has active children OR
   *  active services pointing at it, unless the caller explicitly opts in.
   *  This keeps the dashboard's "Deactivate" button from silently breaking
   *  vendor catalogs. */
  async softDelete(
    id: string,
    opts?: { force?: boolean },
    req?: Request,
  ): Promise<CategoryRow> {
    const existing = await this.get(id);
    const { active_subs, service_refs } = await adminCategoriesRepository.countDependents(id);
    if (!opts?.force && (active_subs > 0 || service_refs > 0)) {
      throw new ConflictError(
        `Category has ${active_subs} active subcategor${active_subs === 1 ? 'y' : 'ies'} ` +
          `and ${service_refs} active service${service_refs === 1 ? '' : 's'} referencing it. ` +
          `Reassign or deactivate them first, or pass ?force=true to override.`,
      );
    }
    const row = await adminCategoriesRepository.softDelete(id);
    if (!row) throw new ResourceNotFoundError('Category');
    if (req) {
      await recordAudit({
        action: AUDIT_ACTION.CATEGORY_DELETE,
        entityType: AUDIT_ENTITY.CATEGORY,
        entityId: id,
        before: existing,
        after: row,
        reason: opts?.force ? 'Force deactivation (dependents present)' : undefined,
        req,
      });
    }
    return row;
  },

  /** Promote a vendor-custom category to global. Idempotent. */
  async promote(id: string, req?: Request): Promise<CategoryRow> {
    // Resolve unscoped — vendor-scoped rows wouldn't be visible to `get()`
    // (which rejects them as "not a global row").
    const existing = await adminCategoriesRepository.getById(id);
    if (!existing) throw new ResourceNotFoundError('Category');
    const promoted = await adminCategoriesRepository.promoteToGlobal(id);
    if (!promoted) throw new ResourceNotFoundError('Category');
    if (req) {
      await recordAudit({
        action: AUDIT_ACTION.CATEGORY_UPDATE,
        entityType: AUDIT_ENTITY.CATEGORY,
        entityId: id,
        before: existing,
        after: promoted,
        reason: 'Promoted vendor-scoped category to global',
        req,
      });
    }
    return promoted;
  },

  async reorder(body: CategoryReorderBody): Promise<{ updated: number }> {
    const updated = await adminCategoriesRepository.reorder(body.parent_id, body.ids);
    return { updated };
  },
};
