import type { IKycVerifier, KycVerifyInput, KycCheckResult } from './kyc.types';

// Verhoeff multiplication table
const D = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],
  [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],
  [7,0,4,6,9,1,3,2,5,8],
];

function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const arr = digits.split('').reverse();
  for (let i = 0; i < arr.length; i++) {
    const pRow = P[i % 8]!;
    const dRow = D[c]!;
    c = dRow[pRow[Number(arr[i])]!]!;
  }
  return c === 0;
}

const PAN_ENTITY_CODES = new Set(['P','F','C','H','A','T','B','L','J','G']);

export class ChecksumVerifier implements IKycVerifier {
  name = 'checksum';
  supports(): boolean { return true; }
  async verify(input: KycVerifyInput): Promise<KycCheckResult[]> {
    if (input.docType === 'aadhaar') {
      // Verhoeff is only meaningful when format passed; if length isn't 12, return a soft fail
      if (!/^\d{12}$/.test(input.documentNumber)) {
        return [{ check: 'checksum', passed: false, score: 0, detail: 'cannot run Verhoeff on malformed input' }];
      }
      const ok = verhoeffValid(input.documentNumber);
      return [{ check: 'checksum', passed: ok, score: ok ? 1 : 0, detail: ok ? undefined : 'verhoeff checksum invalid' }];
    }
    // PAN: 4th char identifies the entity type.
    const num = input.documentNumber.toUpperCase();
    if (num.length !== 10) {
      return [{ check: 'checksum', passed: false, score: 0, detail: 'cannot read PAN entity char on malformed input' }];
    }
    const entityChar = num[3] ?? '';
    const ok = PAN_ENTITY_CODES.has(entityChar);
    return [{ check: 'checksum', passed: ok, score: ok ? 1 : 0, detail: ok ? undefined : `unknown PAN entity code '${entityChar}'` }];
  }
}
