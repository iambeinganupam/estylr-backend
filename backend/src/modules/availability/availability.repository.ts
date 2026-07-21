// ─────────────────────────────────────────────────────────────────────────────
// Availability Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';
import { PoolClient, QueryResultRow } from 'pg';

// ── Row Types ──
export interface WorkingHoursRow extends QueryResultRow {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export interface ShiftRow extends QueryResultRow {
  id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  type: string;
  is_approved: boolean;
}

export interface TimeBlockRow extends QueryResultRow {
  id: string;
  start_datetime: string;
  end_datetime: string;
  reason: string | null;
}

export interface AppointmentTimeRow extends QueryResultRow {
  start_time: string;
  end_time: string;
}

export interface IntentTimeRow extends QueryResultRow {
  scheduled_start: string;
  scheduled_end: string;
}

export const availabilityRepository = {
  // ── Catalog: bulk fetch service durations for multi-service slot calc ──
  async getServiceDurations(serviceIds: string[]): Promise<Array<{ id: string; duration_minutes: number }>> {
    if (serviceIds.length === 0) return [];
    const result = await query<{ id: string; duration_minutes: number }>(
      `SELECT id, duration_minutes FROM public.services WHERE id = ANY($1::uuid[])`,
      [serviceIds],
    );
    return result.rows;
  },

  // ── Working Hours ──
  async getWorkingHours(targetType: string, targetId: string): Promise<WorkingHoursRow[]> {
    const result = await query<WorkingHoursRow>(
      `SELECT * FROM public.working_hours
       WHERE target_type = $1 AND target_id = $2
       ORDER BY day_of_week`,
      [targetType, targetId],
    );
    return result.rows;
  },

  async upsertWorkingHours(targetType: string, targetId: string, hours: Array<{
    day_of_week: number;
    open_time: string | null;
    close_time: string | null;
    is_closed: boolean;
  }>) {
    return withTransaction(async (client: PoolClient) => {
      try {
        for (const h of hours) {
          await client.query(
            `INSERT INTO public.working_hours (target_type, target_id, day_of_week, open_time, close_time, is_closed)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (target_type, target_id, day_of_week)
             DO UPDATE SET open_time = $4, close_time = $5, is_closed = $6, updated_at = NOW()`,
            [targetType, targetId, h.day_of_week, h.open_time, h.close_time, h.is_closed],
          );
        }
      } catch (e) { mapPgError(e); }
    });
  },

  // ── Time Blocks ──
  async getTimeBlocks(targetType: string, targetId: string, date: string): Promise<TimeBlockRow[]> {
    const result = await query<TimeBlockRow>(
      `SELECT * FROM public.time_blocks
       WHERE target_type = $1 AND target_id = $2
         AND start_datetime::date <= $3::date AND end_datetime::date >= $3::date
       ORDER BY start_datetime`,
      [targetType, targetId, date],
    );
    return result.rows;
  },

  async createTimeBlock(data: {
    startTime: string;
    endTime: string;
    reason?: string;
    targetType: string;
    targetId: string;
    createdBy?: string;
  }) {
    try {
      return await queryOne(
        `INSERT INTO public.time_blocks (start_datetime, end_datetime, reason, target_type, target_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [data.startTime, data.endTime, data.reason || null, data.targetType, data.targetId, data.createdBy || null],
      );
    } catch (e) { mapPgError(e); }
  },

  async deleteTimeBlock(blockId: string, targetType: string, targetId: string) {
    try {
      return await queryOne(
        `DELETE FROM public.time_blocks
         WHERE id = $1 AND target_type = $2 AND target_id = $3
         RETURNING *`,
        [blockId, targetType, targetId],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Shift Schedules ──
  async getShiftSchedules(staffMemberId: string, fromDate?: string, toDate?: string): Promise<ShiftRow[]> {
    let sql = `SELECT * FROM public.shift_schedules
               WHERE staff_member_id = $1`;
    const params: unknown[] = [staffMemberId];

    if (fromDate) {
      sql += ` AND shift_date >= $${params.length + 1}`;
      params.push(fromDate);
    }
    if (toDate) {
      sql += ` AND shift_date <= $${params.length + 1}`;
      params.push(toDate);
    }

    sql += ` ORDER BY shift_date, start_time`;
    const result = await query<ShiftRow>(sql, params);
    return result.rows as ShiftRow[];
  },

  async createShift(data: {
    staffMemberId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    type?: string;
  }): Promise<ShiftRow | undefined> {
    try {
      return (await queryOne<ShiftRow>(
        `INSERT INTO public.shift_schedules (staff_member_id, shift_date, start_time, end_time, type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.staffMemberId, data.shiftDate, data.startTime, data.endTime, data.type ?? 'regular_shift'],
      )) ?? undefined;
    } catch (e) { mapPgError(e); }
  },

