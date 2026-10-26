import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(()=>({
  render:vi.fn(),createRoot:vi.fn(),hydrateRoot:vi.fn(),preload:vi.fn(async()=>{}),entrances:vi.fn(),
}));
vi.mock("react-dom/client",()=>({createRoot:calls.createRoot,hydrateRoot:calls.hydrateRoot}));
vi.mock("./ssr/preload",()=>({preloadPublicRoute:calls.preload}));
vi.mock("./App",()=>({default:()=>null}));
vi.mock("./hooks/useEntranceMotion",()=>({enableEntrances:calls.entrances}));
vi.mock("./lib/adminTransport",()=>({clearLegacyAdminToken:vi.fn()}));
vi.mock("./lib/siteTheme",()=>({initializeSiteTheme:vi.fn()}));

beforeEach(()=>{
  vi.resetModules();
  vi.clearAllMocks();
  calls.createRoot.mockReturnValue({render:calls.render});
});
afterEach(()=>vi.unstubAllGlobals());

async function boot(origin:string,pathname:string,stalePayload=true) {
  const root = {};
  const replace = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal("window",{location:{origin,pathname,replace}});
  vi.stubGlobal("fetch",fetch);
  vi.stubGlobal("document",{getElementById:(id:string)=>id==="root"?root:stalePayload?{
    textContent:JSON.stringify({origin:"https://www.bossclinician.com",indexable:true,data:{private:"stale-secret"}}),
  }:null});
  await import("./entry-client");
  await vi.dynamicImportSettled();
  return {root,replace,fetch};
}

describe("cached client document retirement",()=>{
  it.each([
    ["https://bossclinician.callsphere.site","/"],
    ["https://admin.bossclinician.com","/admin/login"],
    ["https://admin.bossclinician.com","/login"],
    ["https://www.bossclinician.com","/admin/login"],
  ])("replaces stale SSR content at %s%s without preloading or redirecting",async(origin,path)=>{
    const result=await boot(origin,path);
    expect(calls.createRoot).toHaveBeenCalledWith(result.root);
    expect(calls.render).toHaveBeenCalledOnce();
    expect(JSON.stringify(calls.render.mock.calls[0][0])).not.toContain("stale-secret");
    expect(calls.hydrateRoot).not.toHaveBeenCalled();
    expect(calls.preload).not.toHaveBeenCalled();
    expect(result.replace).not.toHaveBeenCalled();
    expect(result.fetch).not.toHaveBeenCalled();
  });
  it("keeps canonical member login on its client boot path",async()=>{
    await boot("https://www.bossclinician.com","/login",false);
    expect(calls.createRoot).toHaveBeenCalledOnce();
    expect(calls.render).toHaveBeenCalledOnce();
    expect(calls.entrances).toHaveBeenCalledOnce();
  });
  it("still hydrates ordinary www SSR pages",async()=>{
    await boot("https://www.bossclinician.com","/");
    expect(calls.preload).toHaveBeenCalledWith("/");
    expect(calls.hydrateRoot).toHaveBeenCalledOnce();
    expect(calls.createRoot).not.toHaveBeenCalled();
  });
});
