// ─────────────────────────────────────────────────────────────────────────────
// Availability Module — Service Layer
// ─────────────────────────────────────────────────────────────────────────────

import { availabilityRepository } from './availability.repository';
import { ResourceNotFoundError, SlotUnavailableError } from '../../lib/errors';
import { istClockToDate, istDayOfWeek } from '../../lib/timezone';
import { SHIFT_TYPE, type ShiftType } from '../../lib/constants';

const SLOT_INTERVAL_MINUTES = 15;

// Minimum lead time before a slot can be booked. Slots whose start is
// strictly earlier than `now + this many minutes` are returned with
// `available: false` so the customer-facing picker hides them. 15 min is
// the industry-standard "now-ish" cutoff for grooming — short enough that
// walk-in-style same-day bookings still work, long enough that the vendor
// app actually has time to see the booking before the customer turns up.
const BOOKING_LEAD_TIME_MINUTES = 15;

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface SlotResult {
  is_open: boolean;
  open_time: string | null;
  close_time: string | null;
  slots: TimeSlot[];
}

interface TimeRange {
  start: Date;
  end: Date;
}

export const availabilityService = {
  // ── AVAIL-01: Get Available Slots ──
  //
  // Accepts either `serviceId` (single — legacy) or `serviceIds` (multi —
  // preferred for cart-style flows). The total booking duration is the sum
  // of every selected service's `duration_minutes`; slot generation uses
  // this sum so the last slot we hand back actually fits the whole cart
  // inside the day's working window.
  async getAvailableSlots(params: {
    vendorType: string;
    vendorId: string;
    serviceId?: string;
    serviceIds?: string[];
    staffId?: string;
    date: string;
  }): Promise<SlotResult> {
    const { vendorType, vendorId, serviceId, serviceIds, staffId, date } = params;

    const ids = serviceIds && serviceIds.length > 0
      ? serviceIds
      : (serviceId ? [serviceId] : []);
    if (ids.length === 0) throw new ResourceNotFoundError('Service');

    // One round-trip for every selected service. `ANY($1)` returns rows in
    // arbitrary order, but we only need the sum so order doesn't matter.
    const rows = await availabilityRepository.getServiceDurations(ids);
    if (rows.length !== ids.length) throw new ResourceNotFoundError('Service');
    const durationMinutes = rows.reduce((sum, r) => sum + Number(r.duration_minutes), 0);

    // Working hours are stored as IST wall-clock times. Resolve the
    // day-of-week from the requested IST date and let `istClockToDate`
    // (below) convert each open/close time to its UTC instant.
    const dayOfWeek = istDayOfWeek(date);

    // Layer 1: Working hours
    const workingHours = await availabilityRepository.getWorkingHours(vendorType, vendorId);
    const todayHours = workingHours.find((wh) => wh.day_of_week === dayOfWeek);
    if (!todayHours || todayHours.is_closed) {
      return { is_open: false, open_time: null, close_time: null, slots: [] };
    }

    // Layer 2: Shift schedules for the staff member (if specified)
    const shiftsForDay: TimeRange[] = [];
    if (staffId) {
      const shifts = await availabilityRepository.getShiftSchedules(staffId, date, date);
      const regular = shifts
        .filter((s) => s.type === SHIFT_TYPE.REGULAR_SHIFT)
        .map((s) => ({
          start: istClockToDate(date, s.start_time),
          end: istClockToDate(date, s.end_time),
        }));
      shiftsForDay.push(...regular);
    }

    // Layer 3: Time blocks
    const targetType = staffId ? 'staff_member' : vendorType;
    const targetId = staffId || vendorId;
    const blocks = await availabilityRepository.getTimeBlocks(targetType, targetId, date);

    // Subtract appointments
    const appointments = await availabilityRepository.getAppointmentsForDate(
      vendorType, vendorId, staffId || null, date,
    );

    // Subtract active intents
    const activeIntents = await availabilityRepository.getActiveIntentsForDate(
      vendorType, vendorId, staffId || null, date,
    );

    const baseStart = istClockToDate(date, todayHours.open_time);
    const baseEnd = istClockToDate(date, todayHours.close_time);

    const availableWindows: TimeRange[] = shiftsForDay.length > 0
      ? shiftsForDay
      : [{ start: baseStart, end: baseEnd }];

    const blockedRanges = blocks.map((b) => ({
      start: new Date(b.start_datetime),
      end: new Date(b.end_datetime),
    }));

    const bookedRanges = appointments.map((a) => ({
      start: new Date(a.start_time),
      end: new Date(a.end_time),
    }));

    const intentRanges = activeIntents.map((i) => ({
      start: new Date(i.scheduled_start),
      end: new Date(i.scheduled_end),
    }));

    const allUnavailable = [...blockedRanges, ...bookedRanges, ...intentRanges];

    // Past-slot guard. The customer can never book a slot whose start time
    // is in the past — and we also enforce a short lead time so they can't
    // book a slot that begins 30 seconds from now (which the vendor app
    // would never realistically see + accept in time). The 15-min window
    // is the industry-standard "now-ish" cutoff for grooming bookings.
    const nowMs = Date.now();
    const leadCutoffMs = nowMs + BOOKING_LEAD_TIME_MINUTES * 60_000;

    const slots: TimeSlot[] = [];
    for (const window of availableWindows) {
      let slotStart = new Date(window.start);
      while (slotStart.getTime() + durationMinutes * 60000 <= window.end.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
        const overlapsBooked = allUnavailable.some(
          (range) => slotStart < range.end && slotEnd > range.start,
        );
        const isInPast = slotStart.getTime() < leadCutoffMs;
        const isAvailable = !overlapsBooked && !isInPast;
        slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString(), available: isAvailable });
        slotStart = new Date(slotStart.getTime() + SLOT_INTERVAL_MINUTES * 60000);
      }
    }

    return {
      is_open: true,
      open_time: todayHours.open_time,
      close_time: todayHours.close_time,
      slots,
    };
  },

  // ── AVAIL-02: Working Hours ──
  async getWorkingHours(targetType: string, targetId: string) {
    return availabilityRepository.getWorkingHours(targetType, targetId);
  },

  async updateWorkingHours(targetType: string, targetId: string, hours: Array<{
    day_of_week: number;
    open_time: string | null;
    close_time: string | null;
    is_closed: boolean;
  }>) {
    await availabilityRepository.upsertWorkingHours(targetType, targetId, hours);
    return this.getWorkingHours(targetType, targetId);
  },

  // ── AVAIL-03: Create Time Block ──
  async createTimeBlock(data: {
    startTime: string;
    endTime: string;
    reason?: string;
    targetType: string;
    targetId: string;
    createdBy?: string;
  }) {
    const startDate = new Date(data.startTime).toISOString().split('T')[0]!;
    const conflicts = await availabilityRepository.getAppointmentsForDate(
      data.targetType, data.targetId, null, startDate,
    );

    const blockStart = new Date(data.startTime);
    const blockEnd = new Date(data.endTime);
    const hasConflict = conflicts.some((a) => {
      const aStart = new Date(a.start_time);
      const aEnd = new Date(a.end_time);
      return blockStart < aEnd && blockEnd > aStart;
    });

    if (hasConflict) {
      throw new SlotUnavailableError({ reason: 'Time block conflicts with existing appointments.' });
    }

    return availabilityRepository.createTimeBlock(data);
  },

  // ── AVAIL-04: Delete Time Block ──
  async deleteTimeBlock(blockId: string, targetType: string, targetId: string) {
    const deleted = await availabilityRepository.deleteTimeBlock(blockId, targetType, targetId);
    if (!deleted) throw new ResourceNotFoundError('Time block');
  },

  // ── AVAIL-05: Create / Batch-Create Shift ──
  async createShift(data: {
    staffMemberId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    type?: ShiftType;
  }) {
    return availabilityRepository.createShift(data);
  },

  async batchCreateShifts(
    items: Array<{
      staffMemberId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      type?: ShiftType;
    }>,
  ): Promise<{ created_count: number; shift_ids: string[] }> {
    const rows = await availabilityRepository.batchCreateShifts(items);
    return {
      created_count: rows.length,
      shift_ids: rows.map((r) => r.id),
    };
  },

  async updateShift(shiftId: string, data: Record<string, unknown>) {
    const updated = await availabilityRepository.updateShift(shiftId, data);
    if (!updated) throw new ResourceNotFoundError('Shift');
    return updated;
  },

  // ── AVAIL-06: Calendar View ──
  async getCalendar(vendorType: string, vendorId: string, startDate: string, endDate: string) {
    return availabilityRepository.getCalendarEvents(vendorType, vendorId, startDate, endDate);
  },
};

