import bcrypt from "bcrypt";

/**
 * Password hashing for member accounts.
 *
 * The brief allows Argon2id or bcrypt at cost >= 12. bcrypt is what this repo
 * already ships (the admin login uses it) and it needs no new native build step
 * in the Alpine image, so it stays — at cost 12 rather than the library default
 * of 10.
 */
const BCRYPT_COST = 12;

/** Rejects the passwords that show up first in every credential-stuffing list. */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "qwerty123",
  "letmein1", "welcome1", "admin123", "iloveyou", "sunshine", "princess",
  "football", "baseball", "trustno1", "passw0rd", "monkey12", "changeme",
]);

export interface PasswordCheck {
  ok: boolean;
  /** Written for a member to read, not a developer. */
  reason?: string;
}

/**
 * Minimum viable password policy: length does more for real-world safety than
 * character-class rules, which mostly teach people to end passwords in "!1".
 */
export function checkPasswordStrength(password: string): PasswordCheck {
  if (password.length < 10) {
    return { ok: false, reason: "Please use at least 10 characters." };
  }
  if (password.length > 200) {
    return { ok: false, reason: "That password is too long." };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: "That password is too easy to guess. Please pick another." };
  }
  return { ok: true };
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verifies a password against a stored hash.
 *
 * A member with no password (invited, or created by a guest checkout that has
 * not set one yet) still costs a hash comparison: returning early would make
 * "this account exists but has no password" measurably faster than a wrong
 * password, which is exactly the account-enumeration signal the generic error
 * messages exist to hide.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5rZ0BEt.JJ2ZWfCUfLDe6qEBpjIVJFC";

export async function verifyPassword(
  password: string,
  hash: string | null | undefined
): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}
