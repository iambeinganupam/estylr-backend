// ─────────────────────────────────────────────────────────────────────────────
// CMS Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import { cmsRepository } from './cms.repository';
import { ResourceNotFoundError } from '../../lib/errors';

export const cmsService = {
  async listPages(filters: { status?: string; tag?: string; limit: number }) {
    return cmsRepository.listPages(filters);
  },

  async getPageBySlug(slug: string) {
    const page = await cmsRepository.getPageBySlug(slug);
    if (!page) throw new ResourceNotFoundError('Page');
    return page;
  },

  async createPage(data: {
    title: string; slug: string; content: string; status: string;
    meta_title?: string; meta_description?: string; tags?: string[];
    authorId: string;
  }) {
    return cmsRepository.createPage({
      title: data.title, slug: data.slug, content: data.content, status: data.status,
      metaTitle: data.meta_title, metaDescription: data.meta_description,
      tags: data.tags, authorId: data.authorId,
    });
  },

  async updatePage(pageId: string, data: Record<string, unknown>) {
    const page = await cmsRepository.updatePage(pageId, data);
    if (!page) throw new ResourceNotFoundError('Page');
    return page;
  },

  async deletePage(pageId: string) {
    const deleted = await cmsRepository.deletePage(pageId);
    if (!deleted) throw new ResourceNotFoundError('Page');
  },

  async submitContact(data: {
    first_name: string; email_address: string; inquiry_type: string; message_body: string;
  }) {
    return cmsRepository.createContact({
      firstName: data.first_name, emailAddress: data.email_address,
      inquiryType: data.inquiry_type, messageBody: data.message_body,
    });
  },

  async subscribeNewsletter(emailAddress: string) {
    return cmsRepository.subscribeNewsletter(emailAddress);
  },

  async createPlannerEvent(userId: string, eventName: string, eventDate: string) {
    const event = await cmsRepository.createPlannerEvent(userId, eventName, eventDate);
    const tasks = await cmsRepository.createDefaultTasks(event!.id);
    return { event, tasks };
  },

  async getPlannerTasks(plannerEventId: string) {
    return cmsRepository.getPlannerTasks(plannerEventId);
  },

  async toggleTask(taskId: string, isCompleted: boolean) {
    const task = await cmsRepository.toggleTask(taskId, isCompleted);
    if (!task) throw new ResourceNotFoundError('Task');
    return task;
  },

  // ── Platform Callouts ──
  async listCallouts(context: string) {
    return cmsRepository.listCallouts(context);
  },

  async createCallout(input: Parameters<typeof cmsRepository.createCallout>[0]) {
    return cmsRepository.createCallout(input);
  },

  async updateCallout(id: string, patch: Record<string, unknown>) {
    const updated = await cmsRepository.updateCallout(id, patch);
    if (!updated) throw new ResourceNotFoundError('Callout');
    return updated;
  },

  async deleteCallout(id: string) {
    const ok = await cmsRepository.deleteCallout(id);
    if (!ok) throw new ResourceNotFoundError('Callout');
  },

  async listTestimonials(params: { limit: number }) {
    return cmsRepository.listTestimonials(params.limit);
  },
};
