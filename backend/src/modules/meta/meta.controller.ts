// ─────────────────────────────────────────────────────────────────────────────
// Meta Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
// Exposes:
//   GET /api/v1/meta/enums         — full client-facing enum catalogue
//   GET /api/v1/meta/enums/:name   — single enum's values
//
// Both routes are public-by-design: enum values are not secrets, every
// dashboard fetches them at boot to populate dropdowns / validators, and
// gating them behind auth would force every login flow to wait on us.
//
// Responses set `Cache-Control: public, max-age=300, s-maxage=600` so the
// browser and any CDN keep the payload around for 5–10 minutes. Most values
// only ever change when a migration ships. The one exception is `staff_role`
// (migration 091 — a table, not a fixed ENUM) — its values are fetched live
// through a short in-process cache (staffService), so this HTTP cache header
// is a slightly stale but harmless upper bound for it, not a correctness
// issue: a brand new role showing up in a cached response up to ~10 minutes
// late is a non-event, nothing books against a role that fast.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { validateParams } from '../../middleware/validate.middleware';
import { success } from '../../lib/response';
import { metaService } from './meta.service';
import { enumNameParam } from './meta.schemas';
import type { EnumName } from './meta.repository';

export const metaController = Router();

const CACHE_HEADER = 'public, max-age=300, s-maxage=600';

// ── META-01: List all client-facing enums ──
metaController.get(
  '/enums',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', CACHE_HEADER);
    success(res, await metaService.listEnums());
  }),
);

// ── META-02: Fetch a single enum's values ──
metaController.get(
  '/enums/:name',
  validateParams(enumNameParam),
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', CACHE_HEADER);
    success(res, await metaService.getEnum(req.params.name as EnumName));
  }),
);
