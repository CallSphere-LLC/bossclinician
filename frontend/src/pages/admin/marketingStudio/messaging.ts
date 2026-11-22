// @ts-nocheck -- same plain-JS style as engine.ts, which this extends.
/**
 * Messaging-first workflow (Yvette's addenda of 20 and 21 Nov 2026).
 *
 * A post now starts from WHO it is for and the problem they already recognise,
 * not from a pillar or a random hook:
 *   audience/stage → saved buyer profile → Point A + one symptom → Point B →
 *   one belief shift → content angle → offer/CTA → generated post.
 * Hooks and pillars stay available as optional creative resources, and the
 * original five-pillar series (engine.ts `series`) stays as an opt-in
 * "Legacy rotation". Nothing here is AI: the copy is assembled from what the
 * owner typed, her saved profiles, and the verified resource routes. Anything
 * she has not supplied is marked "[NEEDS DETAILS: …]" instead of invented.
 *
 * Built-in profiles, FlourisHealer messaging and retreat records ship as code
 * defaults with stable ids. Her own versions live beside them in the saved
 * studio document (`profiles`, `retreats`, `retreatMessaging`, `routeEdits`)
 * and only exist once she saves one, so a studio saved before this update
 * opens unchanged.
 */
import { ROUTES, RETREAT_AUDIENCE, topicList, newId, personalizeHook } from "./engine";

export { RETREAT_AUDIENCE };
export const AUDIENCES = ["Club", "Lounge", "Boardroom", RETREAT_AUDIENCE];
export const RETREAT_TYPES = { international: "International reset", domestic: "Domestic business retreat" };
export const RETREAT_DEFINITION =
  "A FlourisHealer travel experience for women mental health professionals and wellness providers. Not Lounge coaching or Boardroom strategy, and never framed as therapy or treatment.";
export const CTA_ACTIONS = ["Comment", "DM"];
export const MESSAGE_FORMATS = ["Talking-head", "B-roll POV", "Carousel", "Caption-first post", "Email"];

/* Resource routes the owner can edit (brief: "Owner-managed CTA settings should
   permit updating the NICHE destination without editing code"). `line` is the
   ready-to-post Comment wording; the samples are the brief's own. */
export const COMMENT_LINES = {
  CLARITY: "Comment CLARITY and I'll send you my free private practice readiness quiz.",
  READY: "Comment READY and I'll send you my free practice-prep training.",
  NICHE: "Comment NICHE and I'll send you my free 5-Step Marketing Plan.",
  FREEDOM: "Comment FREEDOM for the free masterclass.",
  HIRE: "Comment HIRE for the hiring-readiness quiz.",
  LEAD: "Comment LEAD for the Group Practice Self-Assessment.",
  RETREAT: "Comment RETREAT and I'll send you details about the next FlourisHealer experience.",
};
export const DM_LINES = { RETREAT: "DM RETREAT for the retreat details." };
/** Which keywords belong to which audience, for new posts. No MARKETING keyword. */
export const AUDIENCE_ROUTES = {
  Club: ["CLARITY", "READY", "NICHE"],
  Lounge: ["FREEDOM"],
  Boardroom: ["HIRE", "LEAD"],
  [RETREAT_AUDIENCE]: ["RETREAT"],
};
export function routeTable(edits = {}) {
  const out: Record<string, any> = {};
  for (const [word, r] of Object.entries(ROUTES)) {
    const e = (edits && edits[word]) || {};
    out[word] = {
      ...r,
      resource: e.resource?.trim() || r.resource,
      url: e.url?.trim() || r.url,
      line: e.line?.trim() || COMMENT_LINES[word] || `Comment ${word} for the ${r.resource}.`,
      dmLine: e.dmLine?.trim() || DM_LINES[word] || `DM ${word} for the ${r.resource}.`,
      edited: !!(e.resource || e.url || e.line || e.dmLine),
    };
  }
  return out;
}

/* ---- Content angles ---------------------------------------------------- */
export const MESSAGE_ANGLES = [
  { id: "problem", label: "The problem they think they have vs. the one worth investigating" },
  { id: "dayinlife", label: "A day-in-the-life symptom" },
  { id: "after", label: "A concrete after-the-change scene" },
  { id: "founder", label: "Founder point of view (your real experience)", needs: "founder" },
  { id: "member", label: "A member success story (verified, with permission)", needs: "member" },
  { id: "mechanism", label: "How a tool or program component bridges Point A to B" },
  { id: "objection", label: "One objection", needs: "objection" },
  { id: "seen", label: "An “I feel seen” moment" },
];
export const RETREAT_ANGLES = [
  { id: "postponed", label: "The vacation she keeps postponing" },
  { id: "pov", label: "Recognizable moment / point of view" },
  { id: "micro", label: "Desired micro-moment (vacation anticipation)" },
  { id: "cared", label: "Being poured into, too" },
  { id: "connection", label: "Connection with like-minded women" },
  { id: "finally", label: "Finally making time for yourself" },
  { id: "objection", label: "A buying objection (uses verified retreat details)", needs: "logistics" },
  { id: "founder", label: "Founder perspective (your real story)", needs: "founder" },
  { id: "transformation", label: "Realistic before / after of making the trip" },
];
export function anglesFor(audience) {
  return audience === RETREAT_AUDIENCE ? RETREAT_ANGLES : MESSAGE_ANGLES;
}

