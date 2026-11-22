import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import RetreatAgreement from "./RetreatAgreement";
import { SsrProvider } from "@/ssr/context";

/**
 * /retreatagreement after Yvette's second reply of 22 Nov 2026: the shared room
 * stays (by arrangement, one room, no matching), transport is designated group
 * transfers in her wording, and travel insurance is strongly recommended, not
 * required, everywhere on the page.
 */
const html = renderToString(
  <SsrProvider runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: [] }}>
    <StaticRouter location="/retreatagreement">
      <RetreatAgreement />
    </StaticRouter>
  </SsrProvider>,
);
const text = html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

describe("/retreatagreement (owner reply 22 Nov 2026, items 4 and 7)", () => {
  it("keeps the shared room at $4,500 per person, by arrangement for a guest bringing a friend", () => {
    expect(text).toContain("Shared Luxury Room");
    expect(text).toContain("$4,500");
    expect(text).toContain("There is one shared room, available by arrangement for a guest bringing a friend.");
    expect(text).toContain("It is not offered for public booking, and roommate matching is not offered.");
    expect(text).toContain("The Shared Luxury Room is not a public booking option, and roommate matching is not offered.");
  });

  it("no longer assigns roommates or suggests open shared-room availability", () => {
    expect(text).not.toContain("thoughtfully assigned");
    expect(text).not.toContain("Shared rooms may be available separately");
  });

  it("states transport in her wording and never as on-demand", () => {
    expect(text).toContain(
      "The retreat runs June 15–20, 2027, with checkout June 20. Airport transportation is provided through designated group transfers during these dates. Final shuttle windows will be coordinated with guests and shared before travel.",
    );
    expect(text).not.toContain("Group luxury shuttle transportation will be provided");
    expect(text).not.toMatch(/on[- ]demand/i);
  });

  it("calls travel insurance strongly recommended, not required, in every section", () => {
    expect(text).not.toMatch(/insurance is required/i);
    expect(text).toContain("Travel insurance is strongly recommended, not required, to help protect against these circumstances.");
    expect(text).toContain("strongly recommended, not required — see Section 7");
    expect(text).toContain("Travel insurance is strongly recommended, not required, for all participants.");
  });

  it("keeps the published prices, deposit and deadline", () => {
    for (const t of ["$5,500", "$500", "June 8, 2027", "June 15–20, 2027"]) expect(text).toContain(t);
  });
});
