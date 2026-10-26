import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(()=>({preload:vi.fn(async()=>{}), app:vi.fn()}));
vi.mock("./ssr/preload",()=>({preloadPublicRoute:calls.preload}));
vi.mock("./App",()=>({default:()=>{ calls.app(); return <p>Active site content</p>; }}));
import { render } from "./entry-server";

beforeEach(()=>vi.clearAllMocks());

describe("SSR host retirement",()=>{
  for (const origin of ["https://bossclinician.callsphere.site"]) {
    it.each(["/","/login","/admin/login","/api/auth/google/callback"])("returns 410 before route loading for "+origin+"%s",async path=>{
      const result=await render(path,{origin,indexable:true,data:{private:"must-not-serialize"}});
      expect(result.status).toBe(410);
      expect(result.html).toContain("This page is unavailable");
      expect(result.head).toContain("noindex, nofollow");
      expect(result.bootstrap).not.toContain("must-not-serialize");
      expect(calls.preload).not.toHaveBeenCalled();
      expect(calls.app).not.toHaveBeenCalled();
    });
  }
  it.each(["https://www.bossclinician.com","https://admin.bossclinician.com","https://admin.bossclinician.callsphere.site"])("keeps admin routing active for %s",async(origin)=>{
    const result=await render("/admin/login",{origin,indexable:true,data:{}});
    expect(result.status).toBe(200);
    expect(calls.app).toHaveBeenCalledOnce();
  });
  it("preserves the canonical member login and its normal renderer",async()=>{
    const result=await render("/login",{origin:"https://www.bossclinician.com",indexable:true,data:{}});
    expect(result.status).toBe(200);
    expect(result.html).toContain("Active site content");
    expect(calls.preload).toHaveBeenCalledWith("/login");
    expect(calls.app).toHaveBeenCalledOnce();
  });
});
