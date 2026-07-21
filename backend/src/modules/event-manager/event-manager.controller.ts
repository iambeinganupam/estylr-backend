import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleGuard } from '../../middleware/role-guard.middleware';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.middleware';
import { success, created, noContent } from '../../lib/response';
import { eventManagerService } from './event-manager.service';
import {
  createManagedEventSchema,
  updateManagedEventSchema,
  hireFreelancerSchema,
  updateHireStatusSchema,
  freelancerSearchSchema,
  marketplaceVendorsQuerySchema,
  createEventVendorSchema,
  updateEventVendorSchema,
  createGuestSchema,
  updateGuestSchema,
  createBudgetItemSchema,
  updateBudgetItemSchema,
  createTaskSchema,
  updateTaskSchema,
  createPaymentSchema,
  updatePaymentSchema,
  createTransactionSchema,
  upsertPortfolioSchema,
  createTemplateSchema,
  updateTemplateSchema,
  createCommunicationSchema,
  communicationsQuerySchema,
  eventIdParam,
  hireIdParam,
  vendorIdParam,
  guestIdParam,
  itemIdParam,
  taskIdParam,
  paymentIdParam,
  templateIdParam,
} from './event-manager.schemas';

export const eventManagerController = Router();

eventManagerController.use(authMiddleware);
eventManagerController.use(roleGuard('event_manager'));

const r = eventManagerController;

// ── Top-level (not under :id) ───────────────────────────────────────────────
r.get('/marketplace/vendors',
  validateQuery(marketplaceVendorsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof marketplaceVendorsQuerySchema>;
    const vendors = await eventManagerService.searchMarketplaceVendors(q);
    success(res, vendors);
  }),
);

r.get('/portfolio/me', asyncHandler(async (req, res) => {
  const p = await eventManagerService.getPortfolio(req.auth!.userId);
  success(res, p ?? null);
}));

r.put('/portfolio/me',
  validateBody(upsertPortfolioSchema),
  asyncHandler(async (req, res) => {
    const saved = await eventManagerService.upsertPortfolio(req.auth!.userId, req.body);
    success(res, saved);
  }),
);

r.get('/templates', asyncHandler(async (req, res) => {
  const t = await eventManagerService.listTemplates(req.auth!.userId);
  success(res, t);
}));

r.post('/templates',
  validateBody(createTemplateSchema),
  asyncHandler(async (req, res) => {
    const t = await eventManagerService.createTemplate(req.auth!.userId, req.body);
    created(res, t);
  }),
);

r.patch('/templates/:templateId',
  validateParams(templateIdParam),
  validateBody(updateTemplateSchema),
  asyncHandler(async (req, res) => {
    const t = await eventManagerService.updateTemplate(req.auth!.userId, String(req.params.templateId), req.body);
    success(res, t);
  }),
);

r.delete('/templates/:templateId',
  validateParams(templateIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.removeTemplate(req.auth!.userId, String(req.params.templateId));
    noContent(res);
  }),
);

r.get('/messages',
  validateQuery(communicationsQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof communicationsQuerySchema>;
    const msgs = await eventManagerService.listCommunications(req.auth!.userId, q);
    success(res, msgs);
  }),
);

r.post('/messages',
  validateBody(createCommunicationSchema),
  asyncHandler(async (req, res) => {
    const msg = await eventManagerService.postCommunication(req.auth!.userId, req.body);
    created(res, msg);
  }),
);

r.get('/analytics', asyncHandler(async (req, res) => {
  const data = await eventManagerService.analyticsSummary(req.auth!.userId);
  success(res, data);
}));

// ── Events (collection) ─────────────────────────────────────────────────────
r.post('/',
  validateBody(createManagedEventSchema),
  asyncHandler(async (req, res) => {
    const event = await eventManagerService.createEvent(req.auth!.userId, req.body);
    created(res, event);
  }),
);

r.get('/my', asyncHandler(async (req, res) => {
  const events = await eventManagerService.listMyEvents(req.auth!.userId);
  success(res, events);
}));

// ── Events (item) ───────────────────────────────────────────────────────────
r.get('/:id',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => {
    const event = await eventManagerService.getEvent(req.auth!.userId, String(req.params.id));
    success(res, event);
  }),
);

r.patch('/:id',
  validateParams(eventIdParam),
  validateBody(updateManagedEventSchema),
  asyncHandler(async (req, res) => {
    const event = await eventManagerService.updateEvent(req.auth!.userId, String(req.params.id), req.body);
    success(res, event);
  }),
);

r.delete('/:id',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.deleteEvent(req.auth!.userId, String(req.params.id));
    noContent(res);
  }),
);

// ── Freelancer search & hires (existing) ────────────────────────────────────
r.get('/:id/freelancers',
  validateParams(eventIdParam),
  validateQuery(freelancerSearchSchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof freelancerSearchSchema>;
    const freelancers = await eventManagerService.searchFreelancers(
      req.auth!.userId, String(req.params.id), { city: q.city, limit: q.limit },
    );
    success(res, freelancers);
  }),
);

r.post('/:id/hires',
  validateParams(eventIdParam),
  validateBody(hireFreelancerSchema),
  asyncHandler(async (req, res) => {
    const hire = await eventManagerService.hireFreelancer(
      req.auth!.userId, String(req.params.id),
      req.body.freelancer_id, req.body.agreed_rate, req.body.notes,
    );
    created(res, hire);
  }),
);

