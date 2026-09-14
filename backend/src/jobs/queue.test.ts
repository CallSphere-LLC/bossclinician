import { describe, it, expect } from "vitest";
import { backoffSeconds, isPermanentFailure } from "./queue";

/**
 * Only the pure half is unit tested here. Claiming, leasing and dedupe are all
 * SQL and are covered by `queue.integration.test.ts` against a real database —
 * `FOR UPDATE SKIP LOCKED` cannot be meaningfully tested against a mock.
 */
describe("isPermanentFailure", () => {
  it("treats a recipient-guard refusal as permanent, however it is wrapped", () => {
    const guard = Object.assign(new Error("email guard: refused send to a@b.c (not allow-listed in staging)"), {
      name: "RecipientGuardError",
    });
    expect(isPermanentFailure(guard)).toBe(true);
    expect(isPermanentFailure(new Error("Sequence email failed", { cause: guard }))).toBe(true);
    expect(isPermanentFailure("email guard: refused send to a@b.c")).toBe(true);
  });

  it("leaves ordinary failures retryable", () => {
    expect(isPermanentFailure(new Error("upstream down"))).toBe(false);
    expect(isPermanentFailure(new Error("sending identity incomplete"))).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
  });
});

describe("backoffSeconds", () => {
  it("doubles with each attempt", () => {
    // Jitter is added on top, so each is asserted as a range rather than a
    // value. The floor is the curve; the ceiling is the curve plus its jitter.
    const expected: [number, number][] = [
      [1, 60],
      [2, 120],
      [3, 240],
      [4, 480],
      [5, 960],
    ];
    for (const [attempt, base] of expected) {
      const delay = backoffSeconds(attempt);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(base + 60);
    }
  });

  it("caps at an hour, however many attempts have been made", () => {
    for (const attempt of [7, 10, 50, 1000]) {
      expect(backoffSeconds(attempt)).toBeGreaterThanOrEqual(3600);
      expect(backoffSeconds(attempt)).toBeLessThanOrEqual(3660);
    }
  });

  it("treats a zero or negative attempt as the first", () => {
    for (const attempt of [0, -1, -100]) {
      expect(backoffSeconds(attempt)).toBeGreaterThanOrEqual(60);
      expect(backoffSeconds(attempt)).toBeLessThanOrEqual(120);
    }
  });

  it("actually varies, so a batch of simultaneous failures does not retry in lockstep", () => {
    // The property that matters more than the curve: five hundred emails
    // failing together because a provider is down must not all retry at the
    // same instant and knock it over again the moment it recovers.
    const delays = new Set(Array.from({ length: 200 }, () => backoffSeconds(3)));
    expect(delays.size).toBeGreaterThan(10);
  });

  it("never returns a non-finite or negative delay", () => {
    for (const attempt of [0, 1, 5, 20, 1000]) {
      const delay = backoffSeconds(attempt);
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
    }
  });
});
