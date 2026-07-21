// ─────────────────────────────────────────────────────────────────────────────
// Notifications Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validateBody, validateQuery } from '../../middleware/validate.middleware';
import { success, paginated } from '../../lib/response';
import * as service from './notifications.service';
import {
  listNotificationsQuery,
  markReadSchema,
  updatePreferencesSchema,
} from './notifications.schemas';

export const notificationsController = Router();
notificationsController.use(authMiddleware);

// GET /notifications — paginated list
notificationsController.get(
  '/notifications',
  validateQuery(listNotificationsQuery),
  asyncHandler(async (req, res) => {
    const { rows, nextCursor } = await service.listForUser(
      req.auth!.userId,
      req.query as unknown as Parameters<typeof service.listForUser>[1],
    );
    paginated(res, rows, { next_cursor: nextCursor });
  }),
);

// GET /notifications/unread-count
notificationsController.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    const count = await service.unreadCount(req.auth!.userId);
    success(res, { count });
  }),
);

// PATCH /notifications/read — { ids: uuid[] } | { all: true }
notificationsController.patch(
  '/notifications/read',
  validateBody(markReadSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as { ids?: string[]; all?: true };
    const marked = await service.markRead(
      req.auth!.userId,
      body.all ? undefined : body.ids,
    );
    success(res, { marked });
  }),
);

// GET /notifications/preferences
notificationsController.get(
  '/notifications/preferences',
  asyncHandler(async (req, res) => {
    const prefs = await service.getPreferences(req.auth!.userId);
    success(res, prefs);
  }),
);

// PUT /notifications/preferences
notificationsController.put(
  '/notifications/preferences',
  validateBody(updatePreferencesSchema),
  asyncHandler(async (req, res) => {
    const prefs = await service.updatePreferences(req.auth!.userId, req.body);
    success(res, prefs);
  }),
);
