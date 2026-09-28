import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import FreedomMasterclass from "./FreedomMasterclass";
import WatchNow from "./WatchNow";
import { freedomMasterclass, watchNow } from "@/content/freedomMasterclass";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

/**
 * Both pages rendered in Node, with no `window` and no `document`: rendering at
 * all is the proof that neither reaches for the browser while it renders.
 * /freedom-masterclass is server-rendered in production (render.ts);
 * /watch-now is not, but it must still be safe to render before hydration.
 */
function render(location: string, page: ReactElement): { html: string; head: HeadDescriptor[] } {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider
      runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}
    >
      <StaticRouter location={location}>{page}</StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

/** React escapes apostrophes and quotes in text; compare against the same. */
function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
}

describe("the Freedom Masterclass sign-up, server-rendered", () => {
  const { html, head } = render("/freedom-masterclass", <FreedomMasterclass />);

  it("describes itself, indexably", () => {
    expect(head.at(-1)?.title).toBe(freedomMasterclass.seo.title);
    expect(head.at(-1)?.description).toBe(freedomMasterclass.seo.description);
    expect(head.at(-1)?.noindex).toBeFalsy();
  });

  it("says her headline and promise before any script runs", () => {
    expect(html).toContain(escaped(freedomMasterclass.hero.titleAccent));
    expect(html).toContain(escaped(freedomMasterclass.register.body));
    expect(html).toContain(escaped(freedomMasterclass.forYou.items[0]));
    expect(html).toContain(escaped(freedomMasterclass.host.name));
  });

  it("asks for a first name and an email, twice, and every button scrolls to the first box", () => {
    expect(html).toContain('id="register"');
    expect(html).toContain('href="#register"');
    expect(html.match(/autoComplete="given-name"|autocomplete="given-name"/g)?.length).toBe(2);
    expect(html.match(/type="email"/g)?.length).toBe(2);
    expect(html).toContain('type="submit"');
  });

  it("never sends anybody to the resources hub or the old Kajabi page", () => {
    expect(html).not.toContain('href="/resources"');
    expect(html).not.toContain("bossclinician.com/freedom-masterclass");
  });
});

describe("the Watch Now page", () => {
  it("greets the visitor by the first name in the link, and is kept out of search", () => {
    const { html, head } = render("/watch-now?email=t%40example.com&name=Test", <WatchNow />);
    expect(html).toContain("Welcome, Test");
    expect(head.at(-1)?.noindex).toBe(true);
    // The email is in the query for parity with her Kajabi link; it is never shown.
    expect(html).not.toContain("t@example.com");
  });

  it("drops a name that is not a name rather than printing it", () => {
    const crafted = encodeURIComponent("your account is suspended, visit evil.example");
    const { html } = render(`/watch-now?name=${crafted}`, <WatchNow />);
    expect(html).toContain(">Welcome.<");
    expect(html).not.toContain("suspended");
  });

  it("offers the bundled action guide and the Lounge before any setting has loaded", () => {
    const { html } = render("/watch-now", <WatchNow />);
    expect(html).toContain('href="/downloads/practice-freedom-audit.pdf"');
    expect(html).toContain('href="/lounge"');
    expect(html).toContain(escaped(watchNow.step1.title));
    // The slot waits for the setting rather than showing an empty player.
    expect(html).not.toContain("<video");
    expect(html).not.toContain("<iframe");
  });
});