/* ---- FlourisHealer core messaging (owner approved, 21 Nov 2026) ---------- */
export const RETREAT_MESSAGING = {
  coreMessage: "You spend so much of your life showing up for everyone else. It’s time to have an experience that’s just for you.",
  brandDescription:
    "FlourisHealer creates intentional travel experiences for women mental health professionals and wellness providers who are used to being the ones everyone depends on.\n\nThis is your opportunity to finally take that vacation you’ve been putting off, step away from the constant demands of work and life, and be surrounded by like-minded women who understand what it means to spend your days caring for others.\n\nFor once, you don’t have to be the therapist, the business owner, the leader, or the person with all the answers.\n\nYou get to enjoy the destination, have meaningful conversations, make beautiful memories, and experience what it feels like to be poured into, too.\n\n“Because the woman who takes care of everyone else deserves to be taken care of, too.”",
  campaignLine: "It’s finally your turn.",
  tagline: "Release • Restore • Reconnect.",
  sampleHook:
    "You keep telling yourself you’re going to take a real vacation. But every time you open the booking page, something else needs your attention.",
  sampleBody:
    "You spend your days pouring into clients, communities, and the people who count on you. And somehow, taking a few days for yourself keeps moving to next month. What would it feel like to finally make the trip happen? To wake up somewhere beautiful, enjoy a slow morning, have conversations with women who understand your world, and let the day be about you for a change? That’s the kind of experience FlourisHealer creates space for.",
  sampleCta: "Comment RETREAT and I’ll send you details about the next FlourisHealer experience.",
};
export function retreatMessaging(state) {
  return { ...RETREAT_MESSAGING, ...((state && state.retreatMessaging) || {}) };
}

/* ---- Buyer messaging profiles ------------------------------------------- */
/* The four Boss Clinician examples (brief §D) and the FlourisHealer attendee
   (21 Nov), in the brief's own words. They are original drafts, not
   testimonials. Symptoms are one per line. */
