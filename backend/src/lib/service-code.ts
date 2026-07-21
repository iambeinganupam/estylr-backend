import { randomInt } from 'node:crypto';

/**
 * Generate a 6-digit Rapido-style booking service code.
 * Rerolls if the candidate matches a trivially weak pattern.
 */
export function generateServiceCode(): string {
  let candidate: string;
  do {
    candidate = String(randomInt(0, 1_000_000)).padStart(6, '0');
  } while (isWeakServiceCode(candidate));
  return candidate;
}

/**
 * Reject codes that any attacker would guess first:
 *   - all-same digits (000000, 111111, ...)
 *   - strict ascending or descending runs (123456, 654321, 012345, ...)
 */
export function isWeakServiceCode(code: string): boolean {
  if (!/^\d{6}$/.test(code)) return true;
  if (/^(\d)\1{5}$/.test(code)) return true;

  const digits = code.split('').map(Number);
  const isAscending = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const isDescending = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  return isAscending || isDescending;
}