  async batchCreateShifts(items: Array<{
    staffMemberId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    type?: string;
  }>): Promise<ShiftRow[]> {
    if (items.length === 0) return [];
    try {
      return await withTransaction(async (client: PoolClient) => {
        const rows: ShiftRow[] = [];
        for (const data of items) {
          const result = await client.query<ShiftRow>(
            `INSERT INTO public.shift_schedules (staff_member_id, shift_date, start_time, end_time, type)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [data.staffMemberId, data.shiftDate, data.startTime, data.endTime, data.type ?? 'regular_shift'],
          );
          if (result.rows[0]) rows.push(result.rows[0]);
        }
        return rows;
      });
    } catch (e) { mapPgError(e); return []; }
  },

  async updateShift(shiftId: string, fields: Record<string, unknown>) {
    // Matches updateShiftSchema. DB columns are `type` and `is_approved`
    // (NOT shift_type / is_active — those were schema/column drift fixed
    // in migration 061 + the schema rename).
    // Excludes: id, staff_member_id, shift_date (set at creation), created_at.
    const ALLOWED_FIELDS = ['start_time', 'end_time', 'type', 'is_approved'] as const;
    const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS);
    try {
      return await queryOne(
        `UPDATE public.shift_schedules
         SET ${setClause}, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [shiftId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Existing Appointments (for slot calculation) ──
  async getAppointmentsForDate(vendorType: string, vendorId: string, staffId: string | null, date: string): Promise<AppointmentTimeRow[]> {
    let sql = `SELECT start_time, end_time FROM public.appointments
               WHERE vendor_type = $1 AND vendor_id = $2
                 AND start_time::date = $3::date
                 AND status NOT IN ('cancelled', 'no_show')`;
    const params: unknown[] = [vendorType, vendorId, date];

    if (staffId) {
      sql += ` AND staff_member_id = $${params.length + 1}`;
      params.push(staffId);
    }

    const result = await query<AppointmentTimeRow>(sql, params);
    return result.rows as AppointmentTimeRow[];
  },

  // ── Active Intents (for slot calculation) ──
  async getActiveIntentsForDate(vendorType: string, vendorId: string, staffId: string | null, date: string): Promise<IntentTimeRow[]> {
    let sql = `SELECT scheduled_start, scheduled_end FROM public.booking_intents
               WHERE vendor_type = $1 AND vendor_id = $2
                 AND scheduled_start::date = $3::date
                 AND status IN ('locked')
                 AND expires_at > NOW()`;
    const params: unknown[] = [vendorType, vendorId, date];

    if (staffId) {
      sql += ` AND staff_member_id = $${params.length + 1}`;
      params.push(staffId);
    }

    const result = await query<IntentTimeRow>(sql, params);
    return result.rows as IntentTimeRow[];
  },

  // ── Calendar View ──
  async getCalendarEvents(vendorType: string, vendorId: string, startDate: string, endDate: string) {
    const result = await query(
      `SELECT
         a.id,
         'appointment'::text AS type,
         COALESCE(s.name, 'Appointment') AS title,
         a.start_time AS start,
         a.end_time AS end,
         a.status::text AS status,
         cp.first_name || ' ' || cp.last_name AS customer_name,
         a.vendor_id
       FROM public.appointments a
       LEFT JOIN public.services s ON a.service_id = s.id
       LEFT JOIN public.customer_profiles cp ON a.customer_id = cp.user_id
       WHERE a.vendor_type = $1 AND a.vendor_id = $2
         AND a.start_time >= $3::date AND a.start_time < ($4::date + interval '1 day')
         AND a.status NOT IN ('cancelled')
       UNION ALL
       SELECT
         tb.id,
         'block'::text AS type,
         COALESCE(tb.reason, 'Time block') AS title,
         tb.start_datetime AS start,
         tb.end_datetime AS end,
         NULL::text AS status,
         NULL::text AS customer_name,
         tb.target_id AS vendor_id
       FROM public.time_blocks tb
       WHERE tb.target_type = $1 AND tb.target_id = $2
         AND tb.start_datetime >= $3::date AND tb.start_datetime < ($4::date + interval '1 day')
       ORDER BY start`,
      [vendorType, vendorId, startDate, endDate],
    );
    return result.rows;
  },
};
