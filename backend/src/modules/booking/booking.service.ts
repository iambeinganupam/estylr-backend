// ─────────────────────────────────────────────────────────────────────────────
// Booking Module — Service Layer
// ─────────────────────────────────────────────────────────────────────────────

import { bookingRepository } from './booking.repository';
import { financeService } from '../finance/finance.service';
import * as addressesRepository from '../addresses/addresses.repository';
import { paymentMethod } from '../payments/methods';
import { resolveTransition, APPOINTMENT_TRANSITIONS, INTENT_TRANSITIONS } from '../../lib/state-machine';
import { ResourceNotFoundError, IntentExpiredError, SlotUnavailableError, ValidationError } from '../../lib/errors';
import { BOOKING_STATUS, type VendorType, type TxMethod } from '../../lib/constants';
import { assertCallerOwns } from '../../lib/ownership';
import { bookingIntentsTotal } from '../../lib/metrics';

type CallerAuth = { userId: string; role: string; tenantId?: string };

// 5-minute grace window: a walk-in scheduled within this window of "now" is
// treated as immediate and starts in_progress directly. Beyond that, it stays
// confirmed and requires an explicit Start action.
const WALKIN_IMMEDIATE_THRESHOLD_MS = 5 * 60 * 1000;

export const bookingService = {
  async createIntent(customerId: string, data: {
    vendorType: string; vendorId: string; serviceId: string;
    staffMemberId?: string; slotStart: string; slotEnd: string;
  }) {
    const row = await bookingRepository.createIntent({ customerId, ...data });
    // Wire-shape mapping — the api-client + portal expect `intent_id` (not
    // the raw DB `id`), plus ISO datetimes. Done here so the wire contract
    // is decoupled from the schema column names. See BookingIntent type in
    // packages/api-client/src/types/booking.types.ts.
    return {
      intent_id: row.id as string,
      expires_at: new Date(row.expires_at as string | Date).toISOString(),
      scheduled_start: new Date(row.scheduled_start as string | Date).toISOString(),
      scheduled_end: new Date(row.scheduled_end as string | Date).toISOString(),
      calculated_total: Number(row.calculated_total ?? 0),
      status: row.status as string,
    };
  },

  async lockIntent(intentId: string, customerId: string, data: {
    customerName: string; customerPhone?: string; notes?: string;
  }) {
    const intent = await bookingRepository.getIntentById(intentId, customerId);
    if (!intent) throw new ResourceNotFoundError('Booking intent');
    if (new Date(intent.expires_at) < new Date()) {
      bookingIntentsTotal.inc({ outcome: 'expired' });
      throw new IntentExpiredError();
    }

    resolveTransition(intent.status, 'lock', INTENT_TRANSITIONS);
    const locked = await bookingRepository.lockIntent(intentId, data.customerName, data.customerPhone, data.notes);
    if (!locked) {
      bookingIntentsTotal.inc({ outcome: 'slot_locked' });
      throw new IntentExpiredError();
    }
    bookingIntentsTotal.inc({ outcome: 'locked' });
    return locked;
  },

  /**
   * Release a locked intent the customer owns. Idempotent — returns
   * { released: false } when the intent has already moved on, was
   * never locked, or belongs to someone else. We never 404 on a
   * cross-customer release to avoid leaking ownership info.
   */
  async releaseIntent(customerId: string, intentId: string): Promise<{ released: boolean }> {
    const released = await bookingRepository.releaseIntent(intentId, customerId);
    return { released };
  },

  /**
   * Customer-side intent fetch — returns the row if (and only if) it
   * belongs to the caller. The `status` field is included verbatim so
   * the client can distinguish a terminal-but-successful state (e.g.,
   * `converted` after a successful book-now) from a true failure
   * (`expired`/`cancelled`). Returning null on a status check broke the
   * confirm step's post-convert flow — the query invalidate refetched
   * the now-`converted` intent and the page mistook it for "expired".
   *
   * Returns null (not 404) on miss so the wire never leaks ownership.
   */
  async getOwnIntent(customerId: string, intentId: string) {
    const row = await bookingRepository.getIntentById(intentId, customerId);
    if (!row) return null;
    return {
      intent_id: row.id,
      expires_at: new Date(row.expires_at).toISOString(),
      scheduled_start: new Date(row.scheduled_start).toISOString(),
      scheduled_end: new Date(row.scheduled_end).toISOString(),
      calculated_total: Number(row.calculated_total ?? 0),
      status: row.status,
    };
  },

  async convertIntent(
    intentId: string,
    customerId: string,
    extras: { paymentMethod?: TxMethod; customerAddressId?: string } = {},
  ) {
    const intent = await bookingRepository.getIntentById(intentId, customerId);
    if (!intent) throw new ResourceNotFoundError('Booking intent');
    if (new Date(intent.expires_at) < new Date()) throw new IntentExpiredError();
    resolveTransition(intent.status, 'convert', INTENT_TRANSITIONS);

    // Address ownership check (IDOR defence). When the customer picks an
    // address for a home-delivery booking, verify it actually belongs to
    // them — never trust the client to send a sibling user's id.
    if (extras.customerAddressId) {
      const address = await addressesRepository.findById(customerId, extras.customerAddressId);
      if (!address) {
        throw new ValidationError({ customer_address_id: 'Address not found' });
      }
    }

    // Payment-method validation via the Strategy registry (HLD §5). The
    // booking service is unaware of per-method rules (e.g., cash cap) —
    // the handler enforces them.
    if (extras.paymentMethod) {
      paymentMethod(extras.paymentMethod).assertAllowed({
        vendorType: intent.vendor_type as VendorType,
        amount: Number(intent.calculated_total ?? 0),
      });
    }

    const appointment = await bookingRepository.convertIntent(intentId, {
      paymentMethod: extras.paymentMethod,
      customerAddressId: extras.customerAddressId,
    });
    if (!appointment) {
      bookingIntentsTotal.inc({ outcome: 'expired' });
      throw new IntentExpiredError();
    }
    bookingIntentsTotal.inc({ outcome: 'converted' });
    return appointment;
  },

  async getAppointment(appointmentId: string, auth: CallerAuth) {
    const owner = await bookingRepository.findAppointmentOwner(appointmentId);
    if (!owner) throw new ResourceNotFoundError('Appointment');
    assertCallerOwns({
      callerRole: auth.role,
      callerUserId: auth.userId,
      callerTenantId: auth.tenantId,
      resourceOwnerUserId: owner.customer_user_id,
      resourceTenantId: owner.vendor_id,
        resourceBusinessId: owner.business_account_id,
    });
    const appointment = await bookingRepository.getAppointmentById(appointmentId);
    if (!appointment) throw new ResourceNotFoundError('Appointment');
    return appointment;
  },

  async transitionAppointment(
    appointmentId: string,
    action: string,
    actorRole: string,
    extra?: Record<string, unknown>,
    auth?: CallerAuth,
  ) {
    if (auth) {
      const owner = await bookingRepository.findAppointmentOwner(appointmentId);
      if (!owner) throw new ResourceNotFoundError('Appointment');
      assertCallerOwns({
        callerRole: auth.role,
        callerUserId: auth.userId,
        callerTenantId: auth.tenantId,
        resourceOwnerUserId: owner.customer_user_id,
        resourceTenantId: owner.vendor_id,
        resourceBusinessId: owner.business_account_id,
      });
    }
    const appointment = await bookingRepository.getAppointmentById(appointmentId);
    if (!appointment) throw new ResourceNotFoundError('Appointment');
    // Dues gate: a vendor whose outstanding commission has hit the cap
    // can't take on additional work until they settle. We only block the
    // *new* commitments (confirm) — already-confirmed bookings can still
    // be started/completed/cancelled so the customer in the chair isn't
    // punished for a back-office balance issue.
    if (action === 'confirm') {
      await financeService.assertVendorNotBlocked(
        appointment.vendor_type as VendorType,
        appointment.vendor_id,
      );
    }
    // Service-code gate for both 'start' and 'verify-otp':
    //   • Online bookings (customer profile has a service_code) → require a
    //     matching 6-digit code. This is the Rapido-style customer identity gate.
    //   • Walk-ins (no customer_id linked, so no service_code in profile) →
    //     start directly. The salon already accepted the customer in person.
    if (action === 'start' || action === 'verify-otp') {
      const expected = await bookingRepository.findCustomerServiceCodeByAppointment(appointmentId);
      if (expected !== null) {
        const provided = (extra?.otp_code as string | undefined) ?? '';
        if (!/^\d{6}$/.test(provided)) {
          throw new ValidationError({ field: 'otp_code', code: 'INVALID_SERVICE_CODE', message: 'Service code required to start.' });
        }
        if (expected !== provided) {
          throw new ValidationError({ field: 'otp_code', code: 'INVALID_SERVICE_CODE', message: 'Service code does not match.' });
        }
      }
    }
    const nextStatus = resolveTransition(appointment.status, action, APPOINTMENT_TRANSITIONS, actorRole);
    return bookingRepository.updateAppointmentStatus(appointmentId, nextStatus, extra);
  },

  async listAppointments(filters: {
    vendorType?: string; vendorId?: string; customerId?: string;
    staffMemberId?: string;
    status?: string; fromDate?: string; toDate?: string;
    limit: number; cursor?: string;
  }) {
    const rows = await bookingRepository.listAppointments(filters);
    // Overlay the resolved customer fields onto the wire shape. The repository
    // returns resolved_customer_name / resolved_customer_phone alongside the
    // inline columns; portal-booked appointments have NULL inline values, so
    // we prefer the resolved view when present. Keeping the same field
    // names on the response means salon / freelancer dashboards don't need
    // to know whether a booking came from the portal or a walk-in form.
    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      const inlineName = typeof r.customer_name === 'string' ? r.customer_name.trim() : null;
      const inlinePhone = typeof r.customer_phone === 'string' ? r.customer_phone.trim() : null;
      const resolvedName = r.resolved_customer_name as string | null | undefined;
      const resolvedPhone = r.resolved_customer_phone as string | null | undefined;
      return {
        ...r,
        customer_name: inlineName && inlineName.length > 0 ? inlineName : (resolvedName ?? null),
        customer_phone: inlinePhone && inlinePhone.length > 0 ? inlinePhone : (resolvedPhone ?? null),
      };
    });
  },

  async rescheduleAppointment(appointmentId: string, newStart: string, newEnd: string, auth: CallerAuth) {
    const owner = await bookingRepository.findAppointmentOwner(appointmentId);
    if (!owner) throw new ResourceNotFoundError('Appointment');
    assertCallerOwns({
      callerRole: auth.role,
      callerUserId: auth.userId,
      callerTenantId: auth.tenantId,
      resourceOwnerUserId: owner.customer_user_id,
      resourceTenantId: owner.vendor_id,
        resourceBusinessId: owner.business_account_id,
    });
    const result = await bookingRepository.rescheduleAppointment(appointmentId, newStart, newEnd);
    if (!result) throw new SlotUnavailableError({ reason: 'Appointment cannot be rescheduled in current state.' });
    return result;
  },

  async createWalkIn(data: {
    vendorType: string;
    vendorId: string;
    serviceIds: string[];
    customerName: string;
    customerPhone?: string;
    slotStart: string;
    slotEnd: string;
    staffMemberId?: string;
    bookingType: string;
    notes?: string;
  }) {
    // Dues gate — same as transitionAppointment#confirm: blocked vendors
    // cannot create new in-store bookings until they settle.
    await financeService.assertVendorNotBlocked(data.vendorType as VendorType, data.vendorId);

    // Time-aware initial status: if the slot is now (or within the grace window),
    // start the appointment immediately so the operator doesn't need a second click.
    const slotStartMs = new Date(data.slotStart).getTime();
    const initialStatus =
      slotStartMs - Date.now() <= WALKIN_IMMEDIATE_THRESHOLD_MS
        ? BOOKING_STATUS.IN_PROGRESS
        : BOOKING_STATUS.CONFIRMED;

    const appointment = await bookingRepository.createWalkIn({
      ...data,
      initialStatus,
    });
    if (!appointment) {
      throw new ResourceNotFoundError('One or more services');
    }
    return appointment;
  },
};
