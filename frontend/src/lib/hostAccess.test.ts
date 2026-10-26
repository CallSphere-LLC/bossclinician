import { describe, expect, it } from "vitest";
import { configuredAdminOrigin, isAdminUiPath, isRetiredOrigin, isUnavailableUi } from "./hostAccess";

describe("retired UI host policy", () => {
  it.each([
    "https://bossclinician.callsphere.site",
    "https://admin.bossclinician.com",
    "https://admin.bossclinician.callsphere.site",
    "https://ADMIN.BOSSCLINICIAN.COM.:443",
    "http://bossclinician.callsphere.site:8080",
  ])("blocks every UI path on %s even in development", (origin) => {
    expect(isRetiredOrigin(origin)).toBe(true);
    for (const path of ["/","/login","/library","/admin","/admin/login","/api/auth/google/callback"]) {
      expect(isUnavailableUi(origin,path)).toBe(true);
      expect(isUnavailableUi(origin,path,true)).toBe(true);
    }
  });
  it.each(["/admin","/admin/","/admin/login","/ADMIN/login","/%61dmin/login","/admin%2flogin","//admin/login"])("does not relocate %s to www", path => {
    expect(isAdminUiPath(path)).toBe(true);
    expect(isUnavailableUi("https://www.bossclinician.com",path,true)).toBe(true);
  });
  it.each(["/","/login","/signup","/forgot-password","/library","/account","/administrator"])("preserves public/member route %s", path => {
    expect(isUnavailableUi("https://www.bossclinician.com",path)).toBe(false);
  });
  it.each(["http://localhost:5173","http://127.0.0.1:5173","http://[::1]:5173"])("allows local admin development only at %s", origin => {
    expect(isUnavailableUi(origin,"/admin/login",true)).toBe(false);
    expect(isUnavailableUi(origin,"/admin/login",false)).toBe(true);
  });
  it("does not match unrelated or misleading host names as retired", () => {
    for (const origin of ["https://www.bossclinician.com","https://admin.bossclinician.com.example.invalid","not an origin"]) {
      expect(isRetiredOrigin(origin)).toBe(false);
    }
  });
  it("ignores production admin-origin settings and retired development settings", () => {
    expect(configuredAdminOrigin("https://admin.bossclinician.com",false)).toBe("");
    expect(configuredAdminOrigin("https://another-admin.example.invalid",false)).toBe("");
    expect(configuredAdminOrigin("https://admin.bossclinician.com",true)).toBe("");
    expect(configuredAdminOrigin("http://localhost:5173/",true)).toBe("http://localhost:5173");
    expect(configuredAdminOrigin("javascript:alert(1)",true)).toBe("");
  });
});
