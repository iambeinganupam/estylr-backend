// ─────────────────────────────────────────────────────────────────────────────
// Admin module — Service
// ─────────────────────────────────────────────────────────────────────────────
// Legacy admin endpoints (KYC, users, categories, stats). Every write path
// here records an audit_log row via `recordAudit()` so the trail is complete.
// New endpoint groups live in dedicated modules under `modules/admin-*`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { ResourceNotFoundError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminRepository } from './admin.repository';
import { kycDecisionsTotal } from '../../lib/metrics';

export const adminService = {
  async getPendingKyc() {
    return adminRepository.getPendingKyc();
  },

  async processKyc(
    id: string,
    action: 'approve' | 'reject',
    targetType: 'freelancer' | 'salon',
    req?: Request,
  ) {
    let result;
    if (targetType === 'freelancer') {
      result = action === 'approve'
        ? await adminRepository.approveFreelancer(id)
        : await adminRepository.rejectFreelancer(id);
    } else {
      result = action === 'approve'
        ? await adminRepository.approveSalon(id)
        : await adminRepository.rejectSalon(id);
    }
    if (!result) throw new ResourceNotFoundError(`${targetType} profile`);

    kycDecisionsTotal.inc({ outcome: action === 'approve' ? 'approved' : 'rejected' });

    if (req) {
      await recordAudit({
        action: action === 'approve' ? AUDIT_ACTION.KYC_APPROVE : AUDIT_ACTION.KYC_REJECT,
        entityType: AUDIT_ENTITY.KYC,
        entityId: id,
        after: result,
        reason: `${targetType} ${action}d via legacy admin`,
        req,
      });
    }

    return result;
  },

  async listUsers(filters: { role?: string; is_active?: boolean; page: number; limit: number }) {
    return adminRepository.listUsers(filters);
  },

  async updateUserStatus(
    userId: string,
    status: 'active' | 'suspended' | 'banned',
    req?: Request,
  ) {
    const isActive = status === 'active';
    const before = await adminRepository.getUserById(userId);
    const result = await adminRepository.setUserActiveStatus(userId, isActive);
    if (!result) throw new ResourceNotFoundError('User');

    if (req) {
      await recordAudit({
        action: status === 'active' ? AUDIT_ACTION.CUSTOMER_REINSTATE : AUDIT_ACTION.CUSTOMER_SUSPEND,
        entityType: AUDIT_ENTITY.USER,
        entityId: userId,
        before,
        after: result,
        reason: `Status set to ${status}`,
        req,
      });
    }

    return { ...result, status };
  },

  async getPlatformStats() {
    return adminRepository.getPlatformStats();
  },

  // Category service methods (listCategories, createCategory, updateCategory,
  // promoteCategory, deleteCategory) moved to the admin-categories module on
  // 2026-05-29 — see backend/src/modules/admin-categories/admin-categories.service.ts.
  // The new module preserves audit-log semantics where applicable and adds
  // a dependents guard, audience filtering, and bulk reorder.
};
