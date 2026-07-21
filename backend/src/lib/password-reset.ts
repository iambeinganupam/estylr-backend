import { randomBytes, createHash } from 'node:crypto';

/** 32-byte cryptographically random token, hex-encoded (64 chars). */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

/** Deterministic SHA-256 of the plaintext token, hex-encoded. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
