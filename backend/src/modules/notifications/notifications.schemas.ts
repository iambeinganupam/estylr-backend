// Schemas live in @kshuri/contracts now — see packages/contracts/src/notifications.ts.
// This shim keeps existing intra-backend imports working.
export {
  listNotificationsQuery,
  markReadSchema,
  updatePreferencesSchema,
} from '@kshuri/contracts/notifications';

export type {
  ListNotificationsQuery,
  MarkReadInput,
  UpdatePreferencesInput,
} from '@kshuri/contracts/notifications';
