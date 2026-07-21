import { eventManagerRepository } from './event-manager.repository';
import { ResourceNotFoundError } from '../../lib/errors';

async function ensureEvent(userId: string, eventId: string) {
  const event = await eventManagerRepository.findById(eventId, userId);
  if (!event) throw new ResourceNotFoundError('Event');
  return event;
}

export const eventManagerService = {
  // ── Events ─────────────────────────────────────────────────────────────────
  createEvent: (userId: string, data: Parameters<typeof eventManagerRepository.create>[1]) =>
    eventManagerRepository.create(userId, data),

  listMyEvents: (userId: string) => eventManagerRepository.listByManager(userId),

  async getEvent(userId: string, eventId: string) {
    const event = await eventManagerRepository.findDetail(eventId, userId);
    if (!event) throw new ResourceNotFoundError('Event');
    return event;
  },

  async updateEvent(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const updated = await eventManagerRepository.update(eventId, userId, data);
    if (!updated) throw new ResourceNotFoundError('Event');
    return updated;
  },

  async deleteEvent(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    const deleted = await eventManagerRepository.deleteEvent(eventId, userId);
    if (!deleted) throw new ResourceNotFoundError('Event');
  },

  // ── Freelancer search & hires ─────────────────────────────────────────────
  async searchFreelancers(userId: string, eventId: string, filters: { city?: string; limit: number }) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.searchFreelancers(eventId, filters);
  },

  async hireFreelancer(userId: string, eventId: string, freelancerId: string, agreedRate?: number, notes?: string) {
    await ensureEvent(userId, eventId);
    const hire = await eventManagerRepository.hire(eventId, freelancerId, agreedRate, notes);
    if (!hire) throw new ResourceNotFoundError('Hire record');
    return hire;
  },

  async updateHireStatus(userId: string, eventId: string, hireId: string, status: string, notes?: string) {
    await ensureEvent(userId, eventId);
    const hire = await eventManagerRepository.updateHireStatus(hireId, eventId, status, notes);
    if (!hire) throw new ResourceNotFoundError('Hire record');
    return hire;
  },

  // ── Marketplace ────────────────────────────────────────────────────────────
  searchMarketplaceVendors: (filters: Parameters<typeof eventManagerRepository.searchMarketplaceVendors>[0]) =>
    eventManagerRepository.searchMarketplaceVendors(filters),

  // ── Vendors ────────────────────────────────────────────────────────────────
  async listVendors(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.vendors.list(eventId);
  },
  async createVendor(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.vendors.create(eventId, data);
  },
  async updateVendor(userId: string, eventId: string, vendorId: string, fields: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const updated = await eventManagerRepository.vendors.update(eventId, vendorId, fields);
    if (!updated) throw new ResourceNotFoundError('Vendor');
    return updated;
  },
  async removeVendor(userId: string, eventId: string, vendorId: string) {
    await ensureEvent(userId, eventId);
    const r = await eventManagerRepository.vendors.remove(eventId, vendorId);
    if (!r) throw new ResourceNotFoundError('Vendor');
  },

  // ── Guests ─────────────────────────────────────────────────────────────────
  async listGuests(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.guests.list(eventId);
  },
  async createGuest(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.guests.create(eventId, data);
  },
  async updateGuest(userId: string, eventId: string, guestId: string, fields: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const updated = await eventManagerRepository.guests.update(eventId, guestId, fields);
    if (!updated) throw new ResourceNotFoundError('Guest');
    return updated;
  },
  async removeGuest(userId: string, eventId: string, guestId: string) {
    await ensureEvent(userId, eventId);
    const r = await eventManagerRepository.guests.remove(eventId, guestId);
    if (!r) throw new ResourceNotFoundError('Guest');
  },

  // ── Budget items ───────────────────────────────────────────────────────────
  async listBudgetItems(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.budgetItems.list(eventId);
  },
  async createBudgetItem(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.budgetItems.create(eventId, data);
  },
  async updateBudgetItem(userId: string, eventId: string, itemId: string, fields: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const updated = await eventManagerRepository.budgetItems.update(eventId, itemId, fields);
    if (!updated) throw new ResourceNotFoundError('Budget item');
    return updated;
  },
  async removeBudgetItem(userId: string, eventId: string, itemId: string) {
    await ensureEvent(userId, eventId);
    const r = await eventManagerRepository.budgetItems.remove(eventId, itemId);
    if (!r) throw new ResourceNotFoundError('Budget item');
  },

  // ── Tasks ──────────────────────────────────────────────────────────────────
  async listTasks(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.tasks.list(eventId);
  },
  async createTask(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.tasks.create(eventId, data);
  },
  async updateTask(userId: string, eventId: string, taskId: string, fields: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const updated = await eventManagerRepository.tasks.update(eventId, taskId, fields);
    if (!updated) throw new ResourceNotFoundError('Task');
    return updated;
  },
  async removeTask(userId: string, eventId: string, taskId: string) {
    await ensureEvent(userId, eventId);
    const r = await eventManagerRepository.tasks.remove(eventId, taskId);
    if (!r) throw new ResourceNotFoundError('Task');
  },

  // ── Payments ───────────────────────────────────────────────────────────────
  async listPayments(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.payments.list(eventId);
  },
  async createPayment(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.payments.create(eventId, data);
  },
  async updatePayment(userId: string, eventId: string, paymentId: string, fields: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const updated = await eventManagerRepository.payments.update(eventId, paymentId, fields);
    if (!updated) throw new ResourceNotFoundError('Payment');
    return updated;
  },
  async removePayment(userId: string, eventId: string, paymentId: string) {
    await ensureEvent(userId, eventId);
    const r = await eventManagerRepository.payments.remove(eventId, paymentId);
    if (!r) throw new ResourceNotFoundError('Payment');
  },

  // ── Transactions ───────────────────────────────────────────────────────────
  async listTransactions(userId: string, eventId: string) {
    await ensureEvent(userId, eventId);
    return eventManagerRepository.transactions.list(eventId);
  },
  async recordTransaction(userId: string, eventId: string, data: Record<string, unknown>) {
    await ensureEvent(userId, eventId);
    const tx = await eventManagerRepository.transactions.create(eventId, data);

    // Best-effort payment rollup: if the transaction completes against a payment,
    // bump its paid_amount and recompute status.
    if (tx && data.payment_id && data.status !== 'failed') {
      const payment = await eventManagerRepository.payments.findById(eventId, String(data.payment_id));
      if (payment) {
        const newPaid = Number(payment.paid_amount ?? 0) + Number(data.amount ?? 0);
        const total = Number(payment.amount ?? 0);
        const status =
          newPaid >= total ? 'paid' :
          newPaid > 0      ? 'partial' :
          payment.status;
        await eventManagerRepository.payments.update(eventId, String(data.payment_id), {
          paid_amount: newPaid,
          status,
          paid_date: status === 'paid' ? (data.tx_date as string) : payment.paid_date,
        });
      }
    }
    return tx;
  },

  // ── Portfolio ──────────────────────────────────────────────────────────────
  getPortfolio: (userId: string) => eventManagerRepository.portfolio.findByUser(userId),
  upsertPortfolio: (userId: string, data: Record<string, unknown>) =>
    eventManagerRepository.portfolio.upsert(userId, data),

  // ── Templates ──────────────────────────────────────────────────────────────
  listTemplates:  (userId: string) => eventManagerRepository.templates.list(userId),
  createTemplate: (userId: string, data: Record<string, unknown>) =>
    eventManagerRepository.templates.create(userId, data),
  async updateTemplate(userId: string, templateId: string, fields: Record<string, unknown>) {
    const updated = await eventManagerRepository.templates.update(userId, templateId, fields);
    if (!updated) throw new ResourceNotFoundError('Template');
    return updated;
  },
  async removeTemplate(userId: string, templateId: string) {
    const r = await eventManagerRepository.templates.remove(userId, templateId);
    if (!r) throw new ResourceNotFoundError('Template');
  },

  // ── Communications ─────────────────────────────────────────────────────────
  listCommunications: (userId: string, filters: { event_id?: string; thread_key?: string; limit: number }) =>
    eventManagerRepository.communications.list(userId, filters),
  postCommunication: (userId: string, data: Record<string, unknown>) =>
    eventManagerRepository.communications.create(userId, {
      direction: 'outbound',
      ...data,
    }),

  // ── Analytics ──────────────────────────────────────────────────────────────
  analyticsSummary: (userId: string) => eventManagerRepository.analyticsSummary(userId),
};
