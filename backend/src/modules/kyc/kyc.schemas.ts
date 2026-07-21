// Schemas live in @kshuri/contracts now — see packages/contracts/src/kyc.ts.
// This shim keeps existing intra-backend imports working.
export {
  submitKycSchema,
  kycDecisionSchema,
  kycIdParam,
} from '@kshuri/contracts/kyc';
