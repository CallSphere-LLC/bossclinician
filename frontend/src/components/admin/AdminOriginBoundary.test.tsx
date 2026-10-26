import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { AdminOriginBoundary } from "./AdminOriginBoundary";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

afterEach(()=>vi.unstubAllGlobals());

function render(origin: string, pathname: string) {
  const mounted = vi.fn();
  const headSink: HeadDescriptor[] = [];
  function MemberContent() { mounted(); return <form aria-label="Member login"><input name="email" /></form>; }
  const html = renderToStaticMarkup(
    <SsrProvider runtime={{payload:{origin,indexable:true,data:{}},headSink}}>
      <StaticRouter location={pathname}>
        <AdminOriginBoundary><MemberContent /></AdminOriginBoundary>
      </StaticRouter>
    </SsrProvider>,
  );
  return {html,mounted,headSink};
}

describe("UI boundary before authentication and routing", () => {
  for (const host of ["bossclinician.callsphere.site","admin.bossclinician.com","admin.bossclinician.callsphere.site"]) {
    it.each(["/","/login","/admin/login","/library#admin-preview"])("renders unavailable for "+host+"%s without mounting children", path => {
      const result = render("https://"+host,path);
      expect(result.html).toContain("This page is unavailable");
      expect(result.html).toContain('href="https://www.bossclinician.com/"');
      expect(result.html).not.toMatch(/<form|<input|Opening the site|admin\/login/);
      expect(result.mounted).not.toHaveBeenCalled();
      expect(result.headSink).toEqual([expect.objectContaining({httpStatus:410,noindex:true})]);
    });
  }
  it("leaves www member login available but not www admin login", () => {
    const member = render("https://www.bossclinician.com","/login");
    expect(member.html).toContain('aria-label="Member login"');
    expect(member.mounted).toHaveBeenCalledOnce();
    const admin = render("https://www.bossclinician.com","/admin/login");
    expect(admin.html).toContain("This page is unavailable");
    expect(admin.mounted).not.toHaveBeenCalled();
  });
  it("uses the real browser host instead of a stale public bootstrap origin", () => {
    const replace = vi.fn();
    vi.stubGlobal("window",{location:{origin:"https://admin.bossclinician.com",replace}});
    const result = render("https://www.bossclinician.com","/login");
    expect(result.html).toContain("This page is unavailable");
    expect(result.mounted).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
