// ─────────────────────────────────────────────────────────────────────────────
// Events Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { eventsRepository } from './events.repository';
import { ResourceNotFoundError } from '../../lib/errors';
import { assertCallerOwns } from '../../lib/ownership';

type Auth = { userId: string; role: string; tenantId?: string };

export const eventsService = {
  async createEvent(organizerId: string, eventName: string, eventDate: string, notes?: string) {
    return eventsRepository.create(organizerId, eventName, eventDate, notes);
  },

  async listMyEvents(organizerId: string) {
    return eventsRepository.listByOrganizer(organizerId);
  },

  async getEventDetail(eventId: string, auth: Auth) {
    const owner = await eventsRepository.findEventOwner(eventId);
    if (!owner) throw new ResourceNotFoundError('Event');
    assertCallerOwns({ callerRole: auth.role, callerUserId: auth.userId, callerTenantId: auth.tenantId, resourceOwnerUserId: owner.owner_user_id });
    const event = await eventsRepository.getDetailWithAttendees(eventId);
    if (!event) throw new ResourceNotFoundError('Event');
    return event;
  },

  async updateEvent(eventId: string, organizerId: string, data: Record<string, unknown>) {
    const event = await eventsRepository.update(eventId, organizerId, data);
    if (!event) throw new ResourceNotFoundError('Event');
    return event;
  },

  async addAttendee(eventId: string, guestName: string, serviceId: string, preferredVendorId: string | undefined, notes: string | undefined, auth: Auth) {
    const owner = await eventsRepository.findEventOwner(eventId);
    if (!owner) throw new ResourceNotFoundError('Event');
    assertCallerOwns({ callerRole: auth.role, callerUserId: auth.userId, callerTenantId: auth.tenantId, resourceOwnerUserId: owner.owner_user_id });
    return eventsRepository.addAttendee(eventId, guestName, serviceId, preferredVendorId, notes);
  },

  async updateAttendee(eventId: string, attendeeId: string, data: Record<string, unknown>, auth: Auth) {
    const owner = await eventsRepository.findEventOwner(eventId);
    if (!owner) throw new ResourceNotFoundError('Event');
    assertCallerOwns({ callerRole: auth.role, callerUserId: auth.userId, callerTenantId: auth.tenantId, resourceOwnerUserId: owner.owner_user_id });
    const attendee = await eventsRepository.updateAttendee(eventId, attendeeId, data);
    if (!attendee) throw new ResourceNotFoundError('Attendee');
    return attendee;
  },

  async removeAttendee(eventId: string, attendeeId: string, auth: Auth) {
    const owner = await eventsRepository.findEventOwner(eventId);
    if (!owner) throw new ResourceNotFoundError('Event');
    assertCallerOwns({ callerRole: auth.role, callerUserId: auth.userId, callerTenantId: auth.tenantId, resourceOwnerUserId: owner.owner_user_id });
    const deleted = await eventsRepository.removeAttendee(eventId, attendeeId);
    if (!deleted) throw new ResourceNotFoundError('Attendee');
  },

  async getBudgetSummary(eventId: string, auth: Auth) {
    const owner = await eventsRepository.findEventOwner(eventId);
    if (!owner) throw new ResourceNotFoundError('Event');
    assertCallerOwns({ callerRole: auth.role, callerUserId: auth.userId, callerTenantId: auth.tenantId, resourceOwnerUserId: owner.owner_user_id });
    const attendees = await eventsRepository.getAttendeesByEvent(eventId);
    if (attendees.length === 0) {
      const event = await eventsRepository.getById(eventId);
      if (!event) throw new ResourceNotFoundError('Event');
    }

    const totalCost = attendees.reduce((sum: number, a: { service_price?: number }) => sum + (a.service_price || 0), 0);
    const perAttendee = attendees.length > 0 ? totalCost / attendees.length : 0;

    // Vendor breakdown
    const byVendor = new Map<string, { vendorId: string; total: number; count: number }>();
    for (const a of attendees) {
      const vid = a.preferred_vendor_id || 'unassigned';
      const entry = byVendor.get(vid) || { vendorId: vid, total: 0, count: 0 };
      entry.total += a.service_price || 0;
      entry.count += 1;
      byVendor.set(vid, entry);
    }

    return {
      total_estimated_cost: totalCost,
      cost_per_attendee: Math.round(perAttendee * 100) / 100,
      attendee_count: attendees.length,
      vendor_breakdown: Array.from(byVendor.values()),
    };
  },

  async getTemplates() {
    return eventsRepository.getTemplates();
  },
};
