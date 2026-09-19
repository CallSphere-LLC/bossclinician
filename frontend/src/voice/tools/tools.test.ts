/**
 * The rules the concierge's hands rest on, checked without a browser.
 *
 * Everything here is pure on purpose: where the cursor lands, whether a target
 * is navigable from this session, what the model is actually told about a page,
 * how the walkthrough advances and whether an approval may be acted on. Those
 * are the decisions that would be expensive to get wrong and cheap to verify,
 * and none of them needs a DOM — which is itself the point of the seam.
 */

import { describe, expect, it } from "vitest";
import type { PageSnapshot, TourProgress, TourStop, VoiceSurface, VoiceSurfacePolicy } from "../contract";
import { resolveDestination, surfaceForPath } from "./navigation";
import { snapshotToPrompt } from "./page-reader";
import { captionWidth, pointerAnchor, scoreFocusText, shouldEscalateToFocusGroup } from "./spotlight";
import {
  advanceTour,
  createTourState,
  mergeTourProgress,
  readTourMirror,
  resumeCursor,
  tourSnapshotFrom,
  TOUR_START,
} from "./tour";
import { isRunnable } from "./admin-actions";

const VIEWPORT = { width: 1280, height: 800 };

function policyFor(surface: VoiceSurface, extra?: Partial<VoiceSurfacePolicy>): VoiceSurfacePolicy {
  return {
    surface,
    audience: surface === "public" ? "anonymous" : surface,
    agentName: "Boss Clinician AI",
    voice: "coral",
    instructions: "",
    greeting: "",
    firstVisitGreeting: "",
    tour: [],
    tools: [],
    maxSessionSeconds: 600,
    recordAudio: false,
    destinations: [
      {
        key: "home",
        path: "/",
        label: "Home",
        aliases: ["homepage", "start"],
        narration: "the front page.",
        surfaces: ["public", "member", "admin"],
      },
      {
        key: "library",
        path: "/library",
        label: "My library",
        aliases: ["my courses", "shelf"],
        narration: "the courses they own.",
        surfaces: ["member", "admin"],
      },
    ],
    ...extra,
  };
}

describe("pointerAnchor", () => {
  it("rests near the top of a tall card rather than over its body copy", () => {
    const anchor = pointerAnchor({ top: 200, left: 400, width: 300, height: 600 }, VIEWPORT);
    expect(anchor.x).toBe(550);
    expect(anchor.y).toBe(236);
  });

  it("sits on the centre of a short target", () => {
    const anchor = pointerAnchor({ top: 100, left: 100, width: 200, height: 40 }, VIEWPORT);
    expect(anchor.y).toBe(120);
  });

  it("keeps the whole cursor on screen when the target runs off the edges", () => {
    const anchor = pointerAnchor({ top: -400, left: 1240, width: 200, height: 60 }, VIEWPORT);
    expect(anchor.x).toBeLessThanOrEqual(VIEWPORT.width - 12 - 28);
    expect(anchor.y).toBeGreaterThanOrEqual(12);
  });

  it("flips the caption to the left when there is no room on the right", () => {
    expect(pointerAnchor({ top: 100, left: 40, width: 100, height: 40 }, VIEWPORT).captionSide).toBe("right");
    expect(pointerAnchor({ top: 100, left: 1100, width: 100, height: 40 }, VIEWPORT).captionSide).toBe("left");
  });

  it("sizes the caption to the screen rather than to a desktop", () => {
    expect(captionWidth({ width: 1280, height: 800 })).toBe(256);
    // A phone: the pill keeps a gutter either side instead of running off.
    expect(captionWidth({ width: 390, height: 844 })).toBe(256);
    expect(captionWidth({ width: 240, height: 600 })).toBe(208);
    // And never shrinks below something worth reading.
    expect(captionWidth({ width: 150, height: 600 })).toBe(140);
  });

  it("places the pointer and its caption sensibly at phone width", () => {
    const phone = { width: 390, height: 844 };
    // A full-width card: the tip stays on screen and the caption turns inward.
    const wide = pointerAnchor({ top: 320, left: 16, width: 358, height: 180 }, phone);
    expect(wide.x).toBeLessThanOrEqual(phone.width - 12 - 28);
    expect(wide.captionSide).toBe("left");
    // Hard against the left edge there is room for the pill on the right.
    const narrow = pointerAnchor({ top: 320, left: 0, width: 40, height: 40 }, { width: 640, height: 900 });
    expect(narrow.captionSide).toBe("right");
  });
});

