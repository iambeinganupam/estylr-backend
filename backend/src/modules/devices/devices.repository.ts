// ─────────────────────────────────────────────────────────────────────────────
// Devices Module — Repository
// ─────────────────────────────────────────────────────────────────────────────

import { query, queryOne } from '../../config/database';

export interface DeviceRow {
  id: string;
  user_id: string;
  expo_push_token: string;
  audience: string;
  platform: string;
  device_name: string | null;
  app_version: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface UpsertDeviceArgs {
  userId: string;
  expoPushToken: string;
  audience: string;
  platform: string;
  deviceName?: string;
  appVersion?: string;
}

/**
 * Upsert by `expo_push_token`. If the same token re-registers for a
 * different user (rare — shared device), the latest user wins and the
 * previous binding is reset (refresh-token-version stays put on users).
 */
export async function upsertDevice(args: UpsertDeviceArgs): Promise<DeviceRow> {
  const row = await queryOne<DeviceRow>(
    `INSERT INTO public.devices
       (user_id, expo_push_token, audience, platform, device_name, app_version, is_active, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, now())
     ON CONFLICT (expo_push_token) DO UPDATE SET
       user_id      = EXCLUDED.user_id,
       audience     = EXCLUDED.audience,
       platform     = EXCLUDED.platform,
       device_name  = EXCLUDED.device_name,
       app_version  = EXCLUDED.app_version,
       is_active    = true,
       updated_at   = now(),
       last_seen_at = now()
     RETURNING *`,
    [
      args.userId,
      args.expoPushToken,
      args.audience,
      args.platform,
      args.deviceName ?? null,
      args.appVersion ?? null,
    ],
  );
  if (!row) throw new Error('Failed to upsert device');
  return row;
}

export async function deactivateDevice(
  userId: string,
  expoPushToken: string,
): Promise<void> {
  await query(
    `UPDATE public.devices
       SET is_active = false, updated_at = now()
       WHERE user_id = $1 AND expo_push_token = $2`,
    [userId, expoPushToken],
  );
}

export async function listActiveTokensForUser(
  userId: string,
  audience?: string,
): Promise<string[]> {
  const result = audience
    ? await query<{ expo_push_token: string }>(
        `SELECT expo_push_token FROM public.devices
           WHERE user_id = $1 AND audience = $2 AND is_active = true`,
        [userId, audience],
      )
    : await query<{ expo_push_token: string }>(
        `SELECT expo_push_token FROM public.devices
           WHERE user_id = $1 AND is_active = true`,
        [userId],
      );
  return result.rows.map((r) => r.expo_push_token);
}
