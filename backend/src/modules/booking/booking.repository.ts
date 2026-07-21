// ─────────────────────────────────────────────────────────────────────────────
// Booking Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne, withTransaction } from '../../config/database';
import { SlotLockedError } from '../../lib/errors';
import { mapPgError } from '../../lib/pg-errors';
import { PoolClient } from 'pg';

const INTENT_EXPIRY_MINUTES = 10;

export const bookingRepository = {
  // ── Intents ──
  async createIntent(data: {
    customerId: string;
    vendorType: string;
    vendorId: string;
    serviceId: string;
    staffMemberId?: string;
    slotStart: string;
    slotEnd: string;
  }) {
    return withTransaction(async (client: PoolClient) => {
      // Fetch service price/duration for the line item snapshot.
      const svcResult = await client.query<{ price: string; duration_minutes: number }>(
        `SELECT price, duration_minutes FROM public.services WHERE id = $1`,
        [data.serviceId],
      );
      const svc = svcResult.rows[0];
      const calculatedTotal = svc ? Number(svc.price) : 0;
      const durationMinutes = svc ? svc.duration_minutes : 0;

      let intent: Record<string, unknown>;
      try {
        const result = await client.query(
          `INSERT INTO public.booking_intents
           (customer_id, vendor_type, vendor_id, staff_member_id, scheduled_start, scheduled_end, calculated_total, status, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'locked', NOW() + INTERVAL '${INTENT_EXPIRY_MINUTES} minutes')
           RETURNING *`,
          [
            data.customerId, data.vendorType, data.vendorId,
            data.staffMemberId || null, data.slotStart, data.slotEnd, calculatedTotal,
          ],
        );
        intent = result.rows[0] as Record<string, unknown>;

        // Insert the line item with a locked price snapshot.
        if (svc) {
          await client.query(
            `INSERT INTO public.intent_line_items (intent_id, service_id, locked_price, duration_minutes)
             VALUES ($1, $2, $3, $4)`,
            [intent.id, data.serviceId, svc.price, durationMinutes],
          );
        }
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code === '23505' && err.constraint === 'uq_booking_intents_active_slot') {
          throw new SlotLockedError({ slotStart: data.slotStart, vendorId: data.vendorId });
        }
        mapPgError(e);
      }

      return intent!;
    });
  },

  async getIntentById(intentId: string, customerId: string) {
    return queryOne(
      `SELECT * FROM public.booking_intents WHERE id = $1 AND customer_id = $2`,
      [intentId, customerId],
    );
  },

  async lockIntent(intentId: string, customerName: string, customerPhone: string | undefined, notes: string | undefined) {
    return queryOne(
      `UPDATE public.booking_intents
       SET status = 'locked', customer_name = $2, customer_phone = $3, notes = $4, updated_at = NOW()
       WHERE id = $1 AND status = 'draft' AND expires_at > NOW()
       RETURNING *`,
      [intentId, customerName, customerPhone || null, notes || null],
    );
  },

  /**
   * Release a locked intent that the customer owns. Idempotent:
   * returns false when the intent is already converted / expired /
   * cancelled, or when the caller is not the owner. The endpoint
   * deliberately does not surface ownership info — see service layer.
   */
  async releaseIntent(intentId: string, customerId: string): Promise<boolean> {
    return withTransaction(async (client: PoolClient) => {
      const result = await client.query(
        `UPDATE public.booking_intents
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1
           AND customer_id = $2
           AND status = 'locked'
         RETURNING id`,
        [intentId, customerId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  },

  async convertIntent(
    intentId: string,
    extras?: {
      paymentMethod?: 'upi' | 'card' | 'cash' | 'online';
      customerAddressId?: string;
    },
  ) {
    return withTransaction(async (client: PoolClient) => {
      try {
        // 1. Get intent under row-lock so a parallel convert can't double-spend it.
        //    Schema columns are `scheduled_start/end` + `expires_at` (migration
        //    005's table layout); the service_id lives one level down in
        //    intent_line_items because the flow was designed to support
        //    multi-service bookings (currently always exactly one row).
        const intentResult = await client.query(
          `SELECT * FROM public.booking_intents
            WHERE id = $1 AND status = 'locked' AND expires_at > NOW()
            FOR UPDATE`,
          [intentId],
        );
        const intent = intentResult.rows[0];
        if (!intent) return null;

        const lineItemResult = await client.query<{ service_id: string }>(
          `SELECT service_id FROM public.intent_line_items WHERE intent_id = $1 LIMIT 1`,
          [intentId],
        );
        const serviceId = lineItemResult.rows[0]?.service_id ?? null;

        // 2. Create appointment from intent. payment_method + customer_address_id
        //    flow in from the confirm-step UI; both nullable to keep walk-ins
        //    (which never hit this codepath) and onsite bookings working.
        //    total_amount is sourced from the locked intent so dashboards +
        //    revenue cards don't render ₹0 for every portal-booked row.
        const appointmentResult = await client.query(
          `INSERT INTO public.appointments
           (customer_id, vendor_type, vendor_id, service_id, staff_member_id,
            start_time, end_time, status, intent_id,
            payment_method, customer_address_id, total_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11)
           RETURNING *`,
          [
            intent.customer_id, intent.vendor_type, intent.vendor_id, serviceId,
            intent.staff_member_id, intent.scheduled_start, intent.scheduled_end, intent.id,
            extras?.paymentMethod ?? null,
            extras?.customerAddressId ?? null,
            Number(intent.calculated_total ?? 0),
          ],
        );

        // 3. Mark intent as converted
        await client.query(
          `UPDATE public.booking_intents SET status = 'converted', updated_at = NOW() WHERE id = $1`,
          [intentId],
        );

        return appointmentResult.rows[0];
      } catch (e) { mapPgError(e); }
    });
  },

  // ── Appointments ──
  async getAppointmentById(appointmentId: string) {
    // resolved_customer_name / resolved_customer_phone mirror the same
    // overlay the list query does — see listAppointments above for the
    // rationale. The service layer prefers inline values, falling back to
    // the resolved view for portal-booked rows that carry no walk-in name.
    return queryOne(
      `SELECT a.*,
              s.name AS service_name,
              s.duration_minutes,
              s.price AS service_price,
              vn.vendor_name AS vendor_name,
              COALESCE(li.services, '[]'::jsonb) AS services,
              CASE WHEN tx.id IS NOT NULL THEN 'paid' ELSE 'unpaid' END AS payment_status,
              tx.id AS transaction_id,
              tx.payment_method AS payment_method,
              NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', cp.first_name, cp.last_name)), '')
                AS resolved_customer_name,
              u.phone_number AS resolved_customer_phone
       FROM public.appointments a
       LEFT JOIN public.services s ON a.service_id = s.id
       LEFT JOIN public.customer_profiles cp ON cp.user_id = a.customer_id
       LEFT JOIN public.users u           ON u.id = a.customer_id
       LEFT JOIN LATERAL (
         -- Polymorphic vendor name: freelancer_profiles for freelancers,
         -- salon_locations (brand → outlet name) for salon_locations.
         SELECT CASE a.vendor_type
           WHEN 'freelancer' THEN
             (SELECT COALESCE(fp.display_name, fp.business_name)
                FROM public.freelancer_profiles fp WHERE fp.id = a.vendor_id)
           WHEN 'salon_location' THEN
             (SELECT COALESCE(ba.brand_name, sl.display_name)
                FROM public.salon_locations sl
                JOIN public.business_accounts ba ON sl.business_account_id = ba.id
               WHERE sl.id = a.vendor_id)
         END AS vendor_name
       ) vn ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'service_id', li.service_id,
             'service_name', li.service_name,
             'locked_price', li.locked_price,
             'duration_minutes', li.duration_minutes
           ) ORDER BY li.created_at
         ) AS services
         FROM public.appointment_line_items li
         WHERE li.appointment_id = a.id
       ) li ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, payment_method
         FROM public.transactions
         WHERE appointment_id = a.id AND status = 'completed'
         ORDER BY created_at DESC
         LIMIT 1
       ) tx ON TRUE
       WHERE a.id = $1`,
      [appointmentId],
    );
  },

  async updateAppointmentStatus(appointmentId: string, status: string, extra?: Record<string, unknown>) {
    const setClauses = ['status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [appointmentId, status];

    if (extra) {
      Object.entries(extra).forEach(([key, val]) => {
        setClauses.push(`${key} = $${values.length + 1}`);
        values.push(val);
      });
    }

    return queryOne(
      `UPDATE public.appointments SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      values,
    );
  },

  async listAppointments(filters: {
    vendorType?: string;
    vendorId?: string;
    customerId?: string;
    staffMemberId?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
    cursor?: string;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.vendorType && filters.vendorId) {
      conditions.push(`a.vendor_type = $${paramIdx++}`);
      params.push(filters.vendorType);
      conditions.push(`a.vendor_id = $${paramIdx++}`);
      params.push(filters.vendorId);
    }
    if (filters.customerId) {
      conditions.push(`a.customer_id = $${paramIdx++}`);
      params.push(filters.customerId);
    }
    if (filters.staffMemberId) {
      conditions.push(`a.staff_member_id = $${paramIdx++}`);
      params.push(filters.staffMemberId);
    }
    if (filters.status) {
      conditions.push(`a.status = $${paramIdx++}`);
      params.push(filters.status);
    }
    if (filters.fromDate) {
      conditions.push(`a.start_time >= $${paramIdx++}::date`);
      params.push(filters.fromDate);
    }
    if (filters.toDate) {
      conditions.push(`a.start_time < ($${paramIdx++}::date + interval '1 day')`);
      params.push(filters.toDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // The two COALESCEd columns (resolved_customer_name / phone) resolve a
    // portal-booked appointment's customer from customer_profiles + users
    // when the inline a.customer_name / a.customer_phone are NULL (walk-ins
    // populate those; portal bookings don't). The service layer overlays
    // them onto customer_name / customer_phone for a stable wire shape.
    const result = await query(
      `SELECT a.*,
              s.name AS service_name,
              s.price AS service_price,
              s.duration_minutes,
              COALESCE(li.services, '[]'::jsonb) AS services,
              CASE WHEN tx.id IS NOT NULL THEN 'paid' ELSE 'unpaid' END AS payment_status,
              tx.id AS transaction_id,
              tx.payment_method AS payment_method,
              NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', cp.first_name, cp.last_name)), '')
                AS resolved_customer_name,
              u.phone_number AS resolved_customer_phone
       FROM public.appointments a
       LEFT JOIN public.services s ON a.service_id = s.id
       LEFT JOIN public.customer_profiles cp ON cp.user_id = a.customer_id
       LEFT JOIN public.users u           ON u.id = a.customer_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'service_id', li.service_id,
             'service_name', li.service_name,
             'locked_price', li.locked_price,
             'duration_minutes', li.duration_minutes
           ) ORDER BY li.created_at
         ) AS services
         FROM public.appointment_line_items li
         WHERE li.appointment_id = a.id
       ) li ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, payment_method
         FROM public.transactions
         WHERE appointment_id = a.id AND status = 'completed'
         ORDER BY created_at DESC
         LIMIT 1
       ) tx ON TRUE
       ${whereClause}
       ORDER BY a.start_time DESC
       LIMIT $${paramIdx}`,
      [...params, filters.limit + 1],
    );
    return result.rows;
  },

  async rescheduleAppointment(appointmentId: string, newStart: string, newEnd: string) {
    return queryOne(
      `UPDATE public.appointments
       SET start_time = $2, end_time = $3, status = 'pending', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'confirmed')
       RETURNING *`,
      [appointmentId, newStart, newEnd],
    );
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
    initialStatus: 'confirmed' | 'in_progress';
  }) {
    return withTransaction(async (client: PoolClient) => {
      try {
        // 1. Snapshot service prices/durations (and validate they belong to this vendor).
        const services = await client.query(
          `SELECT id, name, price, duration_minutes
           FROM public.services
           WHERE id = ANY($1::uuid[])
             AND vendor_type = $2
             AND vendor_id   = $3
             AND is_active   = TRUE`,
          [data.serviceIds, data.vendorType, data.vendorId],
        );
        if (services.rows.length !== data.serviceIds.length) {
          return null; // Service mismatch — service layer maps this to a 404.
        }

        const totalAmount = services.rows.reduce(
          (sum: number, r: { price: string }) => sum + Number(r.price),
          0,
        );
        // Derive primary service by highest price (deterministic tiebreak: id ASC).
        // This prevents a malicious/careless client from mis-attributing commission
        // by reordering serviceIds[0].
        const primaryServiceRow = services.rows.reduce(
          (best: { id: string; price: string }, r: { id: string; price: string }) =>
            Number(r.price) > Number(best.price) ||
            (Number(r.price) === Number(best.price) && r.id < best.id)
              ? r
              : best,
          services.rows[0] as { id: string; price: string },
        );
        const primaryServiceId = primaryServiceRow?.id ?? data.serviceIds[0];

        // 2. Create appointment with snapshotted total.
        const appt = await client.query(
          `INSERT INTO public.appointments
           (vendor_type, vendor_id, service_id, customer_name, customer_phone,
            start_time, end_time, staff_member_id, booking_type, status,
            total_amount, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            data.vendorType, data.vendorId, primaryServiceId,
            data.customerName, data.customerPhone || null,
            data.slotStart, data.slotEnd,
            data.staffMemberId || null, data.bookingType,
            data.initialStatus, totalAmount, data.notes || null,
          ],
        );
        const appointment = appt.rows[0];

        // 3. Insert line items (one per service, with locked price snapshot).
        for (const s of services.rows) {
          await client.query(
            `INSERT INTO public.appointment_line_items
             (appointment_id, service_id, service_name, locked_price, duration_minutes)
             VALUES ($1, $2, $3, $4, $5)`,
            [appointment.id, s.id, s.name, s.price, s.duration_minutes],
          );
        }

        return appointment;
      } catch (e) { mapPgError(e); }
    });
  },

  async findCustomerServiceCodeByAppointment(appointmentId: string): Promise<string | null> {
    const row = await queryOne<{ service_code: string }>(
      `SELECT cp.service_code
         FROM public.appointments a
         JOIN public.customer_profiles cp ON cp.user_id = a.customer_id
        WHERE a.id = $1`,
      [appointmentId],
    );
    return row?.service_code ?? null;
  },

  async findAppointmentOwner(appointmentId: string): Promise<{
    customer_user_id: string;
    vendor_id: string;
    vendor_type: string;
    /**
     * Parent business_account.id when the vendor is a salon_location;
     * NULL for freelancer-owned appointments. business_admin / staff
     * JWTs carry the business_account.id as `tenantId`, so the
     * ownership check needs BOTH the location id AND the parent
     * business id to authorise — otherwise the salon dashboard's
     * "Accept" CTA 404s its own bookings.
     */
    business_account_id: string | null;
  } | null> {
    return queryOne(
      `SELECT a.customer_id        AS customer_user_id,
              a.vendor_id,
              a.vendor_type::text  AS vendor_type,
              CASE WHEN a.vendor_type = 'salon_location'
                   THEN sl.business_account_id
                   ELSE NULL
              END                  AS business_account_id
         FROM public.appointments a
         LEFT JOIN public.salon_locations sl
                ON a.vendor_type = 'salon_location' AND sl.id = a.vendor_id
        WHERE a.id = $1`,
      [appointmentId],
    );
  },
};
