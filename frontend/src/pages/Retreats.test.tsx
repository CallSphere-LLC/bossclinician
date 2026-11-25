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
      "The retreat is in Ubud, Bali.",
      "Ngurah Rai International Airport, Denpasar (DPS)",
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

/** React escapes apostrophes in text; compare against the page's own encoding. */
const esc = (text: string) => text.replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

describe("retreat page, second 22 Nov 2026 owner reply (item 4: FAQ wording, item 7: insurance)", () => {
  const { html, head } = render();

  it("uses her exact dietary, activity, mobility and transportation answers", () => {
    for (const text of [
      "Please share dietary preferences, restrictions, and allergies in your pre-retreat questionnaire. We’ll review requests with the villa team and confirm what can be accommodated. For severe allergies, contact retreats@bossclinician.com before booking.",
      "You’re welcome to opt out of an activity and take personal time. Please let us know so we can coordinate the group’s plans. Contact us about any activity-specific concerns before travel.",
      "If you have mobility or accessibility needs, please contact retreats@bossclinician.com before booking. We’ll confirm relevant details about the villa, transportation, and planned activities so you can assess whether the retreat meets your needs.",
      "The retreat runs June 15–20, 2027, with checkout June 20. Airport transportation is provided through designated group transfers during these dates. Final shuttle windows will be coordinated with guests and shared before travel.",
    ]) expect(html).toContain(esc(text));
  });

  it("drops the old chef promise and never presents transport as on demand", () => {
    for (const text of [
      "Our private villa chef can accommodate most dietary needs",
      "Exact pickup windows",
      "on demand",
      "on-demand",
      "alternative treatment",
      "replacement",
    ]) expect(html).not.toContain(text);
  });

  it("says travel insurance is strongly recommended, not required", () => {
    expect(html).toContain("Travel insurance is strongly recommended, not required.");
    expect(html).not.toMatch(/insurance (is )?(required|mandatory)/i);
  });

  it("keeps June 15–20, 2027 with checkout June 20 and declares /retreats canonical", () => {
    expect(html).toContain("June 15–20, 2027");
    expect(head[0]?.canonicalPath).toBe("/retreats");
  });

  it("puts the activity and mobility questions straight after the dietary one", () => {
    const diet = html.indexOf("I have dietary restrictions. Can those be accommodated?");
    const activity = html.indexOf("Do I have to take part in every activity?");
    const mobility = html.indexOf("What if I have mobility or accessibility needs?");
    const flight = html.indexOf("When should I book my flight?");
    expect(diet).toBeGreaterThan(-1);
    expect(activity).toBeGreaterThan(diet);
    expect(mobility).toBeGreaterThan(activity);
    expect(flight).toBeGreaterThan(mobility);
  });
});

describe("retreat villa video (row 256)", () => {
  it("stays off the published page until the owner approves the ?preview=video link", () => {
    const { html } = render();
    expect(html).not.toContain("retreat-bali-preview-v1");
    expect(html).not.toContain("Imagine Six Days Where You");
  });

  it("assets and captions for the section exist", async () => {
    const { existsSync } = await import("node:fs");
    for (const file of ["-720.mp4", "-540.mp4", "-poster.jpg"]) {
      expect(existsSync(new URL(`../../public/videos/retreat-bali-preview-v1${file}`, import.meta.url)), file).toBe(true);
    }
    expect(existsSync(new URL("../../public/videos/captions/retreat-bali-preview-v1.en.vtt", import.meta.url))).toBe(true);
  });
});
