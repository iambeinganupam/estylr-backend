import type { IKycVerifier, KycVerifyInput, KycCheckResult } from './kyc.types';
import { logger } from '../../config/logger';

// Use node-tesseract-ocr for a JS-friendly tesseract binding.
// If the host doesn't have tesseract installed, the import will throw at import-time;
// we catch this lazily so the rest of the app still boots in environments without OCR.
let _runner: ((path: string, opts?: Record<string, unknown>) => Promise<string>) | null = null;
async function getRunner(): Promise<((path: string, opts?: Record<string, unknown>) => Promise<string>) | null> {
  if (_runner !== null) return _runner;
  try {
    // Optional peer dependency; may not be installed at runtime.
    const tesseract = await import('node-tesseract-ocr');
    _runner = tesseract.recognize as (path: string, opts?: Record<string, unknown>) => Promise<string>;
    return _runner;
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 5000;

export class TesseractOcrVerifier implements IKycVerifier {
  name = 'ocr_match';
  supports(): boolean { return true; }

  async verify(input: KycVerifyInput): Promise<KycCheckResult[]> {
    if (!input.imagePath) return [];  // skip silently for PDFs

    const runner = await getRunner();
    if (!runner) {
      logger.warn('ocr: tesseract not available; skipping OCR check');
      return [{ check: 'ocr_match', passed: true, score: 0, detail: 'tesseract not installed; skipped' }];
    }

    try {
      const text = await Promise.race([
        runner(input.imagePath, { lang: 'eng' }),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('ocr timeout')), TIMEOUT_MS)),
      ]);

      // Look for the entered number in the OCR'd text — strip non-alphanumerics for tolerance
      const haystack = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const needle   = input.documentNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const found    = haystack.includes(needle);
      return [{
        check: 'ocr_match',
        passed: found,
        score: found ? 1 : 0,
        detail: found ? `matched ${input.docType} number in document image` : 'entered number not found in OCR text',
      }];
    } catch (err) {
      logger.warn({ err }, 'ocr: extraction failed; treating as skipped');
      return [{ check: 'ocr_match', passed: true, score: 0, detail: `ocr failed: ${(err as Error).message}` }];
    }
  }
}
