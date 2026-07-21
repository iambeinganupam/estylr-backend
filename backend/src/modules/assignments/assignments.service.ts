// ─────────────────────────────────────────────────────────────────────────────
// Assignments Module — Service
// ─────────────────────────────────────────────────────────────────────────────
// Business logic + state-machine enforcement for salon→freelancer gigs.
// Every state transition emits a notification to the *other* party so each
// dashboard sees activity in real time.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import {
  ASSIGNMENT_TRANSITIONS,
  resolveTransition,
} from '../../lib/state-machine';
import {
  ResourceNotFoundError,
  ValidationError,
  TenantMismatchError,
} from '../../lib/errors';
import { assignmentsRepository, type AssignmentRow } from './assignments.repository';

// ── Notification side-channel ────────────────────────────────────────────────
// Inserts a row into public.notifications. Failure is logged but never
// propagates — a notification miss must not roll back a status transition.

const NOTIF_TYPE_BY_STATUS: Record<string, string> = {
  requested:   'assignment_requested',
  accepted:    'assignment_accepted',
  declined:    'assignment_declined',
  in_progress: 'assignment_started',
  completed:   'assignment_completed',
  cancelled:   'assignment_cancelled',
};

async function notify(
  recipientUserId: string,
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await query(
      `INSERT INTO public.notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [recipientUserId, type, title, body, JSON.stringify(data)],
    );
  } catch (err) {
    // Pino-style structured log without bringing the request handler down.
    // Notifications are auxiliary; the transition itself already succeeded.
    console.error('[assignments] notify() failed', { err, recipientUserId, type });
  }
}

/**
 * Resolve the salon admin's recipient user_id for a given assignment.
 * The created_by_user_id is the canonical "salon side" recipient — it's the
 * user who initiated the gig, not necessarily the business owner.
 */
function salonRecipient(row: AssignmentRow): string {
  return row.created_by_user_id;
}

function freelancerRecipient(row: AssignmentRow): string {
  return row.freelancer_user_id;
}

function notificationCopy(
  status: string,
  row: AssignmentRow,
  reason: string | null,
): { title: string; body: string } {
  const salon = row.salon_brand_name ?? row.salon_display_name ?? 'A salon';
  const freelancer = row.freelancer_business_name;
  const window = formatWindow(row.start_time, row.end_time);
  switch (status) {
    case 'requested':
      return {
        title: 'New gig request',
        body: `${salon} requested you for a ${row.service_category ?? ''} gig ${window}.`,
      };
    case 'accepted':
      return {
        title: 'Gig accepted',
        body: `${freelancer} accepted your request ${window}.`,
      };
    case 'declined':
      return {
        title: 'Gig declined',
        body: reason
          ? `${freelancer} declined your request: ${reason}`
          : `${freelancer} declined your request.`,
      };
    case 'in_progress':
      return {
        title: 'Gig started',
        body: `${freelancer} has started the gig ${window}.`,
      };
    case 'completed':
      return {
        title: 'Gig completed',
        body: `${freelancer} marked the gig ${window} as complete.`,
      };
    case 'cancelled':
      return {
        title: 'Gig cancelled',
        body: reason ? `Gig was cancelled: ${reason}` : 'Gig was cancelled.',
      };
    default:
      return { title: 'Gig update', body: `Status: ${status}` };
  }
}

function formatWindow(startIso: string, endIso: string): string {
  // Format in UTC without locale assumptions; the UI will localise.
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toISOString().slice(0, 10);
  const hh = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `on ${day} ${hh(start)}–${hh(end)} UTC`;
}

// ── Authorization helpers ────────────────────────────────────────────────────
// Each request carries either { businessId } (business_admin) or
// { freelancerProfileId } (freelancer); these helpers verify ownership.

function assertSalonOwns(row: AssignmentRow, businessId: string | undefined): void {
  if (!businessId || row.business_id !== businessId) {
    throw new TenantMismatchError();
  }
}

function assertFreelancerOwns(row: AssignmentRow, freelancerProfileId: string | undefined): void {
  if (!freelancerProfileId || row.freelancer_id !== freelancerProfileId) {
    throw new TenantMismatchError();
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export const assignmentsService = {
  // ── Business admin: create a new assignment ────────────────────────────────
  async create(input: {
    businessId: string;
    salonLocationId: string;
    freelancerId: string;
    createdByUserId: string;
    serviceCategory: string | null;
    notes: string | null;
    startTime: string;
    endTime: string;
    proposedAmount: number;
  }): Promise<AssignmentRow> {
    const exists = await queryOne(
      `SELECT 1 FROM public.freelancer_profiles WHERE id = $1 AND is_active = TRUE`,
      [input.freelancerId],
    );
    if (!exists) throw new ResourceNotFoundError('Freelancer');

    const row = await assignmentsRepository.create({
      businessId: input.businessId,
      salonLocationId: input.salonLocationId,
      freelancerId: input.freelancerId,
      createdByUserId: input.createdByUserId,
      serviceCategory: input.serviceCategory,
      notes: input.notes,
      startTime: input.startTime,
      endTime: input.endTime,
      proposedAmount: input.proposedAmount,
    });
    if (!row) {
      throw new ValidationError({
        fields: [{ field: 'salon_location_id', message: 'That salon location does not belong to your business.', code: 'tenant_mismatch' }],
      });
    }

    const copy = notificationCopy('requested', row, null);
    await notify(
      freelancerRecipient(row),
      NOTIF_TYPE_BY_STATUS.requested ?? 'system',
      copy.title,
      copy.body,
      { assignment_id: row.id },
    );

    return row;
  },

  // ── Listing ────────────────────────────────────────────────────────────────
  async listForBusiness(businessId: string, status: string | undefined, limit: number): Promise<AssignmentRow[]> {
    return assignmentsRepository.listForBusiness(businessId, { status, limit });
  },

  async listForFreelancer(freelancerProfileId: string, status: string | undefined, limit: number): Promise<AssignmentRow[]> {
    return assignmentsRepository.listForFreelancer(freelancerProfileId, { status, limit });
  },

  // ── Detail (auto-scoped by caller's role) ──────────────────────────────────
  async getForRole(
    id: string,
    actor: { role: string; businessId?: string; freelancerProfileId?: string },
  ): Promise<AssignmentRow> {
    const row = await assignmentsRepository.findById(id);
    if (!row) throw new ResourceNotFoundError('Assignment');
    if (actor.role === 'business_admin') {
      assertSalonOwns(row, actor.businessId);
    } else if (actor.role === 'freelancer') {
      assertFreelancerOwns(row, actor.freelancerProfileId);
    } else {
      throw new TenantMismatchError();
    }
    return row;
  },

  // ── Action (state transition) ──────────────────────────────────────────────
  async applyAction(
    id: string,
    action: string,
    actor: {
      userId: string;
      role: string;
      businessId?: string;
      freelancerProfileId?: string;
    },
    reason: string | null,
  ): Promise<AssignmentRow> {
    const row = await this.getForRole(id, actor);

    const newState = resolveTransition(
      row.status,
      action,
      ASSIGNMENT_TRANSITIONS,
      actor.role,
    );

    if (action === 'cancel' && !reason) {
      throw new ValidationError({
        fields: [{ field: 'reason', message: 'A reason is required to cancel an assignment.', code: 'reason_required' }],
      });
    }

    const updated = await assignmentsRepository.transition(id, newState, actor.userId, reason);
    if (!updated) throw new ResourceNotFoundError('Assignment');

    // Notify the other party.
    const copy = notificationCopy(newState, updated, reason);
    const recipientId =
      actor.role === 'freelancer'
        ? salonRecipient(updated)
        : freelancerRecipient(updated);
    await notify(
      recipientId,
      NOTIF_TYPE_BY_STATUS[newState] ?? 'system',
      copy.title,
      copy.body,
      { assignment_id: updated.id },
    );

    return updated;
  },
};
