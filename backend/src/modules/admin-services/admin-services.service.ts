// ─────────────────────────────────────────────────────────────────────────────
// Admin Services — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminServicesRepository, type ServiceRow } from './admin-services.repository';
import type {
  ServiceCreateBody,
  ServiceListQuery,
  ServiceUpdateBody,
} from './admin-services.schemas';

export const adminServicesService = {
  async list(q: ServiceListQuery): Promise<{ data: ServiceRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminServicesRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<ServiceRow> {
    const row = await adminServicesRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Service not found');
    return row;
  },

  async create(body: ServiceCreateBody, req: Request): Promise<ServiceRow> {
    const id = await adminServicesRepository.create(body);
    const after = await adminServicesRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Service not found after create');
    await recordAudit({
      action: AUDIT_ACTION.SERVICE_CREATE,
      entityType: AUDIT_ENTITY.SERVICE,
      entityId: id,
      after,
      reason: 'Admin-created service',
      req,
    });
    return after;
  },

  async update(id: string, body: ServiceUpdateBody, req: Request): Promise<ServiceRow> {
    const before = await adminServicesRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Service not found');
    await adminServicesRepository.update(id, body);
    const after = await adminServicesRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Service not found after update');
    await recordAudit({
      action: AUDIT_ACTION.SERVICE_UPDATE,
      entityType: AUDIT_ENTITY.SERVICE,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },

  async softDelete(id: string, req: Request): Promise<void> {
    const before = await adminServicesRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Service not found');
    await adminServicesRepository.softDelete(id);
    await recordAudit({
      action: AUDIT_ACTION.SERVICE_DELETE,
      entityType: AUDIT_ENTITY.SERVICE,
      entityId: id,
      before,
      after: { ...before, is_active: false },
      req,
    });
  },
};
