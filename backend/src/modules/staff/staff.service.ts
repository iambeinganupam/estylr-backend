import { staffRepository } from './staff.repository';
import { ResourceNotFoundError, InvalidTransitionError, ValidationError } from '../../lib/errors';
import { encodeCursor } from '../../lib/pagination';
import type { MyBookingsListQuery } from './staff.schemas';

// ── Role cache ────────────────────────────────────────────────────────────────
// Same TTL-cache idea as entitlements.service.ts, deliberately without its
// LISTEN/NOTIFY invalidation — entitlement checks run on nearly every request
// and need near-immediate invalidation when a plan changes; staff_roles
// changes maybe a handful of times a year, so up to 60s staleness on a brand
// new role is a non-issue (nothing books against a role in the same minute
// it's created) and doesn't justify the extra moving part.

const ROLE_CACHE_TTL_MS = 60_000;
let roleCache: { codes: string[]; expires: number } | null = null;

async function getActiveRoleCodesCached(): Promise<string[]> {
  if (roleCache && roleCache.expires > Date.now()) return roleCache.codes;
  const codes = await staffRepository.listActiveRoleCodes();
  roleCache = { codes, expires: Date.now() + ROLE_CACHE_TTL_MS };
  return codes;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getWeekBounds(weekStart?: string): { start: string; end: string } {
  const startDate = weekStart ? new Date(weekStart) : (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay()); // Sunday of current week
    return d;
  })();
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);
  return {
    start: startDate.toISOString().slice(0, 10),
    end:   endDate.toISOString().slice(0, 10),
  };
}

function getMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const staffService = {

  // ─── Role catalogue ─────────────────────────────────────────────────────────
  // Single source of truth for "what roles exist right now" — replaces the
  // three previously-hardcoded, mutually-inconsistent lists in
  // constants.ts / admin-staff.schemas.ts / business.schemas.ts.

  async getActiveRoleCodes(): Promise<string[]> {
    return getActiveRoleCodesCached();
  },

  async assertValidRoleCode(code: string): Promise<void> {
    const codes = await getActiveRoleCodesCached();
    if (!codes.includes(code)) {
      throw new ValidationError({
        fields: [{ field: 'role', message: `Unknown or inactive staff role: ${code}`, code: 'invalid_enum_value' }],
      });
    }
  },

  // ─── STF-11: Profile ──────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getProfile(staffMember.id, userId);
  },

  async updateProfile(userId: string, patch: {
    full_name?: string;
    email?: string;
    address?: string;
    avatar_url?: string;
  }) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    await staffRepository.updateProfile(staffMember.id, userId, patch);
    return staffRepository.getProfile(staffMember.id, userId);
  },

  // ─── STF-12: Documents ────────────────────────────────────────────────────

  async getDocuments(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getDocuments(staffMember.id);
  },

  async uploadDocument(userId: string, doc: {
    document_type: string;
    document_number?: string;
    file_url?: string;
  }) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.upsertDocument(staffMember.id, doc);
  },

  // ─── STF-13: Bank Details ─────────────────────────────────────────────────

  async getBankDetails(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getBankDetails(staffMember.id);
  },

  async updateBankDetails(userId: string, details: {
    bank_name: string;
    account_holder: string;
    account_number: string;
    ifsc_code: string;
    payment_mode?: string;
  }) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.upsertBankDetails(staffMember.id, details);
  },

  // ─── STF-01: Schedule ─────────────────────────────────────────────────────

  async getSchedule(userId: string, weekStart?: string, date?: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');

    const { start, end } = date ? { start: date, end: date } : getWeekBounds(weekStart);
    const schedule = await staffRepository.getSchedule(staffMember.id, start, end);

    return { week: { start, end }, ...schedule };
  },

  // ─── STF-02: Earnings ─────────────────────────────────────────────────────

  async getEarnings(userId: string, fromDate?: string, toDate?: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');

    const bounds = getMonthBounds();
    const from = fromDate ?? bounds.start;
    const to   = toDate   ?? bounds.end;

    return staffRepository.getEarnings(staffMember.id, from, to);
  },

  // ─── STF-03: Update Appointment Status ───────────────────────────────────

  async updateAppointmentStatus(userId: string, appointmentId: string, status: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');

    const appointment = await staffRepository.findAppointmentForStaff(appointmentId, staffMember.id);
    if (!appointment) throw new ResourceNotFoundError('Appointment');

    const current = (appointment as { status: string }).status;
    const validTransitions: Record<string, string[]> = {
      confirmed:   ['in_progress', 'cancelled', 'no_show'],
      in_progress: ['completed', 'cancelled'],
    };

    if (!validTransitions[current]?.includes(status)) {
      throw new InvalidTransitionError(current, `transition to ${status}`);
    }

    const updated = await staffRepository.updateAppointmentStatus(appointmentId, staffMember.id, status);
    if (!updated) throw new ResourceNotFoundError('Appointment');
    return updated;
  },

  // ─── STF-04 / STF-05 / STF-06: Clock-in/out ──────────────────────────────

  async clockIn(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');

    const open = await staffRepository.getOpenClockIn(staffMember.id);
    if (open) throw new InvalidTransitionError('clocked_in', 'clock_in');

    return staffRepository.clockIn(staffMember.id);
  },

  async clockOut(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');

    const record = await staffRepository.clockOut(staffMember.id);
    if (!record) throw new ResourceNotFoundError('Open clock-in record for today');
    return record;
  },

  async getClockStatus(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getClockStatus(staffMember.id);
  },

  async getAttendanceHistory(userId: string, params: { from_date?: string; to_date?: string; limit?: number }) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getAttendanceHistory(staffMember.id, params);
  },

  // ─── STF-08: Weekly Chart ─────────────────────────────────────────────────

  async getWeeklyChart(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getWeeklyChart(staffMember.id);
  },

  // ─── STF-09: Targets ──────────────────────────────────────────────────────

  async getTargets(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getTargets(staffMember.id);
  },

  // ─── STF-10: Commission History ───────────────────────────────────────────

  async getCommissionHistory(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getCommissionHistory(staffMember.id);
  },

  // ─── STF-14: Reviews ──────────────────────────────────────────────────────

  async getReviews(userId: string, params: { limit?: number; offset?: number }) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getReviews(staffMember.id, params);
  },

  async getReviewSummary(userId: string) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return staffRepository.getReviewSummary(staffMember.id);
  },

  // ─── STF-15: My Bookings (cursor list) ─────────────────────────────────
  async listMyBookings(userId: string, q: MyBookingsListQuery) {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    const { rows, hasMore } = await staffRepository.listMyBookings(staffMember.id, q);
    const last = rows[rows.length - 1];
    const next_cursor = hasMore && last
      ? encodeCursor({ id: last.id, created_at: last.created_at })
      : null;
    return { data: rows, next_cursor, has_more: hasMore };
  },

  // ─── STF-16: My Permissions (role + capability map) ────────────────────
  // Future-proofed for additional sub-roles (manager / sales / receptionist).
  // Frontend reads this on login and gates UI elements off the `can` map.
  // Backend permission checks should also consult this map (or an equivalent
  // server-side guard) when role-sensitive endpoints land.
  async getMyPermissions(userId: string): Promise<{
    role: string;
    is_active: boolean;
    employer_id: string;
    can: Record<string, boolean>;
  }> {
    const staffMember = await staffRepository.findStaffMemberByUserId(userId);
    if (!staffMember) throw new ResourceNotFoundError('Staff member');
    return {
      role: staffMember.role,
      is_active: staffMember.is_active,
      employer_id: staffMember.employer_id,
      can: capabilitiesFor(staffMember.role),
    };
  },
};

// ── Permission map ────────────────────────────────────────────────────────
// Capabilities are intentionally personal-only for v1. New sub-roles
// (manager / sales / receptionist / etc.) will slot in here without changing
// any consumer code.
function capabilitiesFor(role: string): Record<string, boolean> {
  // Every role in the current `staff_role` enum (owner / manager /
  // senior_stylist / stylist / apprentice / admin) is treated as a salon
  // staff member with personal scope. The actual cross-staff manager view
  // lives in the salon dashboard, not here.
  const base: Record<string, boolean> = {
    view_my_schedule:    true,
    view_my_earnings:    true,
    view_my_reviews:     true,
    edit_my_profile:     true,
    upload_my_documents: true,
    set_my_bank:         true,
    update_appointment_status: true,
    clock_in_out:        true,
    // Reserved for future sub-roles — kept here as `false` so UI can render
    // the gates today, ready to flip when the role lands:
    view_team_earnings:  false,
    manage_shifts:       false,
    view_team_attendance: false,
  };
  if (role === 'owner' || role === 'manager' || role === 'admin') {
    // The current staff app does not expose team views; the salon dashboard
    // already does that. This block exists so future sub-roles can opt in
    // without touching the schema. Today these are owner/manager logged into
    // the staff app — they see the same personal view as anyone else.
  }
  return base;
}