r.patch('/:id/hires/:hireId',
  validateParams(hireIdParam),
  validateBody(updateHireStatusSchema),
  asyncHandler(async (req, res) => {
    const hire = await eventManagerService.updateHireStatus(
      req.auth!.userId, String(req.params.id), String(req.params.hireId),
      req.body.status, req.body.notes,
    );
    success(res, hire);
  }),
);

// ── Vendors (per event) ─────────────────────────────────────────────────────
r.get('/:id/vendors',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => success(res, await eventManagerService.listVendors(req.auth!.userId, String(req.params.id)))),
);
r.post('/:id/vendors',
  validateParams(eventIdParam),
  validateBody(createEventVendorSchema),
  asyncHandler(async (req, res) => created(res, await eventManagerService.createVendor(req.auth!.userId, String(req.params.id), req.body))),
);
r.patch('/:id/vendors/:vendorId',
  validateParams(vendorIdParam),
  validateBody(updateEventVendorSchema),
  asyncHandler(async (req, res) => success(res, await eventManagerService.updateVendor(req.auth!.userId, String(req.params.id), String(req.params.vendorId), req.body))),
);
r.delete('/:id/vendors/:vendorId',
  validateParams(vendorIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.removeVendor(req.auth!.userId, String(req.params.id), String(req.params.vendorId));
    noContent(res);
  }),
);

// ── Guests ──────────────────────────────────────────────────────────────────
r.get('/:id/guests',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => success(res, await eventManagerService.listGuests(req.auth!.userId, String(req.params.id)))),
);
r.post('/:id/guests',
  validateParams(eventIdParam),
  validateBody(createGuestSchema),
  asyncHandler(async (req, res) => created(res, await eventManagerService.createGuest(req.auth!.userId, String(req.params.id), req.body))),
);
r.patch('/:id/guests/:guestId',
  validateParams(guestIdParam),
  validateBody(updateGuestSchema),
  asyncHandler(async (req, res) => success(res, await eventManagerService.updateGuest(req.auth!.userId, String(req.params.id), String(req.params.guestId), req.body))),
);
r.delete('/:id/guests/:guestId',
  validateParams(guestIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.removeGuest(req.auth!.userId, String(req.params.id), String(req.params.guestId));
    noContent(res);
  }),
);

// ── Budget items ────────────────────────────────────────────────────────────
r.get('/:id/budget-items',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => success(res, await eventManagerService.listBudgetItems(req.auth!.userId, String(req.params.id)))),
);
r.post('/:id/budget-items',
  validateParams(eventIdParam),
  validateBody(createBudgetItemSchema),
  asyncHandler(async (req, res) => created(res, await eventManagerService.createBudgetItem(req.auth!.userId, String(req.params.id), req.body))),
);
r.patch('/:id/budget-items/:itemId',
  validateParams(itemIdParam),
  validateBody(updateBudgetItemSchema),
  asyncHandler(async (req, res) => success(res, await eventManagerService.updateBudgetItem(req.auth!.userId, String(req.params.id), String(req.params.itemId), req.body))),
);
r.delete('/:id/budget-items/:itemId',
  validateParams(itemIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.removeBudgetItem(req.auth!.userId, String(req.params.id), String(req.params.itemId));
    noContent(res);
  }),
);

// ── Tasks ───────────────────────────────────────────────────────────────────
r.get('/:id/tasks',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => success(res, await eventManagerService.listTasks(req.auth!.userId, String(req.params.id)))),
);
r.post('/:id/tasks',
  validateParams(eventIdParam),
  validateBody(createTaskSchema),
  asyncHandler(async (req, res) => created(res, await eventManagerService.createTask(req.auth!.userId, String(req.params.id), req.body))),
);
r.patch('/:id/tasks/:taskId',
  validateParams(taskIdParam),
  validateBody(updateTaskSchema),
  asyncHandler(async (req, res) => success(res, await eventManagerService.updateTask(req.auth!.userId, String(req.params.id), String(req.params.taskId), req.body))),
);
r.delete('/:id/tasks/:taskId',
  validateParams(taskIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.removeTask(req.auth!.userId, String(req.params.id), String(req.params.taskId));
    noContent(res);
  }),
);

// ── Payments ────────────────────────────────────────────────────────────────
r.get('/:id/payments',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => success(res, await eventManagerService.listPayments(req.auth!.userId, String(req.params.id)))),
);
r.post('/:id/payments',
  validateParams(eventIdParam),
  validateBody(createPaymentSchema),
  asyncHandler(async (req, res) => created(res, await eventManagerService.createPayment(req.auth!.userId, String(req.params.id), req.body))),
);
r.patch('/:id/payments/:paymentId',
  validateParams(paymentIdParam),
  validateBody(updatePaymentSchema),
  asyncHandler(async (req, res) => success(res, await eventManagerService.updatePayment(req.auth!.userId, String(req.params.id), String(req.params.paymentId), req.body))),
);
r.delete('/:id/payments/:paymentId',
  validateParams(paymentIdParam),
  asyncHandler(async (req, res) => {
    await eventManagerService.removePayment(req.auth!.userId, String(req.params.id), String(req.params.paymentId));
    noContent(res);
  }),
);

// ── Transactions ────────────────────────────────────────────────────────────
r.get('/:id/transactions',
  validateParams(eventIdParam),
  asyncHandler(async (req, res) => success(res, await eventManagerService.listTransactions(req.auth!.userId, String(req.params.id)))),
);
r.post('/:id/transactions',
  validateParams(eventIdParam),
  validateBody(createTransactionSchema),
  asyncHandler(async (req, res) => created(res, await eventManagerService.recordTransaction(req.auth!.userId, String(req.params.id), req.body))),
);
