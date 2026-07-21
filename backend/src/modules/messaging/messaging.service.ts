// ─────────────────────────────────────────────────────────────────────────────
// Messaging Module — Service (business logic)
// ─────────────────────────────────────────────────────────────────────────────
import * as repo from './messaging.repository';
import * as notificationsService from '../notifications/notifications.service';
import { withTransaction } from '../../config/database';
import { InsufficientRoleError, ResourceNotFoundError } from '../../lib/errors';
import type { ThreadRow, MessageRow, ThreadSummaryRow } from './messaging.repository';

const DEFAULT_POLL_MS = 25_000;
const POLL_TICK_MS = 1_000;

// ── Participant guard ─────────────────────────────────────────────────────────

async function assertParticipant(threadId: string, userId: string): Promise<ThreadRow> {
  const thread = await repo.getThread(threadId);
  if (!thread) throw new ResourceNotFoundError('Thread');
  const ok = await repo.isParticipant(threadId, userId);
  if (!ok) throw new InsufficientRoleError();
  return thread;
}

// ── Vendor user resolution ────────────────────────────────────────────────────

async function resolveVendorUserId(vendorType: string, vendorId: string): Promise<string> {
  let userId: string | null = null;

  if (vendorType === 'freelancer') {
    userId = await repo.resolveFreelancerUserId(vendorId);
  } else if (vendorType === 'salon_location') {
    userId = await repo.resolveSalonLocationUserId(vendorId);
  }

  if (!userId) {
    throw new ResourceNotFoundError(`Vendor (${vendorType} ${vendorId})`);
  }
  return userId;
}

// ── Public service functions ──────────────────────────────────────────────────

export async function openOrGetThread(args: {
  customerId: string;
  vendorType: string;
  vendorId: string;
  appointmentId?: string;
}): Promise<ThreadRow> {
  const vendorUserId = await resolveVendorUserId(args.vendorType, args.vendorId);
  return repo.findOrCreateThread({
    customerId: args.customerId,
    vendorType: args.vendorType,
    vendorId: args.vendorId,
    vendorUserId,
    appointmentId: args.appointmentId,
  });
}

export async function sendMessage(args: {
  threadId: string;
  senderId: string;
  body: string;
  mediaId?: string;
}): Promise<MessageRow> {
  const thread = await assertParticipant(args.threadId, args.senderId);

  return withTransaction(async (client) => {
    const msg = await repo.appendMessage(
      {
        threadId: args.threadId,
        senderId: args.senderId,
        body: args.body,
        mediaId: args.mediaId,
      },
      client,
    );

    // Notify the other party.
    const recipientId =
      args.senderId === thread.customer_id ? thread.vendor_user_id : thread.customer_id;

    await notificationsService.dispatch(
      {
        userId: recipientId,
        type: 'message_received',
        data: {
          thread_id: args.threadId,
          sender_id: args.senderId,
          preview: args.body.slice(0, 100),
        },
        dedupeKey: `msg:${msg.id}`,
      },
      client,
    );

    return msg;
  });
}

export async function listThreads(
  userId: string,
  opts: { limit?: number } = {},
): Promise<ThreadSummaryRow[]> {
  return repo.listThreadsForUser(userId, { limit: opts.limit ?? 20 });
}

export async function getThread(
  threadId: string,
  userId: string,
  opts: { messageLimit?: number } = {},
): Promise<{ thread: ThreadRow; messages: MessageRow[] }> {
  const thread = await assertParticipant(threadId, userId);
  const messages = await repo.listMessages(threadId, { limit: opts.messageLimit ?? 30 });
  return { thread, messages };
}

export async function pollSince(args: {
  threadId: string;
  userId: string;
  sinceSeq: number;
  longPollMs?: number;
}): Promise<MessageRow[]> {
  await assertParticipant(args.threadId, args.userId);

  const maxWait = args.longPollMs ?? DEFAULT_POLL_MS;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const rows = await repo.listMessagesSince(args.threadId, args.sinceSeq);
    if (rows.length > 0) return rows;
    // 1-second tick — yield so the event loop isn't blocked
    await new Promise((resolve) => setTimeout(resolve, POLL_TICK_MS));
  }

  return [];
}

export async function markRead(args: {
  threadId: string;
  userId: string;
  uptoSeq: number;
}): Promise<number> {
  await assertParticipant(args.threadId, args.userId);
  return repo.markRead(args.threadId, args.userId, args.uptoSeq);
}

export async function unreadCount(userId: string): Promise<number> {
  return repo.unreadCountForUser(userId);
}
