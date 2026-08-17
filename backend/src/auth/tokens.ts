import crypto from "crypto";

/**
 * Opaque-token primitives shared by member sessions, password resets, email
 * verifications and magic links.
 *
 * The rule every caller follows: the raw token is generated once, handed to the
 * one person entitled to it (cookie or emailed link), and never stored. Only
 * `hashToken(raw)` reaches the database, so a dump of `member_sessions` or
 * `member_password_resets` contains nothing an attacker can present back.
 */

/** 32 bytes of CSPRNG entropy, base64url — 256 bits, no escaping needed in a URL. */
export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256, hex.
 *
 * Deliberately *not* bcrypt/argon2 here: these tokens are already 256 bits of
 * uniform randomness, so there is no low-entropy secret to slow an attacker
 * down against, and a fast hash keeps the lookup a single indexed equality
 * check. Password hashing is a different problem and uses bcrypt — see
 * auth/password.ts.
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time string comparison, for the rare case where a token has to be
 * compared in application code rather than looked up by its hash.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** A Date `seconds` from now — for the TTL on every token table. */
export function expiresIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
