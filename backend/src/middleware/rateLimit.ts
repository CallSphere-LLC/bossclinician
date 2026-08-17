import { Request } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const GENERIC_RATE_LIMIT_MESSAGE = { error: "Too many requests. Please try again later." };
const GENERIC_LOGIN_RATE_LIMIT_MESSAGE = { error: "Too many login attempts. Please try again later." };

/**
 * Strict per-IP limiter for the admin login endpoint: 5 requests / 15 min.
 */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_LOGIN_RATE_LIMIT_MESSAGE,
});

/**
 * Per-IP+email limiter for the admin login endpoint. Prevents repeated guesses
 * against a single account from a given IP without revealing whether the IP
 * cap or the email cap was the one that tripped (same generic message/status
 * as loginIpLimiter).
 */
export const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_LOGIN_RATE_LIMIT_MESSAGE,
  keyGenerator: (req: Request): string => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
  },
});

/** Moderate per-IP limiter for public lead-generating endpoints. */
export const leadsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/** Moderate per-IP limiter for the newsletter subscribe endpoint. */
export const subscribeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/**
 * Per-IP limiter for Stripe Checkout Session creation. Tighter than the other
 * public endpoints: every call hits the Stripe API, so this caps both abuse and
 * our own rate-limit exposure upstream.
 */
export const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/** Moderate per-IP limiter for the public chat endpoint. */
export const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/**
 * Looser than chatLimiter: a voice conversation flushes one request per spoken
 * turn, so a ten-minute call legitimately posts many more times than a typed
 * exchange does. Each call is a plain insert with no AI hop behind it.
 */
export const chatTranscriptLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/**
 * Member identity limiters.
 *
 * Separate instances from the admin ones above on purpose: sharing a counter
 * would let member traffic lock Yvette out of her own dashboard, and the two
 * surfaces have very different legitimate volumes.
 *
 * These are the cheap first line only. Member sign-in is additionally throttled
 * against `member_login_attempts`, because an in-memory counter resets on every
 * deploy and is not shared between replicas — see routes/auth/memberAuth.ts.
 */

/** Per IP+email, so one address cannot be pounded from a single host. */
const ipEmailKey = (req: Request): string => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return `${ipKeyGenerator(req.ip ?? "")}:${email}`;
};

export const memberRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

export const memberLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_LOGIN_RATE_LIMIT_MESSAGE,
});

/**
 * Covers forgotten passwords, resets, verification resends and magic links —
 * every route that turns one HTTP request into one outbound email, where the
 * abuse case is using us to mailbomb somebody else.
 */
export const memberEmailLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
  keyGenerator: ipEmailKey,
});

/** Consuming a token sends no mail, so this is guessing protection, keyed on IP alone. */
export const memberTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/**
 * Avatar uploads — the one route on which a member can write megabytes to the
 * server's disk, and it shares a volume with the course video.
 *
 * Keyed on the member rather than the IP, because the route is authenticated
 * and a clinic whose staff all sit behind one address must not share a
 * profile-photo budget. Ten an hour is far beyond how often anyone changes
 * their picture and far below what it takes to fill a disk.
 */
export const memberAvatarLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
  keyGenerator: (req: Request): string =>
    req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? ""),
});

/**
 * Impersonation. Every call mints a working key to a customer's account, so the
 * ceiling is deliberately low: support looking at one member's screen is a
 * considered act, while a script walking the member list issuing tokens is not
 * something the audit log should be left to discover afterwards.
 */
export const adminImpersonateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});
