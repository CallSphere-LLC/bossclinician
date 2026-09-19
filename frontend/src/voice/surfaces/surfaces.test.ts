import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOSS_CLINICIAN_PERSONA } from "@/voice/contract";
import type { VoiceSurfacePolicy } from "@/voice/contract";
import { ADMIN_POLICY, MEMBER_POLICY, PUBLIC_POLICY, policyForPath } from "@/voice/surfaces";

/**
 * What these tests are actually protecting.
 *
 * The policies are data, and data rots differently from code: nothing here can
 * fail to compile. A page gets renamed, a route moves, a destination quietly
 * points at an address that no longer exists — and the only symptom is an agent
 * that walks a visitor into the 404 page halfway through a walkthrough, or, far
 * worse, offers a stranger a tour of the owner's admin.
 *
 * So the invariants below are the ones with a victim: the public catalog cannot
 * name a private address, every address is a route this app really serves, every
 * tour stop resolves, and the admin never says a word its reader would not.
 *
 * The route lists are read out of `App.tsx` and `AdminApp.tsx` as text rather
 * than imported, because importing them would drag React, the router and eighty
 * lazily-loaded pages into a Node test that wants none of it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(srcRoot, relative), "utf8");
}

/** A path with no parameters and no wildcard — the only kind an agent can be sent to. */
function isConcrete(routePath: string): boolean {
  return !routePath.includes(":") && !routePath.includes("*");
}

/**
 * Both route tables are written two ways: the public table is an array of
 * objects (`path: "/about"`) that `entry-server` also reads, and everything else
 * is JSX (`path="/library"`). One pass over each form catches both.
 */
function routePathsIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/path(?:=|:\s*)"([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith("/") && isConcrete(value)) found.add(value);
  }
  return [...found];
}

const APP_ROUTES = new Set(routePathsIn(read("App.tsx")));

/** Admin routes are declared relative to the `/admin/*` branch they hang off. */
const ADMIN_ROUTES = new Set(
  routePathsIn(read("pages/admin/AdminApp.tsx")).map((route) =>
    route === "/" ? "/admin" : `/admin${route}`,
  ),
);

/** The address roots `App.tsx` keeps behind `RequireMember`. */
const MEMBER_ROOTS = [
  "/account",
  "/library",
  "/downloads",
  "/my-events",
  "/community",
  "/coaching",
  "/podcasts",
  "/newsletters",
  "/partners/dashboard",
];

function isPrivate(candidate: string): boolean {
  if (candidate === "/admin" || candidate.startsWith("/admin/")) return true;
  return MEMBER_ROOTS.some((root) => candidate === root || candidate.startsWith(`${root}/`));
}

const POLICIES: [string, VoiceSurfacePolicy][] = [
  ["public", PUBLIC_POLICY],
  ["member", MEMBER_POLICY],
  ["admin", ADMIN_POLICY],
];

