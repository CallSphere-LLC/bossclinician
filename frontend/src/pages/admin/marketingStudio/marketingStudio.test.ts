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
import {
  DEFAULT_PROFILES,
  RETREAT_AUDIENCE,
  RETREAT_MESSAGING,
  allProfiles,
  allRetreats,
  checkMessage,
  createMessagePost,
  messageResource,
  profilesFor,
  reviewPost,
  routeTable,
  splitPost,
} from "./messaging";

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

/*
 * Messaging-first addenda (20 and 21 Nov 2026): buyer profiles, angles,
 * FlourisHealer Retreats, the CLARITY / READY / NICHE Club routes, and the
 * promise that the studio Yvette saved before the update opens unchanged.
 */
const profile = (id: string) => DEFAULT_PROFILES.find((p: { id: string }) => p.id === id)!;
const msg = (over: S): S => ({ ...base({}), mode: "messaging", ctaAction: "Comment", messageFormat: "Talking-head", ...over });
const club = (topicId: string, over: S = {}) => msg({ audience: "Club", topicId, profileId: "profile-club-agency", angle: "problem", ...over });
const ctxFor = (id: string, retreat?: unknown) => ({ profile: profile(id), retreat, messaging: RETREAT_MESSAGING, routeEdits: {} });

// Her saved document as it was on 7 Nov 2026 (version 8).
const SAVED_7_NOV = {
  posts: [],
  legacy: {},
  settings: {
    hook: "“Your approach to [topic] can leave room for rest.”",
    story: "",
    format: "B-roll",
    lesson: "",
    pillar: "Inspirational Quote",
    result: "",
    context: "",
    ctaType: "Reflective ending",
    topicId: "systems",
    audience: "Lounge",
    hashtags: "#BossClinician #PrivatePractice #PracticeOwnership",
    override: { url: "", word: "", resource: "" },
    postingDate: "",
    contributors: "",
    audienceStage: "",
  },
  hookEdits: {},
  savedIdeas: [],
  customHooks: [],
};

describe("studio saved before the update", () => {
  it("still produces the same legacy post (DM wording kept when no CTA action was saved)", () => {
    const p = createPost({ ...SAVED_7_NOV.settings }, SAVED_7_NOV.settings.hook, "x");
    expect(p.pillar).toBe("Inspirational Quote");
    expect(p.caption.split("\n")[0]).toMatch(/DM “FREEDOM”/);
    expect(p.closingScreen).toBe("DM “FREEDOM” · Free masterclass");
  });

  it("her saved library hook is personalised in a messaging-first post, never left as [topic]", () => {
    const s = msg({ ...SAVED_7_NOV.settings, mode: "messaging", profileId: "profile-lounge-booked", angle: "problem" });
    const p = createMessagePost(s, ctxFor("profile-lounge-booked"));
    expect(p.hook).toBe("“Your approach to improving current practice systems can leave room for rest.”");
    expect(`${p.hook}${p.script}${p.caption}`).not.toMatch(/\[topic\]/i);
    const r = msg({ audience: RETREAT_AUDIENCE, audienceStage: "international", angle: "postponed", hook: SAVED_7_NOV.settings.hook });
    expect(checkMessage(r, ctxFor("profile-flourishealer-attendee", allRetreats({})[0])).join(" ")).toMatch(/placeholder/);
  });

  it("reads the built-in profiles and retreats without needing new keys", () => {
    expect(allProfiles(SAVED_7_NOV)).toHaveLength(DEFAULT_PROFILES.length);
    expect(allRetreats(SAVED_7_NOV).length).toBeGreaterThan(0);
    expect(SAVED_7_NOV).not.toHaveProperty("profiles");
  });

  it("backs up and merges with every original key and value intact", () => {
    const backup = { app: "Boss Clinician Marketing Studio", schemaVersion: 3, ...structuredClone(SAVED_7_NOV) };
    expect(() => validateBackup(backup)).not.toThrow();
    const merged = mergeBackup(structuredClone(SAVED_7_NOV), backup).state;
    for (const [k, v] of Object.entries(SAVED_7_NOV)) expect(merged[k as keyof typeof merged]).toEqual(v);
  });
});

