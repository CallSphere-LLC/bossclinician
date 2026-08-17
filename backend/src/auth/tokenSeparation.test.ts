import { describe, it, expect, beforeAll } from "vitest";

/**
 * Regression guard for a privilege escalation that shipped in an early cut of
 * Phase 1 and was caught in review.
 *
 * Both token families are HS256 JWTs. They were signed with the same key, and
 * `jsonwebtoken` only validates `aud` when the caller passes an `audience`
 * option — which the admin verifier did not. The result: a member access token
 * verified cleanly as an admin token, arriving with `role === undefined`. Since
 * `requireRole('admin')` guards only one route and everything else relies on
 * `requireAuth` alone, any registered customer could have driven the entire
 * admin API.
 *
 * These tests assert the two families are mutually unverifiable. If someone
 * later "simplifies" the key derivation away, this fails loudly.
 */

// config/env throws without these, and this suite deliberately exercises the
// real signing path rather than a mock of it.
beforeAll(() => {
  process.env.JWT_SECRET ??= "test-jwt-secret-for-token-separation-suite";
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:5432/unused";
});

describe("admin and member tokens are cryptographically separated", () => {
  it("does not accept a member access token as an admin token", async () => {
    const { signMemberAccessToken } = await import("./memberSession");
    const { verifyToken } = await import("../utils/jwt");

    const memberToken = signMemberAccessToken({ sub: 42, email: "member@example.com" });

    expect(() => verifyToken(memberToken)).toThrow();
  });

  it("does not accept an admin token as a member access token", async () => {
    const { signToken } = await import("../utils/jwt");
    const { verifyMemberAccessToken } = await import("./memberSession");

    const adminToken = signToken({ sub: 1, email: "admin@example.com", role: "admin" });

    expect(() => verifyMemberAccessToken(adminToken)).toThrow();
  });

  it("still round-trips each token with its own verifier", async () => {
    const { signToken, verifyToken } = await import("../utils/jwt");
    const { signMemberAccessToken, verifyMemberAccessToken } = await import("./memberSession");

    const admin = verifyToken(signToken({ sub: 1, email: "admin@example.com", role: "admin" }));
    expect(admin).toMatchObject({ sub: 1, email: "admin@example.com", role: "admin" });

    const member = verifyMemberAccessToken(
      signMemberAccessToken({ sub: 42, email: "member@example.com" }),
    );
    expect(member).toMatchObject({ sub: 42, email: "member@example.com" });
  });

  it("uses a member signing key that is not the configured JWT secret", async () => {
    const { memberTokenSecret, adminTokenSecret } = await import("./secrets");
    expect(memberTokenSecret()).not.toBe(adminTokenSecret());
    expect(memberTokenSecret()).not.toBe(process.env.JWT_SECRET);
  });

  it("derives the member key deterministically, so tokens survive a restart", async () => {
    const { memberTokenSecret } = await import("./secrets");
    expect(memberTokenSecret()).toBe(memberTokenSecret());
  });

  it("rejects an admin token carrying no role claim", async () => {
    // The belt-and-braces half of the fix: even a correctly-signed token that
    // does not assert a role is not an administrator.
    const jwt = (await import("jsonwebtoken")).default;
    const { adminTokenSecret } = await import("./secrets");
    const { verifyToken } = await import("../utils/jwt");

    const roleless = jwt.sign({ sub: 1, email: "x@example.com" }, adminTokenSecret(), {
      algorithm: "HS256",
      expiresIn: 600,
    });

    expect(() => verifyToken(roleless)).toThrow(/not an administrator/i);
  });

  it("rejects an admin token whose role claim is empty", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const { adminTokenSecret } = await import("./secrets");
    const { verifyToken } = await import("../utils/jwt");

    const empty = jwt.sign({ sub: 1, email: "x@example.com", role: "" }, adminTokenSecret(), {
      algorithm: "HS256",
      expiresIn: 600,
    });

    expect(() => verifyToken(empty)).toThrow(/not an administrator/i);
  });
});
