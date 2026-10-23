export type GrowthState = Record<string, unknown>;
export const growthDefaults = (): GrowthState => ({version:4, workspaces:{}, cycle:1, start:new Date().toISOString().slice(0,10), answers:Array(12).fill(null), intake:{}, goalMeasures:[], coaching:{}, focus:"clarity", snapshotDone:false, flags:[], goals:[], status:Array(12).fill("Not started"), metrics:{}, metricsNotes:"", review:{}, history:[]});
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown, depth = 0): unknown => {
  if (depth > 12) return null;
  if (typeof value === "string") return value.slice(0,20000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0,500).map(v => safe(v, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).filter(([k]) => !["__proto__","constructor","prototype"].includes(k)).map(([k,v]) => [k,safe(v,depth+1)]));
  return null;
};
export function normaliseGrowth(raw: unknown): GrowthState {
  const clean = safe(raw), base = growthDefaults();
  if (!record(clean)) return base;
  const state: GrowthState = {...base, ...clean, version:4};
  state.focus = ["clarity","revenue","systems","owner","clients","sustain"].includes(String(state.focus)) ? state.focus : "clarity";
  state.cycle = typeof state.cycle === "number" && state.cycle > 0 ? Math.floor(state.cycle) : 1;
  state.start = typeof state.start === "string" ? state.start : base.start;
  for (const k of ["workspaces","intake","coaching","metrics","review"]) if (!record(state[k])) state[k] = {};
  for (const k of ["goalMeasures","answers","flags","goals","history"]) if (!Array.isArray(state[k])) state[k] = base[k];
  state.goals = (state.goals as unknown[]).slice(0,3).map(String);
  state.status = Array.from({length:12}, (_,i) => {
    const v = Array.isArray(clean.status) ? clean.status[i] : undefined;
    return ["Not started","In progress","Completed","Blocked"].includes(String(v)) ? v : "Not started";
  });
  state.history = (state.history as unknown[]).filter(record).map(h => ({...h,status:Array.isArray(h.status) ? h.status : [], goals:Array.isArray(h.goals) ? h.goals : []}));
  return state;
}

/* ------------------------------------------------ recommended module + lessons */

/**
 * Where each Growth Assessment pathway sends the member in The Practice
 * Elevation (course 61), QA sheet row 170: the umbrella module ("Mod 0N"), the
 * section that starts the work, and the specific lessons, by slug. Titles are
 * the course's as of 23 Oct 2026; the dashboard re-reads the live course outline
 * and uses the current titles, dropping any lesson that no longer exists.
 */
export type ElevationFocusV4 = "clarity" | "revenue" | "systems" | "owner" | "clients" | "sustain";
export const ELEVATION_FOCI: readonly ElevationFocusV4[] = ["clarity", "revenue", "systems", "owner", "clients", "sustain"];

export interface RouteLesson { slug: string; title: string; section: string }
export interface ElevationRoute { module: string; section: string; lessons: RouteLesson[] }

const MOD1 = "Mod 01 | Auditing What's Broken → Finding Your Starting Point";
const MOD2 = "Mod 02 | Restructuring Your Rates and Income Sources";
const MOD3 = "Mod 03 | Building Systems → Getting Out of Your Own Way";
const MOD4 = "Mod 04 | Paying Yourself and Protecting What You Built";

const PRODUCING = "Find Out What Your Practice Is Actually Producing";
const RATE = "Stop Letting Fear Set Your Rate | Let Your Numbers Do It";
const BILLING = "Get Billing and Admin Off Your Plate";
const PAY = "Pay Yourself Consistently | Not Just When the Account Looks Good";
const REFERRALS = "Build Referral Relationships That Send Aligned Clients Consistently";
const SCHEDULE = "Build a Schedule That Protects Your Capacity";