export const PROFILE_FIELDS = [
  ["name", "Profile name", "A short name you will recognise, e.g. “Agency therapist, still employed”."],
  ["who", "1 · Specific WHO", "Profession and situation, current stage, and life circumstances only when genuinely relevant."],
  ["pointA", "2 · What they think is wrong (Point A)", "The problem in the phrases they actually use."],
  ["symptoms", "3 · Micro-symptoms (one per line, 3–5)", "Specific moments in a normal day or week: time, behaviour, thought, context, cost."],
  ["pointB", "4 · Desired outcome (Point B)", "The bigger result they are hoping for."],
  ["microMoment", "5 · The concrete moment", "One vivid, recognisable scene of that result."],
  ["beliefGap", "6 · Belief gap / point of view", "Their current interpretation vs. the issue worth investigating. Phrase it as a perspective, not a diagnosis."],
  ["tried", "7 · What they have already tried (optional)", "Only what is appropriate for this audience. Not presented as a known fact about a real person."],
  ["differentiator", "8 · Differentiator / mechanism", "The real decision, tool, coaching approach or program feature that bridges the gap. No invented services."],
  ["objection", "9 · Objection", "A realistic hesitation."],
  ["evidence", "9b · Evidence (optional)", "An authenticated case study or founder story you are permitted to use. Leave blank if you have none."],
  ["genericExample", "Generic version (optional)", "What vague copy for this person sounds like."],
  ["specificExample", "Specific version (optional)", "The same idea, made specific."],
];
export const DEFAULT_PROFILES = [
  {
    id: "profile-club-agency",
    audience: "Club",
    stage: "",
    name: "Agency therapist starting while employed",
    who: "Agency-employed therapist who wants to start or restart a private practice while keeping their agency job.",
    pointA: "I have downloaded startup checklists and purchased templates, but I still do not know what to do first.",
    symptoms:
      "Collecting free startup checklists.\nBuying premade forms and agreements.\nSigning up for and watching free private practice trainings, hoping each one will finally answer every question.\nComparing EHR systems and wondering whether an EHR or website should come first.\nKeeping multiple startup-resource tabs open without a sequence for implementing them.",
    pointB: "Enough clarity and preparation to build their practice alongside their current job and feel more comfortable with a possible future transition.",
    microMoment: "A clear, phased startup plan, purchasing only what is needed at each stage, with confident foundational decisions made while still employed.",
    beliefGap: "More resources do not necessarily create progress when the order of operations is unclear.",
    tried: "",
    differentiator: "",
    objection: "",
    evidence: "",
    genericExample: "",
    specificExample: "",
    note: "READY for hands-on setup/preparation training; CLARITY for deciding whether ownership fits; NICHE for choosing whom to serve. Do not default to resignation letters, imminent quitting, or an exit countdown.",
  },
  {
    id: "profile-lounge-booked",
    audience: "Lounge",
    stage: "",
    name: "Fully booked, little time off",
    who: "Established therapist with a full calendar but little time off.",
    pointA: "I'm booked, so why don't I feel financially free?",
    symptoms: "Answering billing inquiries from vacation because revenue and admin still depend on them.",
    pointB: "Clinical days and owner pay planned in advance, with genuine time away.",
    microMoment: "Clinical days and owner pay planned in advance, with genuine time away.",
    beliefGap: "More booked appointments are not automatically the solution; examine collected rates, payer mix, workload, reserves, and systems.",
    tried: "",
    differentiator: "",
    objection: "",
    evidence: "",
    genericExample: "Scale your private practice without burnout.",
    specificExample:
      "Your calendar is full, but a week away still means answering billing questions from the hotel. More clients may not be your next move. Review the systems and rates behind the caseload.",
    note: "Routes to the FREEDOM masterclass.",
  },
  {
    id: "profile-boardroom-first-hire",
    audience: "Boardroom",
    stage: "first",
    name: "Solo owner, first clinical hire",
    who: "Solo owner about to make first clinical hire.",
    pointA: "I have referrals to share, but can I actually afford an employee?",
    symptoms: "Searching pay rates without calculating collection assumptions, taxes, supervision, admin support, and onboarding.",
    pointB: "An informed hiring decision with a sustainable staffing model.",
    microMoment: "An informed hiring decision with a sustainable staffing model.",
    beliefGap: "",
    tried: "",
    differentiator: "",
    objection: "",
    evidence: "",
    genericExample: "",
    specificExample: "",
    note: "Routes to the HIRE assessment. Does not assume a team.",
  },
  {
    id: "profile-boardroom-team",
    audience: "Boardroom",
    stage: "team",
    name: "Owner whose team needs constant approval",
    who: "Owner whose clinicians need constant approval.",
    pointA: "Every question still comes to me.",
    symptoms: "Interrupting time off to resolve routine scheduling and staffing issues.",
    pointB: "Clear authority, SOPs, responsibilities, and protected CEO time.",
    microMoment: "Clear authority, SOPs, responsibilities, and protected CEO time.",
    beliefGap: "",
    tried: "",
    differentiator: "",
    objection: "",
    evidence: "",
    genericExample: "",
    specificExample: "",
    note: "Routes to the LEAD group practice self-assessment.",
  },
  {
    id: "profile-flourishealer-attendee",
    audience: RETREAT_AUDIENCE,
    stage: "international",
    name: "FlourisHealer ideal attendee",
    who: "Women mental health professionals and wellness providers who spend their workdays supporting others and rarely prioritize a true vacation for themselves. They may also be business owners, leaders, caregivers, or parents, but not every attendee holds every role or experiences burnout.",
    pointA: "I’ve been saying I need a vacation, but I keep putting it off.",
    symptoms:
      "Looking at destination pictures but never booking.\nRescheduling a personal break around work.\nAnswering other people’s needs on a day off.\nHesitating to travel because they are accustomed to being the responsible one.",
    pointB:
      "Finally being on a real vacation, taking their mind off daily responsibilities, enjoying a beautiful destination, receiving care and attention themselves, laughing and connecting with like-minded women doing similar work, and returning with memories of an experience chosen for themselves.",
    microMoment: "Waking up somewhere beautiful, enjoying a slow morning, and having conversations with women who understand your world.",
    beliefGap: "",
    tried: "",
    differentiator: "FlourisHealer offers thoughtfully planned travel and a setting designed for connection and enjoyment.",
    objection: "Travel logistics, distance from family/work, comfort travelling in a group, room sharing or a private room, price, time away, and what is actually included.",
    evidence: "",
    genericExample: "",
    specificExample: "",
    note: "Other recognisable phrases: “Everyone needs something from me”; “I always plan around everyone else.” Desired experiences, not guaranteed psychological outcomes.",
  },
];

