import type { AddressInfo } from "net";
import type { Server } from "http";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  jwtSecret: "unit-test-secret",
  nodeEnv: "test",
  publicSiteUrl: "https://bossclinician.example",
  adminOrigin: "https://admin.bossclinician.example",
  google: { clientId: "client-123.apps.googleusercontent.com", clientSecret: "shh" },
}));
vi.mock("../../config/env", () => ({ env: mockEnv }));

// The router imports the pool, the session minting and the one network call.
// None of them is what is being pinned here: the pool answers with whatever
// admin row a case needs, Google's token endpoint is replaced by the id_token a
// case wants it to have returned, and the session is a recognisable cookie.
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  exchangeCode: vi.fn(),
  issueAdminCookieSession: vi.fn(),
}));
vi.mock("../../db/pool", () => ({ pool: { query: mocks.query } }));
vi.mock("../../auth/googleTokenExchange", () => ({ exchangeCode: mocks.exchangeCode }));
vi.mock("../../auth/adminSession", () => ({
  issueAdminCookieSession: mocks.issueAdminCookieSession,
  setAdminCookies: (res: Response, session: { accessToken: string }) => {
    res.cookie("test_admin_session", session.accessToken, { path: "/" });
  },
}));
// The real limiter keeps counters between cases, and five is not many.
vi.mock("../../middleware/rateLimit", () => ({
  loginIpLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import {
  ADMIN_DEFAULT_NEXT,
  ADMIN_STATE_FLOW,
  DEFAULT_NEXT,
  GOOGLE_ADMIN_STATE_COOKIE,
  GOOGLE_ADMIN_STATE_COOKIE_PATH,
  googleAdminConfig,
  googleAdminSignInEnabled,
  googleConfig,
  pkceChallenge,
  safeAdminNext,
  signState,
  verifyState,
} from "../../auth/googleOAuth";
import { adminGoogleAuthRouter, decideAdminSignIn, type AdminGoogleLookupRow } from "./googleAuth";

/**
 * "Sign in with Google" for the admin is the member flow with the door shut:
 * it may only ever open an account that already exists, is active, is joined to
 * this Google account or to none, and has no second factor to skip. The pure
 * decisions are pinned first; then the router is driven over a real socket with
 * the database and Google stubbed, because "the refusal happened" and "no
 * session cookie left the building" are properties of the response.
 */

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const ADMIN = mockEnv.adminOrigin;

describe("safeAdminNext", () => {
  it("keeps a path inside the admin, query and fragment included", () => {
    expect(safeAdminNext("/admin")).toBe("/admin");
    expect(safeAdminNext("/admin/offers/12")).toBe("/admin/offers/12");
    expect(safeAdminNext("/admin?tab=today")).toBe("/admin?tab=today");
    expect(safeAdminNext("/admin/contacts?q=a%20b#notes")).toBe("/admin/contacts?q=a%20b#notes");
  });

  it("falls back to the dashboard for anywhere else on the site", () => {
    const elsewhere: unknown[] = [
      "/library",
      "/",
      "/administrator",
      "/admin-tools",
      "/Admin/offers",
      "/admin/../library",
      "/admin/%2e%2e/library",
      "/admin/./../../x",
    ];
    for (const value of elsewhere) expect(safeAdminNext(value)).toBe(ADMIN_DEFAULT_NEXT);
  });

  it("falls back to the dashboard for anything that could leave the site", () => {
    const hostile: unknown[] = [
      "//evil.example/admin",
      "/\\evil.example/admin",
      "/admin\\..\\evil",
      "https://evil.example/admin",
      "javascript:alert(1)",
      "admin",
      "/\t/evil.example/admin",
      "/admin\n/x",
      "/admin/x://evil.example",
      "",
      undefined,
      null,
      42,
      ["/admin"],
      `/admin/${"a".repeat(600)}`,
    ];
    for (const value of hostile) expect(safeAdminNext(value)).toBe(ADMIN_DEFAULT_NEXT);
  });

  it("never sends a fresh sign-in back to the sign-in page or an invitation", () => {
    for (const value of ["/admin/login", "/admin/login/", "/admin/LOGIN?next=/admin/x", "/admin/invite/abc"]) {
      expect(safeAdminNext(value)).toBe(ADMIN_DEFAULT_NEXT);
    }
  });
});

describe("googleAdminConfig", () => {
  it("derives the redirect URI from ADMIN_ORIGIN, under the only prefix that host proxies", () => {
    expect(googleAdminConfig()?.redirectUri).toBe("https://admin.bossclinician.example/api/admin/google/callback");
    expect(googleAdminSignInEnabled()).toBe(true);
    // And the member one is where it was.
    expect(googleConfig()?.redirectUri).toBe("https://bossclinician.example/api/auth/google/callback");
  });

  it("is off without both credentials", () => {
    const original = { ...mockEnv.google };
    try {
      mockEnv.google.clientSecret = "";
      expect(googleAdminConfig()).toBeNull();
      mockEnv.google.clientSecret = original.clientSecret;
      mockEnv.google.clientId = "";
      expect(googleAdminConfig()).toBeNull();
      expect(googleAdminSignInEnabled()).toBe(false);
    } finally {
      Object.assign(mockEnv.google, original);
    }
  });

  it("is off without an admin origin, while the member button stays on", () => {
    try {
      mockEnv.adminOrigin = "";
      expect(googleAdminConfig()).toBeNull();
      expect(googleConfig()).not.toBeNull();
    } finally {
      mockEnv.adminOrigin = ADMIN;
    }
  });
});

describe("admin state cookie", () => {
  const value = { state: "s".repeat(43), verifier: "v".repeat(43), next: "/admin/offers" };

  it("round-trips what was signed", () => {
    expect(verifyState(signState(value, NOW, ADMIN_STATE_FLOW), NOW + 1000, ADMIN_STATE_FLOW)).toEqual(value);
  });

  it("is not honoured by the member flow, nor a member cookie by the admin's", () => {
    // Same key under both, so the audience is the whole of the separation.
    expect(verifyState(signState(value, NOW, ADMIN_STATE_FLOW), NOW)).toBeNull();
    expect(verifyState(signState(value, NOW), NOW, ADMIN_STATE_FLOW)).toBeNull();
    // The member flow on its own is untouched.
    expect(verifyState(signState({ ...value, next: "/account" }, NOW), NOW)?.next).toBe("/account");
  });

  it("re-validates the destination on the way out, against the admin rule", () => {
    const signed = signState({ ...value, next: "/library" }, NOW, ADMIN_STATE_FLOW);
    expect(verifyState(signed, NOW, ADMIN_STATE_FLOW)?.next).toBe(ADMIN_DEFAULT_NEXT);
    const hostile = signState({ ...value, next: "//evil.example" }, NOW, ADMIN_STATE_FLOW);
    expect(verifyState(hostile, NOW, ADMIN_STATE_FLOW)?.next).toBe(ADMIN_DEFAULT_NEXT);
    expect(ADMIN_DEFAULT_NEXT).not.toBe(DEFAULT_NEXT);
  });
});

const SUB = "1098765432101234567";

function adminRow(override: Partial<AdminGoogleLookupRow> = {}): AdminGoogleLookupRow {
  return {
    id: 7,
    email: "yvette@example.com",
    name: "Yvette",
    role: "owner",
    status: "active",
    mfa_enabled: false,
    google_sub: null,
    ...override,
  };
}

describe("decideAdminSignIn", () => {
  it("lets in an active admin, linked to this Google account or to none", () => {
    expect(decideAdminSignIn(adminRow(), { sub: SUB }).ok).toBe(true);
    expect(decideAdminSignIn(adminRow({ google_sub: SUB }), { sub: SUB }).ok).toBe(true);
  });

  it("gives a stranger, an invitee and a suspended admin the same answer", () => {
    const answers = [
      decideAdminSignIn(undefined, { sub: SUB }),
      decideAdminSignIn(adminRow({ status: "invited" }), { sub: SUB }),
      decideAdminSignIn(adminRow({ status: "suspended" }), { sub: SUB }),
      // Suspension outranks everything else that might be said about the row.
      decideAdminSignIn(adminRow({ status: "suspended", mfa_enabled: true, google_sub: "other" }), { sub: SUB }),
    ];
    for (const answer of answers) expect(answer).toMatchObject({ ok: false, failure: "google_no_account" });
  });

  it("refuses an admin joined to a different Google account", () => {
    expect(decideAdminSignIn(adminRow({ google_sub: "someone-else" }), { sub: SUB })).toMatchObject({
      ok: false,
      failure: "google_mismatch",
    });
  });

  it("never stands in for a second factor", () => {
    expect(decideAdminSignIn(adminRow({ mfa_enabled: true }), { sub: SUB })).toMatchObject({
      ok: false,
      failure: "google_mfa",
    });
    expect(decideAdminSignIn(adminRow({ mfa_enabled: true, google_sub: SUB }), { sub: SUB })).toMatchObject({
      ok: false,
      failure: "google_mfa",
    });
  });

  it("puts no address, name or subject in the reason that gets logged", () => {
    const row = adminRow({ google_sub: "someone-else", mfa_enabled: true });
    for (const decision of [
      decideAdminSignIn(row, { sub: SUB }),
      decideAdminSignIn({ ...row, google_sub: null }, { sub: SUB }),
      decideAdminSignIn({ ...row, status: "suspended" }, { sub: SUB }),
    ]) {
      expect(decision.ok).toBe(false);
      if (decision.ok) continue;
      for (const secret of [row.email, row.name, SUB, "someone-else"]) expect(decision.reason).not.toContain(secret);
    }
  });
});

describe("the routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(cookieParser());
    app.use("/api/admin", adminGoogleAuthRouter);
    app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.status ?? 500).json({ error: "error" });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.exchangeCode.mockReset();
    mocks.issueAdminCookieSession.mockReset();
    mocks.issueAdminCookieSession.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(NOW + 8 * 3600 * 1000),
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  function jwt(payload: unknown): string {
    const part = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
    return `${part({ alg: "RS256" })}.${part(payload)}.signature`;
  }

  /** What Google would have returned for yvette@example.com, a minute ago. */
  function idToken(override: Record<string, unknown> = {}): string {
    return jwt({
      iss: "https://accounts.google.com",
      aud: mockEnv.google.clientId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: SUB,
      email: "Yvette@Example.com",
      email_verified: true,
      ...override,
    });
  }

  const STATE = "s".repeat(43);
  const VERIFIER = "v".repeat(43);

  /** The callback, as the browser that started the flow would make it. */
  function callback(query: Record<string, string>, next = "/admin/offers"): Promise<globalThis.Response> {
    const cookie = signState({ state: STATE, verifier: VERIFIER, next }, Date.now(), ADMIN_STATE_FLOW);
    return fetch(`${base}/api/admin/google/callback?${new URLSearchParams(query).toString()}`, {
      redirect: "manual",
      headers: { cookie: `${GOOGLE_ADMIN_STATE_COOKIE}=${cookie}` },
    });
  }

  function sessionCookieSet(response: globalThis.Response): boolean {
    return response.headers.getSetCookie().some((c) => c.startsWith("test_admin_session="));
  }

  it("tells the sign-in page whether to draw the button, uncached", async () => {
    const on = await fetch(`${base}/api/admin/signin-options`);
    expect(on.status).toBe(200);
    expect(on.headers.get("cache-control")).toBe("no-store");
    expect(await on.json()).toEqual({ googleEnabled: true });

    try {
      mockEnv.adminOrigin = "";
      expect(await (await fetch(`${base}/api/admin/signin-options`)).json()).toEqual({ googleEnabled: false });
    } finally {
      mockEnv.adminOrigin = ADMIN;
    }
  });

  it("/start parks a signed state cookie and sends the browser to Google", async () => {
    const response = await fetch(`${base}/api/admin/google/start?next=${encodeURIComponent("/admin/offers?x=1")}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const setCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${GOOGLE_ADMIN_STATE_COOKIE}=`));
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`Path=${GOOGLE_ADMIN_STATE_COOKIE_PATH}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const raw = decodeURIComponent((setCookie ?? "").split(";")[0]!.split("=").slice(1).join("="));
    const parked = verifyState(raw, Date.now(), ADMIN_STATE_FLOW);
    expect(parked?.next).toBe("/admin/offers?x=1");

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ADMIN}/api/admin/google/callback`);
    expect(location.searchParams.get("state")).toBe(parked?.state);
    expect(location.searchParams.get("code_challenge")).toBe(pkceChallenge(parked?.verifier ?? ""));
    expect(location.toString()).not.toContain(parked?.verifier ?? "never");
  });

  it("/start keeps a destination outside the admin out of the cookie", async () => {
    const response = await fetch(`${base}/api/admin/google/start?next=${encodeURIComponent("//evil.example")}`, {
      redirect: "manual",
    });
    const setCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${GOOGLE_ADMIN_STATE_COOKIE}=`));
    const raw = decodeURIComponent((setCookie ?? "").split(";")[0]!.split("=").slice(1).join("="));
    expect(verifyState(raw, Date.now(), ADMIN_STATE_FLOW)?.next).toBe(ADMIN_DEFAULT_NEXT);
  });

  it("/start does not exist while the feature is off", async () => {
    try {
      mockEnv.adminOrigin = "";
      const response = await fetch(`${base}/api/admin/google/start`, { redirect: "manual" });
      expect(response.status).toBe(404);
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      mockEnv.adminOrigin = ADMIN;
    }
  });

  it("signs in an existing active admin, links the subject, and goes where they were going", async () => {
    mocks.exchangeCode.mockResolvedValue(idToken());
    mocks.query
      .mockResolvedValueOnce({ rows: [adminRow()] })
      .mockResolvedValueOnce({ rows: [adminRow({ google_sub: SUB })] });

    const response = await callback({ state: STATE, code: "the-code" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ADMIN}/admin/offers`);
    expect(sessionCookieSet(response)).toBe(true);
    // The state cookie is spent.
    expect(
      response.headers.getSetCookie().some((c) => c.startsWith(`${GOOGLE_ADMIN_STATE_COOKIE}=;`))
    ).toBe(true);

    // Google was asked with the verifier from the cookie and the admin redirect URI.
    expect(mocks.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: `${ADMIN}/api/admin/google/callback` }),
      "the-code",
      VERIFIER
    );

    // Looked up by subject or lower-cased address…
    const [lookupSql, lookupParams] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(lookupSql).toContain("FROM admin_users");
    expect(lookupSql).toContain("lower(email) = lower($2)");
    expect(lookupParams).toEqual([SUB, "yvette@example.com"]);
    // …then linked and stamped, with every refusal repeated in the WHERE.
    const [updateSql, updateParams] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain("COALESCE(google_sub, $2)");
    expect(updateSql).toContain("last_login_at = now()");
    expect(updateSql).toContain("status = 'active'");
    expect(updateSql).toContain("mfa_enabled IS NOT TRUE");
    expect(updateParams).toEqual([7, SUB]);

    expect(mocks.issueAdminCookieSession).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: 7, email: "yvette@example.com", role: "owner" })
    );
  });

  it("NEVER creates an admin: nothing but a SELECT is run for a stranger", async () => {
    mocks.exchangeCode.mockResolvedValue(idToken({ email: "stranger@example.com" }));
    mocks.query.mockResolvedValueOnce({ rows: [] });

    const response = await callback({ state: STATE, code: "the-code" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${ADMIN}/admin/login?error=google_no_account&next=${encodeURIComponent("/admin/offers")}`
    );
    expect(sessionCookieSet(response)).toBe(false);
    expect(mocks.issueAdminCookieSession).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    for (const [sql] of mocks.query.mock.calls as Array<[string]>) expect(sql).not.toMatch(/INSERT/i);
  });

  const refusals: Array<[string, Partial<AdminGoogleLookupRow>, string]> = [
    ["a suspended admin, in a stranger's words", { status: "suspended" }, "google_no_account"],
    ["an invitee who has not accepted", { status: "invited" }, "google_no_account"],
    ["an admin joined to a different Google account", { google_sub: "someone-else" }, "google_mismatch"],
    ["an admin with two-step sign-in on", { mfa_enabled: true }, "google_mfa"],
  ];

  it.each(refusals)("refuses %s", async (_label, override, failure) => {
    mocks.exchangeCode.mockResolvedValue(idToken());
    mocks.query.mockResolvedValueOnce({ rows: [adminRow(override)] });

    const response = await callback({ state: STATE, code: "the-code" }, "/admin");

    expect(response.status).toBe(302);
    // The dashboard is the default, so it is not spelled out.
    expect(response.headers.get("location")).toBe(`${ADMIN}/admin/login?error=${failure}`);
    expect(sessionCookieSet(response)).toBe(false);
    expect(mocks.issueAdminCookieSession).not.toHaveBeenCalled();
    // The lookup, and no write.
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("refuses an admin who stopped qualifying between the read and the write", async () => {
    mocks.exchangeCode.mockResolvedValue(idToken());
    mocks.query.mockResolvedValueOnce({ rows: [adminRow()] }).mockResolvedValueOnce({ rows: [] });

    const response = await callback({ state: STATE, code: "the-code" }, "/admin");
    expect(response.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_no_account`);
    expect(sessionCookieSet(response)).toBe(false);
  });

  it("refuses an address Google has not verified, before the database is asked", async () => {
    mocks.exchangeCode.mockResolvedValue(idToken({ email_verified: false }));
    const response = await callback({ state: STATE, code: "the-code" }, "/admin");
    expect(response.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_unverified`);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("honours a callback only in the browser that started it", async () => {
    const wrongState = await callback({ state: "x".repeat(43), code: "the-code" }, "/admin");
    expect(wrongState.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_failed`);

    const noCookie = await fetch(`${base}/api/admin/google/callback?state=${STATE}&code=the-code`, {
      redirect: "manual",
    });
    expect(noCookie.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_failed`);

    // A MEMBER state cookie, planted under the admin's name: same key, wrong audience.
    const memberCookie = signState({ state: STATE, verifier: VERIFIER, next: "/admin" });
    const planted = await fetch(`${base}/api/admin/google/callback?state=${STATE}&code=the-code`, {
      redirect: "manual",
      headers: { cookie: `${GOOGLE_ADMIN_STATE_COOKIE}=${memberCookie}` },
    });
    expect(planted.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_failed`);

    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("says 'cancelled' when the admin pressed Cancel at Google", async () => {
    const response = await callback({ state: STATE, error: "access_denied" }, "/admin");
    expect(response.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_cancelled`);
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("ends on the sign-in page, not a JSON error, when Google or the database throws", async () => {
    mocks.exchangeCode.mockRejectedValue(new Error("token endpoint answered 400 (invalid_grant)"));
    const response = await callback({ state: STATE, code: "the-code" }, "/admin");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ADMIN}/admin/login?error=google_failed`);
    expect(sessionCookieSet(response)).toBe(false);
  });
});
