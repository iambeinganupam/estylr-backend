import { query, queryOne } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';

// ── JSONB serializer (pre-processes arrays/objects before passing to buildUpdateSet) ──
// Columns that must be sent as JSON strings for the pg driver.
const JSONB_FIELDS = new Set([
  'services', 'gallery', 'certifications', 'specializations',
  'default_services', 'default_tasks', 'default_budget_items',
  'data',
]);

function serializeJsonb(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = JSONB_FIELDS.has(k) && (Array.isArray(v) || (v !== null && typeof v === 'object'))
      ? JSON.stringify(v)
      : v;
  }
  return out;
}

function buildInsertParts(data: Record<string, unknown>) {
  const normalized = serializeJsonb(data);
  const entries = Object.entries(normalized).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => k);
  const vals = entries.map(([, v]) => v);
  return { cols, vals };
}

// Columns projected from event_bookings_extended on every SELECT.
// Extracts lat/lng from the GEOGRAPHY column so callers get plain numbers.
const EVENT_SELECT_FIELDS = `
  e.*,
  ST_Y(e.venue_coordinates::geometry) AS venue_latitude,
  ST_X(e.venue_coordinates::geometry) AS venue_longitude
`;

// Build the venue_coordinates expression and the extra params for it.
// Returns { expr, params } where expr is either a ST_SetSRID call or 'NULL'.
function venueCoords(
  lat: number | undefined,
  lng: number | undefined,
  paramOffset: number,
): { expr: string; params: number[] } {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return {
      expr: `ST_SetSRID(ST_MakePoint($${paramOffset}, $${paramOffset + 1}), 4326)`,
      params: [lng, lat],
    };
  }
  return { expr: 'NULL', params: [] };
}

