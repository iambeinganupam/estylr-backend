export interface KycCheckResult {
  check: string;
  passed: boolean;
  score: number;       // 0..1
  detail?: string;
}

export interface KycVerifyInput {
  docType: 'aadhaar' | 'pan';
  documentNumber: string;
  imagePath?: string;   // local FS path to the image; undefined for PDFs in v1
  mimeType?: string;
}

export interface IKycVerifier {
  name: string;
  supports(docType: 'aadhaar' | 'pan'): boolean;
  verify(input: KycVerifyInput): Promise<KycCheckResult[]>;
}
