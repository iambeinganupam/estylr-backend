// ─────────────────────────────────────────────────────────────────────────────
// Assignments Module — Repository
// ─────────────────────────────────────────────────────────────────────────────
// Owns SQL for the salon_freelancer_assignments table only. Joins customer-
// facing display fields (salon brand_name, freelancer business_name) so the
// API responds with everything a UI needs in one round trip.
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { mapPgError } from '../../lib/pg-errors';

// ── Row types ────────────────────────────────────────────────────────────────

export interface AssignmentRow {
  id: string;
  business_id: string;
  salon_location_id: string;
  freelancer_id: string;
  freelancer_user_id: string;
  created_by_user_id: string;

  service_category: string | null;
  notes: string | null;
  start_time: string;
  end_time: string;
  proposed_amount: number;

  status:
    | 'requested'
    | 'accepted'
    | 'in_progress'
    | 'completed'
    | 'declined'
    | 'cancelled';
  decline_reason: string | null;
  cancel_reason: string | null;
  responded_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;

  created_at: string;
  updated_at: string;

  // Joined display fields
  salon_brand_name: string | null;
  salon_display_name: string | null;
  freelancer_business_name: string;
  freelancer_logo_url: string | null;
}

// Standard SELECT used by every read path.
const SELECT_COLS = `
  a.id, a.business_id, a.salon_location_id, a.freelancer_id,
  fp.user_id  AS freelancer_user_id,
  a.created_by_user_id,
  a.service_category, a.notes,
  a.start_time, a.end_time, a.proposed_amount,
  a.status, a.decline_reason, a.cancel_reason,
  a.responded_at, a.started_at, a.completed_at, a.cancelled_at, a.cancelled_by,
  a.created_at, a.updated_at,
  ba.brand_name AS salon_brand_name,
  sl.display_name AS salon_display_name,
  fp.business_name AS freelancer_business_name,
  fp.logo_url AS freelancer_logo_url
`;

const FROM_CLAUSE = `
  FROM public.salon_freelancer_assignments a
  JOIN public.salon_locations  sl ON sl.id = a.salon_location_id
  JOIN public.business_accounts ba ON ba.id = a.business_id
  JOIN public.freelancer_profiles fp ON fp.id = a.freelancer_id
`;

// ── Repository ───────────────────────────────────────────────────────────────

export const assignmentsRepository = {
  /**
   * Create a new assignment. Validates that the salon location belongs to the
   * given business at SQL level — this catches stale tenant context before
   * we hit the not-null FK.
   */
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
  }): Promise<AssignmentRow | null> {
    try {
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO public.salon_freelancer_assignments
          (business_id, salon_location_id, freelancer_id, created_by_user_id,
           service_category, notes, start_time, end_time, proposed_amount, status)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested'
          WHERE EXISTS (
            SELECT 1 FROM public.salon_locations
             WHERE id = $2 AND business_account_id = $1
          )
         RETURNING id`,
        [
          input.businessId,
          input.salonLocationId,
          input.freelancerId,
          input.createdByUserId,
          input.serviceCategory,
          input.notes,
          input.startTime,
          input.endTime,
          input.proposedAmount,
        ],
      );
      if (!inserted) return null;
      return this.findById(inserted.id);
    } catch (e) { mapPgError(e); }
  },

  async findById(id: string): Promise<AssignmentRow | null> {
    return queryOne<AssignmentRow>(
      `SELECT ${SELECT_COLS} ${FROM_CLAUSE} WHERE a.id = $1`,
      [id],
    );
  },

  async listForBusiness(
    businessId: string,
    filters: { status?: string; limit: number },
  ): Promise<AssignmentRow[]> {
    const clauses = ['a.business_id = $1'];
    const values: unknown[] = [businessId];
    if (filters.status) {
      clauses.push(`a.status = $${values.length + 1}`);
      values.push(filters.status);
    }
    values.push(filters.limit);
    const result = await query<AssignmentRow>(
      `SELECT ${SELECT_COLS} ${FROM_CLAUSE}
        WHERE ${clauses.join(' AND ')}
        ORDER BY a.start_time DESC, a.created_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  },

  async listForFreelancer(
    freelancerId: string,
    filters: { status?: string; limit: number },
  ): Promise<AssignmentRow[]> {
    const clauses = ['a.freelancer_id = $1'];
    const values: unknown[] = [freelancerId];
    if (filters.status) {
      clauses.push(`a.status = $${values.length + 1}`);
      values.push(filters.status);
    }
    values.push(filters.limit);
    const result = await query<AssignmentRow>(
      `SELECT ${SELECT_COLS} ${FROM_CLAUSE}
        WHERE ${clauses.join(' AND ')}
        ORDER BY a.start_time DESC, a.created_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  },

  /**
   * Atomically apply a state transition: updates status, the matching
   * companion timestamp, and (when applicable) the actor / reason.
   * Builds the SET clause dynamically so each branch only references the
   * parameters it actually uses, keeping placeholder numbering airtight.
   */
  async transition(
    id: string,
    nextStatus: string,
    actorUserId: string,
    reason: string | null,
  ): Promise<AssignmentRow | null> {
    const setParts = ['status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [id, nextStatus];
    const placeholder = () => `$${values.length}`;

    switch (nextStatus) {
      case 'accepted':
        setParts.push('responded_at = NOW()');
        break;
      case 'declined':
        setParts.push('responded_at = NOW()');
        values.push(reason);
        setParts.push(`decline_reason = ${placeholder()}`);
        break;
      case 'in_progress':
        setParts.push('started_at = NOW()');
        break;
      case 'completed':
        setParts.push('completed_at = NOW()');
        break;
      case 'cancelled':
        setParts.push('cancelled_at = NOW()');
        values.push(actorUserId);
        setParts.push(`cancelled_by = ${placeholder()}`);
        values.push(reason);
        setParts.push(`cancel_reason = ${placeholder()}`);
        break;
    }

    try {
      await query(
        `UPDATE public.salon_freelancer_assignments
            SET ${setParts.join(', ')}
          WHERE id = $1`,
        values,
      );
    } catch (e) { mapPgError(e); }

    return this.findById(id);
  },
};