export const eventManagerRepository = {
  // ── Events ─────────────────────────────────────────────────────────────────
  async create(managerId: string, data: {
    title: string;
    event_date: string;
    venue?: string;
    total_budget?: number;
    notes?: string;
    client_name?: string;
    client_contact?: string;
    client_email?: string;
    services?: string[];
    venue_address_line1?: string;
    venue_address_line2?: string;
    venue_city?: string;
    venue_state?: string;
    venue_postal_code?: string;
    venue_country_code?: string;
    venue_latitude?: number;
    venue_longitude?: number;
  }) {
    const coords = venueCoords(data.venue_latitude, data.venue_longitude, 17);
    try {
      return await queryOne(
        `INSERT INTO public.event_bookings_extended
           (event_manager_id, title, event_date, venue, total_budget, notes,
            client_name, client_contact, client_email, services,
            venue_address_line1, venue_address_line2, venue_city, venue_state,
            venue_postal_code, venue_country_code, venue_coordinates)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                 $11, $12, $13, $14, $15, $16, ${coords.expr})
         RETURNING *,
           ST_Y(venue_coordinates::geometry) AS venue_latitude,
           ST_X(venue_coordinates::geometry) AS venue_longitude`,
        [
          managerId, data.title, data.event_date,
          data.venue ?? null, data.total_budget ?? null, data.notes ?? null,
          data.client_name ?? null, data.client_contact ?? null,
          data.client_email ? data.client_email : null,
          JSON.stringify(data.services ?? []),
          data.venue_address_line1 ?? null,
          data.venue_address_line2 ?? null,
          data.venue_city ?? null,
          data.venue_state ?? null,
          data.venue_postal_code ?? null,
          data.venue_country_code ?? null,
          ...coords.params,
        ],
      );
    } catch (e) { mapPgError(e); }
  },

  async listByManager(managerId: string) {
    const result = await query(
      `SELECT ${EVENT_SELECT_FIELDS},
              (SELECT COUNT(*) FROM public.event_freelancer_hires h WHERE h.event_id = e.id) AS hire_count,
              (SELECT COUNT(*) FROM public.event_vendors v          WHERE v.event_id = e.id) AS vendor_count,
              (SELECT COUNT(*) FROM public.event_managed_guests g   WHERE g.event_id = e.id) AS guest_count
       FROM public.event_bookings_extended e
       WHERE e.event_manager_id = $1
       ORDER BY e.event_date DESC`,
      [managerId],
    );
    return result.rows;
  },

  async findById(eventId: string, managerId: string) {
    return queryOne(
      `SELECT ${EVENT_SELECT_FIELDS}
       FROM public.event_bookings_extended e
       WHERE e.id = $1 AND e.event_manager_id = $2`,
      [eventId, managerId],
    );
  },

  async findDetail(eventId: string, managerId: string) {
    const event = await this.findById(eventId, managerId);
    if (!event) return null;

    const [hires, vendors, guests, budget, tasks, payments, transactions] = await Promise.all([
      query(
        `SELECT h.*, fp.business_name, fp.display_name, fp.avg_rating
         FROM public.event_freelancer_hires h
         JOIN public.freelancer_profiles fp ON h.freelancer_id = fp.id
         WHERE h.event_id = $1
         ORDER BY h.created_at`,
        [eventId],
      ),
      query(`SELECT * FROM public.event_vendors        WHERE event_id = $1 ORDER BY created_at`, [eventId]),
      query(`SELECT * FROM public.event_managed_guests WHERE event_id = $1 ORDER BY created_at`, [eventId]),
      query(`SELECT * FROM public.event_budget_items   WHERE event_id = $1 ORDER BY created_at`, [eventId]),
      query(`SELECT * FROM public.event_tasks          WHERE event_id = $1 ORDER BY due_date NULLS LAST, created_at`, [eventId]),
      query(`SELECT * FROM public.event_payments       WHERE event_id = $1 ORDER BY due_date NULLS LAST, created_at`, [eventId]),
      query(`SELECT * FROM public.event_transactions   WHERE event_id = $1 ORDER BY tx_date DESC, created_at DESC`, [eventId]),
    ]);

    return {
      ...event,
      hires:        hires.rows,
      vendors:      vendors.rows,
      guests:       guests.rows,
      budget_items: budget.rows,
      tasks:        tasks.rows,
      payments:     payments.rows,
      transactions: transactions.rows,
    };
  },

  async update(eventId: string, managerId: string, fields: Record<string, unknown>) {
    // Scalar fields handled by buildUpdateSet.
    const ALLOWED_FIELDS = [
      'title', 'event_date', 'venue', 'total_budget', 'notes', 'status',
      'client_name', 'client_contact', 'client_email', 'services',
      'venue_address_line1', 'venue_address_line2', 'venue_city', 'venue_state',
      'venue_postal_code', 'venue_country_code',
    ] as const;

    // Extract lat/lng before passing to buildUpdateSet (not scalar string cols).
    const { venue_latitude, venue_longitude, ...scalarFields } = fields as Record<string, unknown> & {
      venue_latitude?: number;
      venue_longitude?: number;
    };

    const scalarParsed = serializeJsonb(scalarFields);
    const hasScalar = ALLOWED_FIELDS.some((f) => scalarParsed[f] !== undefined);

    // Build scalar SET clause only when there are scalar fields to update.
    let setClause = '';
    let values: unknown[] = [];
    if (hasScalar) {
      ({ setClause, values } = buildUpdateSet(scalarParsed, ALLOWED_FIELDS, { paramOffset: 2 }));
    }

    const extraSets: string[] = [];
    const extraVals: unknown[] = [];

    if (typeof venue_latitude === 'number' && typeof venue_longitude === 'number') {
      const base = 2 + values.length;
      extraVals.push(venue_longitude, venue_latitude);
      extraSets.push(`venue_coordinates = ST_SetSRID(ST_MakePoint($${base + 1}, $${base + 2}), 4326)`);
    }

    const allSets = [setClause, ...extraSets].filter(Boolean).join(', ');

    try {
      return await queryOne(
        `UPDATE public.event_bookings_extended
         SET ${allSets}, updated_at = NOW()
         WHERE id = $1 AND event_manager_id = $2
         RETURNING *,
           ST_Y(venue_coordinates::geometry) AS venue_latitude,
           ST_X(venue_coordinates::geometry) AS venue_longitude`,
        [eventId, managerId, ...values, ...extraVals],
      );
    } catch (e) { mapPgError(e); }
  },

  async deleteEvent(eventId: string, managerId: string) {
    try {
      return await queryOne(
        `DELETE FROM public.event_bookings_extended
         WHERE id = $1 AND event_manager_id = $2 RETURNING id`,
        [eventId, managerId],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Freelancer search & hires (existing) ──────────────────────────────────
  async searchFreelancers(eventId: string, filters: { city?: string; limit: number }) {
    const conditions = [
      'fp.is_active = TRUE',
      'fp.is_verified = TRUE',
      `fp.id NOT IN (SELECT h.freelancer_id FROM public.event_freelancer_hires h WHERE h.event_id = $1 AND h.status != 'cancelled')`,
    ];
    const params: unknown[] = [eventId];
    let paramIdx = 2;

    if (filters.city) {
      conditions.push(`fp.city ILIKE '%' || $${paramIdx++} || '%'`);
      params.push(filters.city);
    }

    const result = await query(
      `SELECT fp.id, fp.business_name, fp.display_name, fp.city,
              fp.avg_rating, fp.review_count, fp.starting_price, fp.category
       FROM public.freelancer_profiles fp
       WHERE ${conditions.join(' AND ')}
       ORDER BY fp.avg_rating DESC, fp.review_count DESC
       LIMIT $${paramIdx}`,
      [...params, filters.limit],
    );
    return result.rows;
  },

  async hire(eventId: string, freelancerId: string, agreedRate?: number, notes?: string) {
    try {
      return await queryOne(
        `INSERT INTO public.event_freelancer_hires (event_id, freelancer_id, agreed_rate, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [eventId, freelancerId, agreedRate ?? null, notes ?? null],
      );
    } catch (e) { mapPgError(e); }
  },

  async updateHireStatus(hireId: string, eventId: string, status: string, notes?: string) {
    try {
      return await queryOne(
        `UPDATE public.event_freelancer_hires
         SET status = $3::hire_status, notes = COALESCE($4, notes), updated_at = NOW()
         WHERE id = $1 AND event_id = $2
         RETURNING *`,
        [hireId, eventId, status, notes ?? null],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Marketplace search (broader than per-event freelancer search) ─────────
  async searchMarketplaceVendors(filters: {
    q?: string;
    category?: string;
    city?: string;
    limit: number;
  }) {
    const conditions = ['fp.is_active = TRUE'];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.q) {
      conditions.push(`(fp.business_name ILIKE '%' || $${idx} || '%' OR fp.display_name ILIKE '%' || $${idx} || '%')`);
      params.push(filters.q);
      idx++;
    }
    if (filters.category) {
      conditions.push(`fp.category ILIKE $${idx++}`);
      params.push(filters.category);
    }
    if (filters.city) {
      conditions.push(`fp.city ILIKE '%' || $${idx++} || '%'`);
      params.push(filters.city);
    }

    const result = await query(
      `SELECT fp.id, fp.business_name AS name, fp.display_name, fp.category,
              fp.city AS location, fp.avg_rating AS rating, fp.review_count AS reviews_count,
              fp.starting_price, fp.is_verified AS verified, fp.contact_phone AS contact
       FROM public.freelancer_profiles fp
       WHERE ${conditions.join(' AND ')}
       ORDER BY fp.avg_rating DESC, fp.review_count DESC
       LIMIT $${idx}`,
      [...params, filters.limit],
    );
    return result.rows;
  },

  // ── Event vendors (per-event vendor row, not freelancer hire) ─────────────
  vendors: {
    async list(eventId: string) {
      const r = await query(`SELECT * FROM public.event_vendors WHERE event_id = $1 ORDER BY created_at`, [eventId]);
      return r.rows;
    },
    async create(eventId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_vendors (event_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [eventId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
    async update(eventId: string, vendorId: string, fields: Record<string, unknown>) {
      // Matches updateEventVendorSchema: name, category, subcategory, freelancer_id,
      // rating, reviews_count, price, location, contact, verified, availability, status, notes.
      const ALLOWED_FIELDS = [
        'name', 'category', 'subcategory', 'freelancer_id', 'rating', 'reviews_count',
        'price', 'location', 'contact', 'verified', 'availability', 'status', 'notes',
      ] as const;
      const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 2 });
      try {
        return await queryOne(
          `UPDATE public.event_vendors SET ${setClause}, updated_at = NOW()
           WHERE event_id = $1 AND id = $2 RETURNING *`,
          [eventId, vendorId, ...values],
        );
      } catch (e) { mapPgError(e); }
    },
    async remove(eventId: string, vendorId: string) {
      try {
        return await queryOne(`DELETE FROM public.event_vendors WHERE id = $2 AND event_id = $1 RETURNING id`, [eventId, vendorId]);
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Guests ─────────────────────────────────────────────────────────────────
  guests: {
    async list(eventId: string) {
      const r = await query(`SELECT * FROM public.event_managed_guests WHERE event_id = $1 ORDER BY created_at`, [eventId]);
      return r.rows;
    },
    async create(eventId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_managed_guests (event_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [eventId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
    async update(eventId: string, guestId: string, fields: Record<string, unknown>) {
      // Matches updateGuestSchema: name, email, phone, rsvp_status,
      // dietary_restrictions, plus_one, category, side.
      const ALLOWED_FIELDS = [
        'name', 'email', 'phone', 'rsvp_status',
        'dietary_restrictions', 'plus_one', 'category', 'side',
      ] as const;
      const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 2 });
      try {
        return await queryOne(
          `UPDATE public.event_managed_guests SET ${setClause}, updated_at = NOW()
           WHERE event_id = $1 AND id = $2 RETURNING *`,
          [eventId, guestId, ...values],
        );
      } catch (e) { mapPgError(e); }
    },
    async remove(eventId: string, guestId: string) {
      try {
        return await queryOne(`DELETE FROM public.event_managed_guests WHERE id = $2 AND event_id = $1 RETURNING id`, [eventId, guestId]);
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Budget items ───────────────────────────────────────────────────────────
  budgetItems: {
    async list(eventId: string) {
      const r = await query(`SELECT * FROM public.event_budget_items WHERE event_id = $1 ORDER BY created_at`, [eventId]);
      return r.rows;
    },
    async create(eventId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_budget_items (event_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [eventId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
    async update(eventId: string, itemId: string, fields: Record<string, unknown>) {
      // Matches updateBudgetItemSchema: category, item, budgeted_amount,
      // actual_amount, status, vendor_name, vendor_id.
      const ALLOWED_FIELDS = [
        'category', 'item', 'budgeted_amount', 'actual_amount',
        'status', 'vendor_name', 'vendor_id',
      ] as const;
      const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 2 });
      try {
        return await queryOne(
          `UPDATE public.event_budget_items SET ${setClause}, updated_at = NOW()
           WHERE event_id = $1 AND id = $2 RETURNING *`,
          [eventId, itemId, ...values],
        );
      } catch (e) { mapPgError(e); }
    },
    async remove(eventId: string, itemId: string) {
      try {
        return await queryOne(`DELETE FROM public.event_budget_items WHERE id = $2 AND event_id = $1 RETURNING id`, [eventId, itemId]);
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Tasks ──────────────────────────────────────────────────────────────────
  tasks: {
    async list(eventId: string) {
      const r = await query(`SELECT * FROM public.event_tasks WHERE event_id = $1 ORDER BY due_date NULLS LAST, created_at`, [eventId]);
      return r.rows;
    },
    async create(eventId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_tasks (event_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [eventId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
    async update(eventId: string, taskId: string, fields: Record<string, unknown>) {
      // Matches updateTaskSchema: title, due_date, status, assignee,
      // assigned_vendor_id, category.
      const ALLOWED_FIELDS = [
        'title', 'due_date', 'status', 'assignee', 'assigned_vendor_id', 'category',
      ] as const;
      const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 2 });
      try {
        return await queryOne(
          `UPDATE public.event_tasks SET ${setClause}, updated_at = NOW()
           WHERE event_id = $1 AND id = $2 RETURNING *`,
          [eventId, taskId, ...values],
        );
      } catch (e) { mapPgError(e); }
    },
    async remove(eventId: string, taskId: string) {
      try {
        return await queryOne(`DELETE FROM public.event_tasks WHERE id = $2 AND event_id = $1 RETURNING id`, [eventId, taskId]);
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Payments ───────────────────────────────────────────────────────────────
  payments: {
    async list(eventId: string) {
      const r = await query(`SELECT * FROM public.event_payments WHERE event_id = $1 ORDER BY due_date NULLS LAST, created_at`, [eventId]);
      return r.rows;
    },
    async create(eventId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_payments (event_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [eventId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
    async update(eventId: string, paymentId: string, fields: Record<string, unknown>) {
      // Matches updatePaymentSchema: vendor_id, vendor_name, amount, paid_amount,
      // status, due_date, paid_date, category, description, related_budget_item_id.
      const ALLOWED_FIELDS = [
        'vendor_id', 'vendor_name', 'amount', 'paid_amount', 'status',
        'due_date', 'paid_date', 'category', 'description', 'related_budget_item_id',
      ] as const;
      const { setClause, values } = buildUpdateSet(fields, ALLOWED_FIELDS, { paramOffset: 2 });
      try {
        return await queryOne(
          `UPDATE public.event_payments SET ${setClause}, updated_at = NOW()
           WHERE event_id = $1 AND id = $2 RETURNING *`,
          [eventId, paymentId, ...values],
        );
      } catch (e) { mapPgError(e); }
    },
    async remove(eventId: string, paymentId: string) {
      try {
        return await queryOne(`DELETE FROM public.event_payments WHERE id = $2 AND event_id = $1 RETURNING id`, [eventId, paymentId]);
      } catch (e) { mapPgError(e); }
    },
    async findById(eventId: string, paymentId: string) {
      return queryOne(`SELECT * FROM public.event_payments WHERE id = $2 AND event_id = $1`, [eventId, paymentId]);
    },
  },

  // ── Transactions ───────────────────────────────────────────────────────────
  transactions: {
    async list(eventId: string) {
      const r = await query(`SELECT * FROM public.event_transactions WHERE event_id = $1 ORDER BY tx_date DESC, created_at DESC`, [eventId]);
      return r.rows;
    },
    async create(eventId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_transactions (event_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [eventId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Portfolio ──────────────────────────────────────────────────────────────
  portfolio: {
    async findByUser(userId: string) {
      return queryOne(`SELECT * FROM public.event_manager_portfolios WHERE user_id = $1`, [userId]);
    },
    async upsert(userId: string, data: Record<string, unknown>) {
      const { cols, vals } = buildInsertParts(data);
      const allCols = ['user_id', ...cols];
      const allVals = [userId, ...vals];
      const placeholders = allVals.map((_, i) => `$${i + 1}`).join(', ');
      const updates = cols.map(k => `${k} = EXCLUDED.${k}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_manager_portfolios (${allCols.join(', ')})
           VALUES (${placeholders})
           ${updates ? `ON CONFLICT (user_id) DO UPDATE SET ${updates}, updated_at = NOW()` : 'ON CONFLICT (user_id) DO NOTHING'}
           RETURNING *`,
          allVals,
        );
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Templates ──────────────────────────────────────────────────────────────
  templates: {
    async list(managerId: string) {
      const r = await query(`SELECT * FROM public.event_manager_templates WHERE event_manager_id = $1 ORDER BY created_at DESC`, [managerId]);
      return r.rows;
    },
    async create(managerId: string, data: Record<string, unknown>) {
      const { cols, vals } = buildInsertParts(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_manager_templates (event_manager_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [managerId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
    async update(managerId: string, templateId: string, fields: Record<string, unknown>) {
      // Matches updateTemplateSchema: name, description,
      // default_services, default_tasks, default_budget_items (all three JSONB).
      const ALLOWED_FIELDS = [
        'name', 'description',
        'default_services', 'default_tasks', 'default_budget_items',
      ] as const;
      const { setClause, values } = buildUpdateSet(serializeJsonb(fields), ALLOWED_FIELDS, { paramOffset: 2 });
      try {
        return await queryOne(
          `UPDATE public.event_manager_templates SET ${setClause}, updated_at = NOW()
           WHERE event_manager_id = $1 AND id = $2 RETURNING *`,
          [managerId, templateId, ...values],
        );
      } catch (e) { mapPgError(e); }
    },
    async remove(managerId: string, templateId: string) {
      try {
        return await queryOne(`DELETE FROM public.event_manager_templates WHERE id = $2 AND event_manager_id = $1 RETURNING id`, [managerId, templateId]);
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Communications ─────────────────────────────────────────────────────────
  communications: {
    async list(managerId: string, filters: { event_id?: string; thread_key?: string; limit: number }) {
      const conditions = ['event_manager_id = $1'];
      const params: unknown[] = [managerId];
      let idx = 2;
      if (filters.event_id) {
        conditions.push(`event_id = $${idx++}`);
        params.push(filters.event_id);
      }
      if (filters.thread_key) {
        conditions.push(`thread_key = $${idx++}`);
        params.push(filters.thread_key);
      }
      const r = await query(
        `SELECT * FROM public.event_communications WHERE ${conditions.join(' AND ')}
         ORDER BY sent_at DESC LIMIT $${idx}`,
        [...params, filters.limit],
      );
      return r.rows;
    },
    async create(managerId: string, data: Record<string, unknown>) {
      const cols = Object.keys(data);
      const vals = Object.values(data);
      const placeholders = vals.map((_, i) => `$${i + 2}`).join(', ');
      try {
        return await queryOne(
          `INSERT INTO public.event_communications (event_manager_id, ${cols.join(', ')})
           VALUES ($1, ${placeholders}) RETURNING *`,
          [managerId, ...vals],
        );
      } catch (e) { mapPgError(e); }
    },
  },

  // ── Analytics summary ──────────────────────────────────────────────────────
  async analyticsSummary(managerId: string) {
    const r = await queryOne<{
      total_events: string; planning_events: string; confirmed_events: string;
      completed_events: string; cancelled_events: string;
      total_budget: string | null; total_spent: string | null;
      upcoming_events: string;
    }>(
      `SELECT
         COUNT(*)::text                                                         AS total_events,
         COUNT(*) FILTER (WHERE status = 'planning')::text                       AS planning_events,
         COUNT(*) FILTER (WHERE status = 'confirmed')::text                      AS confirmed_events,
         COUNT(*) FILTER (WHERE status = 'completed')::text                      AS completed_events,
         COUNT(*) FILTER (WHERE status = 'cancelled')::text                      AS cancelled_events,
         COALESCE(SUM(total_budget), 0)::text                                    AS total_budget,
         COALESCE(SUM(spent_budget), 0)::text                                    AS total_spent,
         COUNT(*) FILTER (WHERE event_date >= CURRENT_DATE AND status != 'cancelled')::text AS upcoming_events
       FROM public.event_bookings_extended
       WHERE event_manager_id = $1`,
      [managerId],
    );
    return {
      total_events:     Number(r?.total_events     ?? 0),
      planning_events:  Number(r?.planning_events  ?? 0),
      confirmed_events: Number(r?.confirmed_events ?? 0),
      completed_events: Number(r?.completed_events ?? 0),
      cancelled_events: Number(r?.cancelled_events ?? 0),
      upcoming_events:  Number(r?.upcoming_events  ?? 0),
      total_budget:     Number(r?.total_budget     ?? 0),
      total_spent:      Number(r?.total_spent      ?? 0),
    };
  },
};
