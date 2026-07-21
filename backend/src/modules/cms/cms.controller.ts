// ─────────────────────────────────────────────────────────────────────────────
// CMS Module — Controller (CMS-01 through CMS-07)
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware, optionalAuth } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { cmsService } from './cms.service';
import { z } from 'zod';
import {
  createPageSchema, updatePageSchema, contactFormSchema, newsletterSchema,
  createPlannerEventSchema, toggleTaskSchema,
  pageListSchema, pageIdParam, slugParam, plannerEventIdParam, taskIdParam,
  calloutQuerySchema, createCalloutSchema, updateCalloutSchema, calloutIdParam,
  testimonialQuerySchema,
} from './cms.schemas';

export const cmsController = Router();

// ── CMS-01: List Published Posts [PUBLIC] ──
cmsController.get(
  '/posts',
  optionalAuth,
  validateQuery(pageListSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof pageListSchema>;
    // Public endpoint defaults to showing published only
    const status = q.status || 'published';
    const pages = await cmsService.listPages({ status, tag: q.tag, limit: q.limit });
    success(res, pages);
  }),
);

// ── CMS-02: Get Post by Slug [PUBLIC] ──
cmsController.get(
  '/posts/:slug',
  optionalAuth,
  validateParams(slugParam),
  asyncHandler(async (req, res) => {
    const page = await cmsService.getPageBySlug(String(req.params.slug));
    success(res, page);
  }),
);

// ── CMS-03: Submit Contact Form [PUBLIC] ──
cmsController.post(
  '/contact',
  optionalAuth,
  validateBody(contactFormSchema),
  asyncHandler(async (req, res) => {
    await cmsService.submitContact(req.body);
    // Intentionally vague: never reveal if email exists (anti-enumeration)
    success(res, { message: 'Your inquiry has been received. We will get back to you shortly.' });
  }),
);

// ── CMS-04: Subscribe to Newsletter [PUBLIC] ──
cmsController.post(
  '/newsletter',
  optionalAuth,
  validateBody(newsletterSchema),
  asyncHandler(async (req, res) => {
    await cmsService.subscribeNewsletter(req.body.email_address);
    success(res, { message: 'Successfully subscribed to the newsletter.' });
  }),
);

// ── CMS-05: Create Planner Event ──
cmsController.post(
  '/planner/events',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateBody(createPlannerEventSchema),
  asyncHandler(async (req, res) => {
    const result = await cmsService.createPlannerEvent(
      req.auth!.userId, req.body.event_name, req.body.event_date,
    );
    created(res, result);
  }),
);

// ── CMS-06: Get Planner Tasks ──
cmsController.get(
  '/planner/events/:id/tasks',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(plannerEventIdParam),
  asyncHandler(async (req, res) => {
    const tasks = await cmsService.getPlannerTasks(String(req.params.id));
    success(res, tasks);
  }),
);

// ── CMS-07: Toggle Task Complete ──
cmsController.patch(
  '/planner/tasks/:taskId',
  authMiddleware,
  roleGuard('event_manager', 'customer', 'super_admin'),
  validateParams(taskIdParam),
  validateBody(toggleTaskSchema),
  asyncHandler(async (req, res) => {
    const task = await cmsService.toggleTask(String(req.params.taskId), req.body.is_completed);
    success(res, task);
  }),
);

// ── Admin: Create Page (not in public API, but needed for content management) ──
cmsController.post(
  '/pages',
  authMiddleware,
  roleGuard('super_admin'),
  validateBody(createPageSchema),
  asyncHandler(async (req, res) => {
    const page = await cmsService.createPage({ ...req.body, authorId: req.auth!.userId });
    created(res, page);
  }),
);

// ── Admin: Update Page ──
cmsController.put(
  '/pages/:id',
  authMiddleware,
  roleGuard('super_admin'),
  validateParams(pageIdParam),
  validateBody(updatePageSchema),
  asyncHandler(async (req, res) => {
    const page = await cmsService.updatePage(String(req.params.id), req.body);
    success(res, page);
  }),
);

// ── Admin: Delete Page ──
cmsController.delete(
  '/pages/:id',
  authMiddleware,
  roleGuard('super_admin'),
  validateParams(pageIdParam),
  asyncHandler(async (req, res) => {
    await cmsService.deletePage(String(req.params.id));
    noContent(res);
  }),
);

// ── CMS-08: List Platform Callouts [PUBLIC] ──
cmsController.get(
  '/callouts',
  optionalAuth,
  validateQuery(calloutQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof calloutQuerySchema>;
    const callouts = await cmsService.listCallouts(q.context);
    success(res, callouts);
  }),
);

// ── CMS-09: List Customer Testimonials [PUBLIC] ──
cmsController.get(
  '/testimonials',
  optionalAuth,
  validateQuery(testimonialQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof testimonialQuerySchema>;
    const items = await cmsService.listTestimonials({ limit: q.limit });
    success(res, items);
  }),
);

// ── CMS-10: Create Callout [super_admin] ──
cmsController.post(
  '/callouts',
  authMiddleware,
  roleGuard('super_admin'),
  validateBody(createCalloutSchema),
  asyncHandler(async (req, res) => {
    const callout = await cmsService.createCallout(req.body);
    created(res, callout);
  }),
);

// ── CMS-11: Update Callout [super_admin] ──
cmsController.put(
  '/callouts/:id',
  authMiddleware,
  roleGuard('super_admin'),
  validateParams(calloutIdParam),
  validateBody(updateCalloutSchema),
  asyncHandler(async (req, res) => {
    const callout = await cmsService.updateCallout(String(req.params.id), req.body);
    success(res, callout);
  }),
);

// ── CMS-12: Delete Callout [super_admin] ──
cmsController.delete(
  '/callouts/:id',
  authMiddleware,
  roleGuard('super_admin'),
  validateParams(calloutIdParam),
  asyncHandler(async (req, res) => {
    await cmsService.deleteCallout(String(req.params.id));
    noContent(res);
  }),
);
