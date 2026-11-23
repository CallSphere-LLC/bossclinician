import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MissingRetreatAccessHelp } from "./RetreatDashboardPage";

describe("retreat dashboard access help", () => {
  it("guides a dummy account without dashboard access through email verification", () => {
    const html = renderToStaticMarkup(<MissingRetreatAccessHelp />);
    expect(html).toContain("If you booked with a different email than you use to sign in");
    expect(html).toContain("help verifying your booking and restoring access");
    expect(html).toContain('href="mailto:retreats@bossclinician.com"');
  });
});
