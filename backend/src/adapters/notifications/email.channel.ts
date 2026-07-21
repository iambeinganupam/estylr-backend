// ─────────────────────────────────────────────────────────────────────────────
// Notification Email Channel — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Generic send(to, subject, html/text) for notification emails.
// This is a separate layer from email.provider.ts (which handles auth flows).
// Switch implementations via NOTIFICATION_EMAIL_PROVIDER env var.
// console → dev/test (logs to stdout)
// resend  → production (Resend HTTP API, no SDK dependency)
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '../../config/env';
import { ExternalServiceError } from '../../lib/errors';
import { logger } from '../../config/logger';

export interface EmailSendInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface INotificationEmailChannel {
  send(input: EmailSendInput): Promise<{ providerId?: string }>;
}

// ── Console implementation ───────────────────────────────────────────────────

export class ConsoleNotificationEmailChannel implements INotificationEmailChannel {
  async send(input: EmailSendInput): Promise<{ providerId?: string }> {
    logger.info({ to: input.to, subject: input.subject }, '[email:console]');
    logger.info({ body: input.text ?? input.html?.replace(/<[^>]+>/g, '') }, '[email:console] body');
    return { providerId: undefined };
  }
}

// ── Resend implementation ────────────────────────────────────────────────────

export class ResendNotificationEmailChannel implements INotificationEmailChannel {
  private endpoint = 'https://api.resend.com/emails';

  async send(input: EmailSendInput): Promise<{ providerId?: string }> {
    if (!env.NOTIFICATION_RESEND_API_KEY) {
      throw new ExternalServiceError({ provider: 'resend', message: 'NOTIFICATION_RESEND_API_KEY not set' });
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NOTIFICATION_RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM_ADDRESS,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new ExternalServiceError({ provider: 'resend', status: res.status, body: errBody });
    }
    const data = await res.json() as { id?: string };
    return { providerId: data.id };
  }
}