export const ELEVATION_ROUTES: Record<ElevationFocusV4, ElevationRoute> = {
  clarity: {
    module: MOD1,
    section: PRODUCING,
    lessons: [
      { slug: "what-your-practice-is-really-paying-you", title: "What Your Practice Is Really Paying You", section: PRODUCING },
      { slug: "current-model-audit-worksheet", title: "Current Model Audit Worksheet", section: PRODUCING },
    ],
  },
  revenue: {
    module: MOD2,
    section: RATE,
    lessons: [
      { slug: "how-to-raise-your-rate-based-on-what-the-audit-showed-you", title: "How to Raise Your Rate Based on What the Audit Showed You", section: RATE },
      { slug: "what-each-panel-is-actually-paying-you-per-hour", title: "What Each Panel Is Actually Paying You Per Hour", section: "Find Out Which Insurance Panels Are Worth Keeping" },
      { slug: "what-it-actually-takes-to-leave-a-platform-without-your-caseload-collapsing", title: "What It Actually Takes to Leave a Platform Without Your Caseload Collapsing", section: "Get Clients Off Platforms That Are Underpaying You" },
    ],
  },
  systems: {
    module: MOD3,
    section: BILLING,
    lessons: [
      { slug: "what-to-automate-what-to-delegate-what-only-you-can-do", title: "What to Automate, What to Delegate, What Only You Can Do", section: BILLING },
      { slug: "ehr-and-billing-audit-checklist", title: "EHR and Billing Audit Checklist", section: BILLING },
      { slug: "the-systems-stack-that-works-for-a-solo-or-small-practice", title: "The Systems Stack That Works for a Solo or Small Practice", section: "Choose the Right Tools Without Overpaying for Platforms You Don't Need" },
    ],
  },
  owner: {
    module: MOD4,
    section: PAY,
    lessons: [
      { slug: "why-most-practice-owners-don-t-pay-themselves", title: "Why Most Practice Owners Don't Pay Themselves", section: PAY },
      { slug: "pay-yourself-salary-planning-worksheet", title: "Pay Yourself Salary Planning Worksheet", section: PAY },
    ],
  },
  clients: {
    module: MOD2,
    section: REFERRALS,
    lessons: [
      { slug: "why-referral-partners-convert-better-than-any-directory", title: "Why Referral Partners Convert Better Than Any Directory", section: REFERRALS },
      { slug: "provider-partnership-guide", title: "Provider Partnership Guide", section: REFERRALS },
      { slug: "the-referral-rhythm-keep-clients-coming-without-starting-over-every-month", title: "The Referral Rhythm | Keep Clients Coming Without Starting Over Every Month", section: "Keep New Clients Coming In | Without Starting Over Every Month" },
    ],
  },
  sustain: {
    module: MOD4,
    section: SCHEDULE,
    lessons: [
      { slug: "how-to-build-a-sustainable-session-load", title: "How to Build a Sustainable Session Load", section: SCHEDULE },
      { slug: "calendar-and-client-load-boundaries-worksheet", title: "Calendar and Client Load Boundaries Worksheet", section: SCHEDULE },
    ],
  },
};

/** The parts of the course outline the routes are checked against. */
export interface OutlineLike { modules: { title: string; lessons: { id: number; slug: string; title: string }[] }[] }

/**
 * The routes against the live course: current lesson and section titles, and
 * only lessons that still exist. The umbrella "Mod 0N" name stays as written.
 * With no outline (it failed to load) the static table stands.
 */
export function resolveRoutes(outline: OutlineLike | null): Record<ElevationFocusV4, ElevationRoute> {
  if (!outline) return ELEVATION_ROUTES;
  const bySlug = new Map<string, { title: string; section: string }>();
  for (const m of outline.modules) for (const l of m.lessons) bySlug.set(l.slug, { title: l.title, section: m.title });
  const out = {} as Record<ElevationFocusV4, ElevationRoute>;
  for (const focus of ELEVATION_FOCI) {
    const route = ELEVATION_ROUTES[focus];
    const lessons = route.lessons.flatMap((l) => {
      const live = bySlug.get(l.slug);
      return live ? [{ slug: l.slug, title: live.title, section: live.section }] : [];
    });
    out[focus] = { module: route.module, section: lessons[0]?.section ?? route.section, lessons };
  }
  return out;
}

/** Lesson slugs the dashboard may open: the routes', plus anything in the live outline. */
export function allowedLessonSlugs(outline: OutlineLike | null): Set<string> {
  const slugs = new Set(ELEVATION_FOCI.flatMap((f) => ELEVATION_ROUTES[f].lessons.map((l) => l.slug)));
  for (const m of outline?.modules ?? []) for (const l of m.lessons) slugs.add(l.slug);
  return slugs;
}

