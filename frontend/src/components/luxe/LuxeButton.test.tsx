import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { LuxeButton } from "./LuxeButton";

function render(node: ReactNode): string {
  return renderToStaticMarkup(<StaticRouter location="/">{node}</StaticRouter>);
}

/**
 * A course's link, a session's meeting URL and the footer's Instagram all reach
 * this component as admin-typed strings. React 19 only swaps a `javascript:`
 * href for one that throws, which still ships a dead link carrying the scheme,
 * and react-router's Link passes any schemed `to` straight through, so the
 * button itself is where a stored script has to stop.
 */
describe("LuxeButton", () => {
  it("keeps an ordinary external address", () => {
    const html = render(<LuxeButton href="https://zoom.us/j/123" target="_blank">Join</LuxeButton>);
    expect(html).toContain('href="https://zoom.us/j/123"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps an on-page anchor and an in-app route", () => {
    expect(render(<LuxeButton href="#library">Browse</LuxeButton>)).toContain('href="#library"');
    expect(render(<LuxeButton to="/courses">Courses</LuxeButton>)).toContain('href="/courses"');
  });

  it("drops a script address from href", () => {
    const html = render(<LuxeButton href="javascript:alert(document.cookie)">Enrol</LuxeButton>);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href=");
  });

  it("drops a script address from to", () => {
    const html = render(<LuxeButton to="javascript:alert(document.cookie)">Enrol</LuxeButton>);
    expect(html).not.toContain("javascript:");
  });
});
