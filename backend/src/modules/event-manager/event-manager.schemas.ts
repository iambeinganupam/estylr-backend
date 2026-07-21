import { z } from 'zod';
import { MAX_PAGE_SIZE } from '../../lib/pagination';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const uuid = z.string().uuid('Must be a valid UUID');

// ── Shared venue address fields ───────────────────────────────────────────────
const venueAddressFields = {
  venue_address_line1: z.string().trim().max(255).optional(),
  venue_address_line2: z.string().trim().max(255).optional(),
  venue_city:          z.string().trim().max(100).optional(),
  venue_state:         z.string().trim().max(100).optional(),
  venue_postal_code:   z.string().trim().max(20).optional(),
  venue_country_code:  z.string().length(2).default('IN').optional(),
  venue_latitude:      z.number().gte(-90).lte(90).optional(),
  venue_longitude:     z.number().gte(-180).lte(180).optional(),
};

// ── Events ───────────────────────────────────────────────────────────────────
export const createManagedEventSchema = z.object({
  title: z.string().min(1).max(200),
  event_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD'),
  venue: z.string().max(500).optional(),
  total_budget: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
  client_name: z.string().max(200).optional(),
  client_contact: z.string().max(40).optional(),
  client_email: z.string().email().max(200).optional().or(z.literal('')),
  services: z.array(z.string().max(100)).optional(),
  ...venueAddressFields,
});

export const updateManagedEventSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  event_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
  venue: z.string().max(500).optional(),
  total_budget: z.number().min(0).optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(['planning', 'confirmed', 'completed', 'cancelled']).optional(),
  client_name: z.string().max(200).optional(),
  client_contact: z.string().max(40).optional(),
  client_email: z.string().email().max(200).optional().or(z.literal('')),
  services: z.array(z.string().max(100)).optional(),
  ...venueAddressFields,
});

// ── Freelancer hires (existing) ──────────────────────────────────────────────
export const hireFreelancerSchema = z.object({
  freelancer_id: uuid,
  agreed_rate: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const updateHireStatusSchema = z.object({
  status: z.enum(['confirmed', 'cancelled']),
  notes: z.string().max(500).optional(),
});

export const freelancerSearchSchema = z.object({
  city: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ── Vendors (per event) ──────────────────────────────────────────────────────
export const createEventVendorSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  subcategory: z.string().max(100).optional(),
  freelancer_id: uuid.optional(),
  rating: z.number().min(0).max(5).optional(),
  reviews_count: z.number().int().min(0).optional(),
  price: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  contact: z.string().max(200).optional(),
  verified: z.boolean().optional(),
  availability: z.string().max(100).optional(),
  status: z.enum(['shortlisted', 'confirmed', 'rejected']).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateEventVendorSchema = createEventVendorSchema.partial();

// ── Guests ───────────────────────────────────────────────────────────────────
export const createGuestSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200).optional().or(z.literal('')),
  phone: z.string().max(40).optional(),
  rsvp_status: z.enum(['pending', 'attending', 'declined']).optional(),
  dietary_restrictions: z.string().max(500).optional(),
  plus_one: z.boolean().optional(),
  category: z.enum(['family', 'friends', 'colleagues']).optional(),
  side: z.enum(['host', 'client', 'mutual']).optional(),
});

export const updateGuestSchema = createGuestSchema.partial();

// ── Budget items ─────────────────────────────────────────────────────────────
export const createBudgetItemSchema = z.object({
  category: z.string().min(1).max(100),
  item: z.string().min(1).max(200),
  budgeted_amount: z.number().min(0).default(0),
  actual_amount: z.number().min(0).optional(),
  status: z.enum(['pending', 'paid', 'overdue']).optional(),
  vendor_name: z.string().max(200).optional(),
  vendor_id: uuid.optional(),
});

export const updateBudgetItemSchema = createBudgetItemSchema.partial();

// ── Tasks ────────────────────────────────────────────────────────────────────
export const createTaskSchema = z.object({
  title: z.string().min(1).max(300),
  due_date: z.string().regex(dateRegex, 'Must be YYYY-MM-DD').optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  assignee: z.string().max(200).optional(),
  assigned_vendor_id: uuid.optional(),
  category: z.string().max(100).optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

// ── Payments ─────────────────────────────────────────────────────────────────
export const createPaymentSchema = z.object({
  vendor_id: uuid.optional(),
  vendor_name: z.string().min(1).max(200),
  amount: z.number().min(0),
  paid_amount: z.number().min(0).optional(),
  status: z.enum(['pending', 'partial', 'paid', 'overdue']).optional(),
  due_date: z.string().regex(dateRegex).optional(),
  paid_date: z.string().regex(dateRegex).optional(),
  category: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  related_budget_item_id: uuid.optional(),
});

export const updatePaymentSchema = createPaymentSchema.partial();

// ── Transactions ─────────────────────────────────────────────────────────────
export const createTransactionSchema = z.object({
  payment_id: uuid.optional(),
  vendor_id: uuid.optional(),
  vendor_name: z.string().min(1).max(200),
  amount: z.number(),
  tx_type: z.enum(['payment', 'refund', 'advance']).optional(),
  tx_method: z.enum(['cash', 'bank-transfer', 'upi', 'card', 'cheque']).optional(),
  status: z.enum(['completed', 'pending', 'failed']).optional(),
  tx_date: z.string().regex(dateRegex),
  reference: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

// ── Portfolio ────────────────────────────────────────────────────────────────
export const upsertPortfolioSchema = z.object({
  display_name: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  city: z.string().max(100).optional(),
  years_experience: z.number().int().min(0).max(80).optional(),
  starting_price: z.number().min(0).optional(),
  services: z.array(z.unknown()).optional(),
  gallery: z.array(z.unknown()).optional(),
  certifications: z.array(z.unknown()).optional(),
  specializations: z.array(z.unknown()).optional(),
  contact_email: z.string().email().max(200).optional().or(z.literal('')),
  contact_phone: z.string().max(40).optional(),
  data: z.record(z.unknown()).optional(),
});

// ── Templates ────────────────────────────────────────────────────────────────
export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  default_services: z.array(z.unknown()).optional(),
  default_tasks: z.array(z.unknown()).optional(),
  default_budget_items: z.array(z.unknown()).optional(),
});

export const updateTemplateSchema = createTemplateSchema.partial();

// ── Communications ───────────────────────────────────────────────────────────
export const createCommunicationSchema = z.object({
  event_id: uuid.optional(),
  thread_key: z.string().min(1).max(200),
  direction: z.enum(['inbound', 'outbound']).optional(),
  sender_name: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

export const communicationsQuerySchema = z.object({
  event_id: uuid.optional(),
  thread_key: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});

// ── Marketplace search (broad vendor discovery, not per-event) ───────────────
export const marketplaceVendorsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ── Params ───────────────────────────────────────────────────────────────────
export const eventIdParam = z.object({ id: uuid });
export const hireIdParam = z.object({ id: uuid, hireId: uuid });
export const vendorIdParam = z.object({ id: uuid, vendorId: uuid });
export const guestIdParam = z.object({ id: uuid, guestId: uuid });
export const itemIdParam = z.object({ id: uuid, itemId: uuid });
export const taskIdParam = z.object({ id: uuid, taskId: uuid });
export const paymentIdParam = z.object({ id: uuid, paymentId: uuid });
export const templateIdParam = z.object({ templateId: uuid });
