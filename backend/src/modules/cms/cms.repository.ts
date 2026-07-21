// ─────────────────────────────────────────────────────────────────────────────
// CMS Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';
import { buildUpdateSet } from '../../lib/sql-update';
import { mapPgError } from '../../lib/pg-errors';

export const cmsRepository = {
  // ── Pages / Posts ──
  async createPage(data: {
    title: string; slug: string; content: string; status: string;
    metaTitle?: string; metaDescription?: string; tags?: string[];
    authorId: string;
  }) {
    try {
      return await queryOne(
        `INSERT INTO public.cms_pages (title, slug, content, status, meta_title, meta_description, tags, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.title, data.slug, data.content, data.status,
         data.metaTitle || null, data.metaDescription || null,
         data.tags ? JSON.stringify(data.tags) : null, data.authorId],
      );
    } catch (e) { mapPgError(e); }
  },

  async listPages(filters: { status?: string; tag?: string; limit: number }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filters.status) { conditions.push(`status = $${paramIdx++}`); params.push(filters.status); }
    if (filters.tag) { conditions.push(`tags::jsonb ? $${paramIdx++}`); params.push(filters.tag); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT id, title, slug, status, meta_title, meta_description, tags, created_at, updated_at
       FROM public.cms_pages ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx}`,
      [...params, filters.limit],
    );
    return result.rows;
  },

  async getPageBySlug(slug: string) {
    return queryOne(`SELECT * FROM public.cms_pages WHERE slug = $1`, [slug]);
  },

  async getPageById(pageId: string) {
    return queryOne(`SELECT * FROM public.cms_pages WHERE id = $1`, [pageId]);
  },

  async updatePage(pageId: string, data: Record<string, unknown>) {
    // Matches updatePageSchema: title, content, meta_title, meta_description, status, tags.
    // tags is JSONB — pre-serialise the array to a JSON string.
    const ALLOWED_FIELDS = ['title', 'content', 'meta_title', 'meta_description', 'status', 'tags'] as const;
    const normalized: Record<string, unknown> = { ...data };
    if (Array.isArray(normalized.tags)) {
      normalized.tags = JSON.stringify(normalized.tags);
    }
    const { setClause, values } = buildUpdateSet(normalized, ALLOWED_FIELDS);
    try {
      return await queryOne(
        `UPDATE public.cms_pages SET ${setClause}, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [pageId, ...values],
      );
    } catch (e) { mapPgError(e); }
  },

  async deletePage(pageId: string) {
    try {
      return await queryOne(`DELETE FROM public.cms_pages WHERE id = $1 RETURNING *`, [pageId]);
    } catch (e) { mapPgError(e); }
  },

  // ── Contact Leads ──
  async createContact(data: {
    firstName: string; emailAddress: string; inquiryType: string; messageBody: string;
  }) {
    try {
      return await queryOne(
        `INSERT INTO public.contact_leads (first_name, email_address, inquiry_type, message_body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [data.firstName, data.emailAddress, data.inquiryType, data.messageBody],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Newsletter ──
  async subscribeNewsletter(emailAddress: string) {
    try {
      return await queryOne(
        `INSERT INTO public.newsletter_subscribers (email_address, is_active)
         VALUES ($1, TRUE)
         ON CONFLICT (email_address) DO UPDATE SET is_active = TRUE, updated_at = NOW()
         RETURNING id, is_active`,
        [emailAddress],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Planner ──
  async createPlannerEvent(userId: string, eventName: string, eventDate: string) {
    try {
      return await queryOne(
        `INSERT INTO public.planner_events (user_id, event_name, event_date)
         VALUES ($1, $2, $3) RETURNING *`,
        [userId, eventName, eventDate],
      );
    } catch (e) { mapPgError(e); }
  },

  async createDefaultTasks(plannerEventId: string) {
    const defaultTasks = [
      'Book venue', 'Finalize guest list', 'Book makeup artist',
      'Book photographer', 'Arrange decorations', 'Plan menu',
      'Send invitations', 'Final rehearsal',
    ];
    const results = [];
    for (let i = 0; i < defaultTasks.length; i++) {
      try {
        const row = await queryOne(
          `INSERT INTO public.planner_tasks (planner_event_id, title, sort_order, is_completed)
           VALUES ($1, $2, $3, FALSE) RETURNING *`,
          [plannerEventId, defaultTasks[i], i + 1],
        );
        results.push(row);
      } catch (e) { mapPgError(e); }
    }
    return results;
  },

  async getPlannerTasks(plannerEventId: string) {
    const result = await query(
      `SELECT * FROM public.planner_tasks WHERE planner_event_id = $1 ORDER BY sort_order`,
      [plannerEventId],
    );
    return result.rows;
  },

  async toggleTask(taskId: string, isCompleted: boolean) {
    try {
      return await queryOne(
        `UPDATE public.planner_tasks SET is_completed = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [taskId, isCompleted],
      );
    } catch (e) { mapPgError(e); }
  },

  // ── Platform Callouts ──
  async listCallouts(context: string) {
    const result = await query<{
      id: string;
      context: string;
      key: string | null;
      icon: string;
      text: string;
      sort_order: number;
      is_active: boolean;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id, context, key, icon, text, sort_order, is_active, metadata
         FROM public.platform_callouts
        WHERE context = $1 AND is_active = TRUE
        ORDER BY sort_order ASC, created_at ASC`,
      [context],
    );
    return result.rows;
  },

  async createCallout(input: {
    context: string;
    key?: string | null;
    icon: string;
    text: string;
    sort_order: number;
    is_active: boolean;
    metadata?: Record<string, unknown>;
  }) {
    try {
      return await queryOne(
        `INSERT INTO public.platform_callouts (context, key, icon, text, sort_order, is_active, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, context, key, icon, text, sort_order, is_active, metadata, created_at, updated_at`,
        [input.context, input.key ?? null, input.icon, input.text, input.sort_order, input.is_active, input.metadata ?? {}],
      );
    } catch (e) { mapPgError(e); }
  },

  async updateCallout(id: string, patch: Record<string, unknown>) {
    const fields = ['context', 'key', 'icon', 'text', 'sort_order', 'is_active', 'metadata'];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(patch, f)) {
        values.push(patch[f]);
        sets.push(`${f} = $${values.length}`);
      }
    }
    if (!sets.length) return null;
    values.push(id);
    try {
      return await queryOne(
        `UPDATE public.platform_callouts
            SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${values.length}
          RETURNING id, context, key, icon, text, sort_order, is_active, metadata, created_at, updated_at`,
        values,
      );
    } catch (e) { mapPgError(e); }
  },

  async deleteCallout(id: string): Promise<boolean> {
    try {
      const result = await query(
        `DELETE FROM public.platform_callouts WHERE id = $1`,
        [id],
      );
      return (result.rowCount ?? 0) > 0;
    } catch (e) { mapPgError(e); }
  },

  async listTestimonials(limit: number) {
    try {
      const result = await query<{
        id: string; customer_name: string; customer_city: string;
        quote: string; rating: number;
        service_category_id: string | null; photo_url: string | null;
        sort_order: number; created_at: Date;
      }>(
        `SELECT id, customer_name, customer_city, quote, rating,
                service_category_id, photo_url, sort_order, created_at
           FROM public.customer_testimonials
          WHERE is_published = TRUE
          ORDER BY sort_order ASC, created_at DESC
          LIMIT $1`,
        [limit],
      );
      return result.rows;
    } catch (e) {
      mapPgError(e);
      // mapPgError throws — this return is unreachable but satisfies TS
      return [];
    }
  },
};
