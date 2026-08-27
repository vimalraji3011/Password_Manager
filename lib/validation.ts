import { z } from 'zod';

/**
 * Every mutating endpoint validates through one of these schemas, so the API
 * and the forms share a single definition of "valid". `.trim()` doubles as
 * light input sanitisation; everything rendered back to the browser goes
 * through React escaping, so no HTML stripping is required.
 */

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be 128 characters or fewer');

const strongPassword = password
  .regex(/[a-z]/, 'Include at least one lowercase letter')
  .regex(/[A-Z]/, 'Include at least one uppercase letter')
  .regex(/\d/, 'Include at least one number');

const optionalUrl = z
  .string()
  .trim()
  .max(2048, 'URL is too long')
  .refine(
    (v) => {
      if (!v) return true;
      try {
        const parsed = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        return Boolean(parsed.hostname) && parsed.hostname.includes('.');
      } catch {
        return false;
      }
    },
    { message: 'Enter a valid URL (for example https://aws.amazon.com)' },
  )
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({ email });

export const verifyOtpSchema = z.object({
  email,
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const resetPasswordSchema = z
  .object({
    email,
    otp: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code'),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Organization name must be at least 2 characters')
    .max(80, 'Organization name must be 80 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(280, 'Description must be 280 characters or fewer')
    .optional(),
});

export const sourceSchema = z.object({
  organizationId: z.coerce.number().int().positive('Select an organization'),
  source: z
    .string()
    .trim()
    .min(2, 'Source name must be at least 2 characters')
    .max(80, 'Source name must be 80 characters or fewer'),
  username: z
    .string()
    .trim()
    .min(1, 'Username or email is required')
    .max(160, 'Username must be 160 characters or fewer'),
  password: z.string().min(1, 'Password is required').max(512, 'Password is too long'),
  url: optionalUrl.optional().default(''),
  notes: z.string().trim().max(1000, 'Notes must be 1000 characters or fewer').optional(),
});

/**
 * Edit payload: every field is optional, so a caller can correct just the
 * username without resending the rest. An omitted `password` specifically means
 * "leave the stored credential unchanged" — that is what lets someone fix a
 * typo in a URL without ever knowing the password.
 */
export const sourceUpdateSchema = sourceSchema.partial();

export const revealSchema = z.object({
  password: z.string().min(1, 'Enter your login password to continue'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid mobile number'),
});

export const adminResetUserSchema = z.object({
  userId: z.coerce.number().int().positive('Select a user'),
});

export const viewResetRequestSchema = z.object({
  reason: z.string().trim().max(500, 'Reason must be 500 characters or fewer').optional(),
});

export const decideRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

/** Flatten a ZodError into the `{ field: message }` shape the forms expect. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
