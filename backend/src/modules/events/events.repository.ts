// ─────────────────────────────────────────────────────────────────────────────
// Events Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';

export const eventsRepository = {
  async create(organizerId: string, eventName: string, eventDate: string, notes?: string) {
    try {
      return await queryOne(
        `INSERT INTO public.events (organizer_id, title, event_date, notes, status)
         VALUES ($1, $2, $3, $4, 'draft') RETURNING *`,
        [organizerId, eventName, eventDate, notes || null],
      );
    } catch (e) { mapPgError(e); }
  },

  async listByOrganizer(organizerId: string) {
    const result = await query(
      `SELECT e.*,
              (SELECT COUNT(*) FROM public.event_attendees ea WHERE ea.event_id = e.id) AS attendee_count
       FROM public.events e WHERE e.organizer_id = $1
       ORDER BY e.event_date DESC`,
      [organizerId],
    );
    return result.rows;
  },

  async getById(eventId: string) {
    return queryOne(
      `SELECT e.*,
              (SELECT COUNT(*) FROM public.event_attendees ea WHERE ea.event_id = e.id) AS attendee_count
       FROM public.events e WHERE e.id = $1`,
      [eventId],
    );
  },

  async getDetailWithAttendees(eventId: string) {
    const event = await this.getById(eventId);
    if (!event) return null;

    const attendeesResult = await query(
      `SELECT ea.*, s.name AS service_name, s.price AS service_price
       FROM public.event_attendees ea
       LEFT JOIN public.services s ON ea.service_id = s.id
       WHERE ea.event_id = $1
       ORDER BY ea.created_at`,
      [eventId],
    );
    return { ...event, attendees: attendeesResult.rows };
  },

  async update(eventId: string, organizerId: string, data: Record<string, unknown>) {
    // Matches updateEventSchema: title (mapped from event_name), event_date, notes, status.
    const ALLOWED_FIELDS = ['title', 'event_date', 'notes', 'status'] as const;
    const { setClause, values } = buildUpdateSet(data, ALLOWED_FIELDS, { paramOffset: 2 });
    try {
      return await queryOne(
        `UPDATE public.events SET ${setClause}, updated_at = NOW()
         WHERE id = $1 AND organizer_id = $2 RETURNING *`,
        [eventId, organizerId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Attendees ──
  async addAttendee(eventId: string, guestName: string, serviceId: string, preferredVendorId?: string, notes?: string) {
    try {
      return await queryOne(
        `INSERT INTO public.event_attendees (event_id, guest_name, service_id, preferred_vendor_id, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [eventId, guestName, serviceId, preferredVendorId || null, notes || null],
      );
    } catch (e) { mapPgError(e); }
  },

  async updateAttendee(eventId: string, attendeeId: string, data: Record<string, unknown>) {
    // Matches updateAttendeeSchema: guest_name, service_id, preferred_vendor_id, notes.
    const ALLOWED_FIELDS = ['guest_name', 'service_id', 'preferred_vendor_id', 'notes'] as const;
    const { setClause, values } = buildUpdateSet(data, ALLOWED_FIELDS, { paramOffset: 2 });
    try {
      return await queryOne(
        `UPDATE public.event_attendees SET ${setClause}, updated_at = NOW()
         WHERE id = $1 AND event_id = $2 RETURNING *`,
        [attendeeId, eventId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  async removeAttendee(eventId: string, attendeeId: string) {
    try {
      return await queryOne(
        `DELETE FROM public.event_attendees WHERE id = $1 AND event_id = $2 RETURNING *`,
        [attendeeId, eventId],
      );
    } catch (e) { mapPgError(e); }
  },

  async getAttendeesByEvent(eventId: string) {
    const result = await query(
      `SELECT ea.*, s.name AS service_name, s.price AS service_price, s.duration_minutes
       FROM public.event_attendees ea
       LEFT JOIN public.services s ON ea.service_id = s.id
       WHERE ea.event_id = $1`,
      [eventId],
    );
    return result.rows;
  },

  async getTemplates() {
    const result = await query(
      `SELECT * FROM public.event_templates WHERE is_active = TRUE ORDER BY sort_order`,
      [],
    );
    return result.rows;
  },

  async findEventOwner(eventId: string): Promise<{ owner_user_id: string } | null> {
    return queryOne<{ owner_user_id: string }>(
      `SELECT organizer_id AS owner_user_id FROM public.events WHERE id = $1`,
      [eventId],
    );
  },
};