describe("Club CTA routing (20 Nov)", () => {
  it("has CLARITY, READY and NICHE for Club and no MARKETING keyword", () => {
    expect(ROUTES.NICHE.url).toBe("https://www.bossclinician.com/5-step-marketing");
    expect(Object.keys(ROUTES)).not.toContain("MARKETING");
    expect(routeTable().READY.line).toBe("Comment READY and I'll send you my free practice-prep training.");
    expect(routeTable().NICHE.line).toBe("Comment NICHE and I'll send you my free 5-Step Marketing Plan.");
    expect(routeTable().CLARITY.line).toBe("Comment CLARITY and I'll send you my free private practice readiness quiz.");
  });

  it("routes a CLARITY, a READY, a NICHE and a marketing-topic post", () => {
    const c = ctxFor("profile-club-agency");
    expect(createMessagePost(club("fit"), c).dmWord).toBe("CLARITY");
    expect(createMessagePost(club("start"), c).dmWord).toBe("READY");
    expect(createMessagePost(club("niche"), c).dmWord).toBe("NICHE");
    const m = createMessagePost(club("marketing"), c);
    expect(m.dmWord).toBe("NICHE");
    expect(m.resourceUrl).toBe("https://www.bossclinician.com/5-step-marketing");
    expect(m.script).toMatch(/Comment NICHE and I'll send you my free 5-Step Marketing Plan\./);
    expect(m.caption).toContain("https://www.bossclinician.com/5-step-marketing");
  });

  it("lets the owner change the NICHE destination without code", () => {
    const r = messageResource(club("niche"), { routeEdits: { NICHE: { url: "https://www.bossclinician.com/new-plan" } } });
    expect(r.url).toBe("https://www.bossclinician.com/new-plan");
  });

  it("legacy invitations follow the chosen Comment action", () => {
    const s = base({ audience: "Club", topicId: "niche", ctaAction: "Comment" });
    expect(createPost(s, "", "x").closingScreen).toBe("Comment “NICHE” · Free 5-Step Marketing Plan");
  });
});

describe("messaging-first drafts (20 Nov)", () => {
  it("requires an audience and a buyer profile, not a pillar", () => {
    expect(checkMessage(msg({}), {}).join(" ")).toMatch(/Choose Club, Lounge, Boardroom, or FlourisHealer Retreats/);
    expect(checkMessage(club("fit"), {}).join(" ")).toMatch(/buyer profile/);
    const p = createMessagePost(club("fit", { pillar: "" }), ctxFor("profile-club-agency"));
    expect(p.pillar).toBe("");
    expect(p.mode).toBe("messaging");
  });

  it("starts in the buyer’s own words and stores the message fields", () => {
    const p = createMessagePost(club("start"), ctxFor("profile-club-agency"));
    expect(p.hook).toContain("I have downloaded startup checklists");
    expect(p.buyerProfileId).toBe("profile-club-agency");
    expect(p.pointA).toBeTruthy();
    expect(p.pointB).toBeTruthy();
    expect(p.angleLabel).toBeTruthy();
    expect(p.script).not.toMatch(/resignation|quit/i);
  });

  it("maps Lounge to FREEDOM, first hire to HIRE and an existing team to LEAD", () => {
    const lounge = createMessagePost(
      msg({ audience: "Lounge", topicId: "income", profileId: "profile-lounge-booked", angle: "problem" }),
      ctxFor("profile-lounge-booked"),
    );
    expect(lounge.dmWord).toBe("FREEDOM");
    expect(lounge.script).toMatch(/rates|payer mix|systems/);
    const first = createMessagePost(
      msg({ audience: "Boardroom", audienceStage: "first", topicId: "cost", angle: "dayinlife" }),
      ctxFor("profile-boardroom-first-hire"),
    );
    expect(first.dmWord).toBe("HIRE");
    expect(first.script).not.toMatch(/your team/i);
    const team = createMessagePost(
      msg({ audience: "Boardroom", audienceStage: "team", topicId: "delegation", angle: "after" }),
      ctxFor("profile-boardroom-team"),
    );
    expect(team.dmWord).toBe("LEAD");
  });

  it("keeps the three endings: reflective puts the CTA first in the caption, engagement adds none", () => {
    const c = ctxFor("profile-club-agency");
    const reflective = createMessagePost(club("start", { ctaType: "Reflective ending" }), c);
    expect(reflective.script).not.toMatch(/Comment READY/);
    expect(reflective.caption.startsWith("If ")).toBe(true);
    const engage = createMessagePost(club("start", { ctaType: "Engagement question" }), c);
    for (const t of [engage.script, engage.caption, engage.closingScreen]) expect(t).not.toMatch(/Comment READY|https?:\/\//);
    expect(engage.dmWord).toBe("");
  });

  it("never invents a founder or member story", () => {
    const c = ctxFor("profile-club-agency");
    const founder = createMessagePost(club("start", { angle: "founder" }), c);
    expect(founder.needsDetails).toBe(true);
    expect(founder.script).toMatch(/\[NEEDS DETAILS/);
    const member = createMessagePost(club("start", { angle: "member", proof: "A real story" }), c);
    expect(member.needsDetails).toBe(true); // permission not confirmed
  });

  it("flags vague copy and listicles in the quality review, and can split them", () => {
    const p = createMessagePost(club("start"), ctxFor("profile-club-agency"));
    const vague = { ...p, script: "Work less, earn more.\n1. a\n2. b\n3. c\n4. d" };
    const flags = reviewPost(vague)
      .filter((x: { ok: boolean }) => !x.ok)
      .map((x: { label: string }) => x.label);
    expect(flags).toEqual(expect.arrayContaining(["Specific, not vague", "One core idea"]));
    expect(splitPost(vague)).toHaveLength(4);
  });
});

describe("FlourisHealer Retreats (21 Nov)", () => {
  const bali = allRetreats({})[0];
  const retreat = (over: S = {}) =>
    msg({
      audience: RETREAT_AUDIENCE,
      audienceStage: "international",
      profileId: "profile-flourishealer-attendee",
      retreatId: bali.id,
      angle: "postponed",
      ...over,
    });

  it("shows the broader audience and the owner-approved core message", () => {
    expect(profile("profile-flourishealer-attendee").who).toMatch(/^Women mental health professionals and wellness providers/);
    expect(RETREAT_MESSAGING.coreMessage).toBe(
      "You spend so much of your life showing up for everyone else. It’s time to have an experience that’s just for you.",
    );
    expect(profilesFor({}, RETREAT_AUDIENCE, "international")).toHaveLength(1);
  });

  it("is its own audience: no pillar rotation, routed to RETREAT", () => {
    expect(checkFit({ audience: RETREAT_AUDIENCE }).join(" ")).toMatch(/messaging-first/);
    const p = createMessagePost(retreat(), ctxFor("profile-flourishealer-attendee", bali));
    expect(p.dmWord).toBe("RETREAT");
    expect(p.resourceUrl).toBe("https://www.bossclinician.com/retreats");
    expect(p.script).toContain("Comment RETREAT and I'll send you details about the next FlourisHealer experience.");
    expect(p.hook).toBe(RETREAT_MESSAGING.sampleHook);
  });

  it("keeps the tagline and campaign line optional and never as the hook", () => {
    const c = ctxFor("profile-flourishealer-attendee", bali);
    for (const a of ["postponed", "pov", "micro", "cared", "connection", "finally", "objection", "transformation"]) {
      const p = createMessagePost(retreat({ angle: a }), c);
      expect(p.hook).not.toMatch(/Release • Restore/);
      expect(`${p.script}${p.caption}`).not.toMatch(/Release • Restore|finally your turn/);
      expect(`${p.script}${p.caption}`).not.toMatch(/CEU|coaching|heal burnout|nervous system|trauma/i);
    }
    const flourish = createMessagePost(retreat({ useTagline: true, useCampaignLine: true }), c);
    expect(flourish.caption.trim().endsWith("Release • Restore • Reconnect.")).toBe(true);
    expect(flourish.script).toContain("It’s finally your turn.");
  });

  it("flags missing dates, rooming and inclusions instead of inventing them", () => {
    const p = createMessagePost(retreat({ angle: "objection" }), ctxFor("profile-flourishealer-attendee", bali));
    expect(p.needsDetails).toBe(true);
    expect(p.missingDetails).toEqual(expect.arrayContaining(["Dates (if public)", "Accommodation (private / shared rooms)", "Inclusions"]));
    expect(reviewPost(p).find((x: { label: string }) => x.label === "Verified retreat details").ok).toBe(false);
  });

  it("a domestic business retreat needs its own confirmed promise and does not reuse the Bali reset copy", () => {
    const domestic = { id: "retreat-d", type: "domestic", name: "Practice growth retreat", promise: "", promiseConfirmed: false };
    const dProfile = {
      id: "profile-d",
      audience: RETREAT_AUDIENCE,
      stage: "domestic",
      name: "Owner",
      who: "Group practice owners",
      pointA: "I never get time to plan.",
      symptoms: "Planning on Sunday nights.",
      pointB: "A clear plan for next year.",
    };
    const s = retreat({ audienceStage: "domestic", profileId: "profile-d", retreatId: "retreat-d", angle: "transformation" });
    const c = { profile: dProfile, retreat: domestic, messaging: RETREAT_MESSAGING, routeEdits: {} };
    expect(checkMessage(s, c).join(" ")).toMatch(/promise/);
    const ok = createMessagePost(s, { ...c, retreat: { ...domestic, promise: "a two-day annual planning workshop", promiseConfirmed: true } });
    expect(ok.script).toContain("a two-day annual planning workshop");
    expect(ok.script).not.toContain(RETREAT_MESSAGING.sampleBody);
    expect(ok.caption).not.toMatch(/Release • Restore/);
  });

  it("new retreat and message fields reach the CSV", () => {
    const p = createMessagePost(retreat(), ctxFor("profile-flourishealer-attendee", bali));
    const csv = toCSV([p]);
    for (const col of ["Buyer profile", "Point A", "Point B", "Content angle", "CTA action", "Retreat"]) expect(csv.split("\r\n")[0]).toContain(col);
    expect(csv).toContain("Bali international reset");
  });
});
