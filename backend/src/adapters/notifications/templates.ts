// ─────────────────────────────────────────────────────────────────────────────
// Notification Templates — Typed per NotificationType
// ─────────────────────────────────────────────────────────────────────────────
// The REGISTRY is keyed on every NotificationType value. A missing template is
// a compile error (exhaustive Record<NotificationType, ...> enforces coverage).
// ─────────────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'booking_confirmed'
  | 'booking_cancelled'
  | 'booking_completed'
  | 'review_received'
  | 'payment_received'
  | 'payout_processed'
  | 'promotional'
  | 'system'
  | 'kyc_submitted'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'kyc_resubmit_requested'
  | 'message_received'
  | 'plan_activated'
  | 'plan_expired';

export interface RenderedTemplate {
  title: string;
  body: string;
  email_subject: string;
  email_html: string;
}

type TemplateRenderer = (data: Record<string, unknown>) => RenderedTemplate;

function basicEmail(subject: string, bodyText: string): { email_subject: string; email_html: string } {
  return {
    email_subject: subject,
    email_html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>${subject}</h2><p>${bodyText}</p><hr/><p style="color:#888;font-size:12px">Kshuri Platform</p></body></html>`,
  };
}

const REGISTRY: Record<NotificationType, TemplateRenderer> = {
  booking_confirmed: (d) => ({
    title: 'Booking confirmed',
    body: `Your booking #${d['appointment_id'] ?? ''} is confirmed.`,
    ...basicEmail('Booking confirmed', `Your booking #${d['appointment_id'] ?? ''} is confirmed.`),
  }),
  booking_cancelled: (d) => ({
    title: 'Booking cancelled',
    body: `Booking #${d['appointment_id'] ?? ''} was cancelled.`,
    ...basicEmail('Booking cancelled', `Booking #${d['appointment_id'] ?? ''} was cancelled.`),
  }),
  booking_completed: () => ({
    title: 'Booking completed',
    body: 'Hope you enjoyed your service. Leave a review!',
    ...basicEmail('Booking completed', 'Hope you enjoyed your service. Leave a review!'),
  }),
  review_received: (d) => ({
    title: 'New review',
    body: `You received a ${d['rating'] ?? ''}-star review.`,
    ...basicEmail('New review', `You received a ${d['rating'] ?? ''}-star review.`),
  }),
  payment_received: (d) => ({
    title: 'Payment received',
    body: `₹${d['amount'] ?? ''} received for booking #${d['appointment_id'] ?? ''}.`,
    ...basicEmail('Payment received', `₹${d['amount'] ?? ''} received for booking #${d['appointment_id'] ?? ''}.`),
  }),
  payout_processed: (d) => ({
    title: 'Payout processed',
    body: `Your payout of ₹${d['amount'] ?? ''} has been processed.`,
    ...basicEmail('Payout processed', `Your payout of ₹${d['amount'] ?? ''} has been processed.`),
  }),
  promotional: (d) => ({
    title: (d['title'] as string) ?? 'Special offer',
    body: (d['body'] as string) ?? '',
    ...basicEmail((d['title'] as string) ?? 'Special offer', (d['body'] as string) ?? ''),
  }),
  system: (d) => ({
    title: (d['title'] as string) ?? 'System notice',
    body: (d['body'] as string) ?? '',
    ...basicEmail((d['title'] as string) ?? 'System notice', (d['body'] as string) ?? ''),
  }),

  kyc_submitted: (d) => ({
    title: 'KYC submitted',
    body: `${d['vendor_name'] ?? 'Vendor'} submitted KYC documents — awaiting review.`,
    ...basicEmail('KYC submitted', `${d['vendor_name'] ?? 'Vendor'} submitted KYC documents — awaiting review.`),
  }),
  kyc_approved: () => ({
    title: 'KYC approved',
    body: 'Your KYC is approved. Welcome aboard!',
    ...basicEmail('KYC approved', 'Your KYC is approved. Welcome aboard!'),
  }),
  kyc_rejected: (d) => ({
    title: 'KYC rejected',
    body: `Reason: ${d['reason'] ?? 'see admin for details'}.`,
    ...basicEmail('KYC rejected', `Reason: ${d['reason'] ?? 'see admin for details'}.`),
  }),
  kyc_resubmit_requested: (d) => ({
    title: 'KYC re-submit requested',
    body: `Reason: ${d['reason'] ?? ''}. Please re-submit.`,
    ...basicEmail('KYC re-submit requested', `Reason: ${d['reason'] ?? ''}. Please re-submit.`),
  }),

  message_received: (d) => ({
    title: `New message from ${d['sender_name'] ?? 'someone'}`,
    body: (d['preview'] as string) ?? '',
    ...basicEmail(`New message from ${d['sender_name'] ?? 'someone'}`, (d['preview'] as string) ?? ''),
  }),

  plan_activated: (d) => ({
    title: 'Plan activated',
    body: `Your ${d['plan_name'] ?? ''} plan is active.`,
    ...basicEmail('Plan activated', `Your ${d['plan_name'] ?? ''} plan is active.`),
  }),
  plan_expired: (d) => ({
    title: 'Plan expired',
    body: `Your ${d['plan_name'] ?? ''} plan has expired. Renew to continue.`,
    ...basicEmail('Plan expired', `Your ${d['plan_name'] ?? ''} plan has expired. Renew to continue.`),
  }),
};

export function renderTemplate(
  type: NotificationType,
  data: Record<string, unknown> = {},
): RenderedTemplate {
  const renderer = REGISTRY[type];
  if (!renderer) throw new Error(`No template registered for notification type: ${type}`);
  return renderer(data);
}
