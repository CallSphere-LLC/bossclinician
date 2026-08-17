import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeForTime, generateSecret, otpauthUrl, verifyCode } from "./mfa";

/**
 * RFC 6238's published test vectors.
 *
 * These are the whole reason this suite exists. A TOTP implementation that is
 * wrong by one byte of truncation, or that treats the counter as a 32-bit
 * integer, produces codes that look perfectly plausible and never match — and
 * the first person to find out is the owner, locked out of her own admin with
 * an authenticator app that says everything is fine.
 *
 * The seed is the RFC's ASCII string "12345678901234567890", and the codes are
 * the HMAC-SHA1 column of its table. Eight digits, because that is what the RFC
 * tabulates; the product uses six, which is the same arithmetic with a smaller
 * modulus.
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

const RFC_VECTORS: [seconds: number, code: string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP", () => {
  it("matches every RFC 6238 SHA-1 vector", () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(codeForTime(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
    }
  });

  it("produces six digits by default", () => {
    // The same instants, truncated to the product's digit count.
    expect(codeForTime(RFC_SECRET, 59_000)).toBe("287082");
    expect(codeForTime(RFC_SECRET, 1111111109_000)).toBe("081804");
  });

  it("holds a code steady across its 30-second step and changes at the boundary", () => {
    const start = 1_700_000_040_000; // a multiple of 30s
    expect(codeForTime(RFC_SECRET, start)).toBe(codeForTime(RFC_SECRET, start + 29_999));
    expect(codeForTime(RFC_SECRET, start)).not.toBe(codeForTime(RFC_SECRET, start + 30_000));
  });

  it("accepts the current code and one step of skew either way", () => {
    const now = 1_700_000_040_000;
    const previous = codeForTime(RFC_SECRET, now - 30_000);
    const current = codeForTime(RFC_SECRET, now);
    const next = codeForTime(RFC_SECRET, now + 30_000);

    expect(verifyCode(RFC_SECRET, current, { atMs: now })).toBe(true);
    expect(verifyCode(RFC_SECRET, previous, { atMs: now })).toBe(true);
    expect(verifyCode(RFC_SECRET, next, { atMs: now })).toBe(true);
  });

  it("rejects a code two steps out", () => {
    const now = 1_700_000_040_000;
    const stale = codeForTime(RFC_SECRET, now - 90_000);
    expect(verifyCode(RFC_SECRET, stale, { atMs: now })).toBe(false);
  });

  it("honours a zero window", () => {
    const now = 1_700_000_040_000;
    const previous = codeForTime(RFC_SECRET, now - 30_000);
    expect(verifyCode(RFC_SECRET, previous, { atMs: now, window: 0 })).toBe(false);
  });

  it("rejects malformed input rather than throwing", () => {
    const now = Date.now();
    expect(verifyCode(RFC_SECRET, "", { atMs: now })).toBe(false);
    expect(verifyCode(RFC_SECRET, "12345", { atMs: now })).toBe(false);
    expect(verifyCode(RFC_SECRET, "abcdef", { atMs: now })).toBe(false);
    expect(verifyCode("", "123456", { atMs: now })).toBe(false);
  });

  it("ignores the spaces people type when copying a code off a phone", () => {
    const now = 1_700_000_040_000;
    const current = codeForTime(RFC_SECRET, now);
    const spaced = `${current.slice(0, 3)} ${current.slice(3)}`;
    expect(verifyCode(RFC_SECRET, spaced, { atMs: now })).toBe(true);
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (let length = 1; length <= 32; length += 1) {
      const bytes = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) % 256));
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });

  it("encodes the RFC's seed the way an authenticator app expects", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("tolerates lower case, spaces and padding in a pasted secret", () => {
    const bytes = Buffer.from("12345678901234567890", "ascii");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toEqual(bytes);
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ======")).toEqual(bytes);
  });
});

describe("enrolment", () => {
  it("generates a 160-bit secret", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it("generates a different secret each time", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });

  it("spells out every parameter in the otpauth URL", () => {
    const url = new URL(otpauthUrl("ABCDEFGHIJKLMNOP", "yvette@bossclinician.com"));
    expect(url.protocol).toBe("otpauth:");
    expect(url.searchParams.get("secret")).toBe("ABCDEFGHIJKLMNOP");
    expect(url.searchParams.get("algorithm")).toBe("SHA1");
    expect(url.searchParams.get("digits")).toBe("6");
    expect(url.searchParams.get("period")).toBe("30");
    expect(url.searchParams.get("issuer")).toBe("Boss Clinician");
    expect(decodeURIComponent(url.pathname)).toContain("yvette@bossclinician.com");
  });

  it("verifies a code produced from a freshly generated secret", () => {
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyCode(secret, codeForTime(secret, now), { atMs: now })).toBe(true);
  });
});
