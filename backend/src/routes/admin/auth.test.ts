import type { AddressInfo } from "net";
import type { Server } from "http";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({ env: { jwtSecret: "unit-test-secret", nodeEnv: "test" } }));

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  issueAdminCookieSession: vi.fn(),
}));
vi.mock("../../db/pool", () => ({ pool: { query: mocks.query } }));
vi.mock("bcrypt", () => ({
  default: { compare: async (plain: string, hash: string) => hash === `hash:${plain}` },
}));
vi.mock("../../middleware/rateLimit", () => ({
  loginIpLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  loginEmailLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../auth/adminSession", () => ({
  ADMIN_REFRESH_COOKIE: "refresh",
  issueAdminCookieSession: mocks.issueAdminCookieSession,
  setAdminCookies: () => undefined,
  clearAdminCookies: () => undefined,
  refreshAdminCookieSession: vi.fn(),
  revokeAdminCookieSession: vi.fn(),
  adminAccessToken: () => null,
}));

import { authRouter } from "./auth";

/** The admin as stored: the seed writes ADMIN_EMAIL exactly as it was typed. */
const STORED = {
  id: 7,
  email: "Yvette@BossClinician.com",
  password_hash: "hash:correct horse battery",
  name: "Yvette",
  role: "owner",
  created_at: new Date("2026-01-01T00:00:00Z"),
  status: "active",
  mfa_enabled: false,
  mfa_secret: null,
};

/** A tiny stand-in for Postgres that honours only the email predicate used. */
function fakeQuery(sql: string, params: unknown[] = []) {
  if (/FROM admin_users/.test(sql) && /password_hash/.test(sql)) {
    const typed = String(params[0]);
    const caseInsensitive = /lower\(email\)\s*=\s*lower\(\$1\)/.test(sql);
    const match = caseInsensitive
      ? STORED.email.toLowerCase() === typed.toLowerCase()
      : STORED.email === typed;
    return Promise.resolve({ rows: match ? [STORED] : [] });
  }
  return Promise.resolve({ rows: [], rowCount: 1 });
}

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", authRouter);
  app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  mocks.query.mockReset().mockImplementation(fakeQuery);
  mocks.issueAdminCookieSession.mockReset().mockResolvedValue({
    accessToken: "a",
    refreshToken: "r",
    expiresAt: new Date(),
  });
});

async function login(email: string, password: string) {
  return fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /login", () => {
  it("signs in whatever case the address is typed in", async () => {
    const response = await login("yvette@bossclinician.com", "correct horse battery");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: number } };
    expect(body.user.id).toBe(7);
    expect(mocks.issueAdminCookieSession).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: 7 })
    );
  });

  it("still refuses a wrong password", async () => {
    const response = await login("YVETTE@bossclinician.com", "wrong password here");
    expect(response.status).toBe(401);
    expect(mocks.issueAdminCookieSession).not.toHaveBeenCalled();
  });
});
