// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings — Service
// ─────────────────────────────────────────────────────────────────────────────

import type { Request } from 'express';
import { recordAudit } from '../../lib/audit-log';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../lib/constants';
import { adminSettingsRepository, type SettingsRow } from './admin-settings.repository';
import type { SettingsUpdateBody } from './admin-settings.schemas';

export const adminSettingsService = {
  async get(): Promise<SettingsRow> {
    return adminSettingsRepository.get();
  },

  async update(body: SettingsUpdateBody, req: Request): Promise<SettingsRow> {
    const before = await adminSettingsRepository.get();
    const after = await adminSettingsRepository.update(body);
    await recordAudit({
      action: AUDIT_ACTION.SETTINGS_UPDATE,
      entityType: AUDIT_ENTITY.SETTINGS,
      entityId: null,
      before, after,
      reason: body.reason,
      req,
    });
    return after;
  },
};
