import crypto from "crypto";
import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  jwtSecret: "unit-test-secret",
  nodeEnv: "test",
  publicSiteUrl: "https://bossclinician.example",
  google: { clientId: "client-123.apps.googleusercontent.com", clientSecret: "shh" },
}));
vi.mock("../../config/env", () => ({ env: mockEnv }));

import {
  DEFAULT_NEXT,
  GOOGLE_STATE_TTL_SECONDS,
  buildAuthoriseUrl,
  decodeIdToken,
  googleConfig,
  googleSignInEnabled,
  pkceChallenge,
  safeNext,
  signState,
  validateIdToken,
  verifyState,
} from "../../auth/googleOAuth";

/**
 * "Continue with Google" makes three decisions that matter to somebody other
 * than the person signing in: where the browser is sent afterwards, whether a
 * callback belongs to the browser that started it, and whether Google's answer
 * is enough to open an account by email address. Each is a pure function in
 * auth/googleOAuth.ts, and these pin them without a database or a network.
 */

const CLIENT_ID = mockEnv.google.clientId;
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);

describe("safeNext", () => {
  it("keeps a plain same-site path, query and fragment included", () => {
    expect(safeNext("/library")).toBe("/library");
    expect(safeNext("/courses/ethics-101?lesson=3#notes")).toBe("/courses/ethics-101?lesson=3#notes");
    // A URL inside the query string is data, not a destination.
    expect(safeNext("/checkout?return=https://bossclinician.example/store")).toBe(
      "/checkout?return=https://bossclinician.example/store"
    );
  });

  it("falls back to the library for anything that could leave the site", () => {
    const hostile: unknown[] = [
      "//evil.example",
      "/\\evil.example",
      "/path\\..\\evil",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example/library",
      "/\t/evil.example",
      "/\n/evil.example",
      "/x://evil.example",
      "",
      undefined,
      null,
      42,
      ["/library"],
      `/${"a".repeat(600)}`,
    ];
    for (const value of hostile) expect(safeNext(value)).toBe(DEFAULT_NEXT);
  });
});

describe("googleConfig", () => {
  it("derives the redirect URI from PUBLIC_SITE_URL", () => {
    expect(googleConfig()?.redirectUri).toBe("https://bossclinician.example/api/auth/google/callback");
    expect(googleSignInEnabled()).toBe(true);
  });

  it("is off unless BOTH credentials are set", () => {
    const original = { ...mockEnv.google };
    try {
      mockEnv.google.clientSecret = "";
      expect(googleConfig()).toBeNull();
      expect(googleSignInEnabled()).toBe(false);
      mockEnv.google.clientSecret = original.clientSecret;
      mockEnv.google.clientId = "";
      expect(googleConfig()).toBeNull();
    } finally {
      Object.assign(mockEnv.google, original);
    }
  });
});

describe("state cookie", () => {
  const value = { state: "s".repeat(43), verifier: "v".repeat(43), next: "/account" };

  it("round-trips what was signed", () => {
    expect(verifyState(signState(value, NOW), NOW + 1000)).toEqual(value);
  });

  it("refuses a cookie whose payload was edited", () => {
    const [, mac] = signState(value, NOW).split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({ ...value, next: "/admin", exp: Math.floor(NOW / 1000) + 600 }),
      "utf8"
    ).toString("base64url");
    expect(verifyState(`${forgedBody}.${mac}`, NOW)).toBeNull();
  });

  it("refuses a cookie whose signature was edited", () => {
    const [body, mac] = signState(value, NOW).split(".") as [string, string];
    const flipped = (mac.startsWith("A") ? "B" : "A") + mac.slice(1);
    expect(verifyState(`${body}.${flipped}`, NOW)).toBeNull();
  });

  it("refuses a cookie signed with a different key", () => {
    const signed = signState(value, NOW);
    const [body] = signed.split(".") as [string];
    // What an attacker without JWT_SECRET can produce: a well-formed MAC over
    // the right body, from the wrong key.
    const mac = crypto.createHmac("sha256", "not-the-key").update(body).digest("base64url");
    expect(verifyState(`${body}.${mac}`, NOW)).toBeNull();
  });

  it("expires by its own clock, not the browser's Max-Age", () => {
    const signed = signState(value, NOW);
    expect(verifyState(signed, NOW + (GOOGLE_STATE_TTL_SECONDS - 1) * 1000)).not.toBeNull();
    expect(verifyState(signed, NOW + GOOGLE_STATE_TTL_SECONDS * 1000)).toBeNull();
  });

  it("refuses everything that is not a cookie of ours", () => {
    for (const junk of [undefined, null, "", "abc", "a.b.c", ".", "e30.", 7]) {
      expect(verifyState(junk, NOW)).toBeNull();
    }
  });

  it("re-validates the destination on the way out", () => {
    const signed = signState({ ...value, next: "//evil.example" }, NOW);
    expect(verifyState(signed, NOW)?.next).toBe(DEFAULT_NEXT);
  });
});

