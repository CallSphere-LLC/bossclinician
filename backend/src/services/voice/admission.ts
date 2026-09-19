/**
 * admission.ts — the one-use bearer the browser trades for an SDP answer.
 *
 * `POST /api/voice/session` decides who you are and mints one of these;
 * `POST /api/voice/connect` is the only thing that will ever accept one, and it
 * consumes it before it touches OpenAI. That ordering is the whole point: the
 * expensive, billable step is behind a token that works exactly once, so a
 * replayed request cannot open a second live session on the first one's
 * authority.
 *
 * The token carries no OpenAI material. It carries the contract's
 * `VoiceAdmission` — the session row's id, the surface the SERVER decided on,
 * and the identity it decided it from — signed so `/connect` can believe it
 * without a database read, and short-lived because it only has to survive one
 * round trip.
 *
 * Pure except for the claim registry, and the clock is an argument everywhere,
 * so the whole file is exercised by voicePolicy.test.ts without a database.
 */

import crypto from "crypto";
import { env } from "../../config/env";
import type { VoiceAdmission, VoiceIdentity, VoiceSurface } from "./contract";

/**
 * Long enough for a browser to gather ICE candidates and post its offer on a
 * slow phone, short enough that a token captured from a log is worthless by the
 * time anyone reads it.
 */
export const ADMISSION_TTL_MS = 2 * 60 * 1000;

/** Version prefix, so a future payload change fails closed instead of oddly. */
const TOKEN_PREFIX = "bcva1.";

/** A bound on what `/connect` will even attempt to verify. */
const MAX_TOKEN_LENGTH = 4096;

/**
 * The signing key is derived from JWT_SECRET rather than being JWT_SECRET, the
 * same move auth/memberDocumentCookie.ts makes and for the same reason: an HMAC
 * under the raw secret is interchangeable with every other HMAC in the app, and
 * a purpose-specific key means an admission can never be mistaken for — or
 * forged from — a receipt cookie or a member token.
 */
const SIGNING_INFO = "bossclinician/voice-admission/v1";

let signingKey: Buffer | null = null;

function key(): Buffer {
  if (signingKey === null) {
    signingKey = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        Buffer.from(env.jwtSecret, "utf8"),
        Buffer.alloc(0),
        Buffer.from(SIGNING_INFO, "utf8"),
        32,
      ),
    );
  }
  return signingKey;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", key()).update(body).digest("base64url");
}

export type AdmissionClaim =
  | { ok: true; admission: VoiceAdmission }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Mints the token for a session row that has just been opened. */
export function issueAdmission(
  input: { sessionId: string; surface: VoiceSurface; identity: VoiceIdentity },
  now: number = Date.now(),
): { token: string; admission: VoiceAdmission } {
  const admission: VoiceAdmission = {
    sessionId: input.sessionId,
    surface: input.surface,
    identity: input.identity,
    expiresAt: now + ADMISSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(admission), "utf8").toString("base64url");
  return { token: `${TOKEN_PREFIX}${body}.${sign(body)}`, admission };
}

/**
 * The admission a token proves, without consuming it.
 *
 * Signature first, then shape, then expiry — in that order, because a payload
 * that has not been authenticated is attacker-controlled JSON and nothing may
 * be read out of it before the MAC says it is ours.
 */
export function verifyAdmission(token: unknown, now: number = Date.now()): AdmissionClaim {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "invalid" };
  }
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, reason: "invalid" };

  const parts = token.slice(TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [body, supplied] = parts;
  if (!body || !supplied || !/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(supplied)) {
    return { ok: false, reason: "invalid" };
  }

  const expected = sign(body);
  if (supplied.length !== expected.length) return { ok: false, reason: "invalid" };
  if (
    !crypto.timingSafeEqual(Buffer.from(supplied, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    return { ok: false, reason: "invalid" };
  }

  let candidate: Partial<VoiceAdmission>;
  try {
    candidate = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<VoiceAdmission>;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (
    typeof candidate.sessionId !== "string" ||
    candidate.sessionId.length === 0 ||
    candidate.sessionId.length > 128 ||
    (candidate.surface !== "public" &&
      candidate.surface !== "member" &&
      candidate.surface !== "admin") ||
    !isIdentity(candidate.identity) ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    // A token that claims a longer life than this file ever mints was not minted
    // by this file, whatever its signature says about a key rotation.
    candidate.expiresAt > now + ADMISSION_TTL_MS
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (candidate.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, admission: candidate as VoiceAdmission };
}

function isIdentity(value: unknown): value is VoiceIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Record<string, unknown>;
  if (identity.audience === "anonymous") return true;
  if (identity.audience === "member") return Number.isSafeInteger(identity.memberId);
  if (identity.audience === "admin") {
    return Number.isSafeInteger(identity.adminUserId) && typeof identity.role === "string";
  }
  return false;
}

/**
 * Session ids that have already been traded for a live session, held until the
 * admission that named them would have expired anyway.
 *
 * The session id IS the single-use key: one row, one admission, one connection.
 * Keeping it in process memory is honest for this deployment — one backend
 * container, and the window is two minutes — and it fails in the safe
 * direction, because a restart forgets that a token was used and the request
 * that replays it then has to get past an expiry that has almost certainly
 * already passed.
 */
const claimed = new Map<string, number>();

function sweep(now: number): void {
  for (const [sessionId, expiresAt] of claimed) {
    if (expiresAt <= now) claimed.delete(sessionId);
  }
}

/**
 * Verifies a token and burns it in the same step, so two requests racing with
 * the same admission cannot both reach OpenAI. Node runs this synchronously
 * between awaits, which is what makes the check-then-set safe here.
 */
export function claimAdmission(token: unknown, now: number = Date.now()): AdmissionClaim {
  const verified = verifyAdmission(token, now);
  if (!verified.ok) return verified;

  sweep(now);
  if (claimed.has(verified.admission.sessionId)) return { ok: false, reason: "used" };
  claimed.set(verified.admission.sessionId, verified.admission.expiresAt);
  return verified;
}
