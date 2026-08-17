import { z } from "zod";

/**
 * Request shapes for `/api/auth/*`.
 *
 * Password *strength* is deliberately not expressed here: the rules live in
 * auth/password.ts so the member-facing reason string ("Please use at least 10
 * characters.") is written once and reused by register, reset and change. These
 * schemas only enforce the bounds that keep a hostile body from reaching bcrypt
 * or Postgres at all.
 */

const email = z.string().trim().email("Please enter a valid email address.").max(320);

/** Bounded before hashing: bcrypt truncates at 72 bytes, and a 10MB "password" is an attack, not a typo. */
const password = z.string().min(1).max(200);

/** Opaque base64url tokens from an emailed link. 32 bytes encodes to 43 characters. */
const linkToken = z.string().trim().min(20).max(512);

const personName = z.string().trim().max(100);

/**
 * A bad timezone is not caught until something tries to render a date with it,
 * at which point every schedule on the member's screen throws. Ask Intl whether
 * it knows the zone instead of accepting any string.
 */
const timezone = z
  .string()
  .trim()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "That doesn't look like a valid timezone.");

const locale = z
  .string()
  .trim()
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length > 0;
    } catch {
      return false;
    }
  }, "That doesn't look like a valid language code.");

export const registerSchema = z.object({
  email,
  password,
  firstName: personName.min(1, "Please tell us your first name."),
  lastName: personName.optional(),
  timezone: timezone.optional(),
});

export const loginSchema = z.object({
  email,
  password,
});

export const forgotPasswordSchema = z.object({
  email,
});

export const resetPasswordSchema = z.object({
  token: linkToken,
  password,
});

export const verifyEmailSchema = z.object({
  token: linkToken,
});

/** The address is optional: a signed-in member asking for a new link is identified by their token. */
export const resendVerificationSchema = z.object({
  email: email.optional(),
});

export const magicLinkRequestSchema = z.object({
  email,
});

export const magicLinkConsumeSchema = z.object({
  token: linkToken,
});

/** Every field optional — a PATCH that only changes the timezone must not blank the name. */
export const updateProfileSchema = z.object({
  firstName: personName.optional(),
  lastName: personName.optional(),
  timezone: timezone.optional(),
  locale: locale.optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: password,
  newPassword: password,
});

/** member_sessions.id is a bigint, but a session list never approaches the safe-integer ceiling. */
export const sessionIdParamSchema = z.object({
  id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
