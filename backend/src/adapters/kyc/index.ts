import { env } from '../../config/env';
import type { IKycVerifier } from './kyc.types';
import { FormatVerifier } from './format.verifier';
import { ChecksumVerifier } from './checksum.verifier';
import { TesseractOcrVerifier } from './ocr.verifier';
import { ImageQualityVerifier } from './image-quality.verifier';
import { KarzaVerifier, DigilockerVerifier } from './remote.verifier';

export function getKycVerifiers(): IKycVerifier[] {
  const list: IKycVerifier[] = [
    new FormatVerifier(),
    new ChecksumVerifier(),
  ];
  if (env.KYC_OCR_ENABLED) list.push(new TesseractOcrVerifier());
  if (env.KYC_IMAGE_QUALITY_ENABLED) list.push(new ImageQualityVerifier());
  if (env.KYC_REMOTE_PROVIDER === 'karza') list.push(new KarzaVerifier());
  if (env.KYC_REMOTE_PROVIDER === 'digilocker') list.push(new DigilockerVerifier());
  return list;
}

export function aggregateConfidence(results: { passed: boolean; check: string }[]): 'high' | 'medium' | 'low' {
  if (results.length === 0) return 'low';
  const formatPassed   = results.find((r) => r.check === 'format')?.passed   ?? false;
  const checksumPassed = results.find((r) => r.check === 'checksum')?.passed ?? false;
  if (!formatPassed || !checksumPassed) return 'low';
  const allPassed = results.every((r) => r.passed);
  return allPassed ? 'high' : 'medium';
}

export type { IKycVerifier, KycCheckResult, KycVerifyInput } from './kyc.types';
