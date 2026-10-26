import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
vi.mock("@/lib/siteOrigins",()=>({ADMIN_ORIGIN:"https://admin.bossclinician.com",PUBLIC_ORIGIN:"https://www.bossclinician.com"}));
import { AdminOriginBoundary } from "./AdminOriginBoundary";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";
afterEach(()=>vi.unstubAllGlobals());
function render(origin:string,pathname:string) {
  const mounted=vi.fn(),headSink:HeadDescriptor[]=[];
  function Content(){mounted();return <form aria-label="Active login"><input name="email" /></form>;}
  const html=renderToStaticMarkup(<SsrProvider runtime={{payload:{origin,indexable:true,data:{}},headSink}}>
    <StaticRouter location={pathname}><AdminOriginBoundary><Content /></AdminOriginBoundary></StaticRouter>
  </SsrProvider>);
  return {html,mounted,headSink};
}
describe("restored admin origin boundary",()=>{
  it.each(["/","/login","/admin/login","/library#admin-preview"])("blocks only old public host at %s",path=>{
    const result=render("https://bossclinician.callsphere.site",path);
    expect(result.html).toContain("This page is unavailable");
    expect(result.html).not.toContain("Opening the site");
    expect(result.mounted).not.toHaveBeenCalled();
    expect(result.headSink[0]).toMatchObject({httpStatus:410,noindex:true});
  });
  it.each([["https://admin.bossclinician.com","/admin/login"],["https://www.bossclinician.com","/login"]])("renders active login on %s%s",(origin,path)=>{
    const result=render(origin,path);
    expect(result.html).toContain('aria-label="Active login"');
    expect(result.mounted).toHaveBeenCalledOnce();
    expect(result.headSink).toEqual([]);
  });
  it.each([["https://www.bossclinician.com","/admin/login"],["https://admin.bossclinician.callsphere.site","/admin/login"],["https://admin.bossclinician.callsphere.site","/"],["https://admin.bossclinician.com","/login"]])("uses the original redirect boundary for %s%s",(origin,path)=>{
    const result=render(origin,path);
    expect(result.html).toContain("Opening the site");
    expect(result.html).not.toContain("unavailable");
    expect(result.mounted).not.toHaveBeenCalled();
  });
  it("uses the browser's actual host despite stale bootstrap data",()=>{
    vi.stubGlobal("window",{location:{origin:"https://bossclinician.callsphere.site",replace:vi.fn()}});
    expect(render("https://admin.bossclinician.com","/admin/login").html).toContain("This page is unavailable");
  });
});
