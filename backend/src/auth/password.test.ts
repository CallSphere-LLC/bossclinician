import { describe, it, expect } from "vitest";
import { checkPasswordStrength, hashPassword, verifyPassword } from "./password";

const GOOD = "correct horse battery staple";

describe("checkPasswordStrength", () => {
  it("rejects anything shorter than 10 characters", () => {
    expect(checkPasswordStrength("").ok).toBe(false);
    expect(checkPasswordStrength("short").ok).toBe(false);
    expect(checkPasswordStrength("123456789").ok).toBe(false);
  });

  it("accepts exactly 10 characters", () => {
    // Boundary in both directions, so a `<=` slip in either comparison fails.
    expect(checkPasswordStrength("a".repeat(9)).ok).toBe(false);
    expect(checkPasswordStrength("a".repeat(10)).ok).toBe(true);
  });

  it("rejects anything longer than 200 characters", () => {
    expect(checkPasswordStrength("a".repeat(200)).ok).toBe(true);
    expect(checkPasswordStrength("a".repeat(201)).ok).toBe(false);
  });

  it("rejects known-common passwords case-insensitively", () => {
    for (const variant of ["password123", "Password123", "PASSWORD123", "PaSsWoRd123"]) {
      const result = checkPasswordStrength(variant);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/guess/i);
    }
  });

  it("rejects short entries from the common list, whichever rule catches them", () => {
    // Most of COMMON_PASSWORDS is under 10 characters, so today the length rule
    // fires first and the guessability rule never sees them. Asserting only the
    // rejection keeps this test honest if the minimum length ever moves.
    for (const common of ["password", "password1", "qwerty123", "letmein1", "trustno1"]) {
      expect(checkPasswordStrength(common).ok).toBe(false);
    }
  });

  it("accepts a reasonable passphrase with no character-class gymnastics", () => {
    expect(checkPasswordStrength(GOOD)).toEqual({ ok: true });
    expect(checkPasswordStrength("yvette's clinic 2026").ok).toBe(true);
    expect(checkPasswordStrength("ThisIsALongEnoughOne").ok).toBe(true);
  });

  it("gives a member-readable reason on every rejection", () => {
    for (const bad of ["nope", "a".repeat(201), "password123"]) {
      const { reason } = checkPasswordStrength(bad);
      expect(reason).toBeTruthy();
      // No jargon leaking into copy a member reads.
      expect(reason).not.toMatch(/bcrypt|hash|regex|null/i);
    }
  });
});

describe("hashPassword", () => {
  it("uses bcrypt at cost 12", () => {
    // The brief's floor is 12. A silent drop to the library default of 10 would
    // still round-trip through verifyPassword, so the prefix is what pins it.
    return expect(hashPassword(GOOD)).resolves.toMatch(/^\$2b\$12\$/);
  });

  it("salts, so the same password hashes to two different strings", async () => {
    const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
    expect(a).not.toBe(b);
    // Both must still be valid — different salt, not different password.
    await expect(verifyPassword(GOOD, a)).resolves.toBe(true);
    await expect(verifyPassword(GOOD, b)).resolves.toBe(true);
  });

  it("produces a 60-character modular crypt string", async () => {
    expect(await hashPassword(GOOD)).toHaveLength(60);
  });
});

describe("verifyPassword", () => {
  it("round-trips a password through its own hash", async () => {
    await expect(verifyPassword(GOOD, await hashPassword(GOOD))).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword(GOOD);
    await expect(verifyPassword("wrong horse battery staple", hash)).resolves.toBe(false);
    await expect(verifyPassword(GOOD.toUpperCase(), hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("returns false for a null or undefined hash without throwing", async () => {
    // Members created by invite or guest checkout have no password_hash yet.
    // Login must reject them, not 500.
    await expect(verifyPassword(GOOD, null)).resolves.toBe(false);
    await expect(verifyPassword(GOOD, undefined)).resolves.toBe(false);
    await expect(verifyPassword(GOOD, "")).resolves.toBe(false);
  });

  it("still spends real bcrypt time when the hash is null", async () => {
    // The anti-enumeration property: a passwordless account must not answer
    // faster than a wrong password, or the response time tells an attacker the
    // address is registered.
    //
    // Asserted as a floor, not as constant time. Proving constant time needs a
    // statistical comparison of two timing distributions, which is exactly the
    // kind of test that goes red on a noisy shared CI runner for no reason. The
    // regression this actually guards is a malformed DUMMY_HASH: bcrypt.compare
    // returns false in under a millisecond for a hash it cannot parse, and does
    // so silently, so a single typo in that constant would delete the defence
    // with no other symptom. A cost-12 round is ~300ms locally; 20ms is far
    // below that and far above the sub-millisecond failure mode.
    const started = performance.now();
    await verifyPassword(GOOD, null);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThan(20);
  });

  it("costs the null-hash path the same order of time as a real comparison", async () => {
    const hash = await hashPassword(GOOD);

    const realStart = performance.now();
    await verifyPassword("wrong horse battery staple", hash);
    const realElapsed = performance.now() - realStart;

    const nullStart = performance.now();
    await verifyPassword("wrong horse battery staple", null);
    const nullElapsed = performance.now() - nullStart;

    // Generous bound for the same reason as above: the failure being caught is
    // "one path skipped bcrypt entirely" (orders of magnitude), not jitter.
    expect(nullElapsed).toBeGreaterThan(realElapsed / 10);
  });
});