describe.each(POLICIES)("the %s policy", (name, policy) => {
  it("names only addresses this app really serves", () => {
    const known = name === "admin" ? ADMIN_ROUTES : APP_ROUTES;
    for (const destination of policy.destinations) {
      expect(known, `${destination.key} → ${destination.path}`).toContain(destination.path);
    }
  });

  it("gives every destination a key of its own", () => {
    const keys = policy.destinations.map((destination) => destination.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only lists destinations this surface is allowed to travel to", () => {
    for (const destination of policy.destinations) {
      expect(destination.surfaces, destination.key).toContain(policy.surface);
    }
  });

  it("describes every destination well enough to arrive on it", () => {
    for (const destination of policy.destinations) {
      expect(destination.aliases.length, destination.key).toBeGreaterThan(1);
      expect(destination.narration.length, destination.key).toBeGreaterThan(30);
      expect(destination.label.length, destination.key).toBeGreaterThan(0);
    }
  });

  it("walks a tour whose every stop is somewhere it may go", () => {
    const keys = new Set(policy.destinations.map((destination) => destination.key));
    for (const stop of policy.tour) {
      expect(keys, `tour stop ${stop.destination}`).toContain(stop.destination);
      expect(stop.beats.length, `tour stop ${stop.destination}`).toBeGreaterThan(0);
      for (const beat of stop.beats) {
        expect(beat.focus.length, `${stop.destination} beat`).toBeGreaterThan(0);
        expect(beat.say.length, `${stop.destination} beat`).toBeGreaterThan(20);
      }
    }
  });

  it("shows a newcomer every page of the surface, once", () => {
    // Addendum 1: the walkthrough is the product's own table of contents, so a
    // page missing from it is a page nobody is ever shown.
    const visited = policy.tour.map((stop) => stop.destination);
    expect(new Set(visited).size).toBe(visited.length);
    expect([...visited].sort()).toEqual(
      policy.destinations.map((destination) => destination.key).sort(),
    );
  });

  it("introduces itself as Boss Clinician AI and never as Yvette", () => {
    expect(policy.agentName).toBe("Boss Clinician AI");
    expect(policy.greeting).toMatch(/Boss Clinician AI/);
    expect(policy.firstVisitGreeting).toMatch(/Boss Clinician AI/);
    expect(policy.instructions).toMatch(/never imply that you are her/i);
  });

  it("opens its instructions with the shared persona, word for word", () => {
    // Addendum 3. The browser re-sends these instructions to the live model
    // straight after the handshake, overwriting the copy the broker set when it
    // minted the session. A persona that lives only on the server therefore
    // survives about one second of a real call, and the agent spends the rest of
    // it introducing itself as something else — which no amount of manual
    // listening reliably catches. So it is pinned here instead.
    expect(policy.instructions.startsWith(BOSS_CLINICIAN_PERSONA)).toBe(true);
  });

  it("speaks in the one voice the app uses", () => {
    expect(policy.voice).toBe("coral");
  });

  it("caps a call at what the server will allow", () => {
    // Mirrors SURFACE_LIMITS in backend/src/services/voice/contract.ts. A browser
    // that promised longer would count a visitor down to a hang-up that already
    // happened.
    const cap = { public: 300, member: 900, admin: 1800 }[name as "public" | "member" | "admin"];
    expect(policy.maxSessionSeconds).toBe(cap);
  });
});

describe("the public catalog", () => {
  it("contains no member or admin address", () => {
    // The first half of role-based access: the model is never told a private
    // address exists, so it cannot ask to be taken to one. The server's own
    // check is the half that actually defends anything.
    for (const destination of PUBLIC_POLICY.destinations) {
      expect(isPrivate(destination.path), destination.path).toBe(false);
      expect(destination.surfaces).not.toContain("admin");
    }
  });

  it("switches on no privileged tool", () => {
    expect(PUBLIC_POLICY.tools).not.toContain("propose_admin_action");
    expect(PUBLIC_POLICY.tools).not.toContain("run_approved_action");
    expect(PUBLIC_POLICY.tools).not.toContain("my_account_summary");
  });
});

describe("the admin policy", () => {
  it("can only act with the owner's approval", () => {
    expect(ADMIN_POLICY.tools).toContain("propose_admin_action");
    expect(ADMIN_POLICY.tools).toContain("run_approved_action");
    expect(ADMIN_POLICY.instructions).toMatch(/approv/i);
  });

  it("says nothing to the owner in the language of the API", () => {
    // Everything on this surface is read aloud to a non-technical business
    // owner. "The link people land on", never "the slug".
    const jargon = /\b(webhook|json|slug|token|endpoint|payload|API key)\b/i;
    // The instructions are excluded deliberately: they are addressed to the
    // model rather than to Yvette, and the line that does the most work in them
    // is the one naming the words it must not use. Everything below is what she
    // actually hears.
    const spoken = [
      ADMIN_POLICY.greeting,
      ADMIN_POLICY.firstVisitGreeting,
      ...ADMIN_POLICY.destinations.flatMap((d) => [d.label, d.narration, ...d.aliases]),
      ...ADMIN_POLICY.tour.flatMap((stop) => [
        stop.purpose,
        ...stop.beats.flatMap((beat) => [beat.focus, beat.say]),
      ]),
    ];
    for (const line of spoken) {
      expect(line, line).not.toMatch(jargon);
    }
  });

  it("is told, in so many words, not to reach for that vocabulary", () => {
    expect(ADMIN_POLICY.instructions).toMatch(/non-technical business owner/i);
  });
});

describe("policyForPath", () => {
  it("hands the owner's console to the admin policy", () => {
    expect(policyForPath("/admin").surface).toBe("admin");
    expect(policyForPath("/admin/contacts/insights").surface).toBe("admin");
  });

  it("hands a signed-in portal page to the member policy", () => {
    expect(policyForPath("/library").surface).toBe("member");
    expect(policyForPath("/account/purchases/42/receipt").surface).toBe("member");
    expect(policyForPath("/community/club/live").surface).toBe("member");
  });

  it("keeps the public affiliate sign-up apart from a partner's own dashboard", () => {
    // The one pair a naive prefix test gets wrong, and the mistake would give
    // every visitor reading the sign-up page the member concierge.
    expect(policyForPath("/partners").surface).toBe("public");
    expect(policyForPath("/partners/dashboard").surface).toBe("member");
  });

  it("treats everything else, including the sign-in screens, as public", () => {
    expect(policyForPath("/").surface).toBe("public");
    expect(policyForPath("/login").surface).toBe("public");
    expect(policyForPath("/courses/start-your-practice").surface).toBe("public");
  });

  it("accepts a full location key, not just a path", () => {
    expect(policyForPath("/library?tab=courses#top").surface).toBe("member");
    expect(policyForPath("").surface).toBe("public");
  });
});