describe("resolveDestination", () => {
  it("travels to a catalog key", () => {
    const result = resolveDestination(policyFor("public"), { destination: "home" });
    expect(result).toMatchObject({ ok: true, path: "/", label: "Home", known: true });
  });

  it("falls back to an alias when the model invents a key", () => {
    const result = resolveDestination(policyFor("public"), { destination: "homepage" });
    expect(result).toMatchObject({ ok: true, path: "/" });
  });

  it("accepts a raw in-app path that is not in the catalog", () => {
    const result = resolveDestination(policyFor("public"), { path: "blog/burnout-recovery/" });
    expect(result).toMatchObject({ ok: true, path: "/blog/burnout-recovery", known: false });
  });

  it("refuses an admin path on a public session, with something to say", () => {
    const result = resolveDestination(policyFor("public"), { path: "/admin/leads" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/admin area/i);
  });

  it("refuses a member path on a public session", () => {
    const result = resolveDestination(policyFor("public"), { path: "/account/purchases" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/signed in/i);
  });

  it("refuses a catalog entry that is not offered on this surface", () => {
    const result = resolveDestination(policyFor("public"), { destination: "library" });
    expect(result.ok).toBe(false);
  });

  it("lets a higher surface stand on a lower one's pages", () => {
    expect(resolveDestination(policyFor("admin"), { path: "/account/billing" }).ok).toBe(true);
    expect(resolveDestination(policyFor("member"), { path: "/blog" }).ok).toBe(true);
    expect(resolveDestination(policyFor("member"), { path: "/admin" }).ok).toBe(false);
  });

  it("will not be walked out of the app by a URL", () => {
    for (const path of ["https://example.com/admin", "//example.com/x", "javascript:alert(1)"]) {
      expect(resolveDestination(policyFor("public"), { path }).ok).toBe(false);
    }
  });

  it("cannot be tricked into the admin area by a traversal", () => {
    const result = resolveDestination(policyFor("public"), { path: "/blog/../admin/leads" });
    expect(result.ok).toBe(false);
  });

  it("says something useful when nothing was named at all", () => {
    const result = resolveDestination(policyFor("public"), {});
    expect(result.ok).toBe(false);
  });
});

describe("surfaceForPath", () => {
  it("knows which face of the app a path belongs to", () => {
    expect(surfaceForPath("/")).toBe("public");
    expect(surfaceForPath("/blog/x")).toBe("public");
    expect(surfaceForPath("/library")).toBe("member");
    expect(surfaceForPath("/account/billing")).toBe("member");
    expect(surfaceForPath("/admin/leads")).toBe("admin");
    // A public path that merely starts with the same letters is not the portal.
    expect(surfaceForPath("/libraries-we-love")).toBe("public");
    // The router matches routes without regard to case, so the gate must too.
    expect(surfaceForPath("/Admin/Leads")).toBe("admin");
    expect(surfaceForPath("/Account/billing")).toBe("member");
  });
});

describe("snapshotToPrompt", () => {
  const snapshot: PageSnapshot = {
    path: "/admin/dashboard",
    title: "Dashboard",
    headings: ["This month", "Enquiries"],
    kpis: [{ label: "Revenue", value: "$4,120" }],
    excerpt: "Everything that happened since the first of the month.",
    focusTargets: ["Revenue", "New enquiries"],
    sparse: false,
  };

  it("hands the model the page's own figures rather than a description of them", () => {
    const prompt = snapshotToPrompt(snapshot);
    expect(prompt).toContain("CURRENT PAGE: Dashboard (/admin/dashboard)");
    expect(prompt).toContain("Revenue = $4,120");
    expect(prompt).toContain("This month · Enquiries");
  });

  it("names the pointing tool and the exact labels it accepts", () => {
    const prompt = snapshotToPrompt(snapshot);
    expect(prompt).toContain("Revenue · New enquiries");
    expect(prompt).toContain("point_at");
  });

  it("asks for a pause instead of inventing content when the page is still drawing", () => {
    const prompt = snapshotToPrompt({ ...snapshot, sparse: true });
    expect(prompt).toMatch(/still drawing/);
    expect(prompt).not.toContain("Revenue = ");
  });
});

describe("the walkthrough's itinerary", () => {
  const tour: readonly TourStop[] = [
    {
      destination: "home",
      purpose: "Where everything starts.",
      beats: [
        { focus: "Welcome", say: "This is the front page." },
        { focus: "Start here", say: "And this is where to begin." },
      ],
    },
    {
      destination: "library",
      purpose: "The courses they own.",
      beats: [{ focus: "My library", say: "Everything they have bought lives here." }],
    },
  ];

  const everythingIsThere = () => true;

  it("arrives before it narrates, then walks the beats in order", () => {
    const first = advanceTour(TOUR_START, tour, everythingIsThere);
    expect(first.step).toMatchObject({ kind: "travel", stopIndex: 0 });

    const second = advanceTour(first.cursor, tour, everythingIsThere);
    expect(second.step).toMatchObject({ kind: "beat", stopIndex: 0, beatIndex: 0 });

    const third = advanceTour(second.cursor, tour, everythingIsThere);
    expect(third.step).toMatchObject({ kind: "beat", beatIndex: 1 });
  });

  it("travels on to the next stop once a page's beats are done", () => {
    let cursor = { stopIndex: 0, beatIndex: 2 };
    const next = advanceTour(cursor, tour, everythingIsThere);
    expect(next.step).toMatchObject({ kind: "travel", stopIndex: 1 });
    cursor = next.cursor;
    expect(advanceTour(cursor, tour, everythingIsThere).step).toMatchObject({ kind: "beat", stopIndex: 1 });
  });

  it("skips a beat whose target has been renamed away, rather than stranding anyone", () => {
    const missing = (focus: string) => focus !== "Welcome";
    const step = advanceTour({ stopIndex: 0, beatIndex: 0 }, tour, missing).step;
    expect(step).toMatchObject({ kind: "beat", beatIndex: 1 });
  });

  it("moves on to the next page when nothing on this one can be pointed at", () => {
    const nothing = () => false;
    const step = advanceTour({ stopIndex: 0, beatIndex: 0 }, tour, nothing).step;
    expect(step).toMatchObject({ kind: "travel", stopIndex: 1 });
  });

  it("finishes rather than running off the end", () => {
    const step = advanceTour({ stopIndex: 1, beatIndex: 1 }, tour, () => false).step;
    expect(step).toEqual({ kind: "done" });
  });

  it("resumes where a dropped call left off", () => {
    const progress: TourProgress = { surface: "public", index: 1, completed: false, updatedAt: 1 };
    expect(resumeCursor(progress, tour)).toEqual({ completed: false, cursor: { stopIndex: 1, beatIndex: -1 } });
  });

  it("never re-offers a walkthrough that was finished or declined", () => {
    const declined: TourProgress = { surface: "public", index: 0, completed: true, updatedAt: 1 };
    expect(resumeCursor(declined, tour).completed).toBe(true);
  });

  it("starts at the top for someone who has never been offered it", () => {
    expect(resumeCursor(null, tour)).toEqual({ completed: false, cursor: TOUR_START });
  });

  it("remembers a decline that only ever reached this device", () => {
    const declinedHere: TourProgress = { surface: "public", index: 0, completed: true, updatedAt: 5 };
    // The server has no account for an anonymous visitor, so it answers
    // "nothing yet" forever; the mirror is the only record of the "no".
    expect(mergeTourProgress(null, declinedHere)).toEqual(declinedHere);
    const partway: TourProgress = { surface: "public", index: 2, completed: false, updatedAt: 9 };
    expect(mergeTourProgress(partway, declinedHere)).toEqual(declinedHere);
  });

  it("answers the local record without waiting, and without a browser at all", () => {
    // The opening line reads this the instant its lookup times out, so it has
    // to be safe where there is no storage to read — a server render, or a
    // browser that refuses it.
    expect(readTourMirror("public")).toBeNull();
  });

  it("takes the more recent position when neither side has finished", () => {
    const older: TourProgress = { surface: "member", index: 1, completed: false, updatedAt: 10 };
    const newer: TourProgress = { surface: "member", index: 3, completed: false, updatedAt: 20 };
    expect(mergeTourProgress(older, newer)).toEqual(newer);
    expect(mergeTourProgress(newer, older)).toEqual(newer);
  });

  it("lands on the last stop when the itinerary has since been shortened", () => {
    const stale: TourProgress = { surface: "public", index: 9, completed: false, updatedAt: 1 };
    expect(resumeCursor(stale, tour).cursor.stopIndex).toBe(1);
  });
});

describe("what the walkthrough bar is shown", () => {
  const tour: readonly TourStop[] = [
    { destination: "home", purpose: "Where everything starts.", beats: [] },
    { destination: "library", purpose: "Their courses.", beats: [] },
  ];
  const policy = policyFor("member", { tour });

  it("shows nothing at all until a walkthrough is running", () => {
    expect(tourSnapshotFrom(policy, createTourState())).toBeNull();
  });

  it("names the stop it is on, counted from zero as the progress record is", () => {
    const state = { ...createTourState(), running: true, cursor: { stopIndex: 1, beatIndex: 0 } };
    expect(tourSnapshotFrom(policy, state)).toEqual({
      index: 1,
      total: 2,
      label: "My library",
      paused: false,
    });
  });

  it("stays inside the itinerary when the cursor has run past its end", () => {
    const state = { ...createTourState(), running: true, cursor: { stopIndex: 9, beatIndex: 0 } };
    expect(tourSnapshotFrom(policy, state)?.index).toBe(1);
  });

  it("says when it is paused, and shows nothing for a surface with no walkthrough", () => {
    const state = { ...createTourState(), running: true, paused: true };
    expect(tourSnapshotFrom(policy, state)?.paused).toBe(true);
    expect(tourSnapshotFrom(policyFor("public"), state)).toBeNull();
  });
});

describe("approvals", () => {
  const later = Date.now() + 60_000;

  it("runs an ordinary change the owner approved", () => {
    expect(isRunnable({ approved: true, via: "voice", expiresAt: later, risk: "normal" }, Date.now()).ok).toBe(true);
  });

  it("refuses a destructive change on a spoken yes alone", () => {
    const gate = isRunnable({ approved: true, via: "voice", expiresAt: later, risk: "destructive" }, Date.now());
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toMatch(/tap Approve/);
  });

  it("accepts a destructive change once she has tapped the card", () => {
    expect(isRunnable({ approved: true, via: "click", expiresAt: later, risk: "destructive" }, Date.now()).ok).toBe(true);
  });

  it("does nothing on a refusal or a stale yes", () => {
    expect(isRunnable({ approved: false, via: "cancelled", expiresAt: later, risk: "normal" }, Date.now()).ok).toBe(false);
    expect(isRunnable({ approved: true, via: "click", expiresAt: Date.now() - 1, risk: "normal" }, Date.now()).ok).toBe(false);
  });
});

describe("matching what was said to what is on the page", () => {
  it("prefers the element whose own label is the phrase", () => {
    const exact = scoreFocusText("revenue this month", { label: "revenue this month", text: "$4,120", authored: true });
    const loose = scoreFocusText("revenue this month", { label: "", text: "Revenue is up on last month across every product line." });
    expect(exact).toBeGreaterThan(loose);
  });

  it("follows the words people actually use", () => {
    expect(scoreFocusText("my receipt", { label: "Invoice", text: "Invoice 1042" })).toBeGreaterThan(0);
  });

  it("ignores a phrase with nothing in common", () => {
    expect(scoreFocusText("pricing", { label: "Cancel", text: "Cancel" })).toBe(0);
  });

  it("widens to the whole card when the request only names the card", () => {
    expect(shouldEscalateToFocusGroup("the revenue tile", "Revenue tile", { selfSufficient: false })).toBe(true);
  });

  it("leaves a button alone when the request named the button", () => {
    expect(shouldEscalateToFocusGroup("the export button", "Revenue tile", { selfSufficient: true })).toBe(false);
  });
});
