// ─────────────────────────────────────────────────────────────────────────────
// Push Notification Channel — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Switch implementations via NOTIFICATION_PUSH_PROVIDER env var.
// console → dev/test (logs to stdout, no network calls)
// expo    → production (Expo Push Notification Service)
// fcm     → stub (not yet implemented)
// ─────────────────────────────────────────────────────────────────────────────

import { ExternalServiceError } from '../../lib/errors';
import { logger } from '../../config/logger';

export interface PushSendInput {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSendResult {
  delivered: number;
  failed: { token: string; error: string }[];
}

export interface INotificationPushChannel {
  send(input: PushSendInput): Promise<PushSendResult>;
}

// ── Expo implementation ──────────────────────────────────────────────────────

export class ExpoPushChannel implements INotificationPushChannel {
  private endpoint = 'https://exp.host/--/api/v2/push/send';

  async send(input: PushSendInput): Promise<PushSendResult> {
    if (input.tokens.length === 0) return { delivered: 0, failed: [] };

    const messages = input.tokens.map((to) => ({
      to,
      sound: 'default',
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    }));

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) throw new ExternalServiceError({ provider: 'expo-push', status: res.status });

      const responseBody = await res.json() as { data?: Array<{ status: 'ok' | 'error'; message?: string }> };
      const tickets = responseBody.data ?? [];
      const failed = tickets
        .map((t, i) => t.status === 'error' ? { token: input.tokens[i]!, error: t.message ?? 'unknown' } : null)
        .filter((x): x is { token: string; error: string } => x !== null);
      return { delivered: tickets.length - failed.length, failed };
    } catch (err) {
      logger.warn({ err }, 'expo push send failed');
      return { delivered: 0, failed: input.tokens.map((t) => ({ token: t, error: (err as Error).message })) };
    }
  }
}

// ── Console implementation ───────────────────────────────────────────────────

export class ConsolePushChannel implements INotificationPushChannel {
  async send(input: PushSendInput): Promise<PushSendResult> {
    for (const token of input.tokens) {
      logger.info({ token, title: input.title, body: input.body, data: input.data }, '[push:console]');
    }
    return { delivered: input.tokens.length, failed: [] };
  }
}

// ── FCM stub ─────────────────────────────────────────────────────────────────

export class FcmPushChannel implements INotificationPushChannel {
  async send(): Promise<PushSendResult> {
    throw new ExternalServiceError({ provider: 'fcm', message: 'FcmPushChannel not implemented; use expo or console' });
  }
}