/* ------------------------------------------------- Practice Reset Snapshot v2 */

/** The v2 snapshot lesson's tool key (row 158); read here, written only there. */
export const SNAPSHOT_V2_KEY = "practice-reset-snapshot-v2";

/**
 * A pathway or priority as the snapshot words it, as one of the dashboard's six.
 * Accepts the dashboard's own keys, the older snapshot's keys (rate / pay /
 * numbers / systems) and plain-language names; anything else is null.
 */
export function focusFromPathway(raw: unknown): ElevationFocusV4 | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if ((ELEVATION_FOCI as readonly string[]).includes(v)) return v as ElevationFocusV4;
  const rules: [ElevationFocusV4, RegExp][] = [
    ["clarity", /clarity|numbers|audit|baseline|performance|starting point/],
    ["owner", /owner|pay(ing)? ?(yourself|myself)|^pay$|salary|compensation|lifestyle|cash ?flow|distribution/],
    ["revenue", /revenue|\brates?\b|income|payer|panel|platform|pricing|collections/],
    ["systems", /system|operation|admin|billing|automat|delegat|workflow/],
    ["clients", /client|referral|inquir|marketing|visibility|retention/],
    ["sustain", /sustain|workload|burnout|capacity|schedule|session load|time off|energy/],
  ];
  for (const [focus, re] of rules) if (re.test(v)) return focus;
  return null;
}

export interface SnapshotSuggestion {
  focus: ElevationFocusV4;
  /** Where the focus came from: the member's own pick wins over the scored one. */
  source: "member" | "recommended";
  flags: string[];
  lessonIds: number[];
  completedAt: string | null;
}

/** The v2 snapshot saves flag ids (snapshotRouting.ts FLAG_COPY); shown here by their labels. */
const FLAG_LABELS: Record<string, string> = {
  financial_clarity: "Complete the Current Model Audit",
  payer_dependency: "Review insurance and platform dependence",
  rate_review: "Evaluate your private-pay rate",
  owner_pay: "Review owner pay and reserves",
  systems_gap: "Improve your systems and delegation plan",
};
const flagLabel = (flag: string): string =>
  FLAG_LABELS[flag] ?? (/^[a-z0-9_]+$/.test(flag) ? flag.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : flag);

/**
 * What the v2 snapshot's saved state suggests for the dashboard, or null (also
 * before its first completion, when every field is still null). The member's
 * own priority wins over the scored recommendation.
 */
export function snapshotSuggestion(raw: unknown): SnapshotSuggestion | null {
  if (!record(raw)) return null;
  const mine = focusFromPathway(raw.member_selected_priority);
  const scored = focusFromPathway(raw.recommended_focus) ?? focusFromPathway(raw.recommended_pathway);
  const focus = mine ?? scored;
  if (!focus) return null;
  const flags = Array.isArray(raw.flags)
    ? raw.flags
        .flatMap((f) => (typeof f === "string" ? [flagLabel(f)] : record(f) && typeof f.label === "string" ? [f.label] : []))
        .map((f) => f.slice(0, 300))
        .slice(0, 8)
    : [];
  const lessonIds = Array.isArray(raw.recommended_lesson_ids)
    ? raw.recommended_lesson_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 6)
    : [];
  return {
    focus,
    source: mine ? "member" : "recommended",
    flags,
    lessonIds,
    completedAt: typeof raw.completed_at === "string" ? raw.completed_at : null,
  };
}

/** The snapshot's own recommended lessons, by id, as they stand in the live outline. */
export function snapshotLessons(ids: readonly number[], outline: OutlineLike | null): RouteLesson[] {
  if (!outline || ids.length === 0) return [];
  const byId = new Map<number, RouteLesson>();
  for (const m of outline.modules) for (const l of m.lessons) byId.set(l.id, { slug: l.slug, title: l.title, section: m.title });
  return ids.flatMap((id) => {
    const lesson = byId.get(id);
    return lesson ? [lesson] : [];
  });
}