describe("buildAuthoriseUrl", () => {
  it("asks Google for a code with PKCE, the chooser and the three scopes", () => {
    const verifier = "v".repeat(43);
    const url = new URL(
      buildAuthoriseUrl({
        clientId: CLIENT_ID,
        redirectUri: "https://bossclinician.example/api/auth/google/callback",
        state: "state-abc",
        codeChallenge: pkceChallenge(verifier),
      })
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: "https://bossclinician.example/api/auth/google/callback",
      scope: "openid email profile",
      state: "state-abc",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    // The verifier itself never goes to the browser.
    expect(url.toString()).not.toContain(verifier);
  });

  it("derives the S256 challenge the way RFC 7636 Appendix B does", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});

describe("id_token", () => {
  const good = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(NOW / 1000) + 3600,
    sub: "1098765432101234567",
    email: "Yvette@Example.com",
    email_verified: true,
    given_name: "Yvette",
    family_name: "Clarke",
  };

  function jwt(payload: unknown): string {
    const part = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
    return `${part({ alg: "RS256" })}.${part(payload)}.signature`;
  }

  it("decodes the payload segment and nothing else", () => {
    expect(decodeIdToken(jwt(good))).toEqual(good);
    for (const junk of [undefined, 12, "", "a.b", "a.!!!.c", "only-one-part"]) {
      expect(decodeIdToken(junk)).toBeNull();
    }
  });

  it("accepts Google's claims and normalises the address", () => {
    expect(validateIdToken(good, CLIENT_ID, NOW)).toEqual({
      ok: true,
      identity: { sub: good.sub, email: "yvette@example.com", firstName: "Yvette", lastName: "Clarke" },
    });
    // Both issuer spellings are Google's.
    expect(validateIdToken({ ...good, iss: "accounts.google.com" }, CLIENT_ID, NOW).ok).toBe(true);
  });

  it("does not need a name to sign somebody in", () => {
    const { given_name: _g, family_name: _f, ...nameless } = good;
    expect(validateIdToken(nameless, CLIENT_ID, NOW)).toMatchObject({
      ok: true,
      identity: { firstName: "", lastName: "" },
    });
  });

  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ["a token minted for another client", { aud: "someone-else.apps.googleusercontent.com" }, "google_failed"],
    ["an audience array", { aud: [CLIENT_ID] }, "google_failed"],
    ["another issuer", { iss: "https://accounts.google.com.evil.example" }, "google_failed"],
    ["a missing issuer", { iss: undefined }, "google_failed"],
    ["an expired token", { exp: Math.floor(NOW / 1000) - 1 }, "google_failed"],
    ["a token with no expiry", { exp: undefined }, "google_failed"],
    ["a missing subject", { sub: "" }, "google_failed"],
    ["a missing email", { email: undefined }, "google_failed"],
    ["an empty email", { email: "" }, "google_failed"],
    ["an address Google has not verified", { email_verified: false }, "google_unverified"],
    ["a stringly-typed verification", { email_verified: "true" }, "google_unverified"],
    ["no verification claim at all", { email_verified: undefined }, "google_unverified"],
  ];

  it.each(refusals)("refuses %s", (_label, override, failure) => {
    const verdict = validateIdToken({ ...good, ...override }, CLIENT_ID, NOW);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.failure).toBe(failure);
  });

  it("refuses a payload that is not an object", () => {
    for (const junk of [null, undefined, "x", 3]) {
      expect(validateIdToken(junk, CLIENT_ID, NOW).ok).toBe(false);
    }
  });
});
