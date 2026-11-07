import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COACHING_INSIGHTS, addCoachingInsights } from "./coachingInsights";
import { HOOKS } from "./hooks";
import {
  ENDINGS,
  PILLARS,
  ROUTES,
  checkFit,
  createPost,
  mergeBackup,
  recommendedRoute,
  series,
  toCSV,
  topicList,
  validateBackup,
} from "./engine";
import { STUDIO_TEMPLATE } from "./studioTemplate";

/*
 * The acceptance checks from Yvette's developer brief (31 Oct 2026, §7 and
 * §11). The rules themselves are the reference app's own code; these pin them
 * so a later edit cannot quietly change what she signed off.
 */

type S = Record<string, unknown>;
const base = (over: S): S => ({
  audience: "",
  audienceStage: "",
  topicId: "",
  pillar: "Strategy Tips",
  format: "Spoken",
  ctaType: "Spoken resource invitation",
  hashtags: "#BossClinician",
  override: { word: "", resource: "", url: "" },
  ...over,
});
const firstTopic = (s: S) => (topicList(s) as { id: string; route?: string }[])[0].id;
const clubTopic = (route: string) =>
  (topicList({ audience: "Club" }) as { id: string; route?: string }[]).find((t) => t.route === route)!.id;

describe("audience selection", () => {
  it("requires an audience, and a stage for Boardroom", () => {
    expect(checkFit(base({})).join(" ")).toMatch(/Choose Club, Lounge, or Boardroom/);
    const board = base({ audience: "Boardroom" });
    expect(checkFit(board).join(" ")).toMatch(/Choose a Boardroom stage/);
  });

  it("refuses a Club opening that assumes an existing practice", () => {
    const s = base({ audience: "Club", topicId: clubTopic("CLARITY"), hook: "Your current clients deserve better." });
    expect(checkFit(s).join(" ")).toMatch(/assumes existing practice assets/);
  });

  it("refuses a first-hire opening that assumes a team already exists", () => {
    const s = base({ audience: "Boardroom", audienceStage: "first", hook: "Your team keeps missing handoffs." });
    s.topicId = firstTopic(s);
    expect(checkFit(s).join(" ")).toMatch(/assumes a team already exists/);
  });
});

describe("resource routing", () => {
  it("sends each audience to the exact resource and URL in the brief", () => {
    expect(ROUTES.CLARITY.url).toBe("https://www.bossclinician.com/private-practice-for-you");
    expect(ROUTES.READY.url).toBe("https://www.bossclinician.com/practicepreptraining");
    expect(ROUTES.FREEDOM.url).toBe("https://www.bossclinician.com/freedom-masterclass");
    expect(ROUTES.HIRE.url).toBe("https://www.bossclinician.com/hiring-quiz");
    expect(ROUTES.LEAD.url).toBe("https://www.bossclinician.com/boss-assessment");
  });

  it("recommends by audience, stage and topic", () => {
    expect(recommendedRoute(base({ audience: "Club", topicId: clubTopic("CLARITY") }))).toBe("CLARITY");
    expect(recommendedRoute(base({ audience: "Club", topicId: clubTopic("READY") }))).toBe("READY");
    const lounge = base({ audience: "Lounge" });
    expect(recommendedRoute({ ...lounge, topicId: firstTopic(lounge) })).toBe("FREEDOM");
    expect(recommendedRoute(base({ audience: "Boardroom", audienceStage: "first" }))).toBe("HIRE");
    expect(recommendedRoute(base({ audience: "Boardroom", audienceStage: "team" }))).toBe("LEAD");
  });
});