/** Built-in defaults with her saved versions laid over them, plus her own. */
function catalog(defaults, saved) {
  const mine = Array.isArray(saved) ? saved.filter((x) => x && typeof x.id === "string") : [];
  const byId = new Map(mine.map((x) => [x.id, x]));
  return [
    ...defaults.map((d) => (byId.has(d.id) ? { ...d, ...byId.get(d.id), builtIn: true, edited: true } : { ...d, builtIn: true })),
    ...mine.filter((x) => !defaults.some((d) => d.id === x.id)),
  ];
}
export const allProfiles = (state) => catalog(DEFAULT_PROFILES, state?.profiles);
export function profilesFor(state, audience, stage, includeArchived = false) {
  return allProfiles(state).filter(
    (p) =>
      (includeArchived || !p.archived) &&
      p.audience === audience &&
      (audience === "Boardroom" ? !p.stage || p.stage === stage : audience === RETREAT_AUDIENCE ? !p.stage || !stage || p.stage === stage : true),
  );
}
/** Stores one profile (new, edited built-in, or duplicate) without touching any post. */
export function upsertById(list, item) {
  const out = Array.isArray(list) ? list.slice() : [];
  const i = out.findIndex((x) => x.id === item.id);
  if (i < 0) out.push(item);
  else out[i] = item;
  return out;
}
export function duplicateProfile(p) {
  const { builtIn, edited, ...rest } = structuredClone(p);
  return { ...rest, id: "profile-" + newId(), name: (p.name || "Profile") + " (copy)", archived: false, createdAt: new Date().toISOString() };
}

/* ---- Retreat records (owner-verified facts only) ------------------------ */
export const RETREAT_FACT_FIELDS = [
  ["dates", "Dates (if public)"],
  ["location", "Confirmed location"],
  ["eligibility", "Eligibility / who it is for"],
  ["price", "Price"],
  ["deposit", "Deposit and refund rules"],
  ["accommodation", "Accommodation (private / shared rooms)"],
  ["itinerary", "Itinerary / schedule"],
  ["inclusions", "Inclusions"],
  ["excursions", "Excursions"],
  ["facilitators", "Facilitators"],
  ["ceus", "CEUs (only if offered)"],
  ["testimonialPermission", "Testimonial permissions on file"],
];
export const DEFAULT_RETREATS = [
  {
    id: "retreat-bali-international",
    type: "international",
    name: "Bali international reset",
    location: "Bali",
    url: "https://www.bossclinician.com/retreats",
    promise: "",
    promiseConfirmed: false,
    note: "A destination experience with a private-villa concept, where applicable. Confirm accommodation before mentioning it.",
  },
];
export const allRetreats = (state) => catalog(DEFAULT_RETREATS, state?.retreats);
export function retreatsFor(state, type, includeArchived = false) {
  return allRetreats(state).filter((r) => (includeArchived || !r.archived) && (!type || r.type === type));
}
export function missingRetreatFacts(r) {
  return RETREAT_FACT_FIELDS.filter(([k]) => !String(r?.[k] || "").trim()).map(([, label]) => label);
}

/* ---- Checks before generating ------------------------------------------- */
const firstLine = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
export function checkMessage(s, ctx = {}) {
  const errors = [];
  if (!AUDIENCES.includes(s.audience)) errors.push("Choose Club, Lounge, Boardroom, or FlourisHealer Retreats.");
  if (s.audience === "Boardroom" && !["first", "team"].includes(s.audienceStage)) errors.push("Choose a Boardroom stage.");
  if (s.audience === RETREAT_AUDIENCE) {
    if (!["international", "domestic"].includes(s.audienceStage)) errors.push("Choose the retreat type: international reset or domestic business retreat.");
    const r = ctx.retreat;
    if (!r) errors.push("Choose the specific retreat this post is about.");
    else if (r.type !== s.audienceStage) errors.push("The chosen retreat is not a " + (RETREAT_TYPES[s.audienceStage] || "matching") + " retreat.");
    else if (s.audienceStage === "domestic" && (!String(r.promise || "").trim() || !r.promiseConfirmed))
      errors.push("Domestic retreats need their actual promise and inclusions confirmed in the retreat record before copy is generated.");
  } else if (AUDIENCES.includes(s.audience) && !topicList(s).some((t) => t.id === s.topicId)) errors.push("Choose a topic that fits this audience stage.");
  if (!ctx.profile) errors.push("Choose a saved buyer profile, or create one.");
  else if (ctx.profile.audience !== s.audience) errors.push("That profile belongs to a different audience.");
  if (!anglesFor(s.audience).some((a) => a.id === s.angle)) errors.push("Choose a content angle.");
  if (!["Spoken resource invitation", "Reflective ending", "Engagement question"].includes(s.ctaType)) errors.push("Choose an ending option.");
  if (s.audience === "Club" && /\byour (?:existing |current )?(?:clients|caseload|team|employees|payroll|website)\b/i.test(s.hook || ""))
    errors.push("This opening assumes existing practice assets. Reframe it for someone starting or restarting.");
  if (s.audience === "Lounge" && /(?:first clinician hire|hire your first|becom(?:e|ing) an employer|team leadership|your employees)/i.test(s.hook || ""))
    errors.push("This opening is about hiring or team leadership. Choose Boardroom or reframe it around the current practice.");
  if (s.audience === RETREAT_AUDIENCE && /\[[^\]]+\]/.test(s.hook || ""))
    errors.push("This library hook still has a [placeholder]. Retreat posts have no topic to fill it, so reword the opening first.");
  if (s.audience === "Boardroom" && s.audienceStage === "first" && /\byour (?:existing |current )?(?:team|employees|team caseloads)\b/i.test(s.hook || ""))
    errors.push("This opening assumes a team already exists. Reframe it for first-hire preparation.");
  return errors;
}

