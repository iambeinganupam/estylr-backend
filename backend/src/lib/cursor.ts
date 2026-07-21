// ─────────────────────────────────────────────────────────────────────────────
// Opaque (score, id) cursor — base64url-encoded JSON
// ─────────────────────────────────────────────────────────────────────────────
// Used by /discovery/search and other seek-style pagination endpoints. The
// cursor stores the sort score of the last row in the previous page plus its
// id (as a tiebreaker), so the next query can resume via a (score, id) >|< seek.
//
// Opaque on purpose — callers should not parse or construct cursors by hand;
// always go through encodeCursor / decodeCursor.

import { z } from 'zod';

const cursorSchema = z.object({
  score: z.number().finite(),
  id:    z.string().uuid(),
});

export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(s: string | undefined | null): Cursor | null {
  if (!s) return null;
  let json: string;
  try {
    json = Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = cursorSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
