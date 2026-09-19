import { Request } from "express";
import { rateLimit, ipKeyGenerator, type Options } from "express-rate-limit";

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
  // A successful MFA login is two requests (password challenge, then code).
  // Remove the final 200 from the counter so each login consumes one attempt,
  // while wrong passwords and wrong second factors remain fully counted.
  skipSuccessfulRequests: true,
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
  skipSuccessfulRequests: true,
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
 * The voice concierge's three routes.
 *
 * These are per-IP burst backstops and nothing more. The real per-caller
 * ceiling is `SURFACE_LIMITS[surface].sessionsPerHour`, enforced against the
 * signed-in person where there is one (services/voice/policy.ts), and that
 * split matters here more than anywhere else on the site: req.ip is a constant
 * in production (the `trust proxy` note in app.ts), so a limit tight enough to
 * bound one abuser would bound every visitor at once. So these are sized to
 * stop a runaway loop, and the identity-keyed budget is what stops a person.
 *
 * /connect is the expensive one — each success mints a billable audio session —
 * but it cannot be reached at all without an admission /session already issued
 * and counted, so it does not need a second tight cap of its own.
 */
export const voiceSessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

export const voiceConnectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: GENERIC_RATE_LIMIT_MESSAGE,
});

/**
 * Looser than chatLimiter, and for the same reason chatTranscriptLimiter is:
 * one typed sentence is several requests here, not one. The browser executes
 * the model's tool calls and comes straight back with the results, so walking
 * somebody through a page legitimately costs three or four round trips before
 * a single word is shown.
 */
export const voiceChatLimiter = rateLimit({
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

/** Test-email buttons are diagnostics, not an alternate bulk sender. */
export const adminTestEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many test emails. Please try again later." },
});

/**
 * The site-wide backstop, mounted in app.ts ahead of every router.
 *
 * Not a substitute for the limiters above, which are tight where one request
 * costs something specific — a password guess, an email, a Stripe call. This
 * one exists so that nothing that reaches the database is unlimited: a runaway
 * client loop, a script walking the admin's list endpoints, a flood aimed at
 * whichever route has no limiter of its own.
 *
 * How it is sized. req.ip is a constant in production (the `trust proxy` note
 * in app.ts), so every visitor shares one key and a limit sized for one visitor
 * would throttle the whole site. It is sized for the whole site instead, from
 * the nginx access log for 7–14 Sep 2026 — 13,355 API requests and 838
 * server-rendered pages across both hosts:
 *
 *   - the busiest minute on any surface was 523 requests, on the admin, and it
 *     was one scripted headless browser, not a person;
 *   - members peaked at 121 a minute, the public API at 32, rendered pages at
 *     158, the Stripe and SES webhooks at 5;
 *   - the 99th-percentile minute of the week was 22 requests, the busiest
 *     single second 57.
 *
 * 6,000 a minute per surface is more than ten times the busiest minute seen.
 * The key is split by surface so a flood on the public API cannot lock the
 * owner out of her admin, and a burst of SES delivery events after a broadcast
 * cannot throttle checkout. When PROXY protocol restores the visitor's address
 * (docs/bugs/infra.md), the same key becomes per visitor per surface with no
 * change here, and the ceiling becomes generous rather than tight. In memory,
 * so it resets on deploy — acceptable for a backstop nothing relies on for
 * correctness.
 */
export const API_REQUESTS_PER_MINUTE = 6000;

export type RateLimitSurface = "admin" | "member" | "integrations" | "webhooks" | "public";

const within = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Which bucket a request counts against, or null for the two paths the
 * backstop leaves alone: `/api/health`, which the deploy's health gate polls
 * through the public URL — a flood must not also fail the gate and roll back a
 * good release — and `/uploads`, static files that never touch the database.
 */
export function rateLimitSurface(path: string): RateLimitSurface | null {
  if (path === "/api/health" || within(path, "/uploads")) return null;
  if (within(path, "/api/admin")) return "admin";
  if (within(path, "/api/member") || within(path, "/api/auth") || within(path, "/account")) {
    return "member";
  }
  if (within(path, "/api/v1")) return "integrations";
  if (within(path, "/api/stripe/webhook") || within(path, "/api/email/webhook")) return "webhooks";
  return "public";
}

/** Exported apart from the instance so a test can exercise it with a small ceiling. */
export function apiLimiterOptions(limit: number): Partial<Options> {
  return {
    windowMs: 60 * 1000,
    max: limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: GENERIC_RATE_LIMIT_MESSAGE,
    skip: (req: Request): boolean => rateLimitSurface(req.path) === null,
    keyGenerator: (req: Request): string =>
      `${rateLimitSurface(req.path)}:${ipKeyGenerator(req.ip ?? "")}`,
  };
}

export const apiLimiter = rateLimit(apiLimiterOptions(API_REQUESTS_PER_MINUTE));
