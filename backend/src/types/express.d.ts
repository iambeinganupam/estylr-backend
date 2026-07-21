// ─────────────────────────────────────────────────────────────────────────────
// Express Type Augmentation
// ─────────────────────────────────────────────────────────────────────────────
// Augments Express Request with auth and tenant context.
// These are injected by middleware and available in all route handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { UserRole, VendorType } from '../lib/constants';

declare global {
  namespace Express {
    interface Request {
      /** Injected by auth middleware after JWT verification */
      auth?: {
        userId: string;
        role: UserRole;
        tenantId: string;       // freelancer_profiles.id or business_accounts.id
        vendorType?: VendorType; // resolved from role
        profileId: string;      // customer_profiles.id, freelancer_profiles.id, etc.
        tokenVersion: number;   // refresh_token_version from JWT
      };

      /** Injected by tenant middleware for B2B routes */
      tenant?: {
        businessId?: string;
        locationId?: string;
        freelancerProfileId?: string;
        /** Denormalized plan code from freelancer_profiles / business_accounts; falls back to 'pay_as_you_go' */
        currentPlanCode?: string;
      };

      /** Request correlation ID for logging */
      requestId?: string;
    }
  }
}

export {};