export function recommendedMessageRoute(s) {
  if (s.audience === RETREAT_AUDIENCE) return "RETREAT";
  if (s.audience === "Club") return topicList(s).find((t) => t.id === s.topicId)?.route || "READY";
  return s.audience === "Lounge" ? "FREEDOM" : s.audienceStage === "first" ? "HIRE" : "LEAD";
}
export function messageResource(s, ctx = {}) {
  const routes = routeTable(ctx.routeEdits);
  const word = s.override?.word && routes[s.override.word] ? s.override.word : recommendedMessageRoute(s);
  const r = routes[word];
  let url = s.override?.url || r.url;
  if (word === "RETREAT" && !s.override?.url && /^https:\/\//.test(ctx.retreat?.url || "")) url = ctx.retreat.url;
  const resource = s.override?.resource || r.resource;
  const action = s.ctaAction === "DM" ? "DM" : "Comment";
  const line = action === "DM" ? r.dmLine : r.line;
  return { word, resource, url, purpose: r.purpose, action, line, routeAudience: r.audience };
}

/* ---- Generation --------------------------------------------------------- */
const NEED = (what) => `[NEEDS DETAILS: ${what}]`;
export const NEEDS_MARKER = /\[(?:NEEDS DETAILS|ADD|WHAT|YOUR|STARTING|CONTRIBUTING|TAKEAWAY)/i;

function filmingFor(format, hook, script) {
  if (format === "B-roll POV") {
    const lines = script.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    return (
      "B-roll POV, on-screen text timed to the clips:\n" +
      lines.map((l, i) => `${String(i * 3).padStart(2, "0")}–${String(i * 3 + 3).padStart(2, "0")}s · ${l}`).join("\n") +
      "\nUse everyday footage that matches the moment described. No client images or identifiable clinical settings."
    );
  }
  if (format === "Carousel") return "Carousel: one idea per slide, the hook on slide 1, the closing slide carries the invitation or question.";
  if (format === "Caption-first post") return "Caption-first post: a simple still image or text card with the hook; the caption carries the message.";
  if (format === "Email") return `Email: use the hook as the subject line (“${hook}”). The caption below is the email body.`;
  return "Talking-head: film to camera in one or two takes. Open on the hook within the first two seconds; keep sentences easy to say aloud.";
}

/**
 * Builds one messaging-first draft. `ctx` = { profile, retreat, messaging,
 * routeEdits }. Pure: it never touches saved profiles or other posts.
 */
export function createMessagePost(s, ctx = {}, id = undefined) {
  const errs = checkMessage(s, ctx);
  if (errs.length) throw Error(errs.join(" "));
  const prof = ctx.profile;
  const retreatPost = s.audience === RETREAT_AUDIENCE;
  const angle = anglesFor(s.audience).find((a) => a.id === s.angle);
  const t = retreatPost ? null : topicList(s).find((x) => x.id === s.topicId);
  const missing = [];
  const pick = (v, fallback, label) => {
    const out = String(v || "").trim() || String(fallback || "").trim();
    if (!out) missing.push(label);
    return out;
  };
  const pointA = pick(s.pointA, prof.pointA, "Point A (what they think is wrong)");
  const symptom = pick(s.symptom, firstLine(prof.symptoms), "a specific symptom");
  const pointB = pick(s.pointB, prof.microMoment || prof.pointB, "the desired result (Point B)");
  const shift = String(s.beliefShift || prof.beliefGap || "").trim();
  const mechanism = String(s.mechanism || prof.differentiator || "").trim();
  const proof = String(s.proof || "").trim();
  const objection = String(s.objection || prof.objection || "").trim();
  const r = messageResource(s, ctx);
  const m = ctx.messaging || RETREAT_MESSAGING;
  // Library hooks carry [topic]-style placeholders: fill them exactly as the legacy builder does.
  let hook = String(s.hook || "").trim();
  if (hook && t) hook = personalizeHook(hook, s, t);
  let body = [];
  let needsDetails = false;
  const retreat = ctx.retreat;
  const retreatMissing = retreatPost ? missingRetreatFacts(retreat) : [];

  if (retreatPost && s.audienceStage === "domestic") {
    // A domestic retreat has its own (confirmed) professional-development promise: no Bali reset copy, no tagline.
    hook ||= `“${pointA}”`;
    body = [
      `Maybe this looks familiar: ${symptom}`,
      `${retreat.name} is built around one thing: ${retreat.promise.trim()}`,
      `Picture this instead: ${pointB}`,
    ];
  } else if (retreatPost) {
    // Only verified record fields: the retreat's name, plus location/dates when entered.
    const where = retreat.location && !retreat.name.toLowerCase().includes(String(retreat.location).toLowerCase()) ? ` in ${retreat.location}` : "";
    const offer = `Featured FlourisHealer experience: ${retreat.name}${where}${retreat.dates ? ` · ${retreat.dates}` : ""}.`;
    const a = angle.id;
    if (a === "postponed") {
      hook ||= m.sampleHook;
      body = [m.sampleBody];
    } else if (a === "pov") {
      hook ||= "You have helped everyone else make room for their needs. But the vacation you keep saying you’ll take is still sitting in a browser tab.";
      body = [`“${pointA}”`, `Maybe this looks familiar: ${symptom}`, "Wanting time away and putting it on the calendar are two different things. You are allowed to close that gap."];
    } else if (a === "micro") {
      hook ||= "Imagine waking up somewhere beautiful and your first decision is whether to linger over breakfast or sit quietly for a few more minutes.";
      body = [pointB, mechanism];
    } else if (a === "cared") {
      hook ||= m.coreMessage;
      body = ["For once, you don’t have to be the therapist, the business owner, the leader, or the person with all the answers.", "You get to enjoy the destination, have meaningful conversations, make beautiful memories, and experience what it feels like to be poured into, too."];
    } else if (a === "connection") {
      hook ||= "Imagine spending a few days with women who understand what it means to spend your days caring for others.";
      body = ["Conversations that aren’t about a caseload. Laughter that isn’t squeezed between sessions.", mechanism];
    } else if (a === "finally") {
      hook ||= "“Because the woman who takes care of everyone else deserves to be taken care of, too.”";
      body = [`Maybe this looks familiar: ${symptom}`, `What if this was the year you said yes to ${pointB.charAt(0).toLowerCase() + pointB.slice(1).replace(/\.$/, "")}?`];
    } else if (a === "objection") {
      hook ||= "A retreat can sound lovely on paper, but you’re thinking about time away, travel, and whether you’ll feel comfortable joining people you haven’t met.";
      const facts = ["itinerary", "accommodation", "inclusions"].map((k) => retreat[k]).filter(Boolean);
      if (facts.length) body = ["Here’s what is actually planned:", ...facts];
      else {
        body = [NEED("the verified itinerary, rooming, support and logistics for this retreat")];
        needsDetails = true;
      }
    } else if (a === "founder") {
      hook ||= "Why I believe clinicians deserve to make intentional space for themselves.";
      if (proof) body = [proof];
      else {
        body = [NEED("your own story, in your words — no invented founder experiences")];
        needsDetails = true;
      }
    } else if (a === "transformation") {
      hook ||= `“${pointA}”`;
      body = [`Before: ${symptom}`, `After: you made room for a trip that was chosen for you. ${pointB}`];
    }
    body = body.filter(Boolean);
    if (offer) body.push(offer);
    if (s.useCampaignLine && m.campaignLine) body.push(m.campaignLine);
  } else {
    // Club / Lounge / Boardroom: Situation → stuck moment → new perspective → mechanism → result → next step.
    const a = angle.id;
    const bridge = mechanism || `That’s what my ${r.resource} is for: to ${r.purpose}.`;
    const perspective = shift ? `Here’s another way to look at it: ${shift}` : t.point;
    if (a === "problem") {
      hook ||= `“${pointA}”`;
      body = ["That’s a fair question. It may not be the whole problem.", `Maybe this looks familiar: ${symptom}`, perspective, bridge, `Picture this instead: ${pointB}`];
    } else if (a === "dayinlife") {
      hook ||= symptom;
      body = [`If that sounds like your week, you might be thinking, “${pointA}”`, perspective, bridge, `Picture this instead: ${pointB}`];
    } else if (a === "after") {
      hook ||= `Picture this: ${pointB}`;
      body = [`Right now it may look more like this: ${symptom}`, perspective, bridge];
    } else if (a === "founder") {
      hook ||= `What I want you to know about “${pointA.replace(/[“”"]/g, "")}”`;
      if (proof) body = [proof, perspective];
      else {
        body = [NEED("your own experience, in your words — do not invent a founder story"), perspective];
        needsDetails = true;
      }
    } else if (a === "member") {
      hook ||= `From “${pointA.replace(/[“”"]/g, "")}” to a clearer next step.`;
      if (proof && s.proofPermission) body = [proof, "Every practice is different; this is one member’s experience, and results vary."];
      else {
        body = [NEED("a documented member story with permission to share — starting point, what changed, timeframe")];
        needsDetails = true;
      }
    } else if (a === "mechanism") {
      hook ||= `“${pointA}”`;
      body = [`Maybe this looks familiar: ${symptom}`, mechanism || NEED("the specific Boss Clinician tool, decision or program component that helps"), `Picture this instead: ${pointB}`];
      if (!mechanism) needsDetails = true;
    } else if (a === "objection") {
      const o = objection || NEED("a realistic hesitation this person has");
      if (!objection) needsDetails = true;
      hook ||= o;
      body = ["That’s a reasonable concern.", perspective, bridge];
    } else if (a === "seen") {
      hook ||= `If this is your week, I see you: ${symptom.charAt(0).toLowerCase() + symptom.slice(1)}`;
      body = [`And somewhere in there is the thought, “${pointA}”`, perspective, `Picture this instead: ${pointB}`];
    }
    body = body.filter(Boolean);
  }
  for (const label of missing) {
    body.push(NEED(label));
    needsDetails = true;
  }

  const question = retreatPost ? "When did you last take a trip that was just for you?" : t.question;
  const engage = s.ctaType === "Engagement question";
  const invitation = engage ? "" : retreatPost || !t ? r.line : `If ${t.pain}: ${r.line}`;
  const core = [hook, ...body].join("\n\n");
  const closing = s.ctaType === "Spoken resource invitation" ? invitation : question;
  const script = `${core}\n\n${closing}`;
  const tagline = retreatPost && s.audienceStage === "international" && s.useTagline && m.tagline ? `\n\n${m.tagline}` : "";
  let caption =
    s.ctaType === "Reflective ending"
      ? `${invitation}\n\n${core}\n\n${question}`
      : s.ctaType === "Spoken resource invitation"
        ? `${core}\n\n${invitation}`
        : `${core}\n\n${question}`;
  if (!engage) caption += `\n\n${r.url}`;
  caption += tagline;
  const screen = engage ? question : `${r.action} ${r.word} · ${r.resource}`;
  const format = s.messageFormat || "Talking-head";
  // Always built (as the legacy builder does), so switching the format later still exports carousel copy.
  const carousel = `Slide 1\n${hook}\n\n${body.map((v, i) => `Slide ${i + 2}\n${v}`).join("\n\n")}\n\nClosing slide\n${screen}`;
  const storyFollowUp = engage
    ? `Share the post with a question sticker: “${question}”`
    : `Share the post and add a text card: “${r.line}”`;
  return {
    id: id || newId(),
    createdAt: new Date().toISOString(),
    mode: "messaging",
    audience: s.audience,
    audienceStage:
      s.audience === "Boardroom"
        ? s.audienceStage === "first"
          ? "Preparing to hire my first clinician."
          : "Already leading a team."
        : retreatPost
          ? RETREAT_TYPES[s.audienceStage]
          : s.audience === "Club"
            ? "Starting or restarting a practice"
            : "Established practice",
    pillar: retreatPost ? "" : s.pillarTag || "",
    format,
    hook,
    script,
    carousel,
    caption,
    hashtags: s.hashtags || (retreatPost ? "#FlourisHealer #BossClinician" : "#BossClinician #PrivatePractice #PracticeOwnership"),
    ctaType: s.ctaType,
    ctaAction: engage ? "Engagement" : r.action,
    ctaLine: invitation,
    dmWord: engage ? "" : r.word,
    resourceName: engage ? "" : r.resource,
    resourceUrl: engage ? "" : r.url,
    closingScreen: screen,
    filming: filmingFor(format, hook, script),
    storyFollowUp,
    postingDate: s.postingDate || "",
    status: needsDetails ? "Needs details" : "Drafting",
    needsDetails,
    topic: retreatPost ? retreat.name : t.label,
    topicId: retreatPost ? "" : t.id,
    angle: angle.id,
    angleLabel: angle.label,
    mainIdea: String(s.mainIdea || shift || "").trim(),
    buyerProfileId: prof.id,
    profileName: prof.name || "",
    who: prof.who || "",
    pointA,
    symptoms: [symptom].filter(Boolean),
    pointB,
    beliefGap: shift,
    tried: prof.tried || "",
    mechanism,
    objection,
    proof,
    proofProvenance: proof ? (s.proofPermission ? "Owner-supplied, permission confirmed" : "Owner-supplied") : "",
    retreatId: retreatPost ? retreat.id : "",
    retreatName: retreatPost ? retreat.name : "",
    retreatType: retreatPost ? s.audienceStage : "",
    missingDetails: retreatMissing,
    hookTemplateId: s.hookTemplateId || "",
    settings: structuredClone(s),
  };
}

/* ---- Message Quality Review (actionable flags, no score) ------------------ */
export const VAGUE_PHRASES = [/work less,? earn more/i, /unlock (?:your )?confidence/i, /grow with ease/i, /scale your (?:private )?practice/i, /level up/i, /dm me if this resonates/i];
export const RETREAT_BANNED = [/heal(?:s|ing)? (?:your )?burnout/i, /fix(?:es)? your nervous system/i, /release (?:your )?trauma/i, /\btherapy\b/i, /\btreatment\b/i, /\bcure/i];
const GUARANTEE = /\bguarantee[ds]?\b|\bwill (?:definitely|always)\b|\bevery (?:client|member) (?:will|gets)\b/i;
export function reviewPost(p) {
  const text = `${p.hook || ""}\n${p.script || ""}\n${p.caption || ""}`;
  const retreatPost = p.audience === RETREAT_AUDIENCE;
  const items = [];
  const add = (ok, label, fix) => items.push({ ok, label, fix: ok ? "" : fix });
  add(!!String(p.who || "").trim(), "Precise WHO", "Choose or complete a buyer profile so the post speaks to one recognisable person.");
  add(!!String(p.pointA || "").trim(), "Recognized problem", "Add Point A in the words they would use.");
  add(!!(p.symptoms && p.symptoms.length) || !!String(p.pointB || "").trim(), "Specific scene", "Add one concrete moment: a time, a behaviour, a thought.");
  const numbered = (p.script || "").split("\n").filter((l) => /^\s*\d+[.)]\s/.test(l)).length;
  add(numbered < 4, "One core idea", `This draft lists ${numbered} separate points. Consider “Split into separate posts”.`);
  const vague = VAGUE_PHRASES.filter((re) => re.test(text)).map((re) => text.match(re)[0]);
  add(!vague.length, "Specific, not vague", `“${vague.join("”, “")}” is vague. Replace it with a recognisable situation and a plausible mechanism.`);
  add(!!String(p.mechanism || p.resourceName || "").trim(), "Plausible bridge", "Name the real tool, decision, program feature or resource that helps.");
  const banned = retreatPost ? RETREAT_BANNED.filter((re) => re.test(text)).map((re) => text.match(re)[0]) : [];
  add(!GUARANTEE.test(text) && !banned.length, "Believable result", banned.length ? `Retreats are travel experiences, not treatment: remove “${banned.join("”, “")}”.` : "Avoid guarantees; describe a realistic result.");
  const routeAudience = p.dmWord && ROUTES[p.dmWord]?.audience;
  const ctaOk = p.ctaType === "Engagement question" ? !p.dmWord : !p.dmWord || !p.audience || routeAudience === p.audience;
  add(ctaOk, "CTA relevance", "Would someone with this problem see why this resource is the next step? The keyword belongs to a different audience — choose a better offer or mark Needs Review.");
  const placeholders = NEEDS_MARKER.test(text);
  const missing = Array.isArray(p.missingDetails) ? p.missingDetails : [];
  add(!placeholders, "No fabricated claims", "Complete the [NEEDS DETAILS] prompts with facts you can verify.");
  if (retreatPost) add(!missing.length, "Verified retreat details", `Needs details in the retreat record: ${missing.join(", ")}. Don't mention these until confirmed.`);
  return items;
}

/** "Split into separate posts": one draft per numbered point, keeping the original. */
export function splitPost(p) {
  const lines = (p.script || "").split("\n");
  const points = lines.filter((l) => /^\s*\d+[.)]\s/.test(l)).map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim());
  return points.map((pt, i) => ({
    ...structuredClone(p),
    id: newId(),
    createdAt: new Date().toISOString(),
    script: `${p.hook}\n\n${pt}\n\n${p.closingScreen && p.ctaType === "Spoken resource invitation" ? p.ctaLine || "" : ""}`.trim(),
    caption: `${p.hook}\n\n${pt}${p.ctaLine ? "\n\n" + p.ctaLine : ""}`,
    carousel: "",
    status: "Drafting",
    splitFrom: p.id,
    splitPart: i + 1,
    history: [],
  }));
}