describe("the three endings", () => {
  const s = base({ audience: "Boardroom", audienceStage: "first" });
  s.topicId = firstTopic(s);

  it("spoken invitation ends both script and caption, with a matching closing screen", () => {
    const p = createPost({ ...s, ctaType: "Spoken resource invitation" }, "", undefined);
    expect(p.script.trim().split("\n").pop()).toMatch(/DM “HIRE”/);
    expect(p.caption.trim().split("\n").pop()).toMatch(/DM “HIRE”/);
    expect(p.closingScreen).toBe("DM “HIRE” · Hiring-readiness quiz");
  });

  it("reflective ending keeps the DM out of the script and starts the caption with it", () => {
    const p = createPost({ ...s, ctaType: "Reflective ending" }, "", undefined);
    expect(p.script).not.toMatch(/DM “/);
    expect(p.caption.startsWith("If ")).toBe(true);
    expect(p.caption.split("\n")[0]).toMatch(/DM “HIRE”/);
    expect(p.closingScreen).toMatch(/DM “HIRE”/);
  });

  it("engagement question adds no invitation, keyword or URL anywhere", () => {
    const p = createPost({ ...s, ctaType: "Engagement question" }, "", undefined);
    for (const text of [p.script, p.caption, p.closingScreen, p.carousel]) expect(text).not.toMatch(/DM “|https?:\/\//);
    expect([p.dmWord, p.resourceName, p.resourceUrl]).toEqual(["", "", ""]);
  });
});

describe("truthful stories", () => {
  it("marks a story without supplied details as Needs details", () => {
    const s = base({ audience: "Lounge", pillar: "Success Story" });
    s.topicId = firstTopic(s);
    const p = createPost(s, "", undefined);
    expect(p.needsDetails).toBe(true);
    expect(p.status).toBe("Needs details");
    expect(p.script).toMatch(/\[ADD A DOCUMENTED BUSINESS RESULT/);
  });
});

describe("series planning", () => {
  it("rotates the five pillars in posting-date order", () => {
    const s = base({ audience: "Lounge" });
    s.topicId = firstTopic(s);
    const posts = series(s, 7, "2026-11-10", 2);
    expect(posts.map((p: { pillar: string }) => p.pillar)).toEqual([...PILLARS, PILLARS[0], PILLARS[1]]);
    expect(posts.map((p: { postingDate: string }) => p.postingDate).slice(0, 3)).toEqual(["2026-11-10", "2026-11-12", "2026-11-14"]);
  });
});

describe("evergreen library", () => {
  it("has 365 hooks, 73 per pillar, with unique ids", () => {
    expect(HOOKS).toHaveLength(365);
    for (const p of PILLARS) expect(HOOKS.filter((h: { pillar: string }) => h.pillar === p)).toHaveLength(73);
    expect(new Set(HOOKS.map((h: { id: number }) => h.id)).size).toBe(365);
  });
});

describe("Coaching Insights collection", () => {
  it("holds the five supplied drafts with their audiences", () => {
    expect(COACHING_INSIGHTS).toHaveLength(5);
    expect(COACHING_INSIGHTS.map((p: { audience: string }) => p.audience)).toEqual([
      "Boardroom",
      "Lounge",
      "Boardroom",
      "Boardroom",
      "Boardroom",
    ]);
  });

  it("adds all five once; a second click adds nothing and keeps edits", () => {
    const once = addCoachingInsights([]);
    expect(once).toHaveLength(5);
    once[0].script = "My edited copy";
    const twice = addCoachingInsights(once);
    expect(twice).toHaveLength(5);
    expect(twice[0].script).toBe("My edited copy");
  });

  it("leaves the posts unscheduled", () => {
    for (const p of addCoachingInsights([])) expect(p.postingDate || "").toBe("");
  });

  it("keeps the Practice Clarity Call wording, no DM word, a blank URL and the Coaching Insight label", () => {
    const fifth = COACHING_INSIGHTS[4];
    expect(fifth.contentLabel).toBe("Coaching Insight");
    expect(fifth.pillar).toBe("Success Story");
    expect(fifth.dmWord || "").toBe("");
    expect(fifth.resourceUrl || "").toBe("");
    expect(`${fifth.script} ${fifth.caption}`).toMatch(/Practice Clarity Call/);
  });
});

describe("backup and restore", () => {
  const backup = (posts: S[]) => ({
    app: "Boss Clinician Marketing Studio",
    schemaVersion: 3,
    settings: {},
    posts,
    savedIdeas: [1001],
  });

  it("rejects a malformed file without touching anything", () => {
    expect(() => validateBackup({ app: "x" })).toThrow(/not a supported/);
    expect(() => validateBackup(backup([{ id: "a" }, { id: "a" }]))).toThrow(/duplicate/);
  });

  it("merge skips identical posts and keeps a conflict as one separate copy, however often it is imported", () => {
    const current = { settings: { audience: "Club" }, posts: [{ id: "a", script: "mine" }], savedIdeas: [], legacy: {} };
    const incoming = backup([{ id: "a", script: "theirs" }, { id: "b", script: "new" }]);
    const first = mergeBackup(current, incoming).state;
    expect(first.posts).toHaveLength(3);
    expect(first.posts.find((p: S) => p.id === "a").script).toBe("mine");
    expect(first.settings).toEqual({ audience: "Club" });
    const again = mergeBackup(first, incoming);
    expect(again.state.posts).toHaveLength(3);
    expect(again.conflicts).toBe(0);
  });

  it("CSV carries every export field the brief lists", () => {
    const header = toCSV([]).split("\n")[0];
    for (const f of ["Audience", "Content pillar", "Hook", "Caption", "Hashtags", "DM word", "Resource URL", "Posting date", "Status"])
      expect(header).toContain(f);
  });
});

describe("embedding in the admin console", () => {
  const app = readFileSync(path.resolve(__dirname, "./studioApp.ts"), "utf8");
  const css = readFileSync(path.resolve(__dirname, "./studio.css"), "utf8");

  it("every element the screen looks up exists, prefixed so it cannot collide with the console", () => {
    const wanted = new Set([...app.matchAll(/\$\("([a-z][\w-]*)"\)/g)].map((m) => m[1]));
    const made = app + STUDIO_TEMPLATE;
    for (const id of wanted) expect(made.includes(`id="ms-${id}"`) || made.includes(`id = "ms-${id}"`), id).toBe(true);
    expect(STUDIO_TEMPLATE).not.toMatch(/\sid="(?!ms-)/);
    expect(app).not.toMatch(/document\.(getElementById|querySelector)/);
  });

  it("every style rule is scoped to the studio", () => {
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@import url\([^)]*\);/g, "")
      .replace(/@media[^{]+\{/g, "")
      .split("}")
      .map((r) => r.split("{")[0].trim())
      .filter(Boolean);
    for (const sel of rules) for (const one of sel.split(",")) expect(one.trim().startsWith(".ms-root"), one).toBe(true);
  });

  it("offers every ending option", () => {
    expect(ENDINGS).toEqual(["Spoken resource invitation", "Reflective ending", "Engagement question"]);
  });
});
