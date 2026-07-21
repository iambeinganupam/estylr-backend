// ─────────────────────────────────────────────────────────────────────────────
// Admin Customers — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminCustomersRepository, type CustomerRow } from './admin-customers.repository';
import type {
  CustomerListQuery,
  CustomerStatusBody,
  CustomerUpdateBody,
} from './admin-customers.schemas';

export const adminCustomersService = {
  async list(q: CustomerListQuery): Promise<{ data: CustomerRow[]; next_cursor: string | null; has_more: boolean }> {
    const { rows, hasMore } = await adminCustomersRepository.list(q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  async get(id: string): Promise<CustomerRow> {
    const row = await adminCustomersRepository.getById(id);
    if (!row) throw new ResourceNotFoundError('Customer not found');
    return row;
  },

  async setStatus(id: string, body: CustomerStatusBody, req: Request): Promise<CustomerRow> {
    const before = await adminCustomersRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Customer not found');

    await adminCustomersRepository.setActive(id, body.is_active);
    const after = await adminCustomersRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Customer not found after update');

    await recordAudit({
      action: body.is_active ? AUDIT_ACTION.CUSTOMER_REINSTATE : AUDIT_ACTION.CUSTOMER_SUSPEND,
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: id,
      before,
      after,
      reason: body.reason,
      req,
    });

    return after;
  },

  async update(id: string, body: CustomerUpdateBody, req: Request): Promise<CustomerRow> {
    const before = await adminCustomersRepository.getById(id);
    if (!before) throw new ResourceNotFoundError('Customer not found');

    await adminCustomersRepository.updateProfile(id, body);
    const after = await adminCustomersRepository.getById(id);
    if (!after) throw new ResourceNotFoundError('Customer not found after update');

    await recordAudit({
      action: AUDIT_ACTION.CUSTOMER_NOTE,
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: id,
      before, after,
      reason: body.reason,
      req,
    });

    return after;
  },
};
