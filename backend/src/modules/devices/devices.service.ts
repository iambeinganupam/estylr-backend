// ─────────────────────────────────────────────────────────────────────────────
// Devices Module — Service
// ─────────────────────────────────────────────────────────────────────────────

import * as repo from './devices.repository';

export async function registerDevice(args: {
  userId: string;
  expoPushToken: string;
  audience: string;
  platform: string;
  deviceName?: string;
  appVersion?: string;
}): Promise<repo.DeviceRow> {
  return repo.upsertDevice(args);
}

export async function unregisterDevice(
  userId: string,
  expoPushToken: string,
): Promise<void> {
  await repo.deactivateDevice(userId, expoPushToken);
}

export async function listActiveTokens(
  userId: string,
  audience?: string,
): Promise<string[]> {
  return repo.listActiveTokensForUser(userId, audience);
}
