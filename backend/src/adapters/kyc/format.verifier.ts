import type { IKycVerifier, KycVerifyInput, KycCheckResult } from './kyc.types';

const AADHAAR_RE = /^\d{12}$/;
const PAN_RE     = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export class FormatVerifier implements IKycVerifier {
  name = 'format';
  supports(): boolean { return true; }
  async verify(input: KycVerifyInput): Promise<KycCheckResult[]> {
    if (input.docType === 'aadhaar') {
      const ok = AADHAAR_RE.test(input.documentNumber);
      return [{ check: 'format', passed: ok, score: ok ? 1 : 0, detail: ok ? undefined : 'aadhaar must be exactly 12 digits' }];
    }
    const ok = PAN_RE.test(input.documentNumber.toUpperCase());
    return [{ check: 'format', passed: ok, score: ok ? 1 : 0, detail: ok ? undefined : 'pan must match [A-Z]{5}[0-9]{4}[A-Z]' }];
  }
}
