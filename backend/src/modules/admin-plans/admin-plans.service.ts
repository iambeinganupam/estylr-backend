// ─────────────────────────────────────────────────────────────────────────────
// Admin Plans — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ConflictError, ResourceNotFoundError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminPlansRepository, type PlanRow } from './admin-plans.repository';
import type { PlanCreateBody, PlanUpdateBody } from './admin-plans.schemas';

export const adminPlansService = {
  async list(): Promise<PlanRow[]> {
    return adminPlansRepository.list();
  },

  async get(id: string): Promise<PlanRow> {
    const row = await adminPlansRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Plan not found');
    return row;
  },

  async create(body: PlanCreateBody, req: Request): Promise<PlanRow> {
    const id = await adminPlansRepository.create(body);
    const after = await adminPlansRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Plan not found after create');
    await recordAudit({
      action: AUDIT_ACTION.PLAN_CREATE,
      entityType: AUDIT_ENTITY.PLAN,
      entityId: id,
      after,
      req,
    });
    return after;
  },

  async update(id: string, body: PlanUpdateBody, req: Request): Promise<PlanRow> {
    const before = await adminPlansRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Plan not found');
    await adminPlansRepository.update(id, body);
    const after = await adminPlansRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Plan not found after update');
    await recordAudit({
      action: AUDIT_ACTION.PLAN_UPDATE,
      entityType: AUDIT_ENTITY.PLAN,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },

  async softDelete(id: string, req: Request): Promise<void> {
    const before = await adminPlansRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Plan not found');
    if (before.is_default) {
      throw new ConflictError('Cannot delete the default plan; mark another plan default first');
    }
    if (before.subscriber_count > 0) {
      throw new ConflictError(`Cannot delete: ${before.subscriber_count} active subscriber(s). Migrate them first.`);
    }
    await adminPlansRepository.softDelete(id);
    await recordAudit({
      action: AUDIT_ACTION.PLAN_DELETE,
      entityType: AUDIT_ENTITY.PLAN,
      entityId: id,
      before,
      after: { ...before, is_active: false },
      req,
    });
  },
};
