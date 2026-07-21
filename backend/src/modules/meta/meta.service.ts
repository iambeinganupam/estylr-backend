// ─────────────────────────────────────────────────────────────────────────────
// Meta Module — Service Layer
// ─────────────────────────────────────────────────────────────────────────────
// Thin orchestration over the meta repository. Kept as its own layer so that
// future additions (per-role filtering, i18n labels, deprecation flags) can
// land without churning the controller.
// ─────────────────────────────────────────────────────────────────────────────

import { metaRepository, type EnumName, type EnumCatalogue } from './meta.repository';
import { ResourceNotFoundError } from '../../lib/errors';
import { staffService } from '../staff/staff.service';

export const metaService = {
  async listEnums(): Promise<EnumCatalogue> {
    const staticEnums = metaRepository.getStaticEnums();
    const staffRoles = await staffService.getActiveRoleCodes();
    return Object.freeze({
      ...staticEnums,
      staff_role: Object.freeze(staffRoles),
    }) as EnumCatalogue;
  },

  async getEnum(name: EnumName): Promise<readonly string[]> {
    if (name === 'staff_role') return staffService.getActiveRoleCodes();
    const values = metaRepository.getStaticEnum(name);
    if (!values) throw new ResourceNotFoundError('Enum');
    return values;
  },
};
