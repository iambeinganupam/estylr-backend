// ─────────────────────────────────────────────────────────────────────────────
// Messaging Module — Controller
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { asyncHandler } from '../../middleware/error-handler.middleware';
import { authMiddleware } from '../../middleware/auth.middleware';
import { kycGuard } from '../../middleware/kyc-guard.middleware';
import { validateBody, validateQuery, validateParams } from '../../middleware/validate.middleware';
import { success, created } from '../../lib/response';
import * as service from './messaging.service';
import {
  createThreadSchema,
  sendMessageSchema,
  pollQuerySchema,
  markReadSchema,
  threadIdParam,
} from './messaging.schemas';

export const messagingController = Router();
messagingController.use(authMiddleware);

// POST /messages/threads — open or get a thread (customer initiates)
messagingController.post(
  '/messages/threads',
  validateBody(createThreadSchema),
  asyncHandler(async (req, res) => {
    const { vendor_type, vendor_id, appointment_id } = req.body as {
      vendor_type: string;
      vendor_id: string;
      appointment_id?: string;
    };
    const thread = await service.openOrGetThread({
      customerId: req.auth!.userId,
      vendorType: vendor_type,
      vendorId: vendor_id,
      appointmentId: appointment_id,
    });
    created(res, thread);
  }),
);

// GET /messages/threads — list caller's threads
messagingController.get(
  '/messages/threads',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const threads = await service.listThreads(req.auth!.userId, { limit });
    success(res, threads);
  }),
);

// GET /messages/unread-count — total unread across all threads
messagingController.get(
  '/messages/unread-count',
  asyncHandler(async (req, res) => {
    const count = await service.unreadCount(req.auth!.userId);
    success(res, { count });
  }),
);

// GET /messages/threads/:id — thread metadata + last N messages
messagingController.get(
  '/messages/threads/:id',
  validateParams(threadIdParam),
  asyncHandler(async (req, res) => {
    const { thread, messages } = await service.getThread(String(req.params.id), req.auth!.userId);
    success(res, { thread, messages });
  }),
);

// POST /messages/threads/:id/messages — send a message
// kycGuard fast-exits for customers (only blocks unverified vendors).
messagingController.post(
  '/messages/threads/:id/messages',
  validateParams(threadIdParam),
  kycGuard,
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    const { body, media_id } = req.body as { body: string; media_id?: string };
    const msg = await service.sendMessage({
      threadId: String(req.params.id),
      senderId: req.auth!.userId,
      body,
      mediaId: media_id,
    });
    created(res, msg);
  }),
);

// GET /messages/threads/:id/poll — long-poll for new messages since cursor
messagingController.get(
  '/messages/threads/:id/poll',
  validateParams(threadIdParam),
  validateQuery(pollQuerySchema),
  asyncHandler(async (req, res) => {
    const sinceSeq = (req.query as unknown as { since: number }).since;
    const messages = await service.pollSince({
      threadId: String(req.params.id),
      userId: req.auth!.userId,
      sinceSeq,
    });
    // Return empty array on timeout (friendlier for React Query than 204).
    success(res, messages);
  }),
);

// PATCH /messages/threads/:id/read — mark messages as read up to seq
messagingController.patch(
  '/messages/threads/:id/read',
  validateParams(threadIdParam),
  validateBody(markReadSchema),
  asyncHandler(async (req, res) => {
    const { upto_seq } = req.body as { upto_seq: number };
    const marked = await service.markRead({
      threadId: String(req.params.id),
      userId: req.auth!.userId,
      uptoSeq: upto_seq,
    });
    success(res, { marked });
  }),
);
