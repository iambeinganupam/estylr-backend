import { z } from 'zod';
import { USER_ROLE } from '../../lib/constants';

export const kycActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  target_type: z.enum(['freelancer', 'salon']),
  reason: z.string().max(500).optional(),
}).superRefine((data, ctx) => {
  if (data.action === 'reject' && !data.reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reason is required when action is reject',
      path: ['reason'],
    });
  }
});

export const userStatusUpdateSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned']),
  reason: z.string().max(500).optional(),
});

export const usersListSchema = z.object({
  role: z.enum([
    USER_ROLE.CUSTOMER,
    USER_ROLE.FREELANCER,
    USER_ROLE.BUSINESS_ADMIN,
    USER_ROLE.STAFF,
    USER_ROLE.EVENT_MANAGER,
    USER_ROLE.SUPER_ADMIN,
  ]).optional(),
  is_active: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Category schemas (createCategorySchema / updateCategorySchema /
// categoryIdParam) were relocated to the admin-categories module on
// 2026-05-29 alongside the controller routes. The new module's schemas
// supersede them with audience + slug + dependents-guard support.

export const kycTargetIdParam = z.object({
  id: z.string().uuid('Invalid target ID'),
});

export const userIdParam = z.object({
  id: z.string().uuid('Invalid user ID'),
});
