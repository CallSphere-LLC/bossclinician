import { describe, expect, it } from "vitest";
import { loginPathFor, RETURN_PARAM, safeReturnPath } from "@/pages/admin/adminReturnTo";

describe("loginPathFor", () => {
  it("carries the deep link, with its query and hash, into the sign-in URL", () => {
    const login = loginPathFor({
      pathname: "/admin/sales/coupons",
      search: "?status=active",
      hash: "#top",
    });
    expect(login).toBe("/admin/login?next=%2Fadmin%2Fsales%2Fcoupons%3Fstatus%3Dactive%23top");

    // …and reading it back gives the same address.
    const next = new URL(login, "https://x.invalid").searchParams.get(RETURN_PARAM);
    expect(safeReturnPath(next)).toBe("/admin/sales/coupons?status=active#top");
  });

  it("adds nothing for the dashboard, where sign-in lands anyway", () => {
    expect(loginPathFor({ pathname: "/admin" })).toBe("/admin/login");
    expect(loginPathFor({ pathname: "/admin/", search: "" })).toBe("/admin/login");
  });

  it("keeps an unknown admin path, so the 404 is what you see after signing in", () => {
    expect(loginPathFor({ pathname: "/admin/zz-nope" })).toBe("/admin/login?next=%2Fadmin%2Fzz-nope");
  });
});

describe("safeReturnPath", () => {
  it("accepts admin paths", () => {
    expect(safeReturnPath("/admin/offers/42")).toBe("/admin/offers/42");
    expect(safeReturnPath("/admin/contacts?status=unconfirmed")).toBe(
      "/admin/contacts?status=unconfirmed",
    );
    expect(safeReturnPath("/admin")).toBe("/admin");
  });

  it("falls back to the dashboard when there is nothing usable", () => {
    expect(safeReturnPath(null)).toBe("/admin");
    expect(safeReturnPath(undefined)).toBe("/admin");
    expect(safeReturnPath("")).toBe("/admin");
  });

  it("never leaves the site", () => {
    for (const hostile of [
      "https://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example/admin",
      "\\\\evil.example",
      "/\t/evil.example/admin",
      "javascript:alert(1)",
      "admin/offers",
    ]) {
      expect(safeReturnPath(hostile), hostile).toBe("/admin");
    }
  });

  it("never leaves the admin", () => {
    expect(safeReturnPath("/account/billing")).toBe("/admin");
    expect(safeReturnPath("/administrator")).toBe("/admin");
    expect(safeReturnPath("/admin/../account")).toBe("/admin");
    expect(safeReturnPath("/admin/%2e%2e/account")).toBe("/admin");
  });

  it("never returns to the sign-in or invitation pages", () => {
    expect(safeReturnPath("/admin/login")).toBe("/admin");
    expect(safeReturnPath("/admin/login/")).toBe("/admin");
    expect(safeReturnPath("/admin/LOGIN?next=/admin/offers")).toBe("/admin");
    expect(safeReturnPath("/admin/invite/abc123")).toBe("/admin");
  });
});
