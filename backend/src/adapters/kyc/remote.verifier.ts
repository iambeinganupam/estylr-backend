import type { IKycVerifier, KycVerifyInput, KycCheckResult } from './kyc.types';
import { ExternalServiceError } from '../../lib/errors';

export class KarzaVerifier implements IKycVerifier {
  name = 'karza_remote';
  supports(): boolean { return true; }
  async verify(_input: KycVerifyInput): Promise<KycCheckResult[]> {
    throw new ExternalServiceError({ provider: 'karza', message: 'KarzaVerifier not implemented; set KYC_REMOTE_PROVIDER=none' });
  }
}

export class DigilockerVerifier implements IKycVerifier {
  name = 'digilocker_remote';
  supports(): boolean { return true; }
  async verify(_input: KycVerifyInput): Promise<KycCheckResult[]> {
    throw new ExternalServiceError({ provider: 'digilocker', message: 'DigilockerVerifier not implemented; set KYC_REMOTE_PROVIDER=none' });
  }
}
