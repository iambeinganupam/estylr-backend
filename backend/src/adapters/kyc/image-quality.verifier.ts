import type { IKycVerifier, KycVerifyInput, KycCheckResult } from './kyc.types';
import { logger } from '../../config/logger';
import fs from 'node:fs/promises';

const MIN_WIDTH  = 600;
const MIN_HEIGHT = 400;
const MIN_BYTES  = 30 * 1024;

async function loadSharp(): Promise<{ default: (path: string) => { metadata(): Promise<{ width?: number; height?: number }> } } | null> {
  try {
    // Optional peer dependency; may not be installed at runtime.
    return await import('sharp');
  } catch {
    return null;
  }
}

export class ImageQualityVerifier implements IKycVerifier {
  name = 'image_quality';
  supports(): boolean { return true; }

  async verify(input: KycVerifyInput): Promise<KycCheckResult[]> {
    if (!input.imagePath) return [];

    const results: KycCheckResult[] = [];
    try {
      const stat = await fs.stat(input.imagePath);
      results.push({
        check: 'image_min_size',
        passed: stat.size >= MIN_BYTES,
        score: Math.min(1, stat.size / (4 * MIN_BYTES)),
        detail: `file is ${(stat.size / 1024).toFixed(1)} KB (min ${MIN_BYTES / 1024} KB)`,
      });
    } catch (err) {
      return [{ check: 'image_quality', passed: false, score: 0, detail: `stat failed: ${(err as Error).message}` }];
    }

    const sharp = await loadSharp();
    if (!sharp) {
      logger.warn('image-quality: sharp not available; skipping dimension check');
      return results;
    }
    try {
      const meta = await sharp.default(input.imagePath).metadata();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;
      results.push({
        check: 'image_min_dimensions',
        passed: w >= MIN_WIDTH && h >= MIN_HEIGHT,
        score: Math.min(1, (w * h) / (MIN_WIDTH * MIN_HEIGHT)),
        detail: `${w}x${h} (min ${MIN_WIDTH}x${MIN_HEIGHT})`,
      });
    } catch (err) {
      logger.warn({ err }, 'image-quality: sharp metadata failed');
    }
    return results;
  }
}
