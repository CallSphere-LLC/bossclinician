import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { generateToken, hashToken, safeEqual, expiresIn } from "./tokens";

describe("generateToken", () => {
  it("emits base64url, so a token can be pasted into a URL unescaped", () => {
    // Every one of these tokens ships inside an emailed link
    // (?token=...). A `+`, `/` or `=` would survive generation and then be
    // mangled by whichever mail client rewrites the URL, producing a
    // "link expired" that is actually a transport bug.
    for (let i = 0; i < 200; i += 1) {
      const token = generateToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).not.toContain("+");
      expect(token).not.toContain("/");
      expect(token).not.toContain("=");
    }
  });

  it("defaults to 256 bits of entropy", () => {
    const token = generateToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    // 32 bytes is 43 base64 characters with the padding stripped.
    expect(token).toHaveLength(43);
  });

  it("honours an explicit byte length", () => {
    expect(Buffer.from(generateToken(16), "base64url")).toHaveLength(16);
    expect(Buffer.from(generateToken(64), "base64url")).toHaveLength(64);
  });

  it("produces 1000 distinct values in 1000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) seen.add(generateToken());
    expect(seen.size).toBe(1000);
  });
});

describe("hashToken", () => {
  it("is stable for the same input", () => {
    const raw = generateToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("returns 64 lowercase hex characters", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for inputs that differ by one character", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("is case sensitive", () => {
    // base64url is case significant, so a lookup that normalised case would
    // widen every token's collision space by a factor of 2^43.
    expect(hashToken("AbC")).not.toBe(hashToken("abc"));
  });

  it("does not return the raw token", () => {
    const raw = generateToken();
    expect(hashToken(raw)).not.toBe(raw);
  });
});

describe("safeEqual", () => {
  it("is true for equal strings", () => {
    const token = generateToken();
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });

  it("is false for different strings of the same length", () => {
    expect(safeEqual("abcdef", "abcdeg")).toBe(false);
    expect(safeEqual("abcdef", "zbcdef")).toBe(false);
  });

  it("is false for different lengths without throwing", () => {
    // This is the entire reason the wrapper exists: crypto.timingSafeEqual
    // raises on a length mismatch, so a bare call would turn a wrong-length
    // token into a 500 instead of a clean rejection.
    expect(() => safeEqual("short", "considerably-longer")).not.toThrow();
    expect(safeEqual("short", "considerably-longer")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("guards a call that the underlying primitive really does reject", () => {
    // Pins the assumption above. If Node ever stopped throwing here the guard
    // would be dead code, and this test says so rather than quietly passing.
    expect(() => crypto.timingSafeEqual(Buffer.from("short"), Buffer.from("longer"))).toThrow();
  });
});

describe("expiresIn", () => {
  it("returns a Date the requested number of seconds in the future", () => {
    const before = Date.now();
    const expiry = expiresIn(3600);
    const after = Date.now();

    expect(expiry).toBeInstanceOf(Date);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + 3_600_000);
  });

  it("treats the argument as seconds, not milliseconds", () => {
    // A unit mix-up here would give password reset links a 15-second life (or a
    // 15-hour one), which is the kind of bug that only shows up in support mail.
    const delta = expiresIn(900).getTime() - Date.now();
    expect(delta).toBeGreaterThan(899_000);
    expect(delta).toBeLessThan(901_000);
  });

  it("produces an already-expired Date for a negative TTL", () => {
    expect(expiresIn(-60).getTime()).toBeLessThan(Date.now());
  });
});
