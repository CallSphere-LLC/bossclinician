import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env", () => ({ env: { frontendOrigin: "http://localhost:5173" } }));

import { memberAuthCsrf } from "./memberCsrf";

/**
 * `/api/auth` is where a browser holds a member session in a cookie (refresh,
 * logout) and where sign-in sets it. These pin the decision for each shape of
 * request a browser or a script can send.
 */

function run(method: string, headers: Record<string, string>): { status?: number } | "passed" {
  const req = {
    method,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  memberAuthCsrf(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  const [error] = (next as ReturnType<typeof vi.fn>).mock.calls[0] as [{ status?: number } | undefined];
  return error === undefined ? "passed" : error;
}

const HOST = "bossclinician.callsphere.site";

describe("memberAuthCsrf", () => {
  it("lets the site's own pages through, under whatever name the site is served", () => {
    expect(run("POST", { host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin" })).toBe("passed");
    expect(run("POST", { host: "bossclinician.com", origin: "https://bossclinician.com" })).toBe("passed");
  });

  it("lets a separately served frontend named by FRONTEND_ORIGIN through", () => {
    expect(run("POST", { host: "localhost:4000", origin: "http://localhost:5173", "sec-fetch-site": "same-site" })).toBe(
      "passed"
    );
  });

  it("refuses a post from another site, including a sibling on the same registrable domain", () => {
    for (const origin of ["https://evil.example", "https://other-app.callsphere.site", `https://${HOST}.evil.example`, "null"]) {
      expect(run("POST", { host: HOST, origin }), origin).toMatchObject({ status: 403 });
    }
  });

  it("refuses a browser request whose fetch metadata says it came from elsewhere, even without Origin", () => {
    expect(run("POST", { host: HOST, "sec-fetch-site": "cross-site" })).toMatchObject({ status: 403 });
    expect(run("POST", { host: HOST, "sec-fetch-site": "same-site" })).toMatchObject({ status: 403 });
  });

  it("lets a non-browser client through: no Origin and no fetch metadata means no ambient cookie to misuse", () => {
    expect(run("POST", { host: HOST })).toBe("passed");
  });

  it("does not stand in the way of reads", () => {
    expect(run("GET", { host: HOST, origin: "https://evil.example", "sec-fetch-site": "cross-site" })).toBe("passed");
  });
});
