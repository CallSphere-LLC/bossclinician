import { describe, expect, it } from "vitest";
import { adminNavigationOrigin, isRetiredOrigin, isUnavailableUi } from "./hostAccess";
const admin="https://admin.bossclinician.com",publicSite="https://www.bossclinician.com";
describe("old public host retirement and restored admin",()=>{
  it.each(["https://bossclinician.callsphere.site","https://BOSSCLINICIAN.CALLSPHERE.SITE.:443","http://bossclinician.callsphere.site:8080"])("retires only old public origin %s",origin=>{
    expect(isRetiredOrigin(origin)).toBe(true);
    expect(isUnavailableUi(origin)).toBe(true);
    for(const path of ["/","/login","/admin/login"]) expect(adminNavigationOrigin(origin,path,admin,publicSite)).toBe("");
  });
  it.each([admin,"https://admin.bossclinician.callsphere.site",publicSite,"http://localhost:5173"])("keeps %s active",origin=>{
    expect(isUnavailableUi(origin)).toBe(false);
  });
  it.each(["/admin","/admin/login","/ADMIN/login","/%61dmin/login"])("restores www%s redirect to admin",path=>{
    expect(adminNavigationOrigin(publicSite,path,admin,publicSite)).toBe(admin);
    expect(adminNavigationOrigin(admin,path,admin,publicSite)).toBe("");
  });
  it.each(["/","/login","/admin/login"])("canonicalizes the legacy admin alias for %s",path=>{
    expect(adminNavigationOrigin("https://admin.bossclinician.callsphere.site",path,admin,publicSite)).toBe(admin);
  });
  it("preserves www member login and routes public pages off the admin host",()=>{
    expect(adminNavigationOrigin(publicSite,"/login",admin,publicSite)).toBe("");
    expect(adminNavigationOrigin(admin,"/login",admin,publicSite)).toBe(publicSite);
    expect(adminNavigationOrigin("http://localhost:5173","/admin/login","","")).toBe("");
  });
});
