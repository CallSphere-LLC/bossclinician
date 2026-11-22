import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import Retreats from "./Retreats";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

function render() {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}>
      <StaticRouter location="/retreats">
        <Retreats />
      </StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

const CALL = "https://tidycal.com/profitwithyvette/retreat";

describe("retreat page, 21 Nov 2026 website handoff (row 245 section 10, row 247)", () => {
  const { html } = render();

  it("orders the hero brand → tagline → H1 → paragraph → dates → explore → talk link", () => {
    const hero = html.slice(html.indexOf('class="retreat-hero"'), html.indexOf('class="retreat-stats"'));
    const steps = [
      "FLOURISHEALER RETREATS",
      "Release. Restore. Reconnect.",
      "<h1>You Spend Your Days Making Room for Other People.<em>This Is Time Set Aside for You.</em></h1>",
      "A six-day, five-night Bali retreat for women in mental health and wellness",
      "June 15–20, 2027 • Ubud, Bali",
      "Explore the Retreat",
      "Have Questions? Talk With Yvette",
    ];
    let previous = -1;
    for (const step of steps) {
      const index = hero.indexOf(step);
      expect(index, step).toBeGreaterThan(previous);
      previous = index;
    }
    expect(hero).toContain(`href="${CALL}"`);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("uses the approved recognition, experience, audience and host story copy", () => {
    for (const text of [
      "Your Last Appointment Ends.",
      "Imagine Having Less to Coordinate Once You Arrive.",
      "Rest, Connection, and an Experience",
      "A Room Full of Women Who Understand the Work",
      "No CEUs are offered.",
      "I redesigned the Boss Clinician logo",
      "In July 2026, I went on a retreat in Thailand.",
      "This is our first FlourisHealer retreat.",
      "Choose the Room Option That Fits Your Trip.",
      "Reserve a Private Room",
      "You do not have to wait until you have nothing left to make room for yourself.",
      "Explore Room Options",
    ]) expect(html).toContain(text);
  });

  it("keeps the confirmed prices, guest count, dates and agreement route", () => {
    for (const text of ["$5,500", "11 GUESTS + YVETTE", "June 8, 2027", 'href="/retreatagreement"', 'href="/checkout/bali-private-room"']) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("/retreat-terms");
  });

  it("drops the absolute and clinical promises the handoff removes", () => {
    for (const text of [
      "Smaller also means safer",
      "nervous system actually lets go",
      "No hotel staff",
      "her clients feel it",
      "No agenda.",
      "Nothing for you to plan",
      "for clarity and protection",
      "this is the sign to stop waiting",
      "Five retreat guests",
    ]) expect(html).not.toContain(text);
  });

  it("shows the whole portrait Thailand photo with its real dimensions (row 247)", () => {
    expect(html).toMatch(
      /<img class="retreat-founder-photo" src="\/images\/retreat-founder-thailand-portrait\.webp" alt="[^"]+" width="942" height="1670"/,
    );
  });
});

describe("retreat page, 22 Nov 2026 owner answers (item 4: rooms and travel)", () => {
  const { html, head } = render();

  it("offers no public shared-room booking or price", () => {
    expect(html).not.toContain("$4,500");
    expect(html).not.toContain("bali-shared-room");
    expect(html).not.toMatch(/shared rooms are/i);
    expect(JSON.stringify(head)).not.toContain("4500");
  });

  it("answers the travel question with the owner's facts", () => {
    for (const text of [
      "Where and when is the retreat, and how do I get there?",
      "The retreat is in Ubud, Bali, June 15–20, 2027. Arrival is June 15 and checkout is June 20.",
      "Ngurah Rai International Airport, Denpasar (DPS)",
      "Airport transportation is provided during June 15–20 through designated group transfers.",
      "Exact pickup windows will be coordinated with guests.",
      "Airfare and travel insurance are not included.",
    ]) expect(html).toContain(text);
  });

  it("never implies unlimited or around-the-clock transport", () => {
    for (const text of ["Luxury airport transfers", "Luxury transportation to and from DPS", "part of every package", "I Gusti Ngurah Rai"]) {
      expect(html).not.toContain(text);
    }
  });

  it("sends no retreat button to the Boardroom application", () => {
    expect(html).not.toMatch(/href="\/apply/);
  });
});
