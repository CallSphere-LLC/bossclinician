import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const mode = vi.hoisted(() => ({ admin: false, member: false }));
vi.mock("../../auth/adminSession", () => ({ ADMIN_ACCESS_COOKIE: "admin_access", ADMIN_REFRESH_COOKIE: "admin_refresh", requireAdminHost: (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../../middleware/auth", async () => {
  const { unauthorized } = await import("../../utils/httpError");
  return { requireAuth: (req: Request, _res: unknown, next: (error?: unknown) => void) => {
    if (mode.admin) { req.user = { sub: 7, role: "owner" } as Request["user"]; next(); }
    else next(unauthorized("Expired admin credential"));
  }};
});
vi.mock("../../middleware/memberAuth", () => ({ optionalMember: (req: Request, _res: unknown, next: () => void) => { if (mode.member) req.member = { id: 8 } as Request["member"]; next(); } }));
import { identityFromRequest } from "./session";
const request = (headers = {}, cookies = {}) => ({ headers, cookies }) as Request;
beforeEach(() => { mode.admin = false; mode.member = false; });
describe("voice identity refresh boundary", () => {
  it("keeps a genuinely anonymous caller public", async () => {
    expect(await identityFromRequest(request(), {} as Response)).toEqual({ audience: "anonymous" });
  });
  it("asks for refresh instead of demoting an expired bearer or cookie", async () => {
    for (const req of [request({ authorization: "Bearer expired" }), request({}, { admin_access: "expired" }), request({}, { admin_refresh: "valid-refresh" })]) {
      await expect(identityFromRequest(req, {} as Response)).rejects.toMatchObject({ status: 401 });
    }
  });
  it("retains an authenticated member or administrator", async () => {
    mode.member = true;
    expect(await identityFromRequest(request({ authorization: "Bearer valid-member" }), {} as Response)).toEqual({ audience: "member", memberId: 8 });
    mode.admin = true;
    expect(await identityFromRequest(request({}, { admin_access: "valid-admin" }), {} as Response)).toEqual({ audience: "admin", adminUserId: 7, role: "owner" });
  });
});
