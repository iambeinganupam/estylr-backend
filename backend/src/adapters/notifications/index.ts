// ─────────────────────────────────────────────────────────────────────────────
// Notification Adapter Factory
// ─────────────────────────────────────────────────────────────────────────────
// getEmailChannel() / getPushChannel() are singletons per process.
// __resetNotificationChannels() is provided for test isolation.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '../../config/env';
import { ExpoPushChannel, ConsolePushChannel, FcmPushChannel } from './push.channel';
import { ConsoleNotificationEmailChannel, ResendNotificationEmailChannel } from './email.channel';
import type { INotificationPushChannel } from './push.channel';
import type { INotificationEmailChannel } from './email.channel';

let pushCache: INotificationPushChannel | null = null;
let emailCache: INotificationEmailChannel | null = null;

export function getPushChannel(): INotificationPushChannel {
  if (pushCache) return pushCache;
  switch (env.NOTIFICATION_PUSH_PROVIDER) {
    case 'expo':    pushCache = new ExpoPushChannel(); break;
    case 'fcm':     pushCache = new FcmPushChannel();  break;
    case 'console':
    default:        pushCache = new ConsolePushChannel(); break;
  }
  return pushCache!;
}

export function getEmailChannel(): INotificationEmailChannel {
  if (emailCache) return emailCache;
  switch (env.NOTIFICATION_EMAIL_PROVIDER) {
    case 'resend': emailCache = new ResendNotificationEmailChannel(); break;
    case 'console':
    default:       emailCache = new ConsoleNotificationEmailChannel(); break;
  }
  return emailCache!;
}

/** Reset cached channel singletons. Call in afterEach/beforeEach for test isolation. */
export function __resetNotificationChannels(): void {
  pushCache = null;
  emailCache = null;
}

export type { INotificationPushChannel, PushSendInput, PushSendResult } from './push.channel';
export type { INotificationEmailChannel, EmailSendInput } from './email.channel';
export { renderTemplate, type NotificationType, type RenderedTemplate } from './templates';
