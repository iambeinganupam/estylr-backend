// ─────────────────────────────────────────────────────────────────────────────
// Meta Module — Schemas
// ─────────────────────────────────────────────────────────────────────────────
// The meta endpoints take no request body and only validate the optional
// enum-name param. Centralising the allow-list here means the controller
// rejects unknown names with VALIDATION_FAILED rather than ResourceNotFound,
// which is the right shape for "this name was never a valid enum".
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { PUBLIC_ENUM_NAMES } from './meta.repository';

export const enumNameParam = z.object({
  name: z.enum(PUBLIC_ENUM_NAMES as unknown as readonly [string, ...string[]]),
});
