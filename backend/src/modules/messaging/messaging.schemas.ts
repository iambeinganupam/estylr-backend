// Schemas live in @kshuri/contracts now — see packages/contracts/src/messaging.ts.
// This shim keeps existing intra-backend imports working.
export {
  createThreadSchema,
  sendMessageSchema,
  pollQuerySchema,
  markReadSchema,
  threadIdParam,
} from '@kshuri/contracts/messaging';

export type {
  CreateThreadInput,
  SendMessageInput,
  PollQuery,
  MarkReadInput,
} from '@kshuri/contracts/messaging';
