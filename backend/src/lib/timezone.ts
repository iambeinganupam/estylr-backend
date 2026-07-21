// ─────────────────────────────────────────────────────────────────────────────
// Timezone helpers — Kshuri is an India-only product, so all wall-clock
// values stored as `TIME` (working hours, shift start/end) are interpreted
// as **Asia/Kolkata** (IST, UTC+05:30, no DST).
//
// Centralising the offset here keeps slot generation, calendar queries and
// reporting consistent: a single place to change if we ever expand to
// multi-timezone vendors. Until then, every "9:00 AM" in the database means
// 9:00 AM IST, which is 03:30 UTC.
// ─────────────────────────────────────────────────────────────────────────────

/** IST is UTC+05:30 and never observes DST. */
export const IST_OFFSET_MINUTES = 5 * 60 + 30;

/**
 * Build a UTC `Date` from a YYYY-MM-DD calendar date and a HH:mm[:ss] time
 * that is implicitly in IST.
 *
 *   istClockToDate("2026-05-09", "09:00:00") →  2026-05-09T03:30:00Z
 *   istClockToDate("2026-05-09", "21:00:00") →  2026-05-09T15:30:00Z
 *
 * Negative arithmetic is fine — `Date.UTC` rolls minute overflow back into
 * hours/days, so an opening time of 00:00 IST correctly resolves to the
 * previous UTC day.
 */
export function istClockToDate(dateStr: string, timeStr: string): Date {
  const [h, m, s] = timeStr.split(':').map(Number) as [number, number, number?];
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  // Subtract the IST offset so the resulting UTC instant maps back to the
  // requested IST wall-clock time when rendered in IST.
  const utcMinutes = h * 60 + m - IST_OFFSET_MINUTES;
  return new Date(Date.UTC(year, month - 1, day, 0, utcMinutes, s ?? 0));
}

/**
 * Resolve the day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD date interpreted
 * in IST. For a whole-day date the IST and UTC days are identical (date
 * strings have no time component), so this is just a thin wrapper for clarity
 * at call sites.
 */
export function istDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
