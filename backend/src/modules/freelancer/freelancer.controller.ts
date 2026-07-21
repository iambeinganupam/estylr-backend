// ─────────────────────────────────────────────────────────────────────────────
// Freelancer Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
// All routes scoped to /api/v1/freelancer and guarded by FREELANCER role.
// The freelancer's profile id (freelancer_profiles.id) lives in req.auth.profileId
// — it was minted into the JWT during login. The userId is in req.auth.userId.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { USER_ROLE } from '../../lib/constants';
import { freelancerService } from './freelancer.service';
import {
  updateFreelancerProfileSchema,
  setPresenceSchema,
  createExperienceSchema,
  updateExperienceSchema,
  createSkillSchema,
  createCertificationSchema,
  createLanguageSchema,
  createSalonAssociationSchema,
  updateSalonAssociationSchema,
  updatePreferencesSchema,
  performanceQuerySchema,
  idParamSchema,
} from './freelancer.schemas';

export const freelancerController = Router();

freelancerController.use(authMiddleware);
freelancerController.use(roleGuard(USER_ROLE.FREELANCER));

// ── Profile ──────────────────────────────────────────────────────────────────

freelancerController.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const profile = await freelancerService.getProfile(req.auth!.profileId);
    success(res, profile);
  }),
);

freelancerController.put(
  '/profile',
  validateBody(updateFreelancerProfileSchema),
  asyncHandler(async (req, res) => {
    const patch = req.body as z.infer<typeof updateFreelancerProfileSchema>;
    const updated = await freelancerService.updateProfile(req.auth!.profileId, patch);
    success(res, updated);
  }),
);

// ── Presence ─────────────────────────────────────────────────────────────────
// PATCH /freelancer/presence — toggle the freelancer's online status.
// Idempotent: re-issuing the same value is a no-op (online_since_at preserved).
freelancerController.patch(
  '/presence',
  validateBody(setPresenceSchema),
  asyncHandler(async (req, res) => {
    const { is_online } = req.body as z.infer<typeof setPresenceSchema>;
    const presence = await freelancerService.setPresence(req.auth!.profileId, is_online);
    success(res, presence);
  }),
);

// ── Experience ───────────────────────────────────────────────────────────────

freelancerController.get(
  '/experience',
  asyncHandler(async (req, res) => {
    const data = await freelancerService.listExperience(req.auth!.profileId);
    success(res, data);
  }),
);

freelancerController.post(
  '/experience',
  validateBody(createExperienceSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createExperienceSchema>;
    const data = await freelancerService.createExperience(req.auth!.profileId, input);
    created(res, data);
  }),
);

freelancerController.put(
  '/experience/:id',
  validateParams(idParamSchema),
  validateBody(updateExperienceSchema),
  asyncHandler(async (req, res) => {
    const data = await freelancerService.updateExperience(
      req.auth!.profileId,
      String(req.params.id),
      req.body,
    );
    success(res, data);
  }),
);

freelancerController.delete(
  '/experience/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    await freelancerService.deleteExperience(req.auth!.profileId, String(req.params.id));
    noContent(res);
  }),
);

// ── Skills ───────────────────────────────────────────────────────────────────

freelancerController.get(
  '/skills',
  asyncHandler(async (req, res) => {
    const data = await freelancerService.listSkills(req.auth!.profileId);
    success(res, data);
  }),
);

freelancerController.post(
  '/skills',
  validateBody(createSkillSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSkillSchema>;
    const data = await freelancerService.createSkill(req.auth!.profileId, input);
    created(res, data);
  }),
);

freelancerController.delete(
  '/skills/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    await freelancerService.deleteSkill(req.auth!.profileId, String(req.params.id));
    noContent(res);
  }),
);

// ── Certifications ───────────────────────────────────────────────────────────

freelancerController.get(
  '/certifications',
  asyncHandler(async (req, res) => {
    const data = await freelancerService.listCertifications(req.auth!.profileId);
    success(res, data);
  }),
);

freelancerController.post(
  '/certifications',
  validateBody(createCertificationSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createCertificationSchema>;
    const data = await freelancerService.createCertification(req.auth!.profileId, input);
    created(res, data);
  }),
);

freelancerController.delete(
  '/certifications/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    await freelancerService.deleteCertification(req.auth!.profileId, String(req.params.id));
    noContent(res);
  }),
);

// ── Languages ────────────────────────────────────────────────────────────────

freelancerController.get(
  '/languages',
  asyncHandler(async (req, res) => {
    const data = await freelancerService.listLanguages(req.auth!.profileId);
    success(res, data);
  }),
);

freelancerController.post(
  '/languages',
  validateBody(createLanguageSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createLanguageSchema>;
    const data = await freelancerService.createLanguage(req.auth!.profileId, input);
    created(res, data);
  }),
);

freelancerController.delete(
  '/languages/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    await freelancerService.deleteLanguage(req.auth!.profileId, String(req.params.id));
    noContent(res);
  }),
);

// ── Salon History ────────────────────────────────────────────────────────────

freelancerController.get(
  '/salon-history',
  asyncHandler(async (req, res) => {
    const data = await freelancerService.listSalonAssociations(req.auth!.profileId);
    success(res, data);
  }),
);

freelancerController.post(
  '/salon-history',
  validateBody(createSalonAssociationSchema),
  asyncHandler(async (req, res) => {
    const input = req.body as z.infer<typeof createSalonAssociationSchema>;
    const data = await freelancerService.createSalonAssociation(req.auth!.profileId, input);
    created(res, data);
  }),
);

freelancerController.put(
  '/salon-history/:id',
  validateParams(idParamSchema),
  validateBody(updateSalonAssociationSchema),
  asyncHandler(async (req, res) => {
    const data = await freelancerService.updateSalonAssociation(
      req.auth!.profileId,
      String(req.params.id),
      req.body,
    );
    success(res, data);
  }),
);

freelancerController.delete(
  '/salon-history/:id',
  validateParams(idParamSchema),
  asyncHandler(async (req, res) => {
    await freelancerService.deleteSalonAssociation(
      req.auth!.profileId,
      String(req.params.id),
    );
    noContent(res);
  }),
);

// ── Performance ──────────────────────────────────────────────────────────────

freelancerController.get(
  '/performance',
  validateQuery(performanceQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof performanceQuerySchema>;
    const data = await freelancerService.getPerformance(req.auth!.profileId, q.range);
    success(res, data);
  }),
);

// ── Preferences ──────────────────────────────────────────────────────────────

freelancerController.get(
  '/preferences',
  asyncHandler(async (req, res) => {
    const data = await freelancerService.getPreferences(req.auth!.userId);
    success(res, data);
  }),
);

freelancerController.put(
  '/preferences',
  validateBody(updatePreferencesSchema),
  asyncHandler(async (req, res) => {
    const data = await freelancerService.updatePreferences(req.auth!.userId, req.body);
    success(res, data);
  }),
);
