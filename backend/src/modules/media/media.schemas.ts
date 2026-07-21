// Schemas live in @kshuri/contracts now — see packages/contracts/src/media.ts.
// This shim keeps existing intra-backend imports working.
export {
  mediaUploadSchema,
  mediaUpdateSchema,
  mediaListQuerySchema,
  mediaIdParam,
} from '@kshuri/contracts/media';
