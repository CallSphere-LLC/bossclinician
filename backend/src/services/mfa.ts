import crypto from "crypto";
import { pool } from "../db/pool";
import { hashToken, safeEqual } from "../auth/tokens";

/**
 * Time-based one-time passwords (RFC 6238) and their recovery codes.
 *
 * Implemented on node's own `crypto` rather than a dependency, because the
 * whole algorithm is thirty lines of HMAC and modular arithmetic and the
 * failure mode of getting it wrong — the owner locked out of her own admin by
 * codes that never match — is one you want to be able to read end to end and
 * test against the RFC's published vectors. See mfa.test.ts, which does exactly
 * that.
 *
 * Parameters are the ones every authenticator app assumes when the otpauth URL
 * does not say otherwise: HMAC-SHA1, 6 digits, a 30-second step. They are not
 * configurable on purpose; a "stronger" choice here is a choice that Google
 * Authenticator silently gets wrong.
 *
 * The shared secret is stored as it must be — recoverable — because verifying a
 * TOTP means recomputing it, and there is no hash that permits that. It is not
 * encrypted under a derived key either: the key would have to come from
 * JWT_SECRET, and rotating JWT_SECRET is a routine act that would then make
 * every enrolled secret undecryptable and lock every administrator out at once.
 * A database dump is protected by not leaking the database; a bricked login is
 * protected by nothing.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;
/** The issuer an authenticator app shows above the code. */
const ISSUER = "Boss Clinician";

/* ------------------------------------------------------------------ base32 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, unpadded — the encoding every authenticator app expects. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];

  return out;
}

export function base32Decode(input: string): Buffer {
  // Padding, spaces and lower case all appear in secrets people paste back in.
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/* -------------------------------------------------------------------- TOTP */

/**
 * RFC 4226 HOTP: HMAC-SHA1 over the counter, then dynamic truncation.
 *
 * The counter is written as an unsigned 64-bit big-endian integer. Anything
 * narrower works until 2038 and then does not, which is the sort of bug that
 * arrives without a deploy to blame.
 */
function hotp(key: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(counter)));

  const digest = crypto.createHmac("sha1", key).update(message).digest();

  // Dynamic truncation: the low nibble of the last byte picks the 4-byte window,
  // and the top bit is masked off so the result is a positive 31-bit integer on
  // every platform's idea of a signed int.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * The code for a given instant.
 *
 * `digits` is a parameter only so the tests can run the RFC's 8-digit vectors;
 * everything in the product uses the default.
 */
export function codeForTime(secret: string, atMs: number, digits: number = DIGITS): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter, digits);
}

/** 20 bytes — the RFC's recommended SHA-1 key length, and what every app expects. */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * The QR code an authenticator app scans.
 *
 * Every parameter is spelled out rather than left to the app's defaults: the
 * defaults agree today, and an app that ever picks differently would produce
 * codes that never match with nothing on screen to explain why.
 */
export function otpauthUrl(secret: string, email: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export interface VerifyOptions {
  /** Steps of clock skew accepted either side. 1 = ±30s, the usual allowance. */
  window?: number;
  /** Overridable for tests only. */
  atMs?: number;
}

/**
 * Checks a code against the secret.
 *
 * Every candidate in the window is compared, and the comparisons are combined
 * without short-circuiting: returning as soon as one matches would make the
 * function's runtime depend on *which* step matched, which is a (small, but
 * free to avoid) timing signal about the verifier's clock.
 */
export function verifyCode(secret: string, code: string, options: VerifyOptions = {}): boolean {
  const window = options.window ?? 1;
  const atMs = options.atMs ?? Date.now();

  const candidate = code.replace(/\D/g, "");
  if (candidate.length !== DIGITS) return false;
  if (!secret) return false;

  let matched = false;
  for (let step = -window; step <= window; step += 1) {
    const expected = codeForTime(secret, atMs + step * STEP_SECONDS * 1000);
    // Written as an assignment rather than `matched ||= …` so that every step is
    // still compared after the first hit.
    if (safeEqual(expected, candidate)) matched = true;
  }
  return matched;
}

/* -------------------------------------------------------- recovery codes */

/** No 0/O/1/I/L — these get read off a screen and typed back in by hand. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_GROUP = 4;

function randomRecoveryCode(): string {
  const chars: string[] = [];
  // Rejection-free because 31 does not divide 256 evenly — but the bias from a
  // plain modulo is under 1% per character and these are 8 characters of a
  // single-use code, so uniformity is bought the cheap way here rather than
  // with a loop that can in principle spin.
  for (const byte of crypto.randomBytes(RECOVERY_GROUP * 2)) {
    chars.push(RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
  }
  return `${chars.slice(0, RECOVERY_GROUP).join("")}-${chars.slice(RECOVERY_GROUP).join("")}`;
}

/** Case and hyphens are cosmetic; the stored hash is over the bare characters. */
function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Replaces an administrator's recovery codes and returns the new ones in plain
 * text — the only time they exist outside a hash.
 *
 * Regenerating invalidates the old set. That is the point: a code list that has
 * been printed, photographed or emailed is exactly what regeneration is for.
 */
export async function issueRecoveryCodes(adminUserId: number): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM admin_mfa_recovery_codes WHERE admin_user_id = $1`, [
      adminUserId,
    ]);
    for (const code of codes) {
      await client.query(
        `INSERT INTO admin_mfa_recovery_codes (admin_user_id, code_hash) VALUES ($1, $2)`,
        [adminUserId, hashToken(normaliseRecoveryCode(code))]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return codes;
}

/**
 * Spends a recovery code, if it is one of this administrator's and unused.
 *
 * The `used_at IS NULL` test is inside the UPDATE rather than a read followed by
 * a write, so two simultaneous presentations of the same code cannot both
 * succeed — the second updates zero rows.
 */
export async function consumeRecoveryCode(adminUserId: number, code: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length < 4) return false;

  const res = await pool.query(
    `UPDATE admin_mfa_recovery_codes
        SET used_at = now()
      WHERE admin_user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [adminUserId, hashToken(normalised)]
  );
  return (res.rowCount ?? 0) > 0;
}

/** How many codes are left, for the "you have 3 left" line on the security screen. */
export async function countUnusedRecoveryCodes(adminUserId: number): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM admin_mfa_recovery_codes
      WHERE admin_user_id = $1 AND used_at IS NULL`,
    [adminUserId]
  );
  return Number(res.rows[0]?.count ?? 0);
}

/**
 * The second factor check used at sign-in: a live code, or one of the recovery
 * codes, either of which is accepted exactly once for a recovery code.
 */
export async function verifySecondFactor(
  adminUserId: number,
  secret: string,
  submitted: string
): Promise<boolean> {
  const code = submitted.trim();
  if (!code) return false;
  if (verifyCode(secret, code)) return true;
  return consumeRecoveryCode(adminUserId, code);
}
