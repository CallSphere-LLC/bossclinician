/**
 * "My Living Business Plan" (QA sheet row 159): the owner's standalone annual
 * dashboard — Dashboard A, annual planning only — as data and pure functions.
 * The Executive Summary plus the ten sections of her Private Practice Business
 * Plan (Maxed Out Clinician Edition), review checkmarks, dated strategic
 * reviews, and an end-of-year rollover that archives the year.
 *
 * Saved per member under tool key `living-business-plan` (useVersionedToolState
 * → member_tool_state) instead of the prototype's localStorage key. Her README
 * keeps the draft plan separate from the append-only archive and reviews: the
 * draft is edited freely, while `reviews` and `archives` only ever grow —
 * `keepHistory` re-adds anything a later document is missing, and a restored
 * backup replaces the draft but merges its archives and reviews in.
 *
 * Her JSON backup format ({type:'boss-clinician-annual-plan', version:1, data})
 * is kept, so a backup downloaded from the prototype restores here.
 */

export const LIVING_PLAN_KEY = "living-business-plan";
export const BACKUP_TYPE = "boss-clinician-annual-plan";

export type FieldType = "text" | "textarea" | "number" | "date" | { select: readonly string[] };

export interface PlanField {
  key: string;
  label: string;
  type: FieldType;
}

export interface PlanGroup {
  id: string;
  title: string;
  desc: string;
  fields: readonly PlanField[];
}

const f = (key: string, label: string, type: FieldType = "text"): PlanField => ({ key, label, type });
const select = (...options: string[]): FieldType => ({ select: options });

/** Her `annualGroups`, verbatim. */
export const PLAN_GROUPS: readonly PlanGroup[] = [
  { id: "summary", title: "Executive Summary", desc: "Complete this last. Summarize your real practice, targets and the purpose of this plan.", fields: [f("legalName", "Registered practice name"), f("ownerName", "Owner / lead clinician"), f("yearEstablished", "Year practice established", "number"), f("summaryMission", "Mission statement (2 sentences maximum)", "textarea"), f("annualActual", "Most recent completed annual revenue ($)", "number"), f("annualTarget", "Annual revenue goal ($)", "number"), f("practiceOverview", "One-paragraph practice overview", "textarea")] },
  { id: "identity", title: "01 · Identity & Direction", desc: "Clarify what your practice does, whom it serves, and the value you intend to build.", fields: [f("vision5", "Five-to-ten-year vision", "textarea"), f("mission", "Practice mission", "textarea"), f("specialty", "Primary clinical specialization"), f("niche", "Ideal clients, problems, outcomes and approach", "textarea"), f("different", "What makes your practice distinct?", "textarea"), f("ceoIdentity", "My CEO identity statement", "textarea")] },
  { id: "structure", title: "02 · Structure & Compliance", desc: "Maintain a business-level record of your legal and operational structure. Keep tax IDs and account numbers outside this tool.", fields: [f("entity", "Business entity type", select("Sole proprietor", "LLC", "PLLC", "Corporation", "Partnership", "Other")), f("regState", "State of business registration"), f("dba", "DBA or brand name"), f("licenseType", "Clinical license type"), f("licenseState", "Licensed practice state(s)"), f("licensingStatus", "Licensing and compliance review status", select("Not reviewed", "Needs attention", "Verified with professional")), f("liabilityStatus", "Professional liability / malpractice coverage status", select("Not reviewed", "Needs attention", "Current")), f("businessBanking", "Business / personal banking separation status", select("Not reviewed", "Separate", "Needs work")), f("deliveryModel", "Practice delivery model", select("In-person", "Telehealth", "Hybrid")), f("structureNotes", "Important structural notes and follow-up", "textarea")] },
  { id: "financial", title: "03 · Financial Model", desc: "Compare your current model with your restructured targets. Enter actual collected income, not invoices or billed charges.", fields: [f("ownerTarget", "Desired owner monthly compensation ($)", "number"), f("annualExpense", "Most recent annual business expenses ($)", "number"), f("reserveBalance", "Current liquid business reserves ($)", "number"), f("sourceInsurance", "Monthly direct insurance collections ($)", "number"), f("sourcePlatform", "Monthly platform-sourced collections ($)", "number"), f("sourcePrivate", "Monthly private-pay collections ($)", "number"), f("sourceOther", "Monthly other business collections ($)", "number"), f("financialStrategy", "What should change in your model this year?", "textarea")] },
  { id: "services", title: "04 · Services & Offers", desc: "Document clinical offerings, insurance/payer decisions, and responsible service expansion.", fields: [f("clinicalOffers", "Current clinical services, fees and payment models", "textarea"), f("newOffers", "Additional income streams (active or planned)", "textarea"), f("payerDecisions", "Insurance panels: maintain, review, reduce, or exit", "textarea"), f("serviceEthics", "Clinical, ethical and payer-contract considerations", "textarea"), f("serviceGoals", "Service-model changes for this plan year", "textarea")] },
  { id: "attraction", title: "05 · Client Attraction & Referrals", desc: "Define aligned demand and reduce overdependence on one referral source.", fields: [f("targetClients", "Ideal client profile", "textarea"), f("referralMix", "Referral source mix and approximate shares", "textarea"), f("partners", "Referral partners and relationship status", "textarea"), f("website", "Website strategy and primary client action", "textarea"), f("visibility", "Other outreach, SEO, speaking or community strategies", "textarea"), f("clientFlowGoal", "Client acquisition goal this year", "textarea")] },
  { id: "systems", title: "06 · Systems & Operations", desc: "Document how the practice works beyond your memory.", fields: [f("techStack", "EHR, billing, scheduling, communications and accounting tools", "textarea"), f("sopsCurrent", "Documented SOPs currently in place", "textarea"), f("sopsMissing", "Critical SOPs or workflows still needed", "textarea"), f("adminGoal", "Desired reduction in unpaid admin work", "textarea"), f("continuity", "Vacation, illness, practice closure and client coverage planning", "textarea")] },
  { id: "team", title: "07 · Team & Support", desc: "Solo owners can document advisors and outsourced support; a group practice can plan staffing and supervision.", fields: [f("teamCurrent", "Current employees, contractors and support roles", "textarea"), f("advisorTeam", "Accountant, lawyer, supervisor and other professional advisors", "textarea"), f("hiring", "Planned hires, reason, estimated cost and target date", "textarea"), f("delegation", "What should stop depending entirely on you?", "textarea")] },
  { id: "goals", title: "08 · Annual Goals & Milestones", desc: "Keep 12-month direction, optional quarterly milestones, and your separate renewable 30-day action plans.", fields: [f("annualGoal1", "12-month outcome 1"), f("annualGoal2", "12-month outcome 2"), f("annualGoal3", "12-month outcome 3"), f("annualGoal4", "12-month outcome 4"), f("annualGoal5", "12-month outcome 5"), f("quarterlyMilestones", "Quarterly strategic milestones", "textarea"), f("threeYear", "Three-year practice vision goals", "textarea")] },
  { id: "risk", title: "09 · Risk & Contingency", desc: "Identify likely business disruptions and the protections you are putting in place.", fields: [f("risks", "Key risks: payer cuts, platform changes, caseload loss, illness, etc.", "textarea"), f("mitigations", "Mitigation strategies and responsible owner", "textarea"), f("reserveTarget", "Target business reserve fund ($)", "number"), f("backupPlan", "Contingency if collections drop or the owner cannot work", "textarea")] },
  { id: "declaration", title: "10 · CEO Declaration", desc: "Review the plan, acknowledge your commitments, and date the annual version.", fields: [f("declaration", "My CEO commitment this year", "textarea"), f("signedName", "Typed CEO name (acknowledgment only)"), f("signedDate", "Acknowledgment date", "date"), f("renewalNotes", "Annual renewal reflections", "textarea")] },
];

export const REVIEW_TYPES = ["Quarterly check-in", "Annual review", "Major business change"] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

/** Fields cleared when a year is archived and the next one starts (her `rollYear`). */
export const ROLLOVER_CLEARS = ["signedName", "signedDate", "declaration", "renewalNotes"] as const;

const FIELDS = new Map(PLAN_GROUPS.flatMap((g) => g.fields.map((field) => [field.key, field] as const)));
const GROUP_IDS = new Set(PLAN_GROUPS.map((g) => g.id));

/** Per-field ceilings keep a member's whole document — draft, archives, reviews — under the 256 KB save limit. */
export const TEXTAREA_MAX = 4000;
export const INPUT_MAX = 300;
export const REVIEW_NOTES_MAX = 4000;
export const fieldMax = (field: PlanField): number => (field.type === "textarea" ? TEXTAREA_MAX : INPUT_MAX);

export interface AnnualPlan {
  /** Field key → what was typed (numbers stay text, as in the prototype). `planYear` is kept here too. */
  values: Record<string, string>;
  /** Group id → "I have reviewed this section for the current plan year." */
  reviewed: Record<string, boolean>;
}

export interface StrategicReview {
  date: string;
  type: ReviewType;
  notes: string;
  /** When it was saved (not in the prototype's backups; filled from `date`). */
  savedAt: string;
}

export interface PlanArchive {
  year: number;
  archivedAt: string;
  plan: AnnualPlan;
}

export interface LivingPlanState {
  version: 1;
  annual: AnnualPlan;
  reviews: StrategicReview[];
  archives: PlanArchive[];
}

export const currentYear = (): string => String(new Date().getFullYear());

export const livingPlanDefaults = (): LivingPlanState => ({
  version: 1,
  annual: { values: { planYear: currentYear() }, reviewed: {} },
  reviews: [],
  archives: [],
});

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** One field's value, cleaned to its kind; null when it cannot be kept. */
export function cleanValue(key: string, raw: unknown): string | null {
  if (key === "planYear") {
    const year = Number(raw);
    return Number.isInteger(year) && year >= 1900 && year <= 2200 ? String(year) : null;
  }
  const field = FIELDS.get(key);
  if (!field || (typeof raw !== "string" && typeof raw !== "number")) return null;
  const value = String(raw).slice(0, fieldMax(field));
  if (typeof field.type === "object") return value === "" || field.type.select.includes(value) ? value : null;
  if (field.type === "number") return value.trim() === "" || Number.isFinite(Number(value)) ? value : null;
  return value;
}

export function cleanPlan(raw: unknown): AnnualPlan {
  const values: Record<string, string> = {};
  const reviewed: Record<string, boolean> = {};
  if (record(raw)) {
    if (record(raw.values)) {
      for (const [key, v] of Object.entries(raw.values)) {
        const clean = cleanValue(key, v);
        if (clean !== null) values[key] = clean;
      }
    }
    if (record(raw.reviewed)) {
      for (const [id, v] of Object.entries(raw.reviewed)) if (GROUP_IDS.has(id) && v === true) reviewed[id] = true;
    }
  }
  values.planYear ??= currentYear();
  return { values, reviewed };
}

function cleanReview(raw: unknown): StrategicReview | null {
  if (!record(raw) || typeof raw.date !== "string" || typeof raw.notes !== "string" || !raw.notes.trim()) return null;
  const date = raw.date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const type = REVIEW_TYPES.includes(raw.type as ReviewType) ? (raw.type as ReviewType) : "Quarterly check-in";
  return { date, type, notes: raw.notes.slice(0, REVIEW_NOTES_MAX), savedAt: isDate(raw.savedAt) ? raw.savedAt : `${date}T00:00:00.000Z` };
}

function cleanArchive(raw: unknown): PlanArchive | null {
  if (!record(raw) || !isDate(raw.archivedAt)) return null;
  const year = Number(raw.year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  return { year, archivedAt: raw.archivedAt, plan: cleanPlan(raw.plan) };
}

const archiveKey = (a: PlanArchive) => `${a.year}|${a.archivedAt}`;
const reviewKey = (r: StrategicReview) => `${r.savedAt}|${r.date}|${r.type}|${r.notes}`;

function union<T>(first: readonly T[], second: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set(first.map(key));
  return [...first, ...second.filter((item) => !seen.has(key(item)) && seen.add(key(item)))];
}

export function normaliseLivingPlan(raw: unknown): LivingPlanState {
  if (!record(raw)) return livingPlanDefaults();
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.map(cleanReview).filter((r): r is StrategicReview => r !== null) : [];
  const archives = Array.isArray(raw.archives) ? raw.archives.map(cleanArchive).filter((a): a is PlanArchive => a !== null) : [];
  return { version: 1, annual: cleanPlan(raw.annual), reviews: union([], reviews, reviewKey), archives: union([], archives, archiveKey) };
}

/** Append-only history: whatever `previous` had in `reviews` / `archives` stays, in its order, ahead of anything new. */
export function keepHistory(previous: LivingPlanState, next: LivingPlanState): LivingPlanState {
  return { ...next, reviews: union(previous.reviews, next.reviews, reviewKey), archives: union(previous.archives, next.archives, archiveKey) };
}

export function setValue(state: LivingPlanState, key: string, raw: string): LivingPlanState {
  const clean = cleanValue(key, raw);
  if (clean === null) return state;
  return { ...state, annual: { ...state.annual, values: { ...state.annual.values, [key]: clean } } };
}

export function setReviewed(state: LivingPlanState, groupId: string, checked: boolean): LivingPlanState {
  if (!GROUP_IDS.has(groupId)) return state;
  const reviewed = { ...state.annual.reviewed };
  if (checked) reviewed[groupId] = true;
  else delete reviewed[groupId];
  return { ...state, annual: { ...state.annual, reviewed } };
}

export const reviewedCount = (plan: AnnualPlan): number => PLAN_GROUPS.filter((g) => plan.reviewed[g.id]).length;

export function addReview(state: LivingPlanState, input: { date: string; type: string; notes: string }, now: string): LivingPlanState | null {
  const review = cleanReview({ ...input, savedAt: now });
  return review ? { ...state, reviews: [...state.reviews, review] } : null;
}

export const planYear = (plan: AnnualPlan): number => Number(plan.values.planYear) || new Date().getFullYear();

/** Her `rollYear`: archive a copy of the year, start the next with the strategy carried over and the checkmarks and declaration reset. */
export function rollYear(state: LivingPlanState, now: string): LivingPlanState {
  const year = planYear(state.annual);
  const archive: PlanArchive = { year, archivedAt: now, plan: cleanPlan(JSON.parse(JSON.stringify(state.annual))) };
  const values: AnnualPlan["values"] = { ...state.annual.values, planYear: String(year + 1) };
  for (const key of ROLLOVER_CLEARS) values[key] = "";
  return { ...state, annual: { values, reviewed: {} }, archives: [...state.archives, archive] };
}

/** Her backup file. */
export const backupDocument = (state: LivingPlanState) => ({ type: BACKUP_TYPE, version: 1, data: state });

/**
 * A restored backup: the draft plan comes from the file, archives and reviews
 * are merged (never dropped). Null when the file is not one of these backups —
 * the same checks as her `restoreBackup`.
 */
export function restoreFromBackup(current: LivingPlanState, file: unknown): LivingPlanState | null {
  if (!record(file) || file.type !== BACKUP_TYPE || !record(file.data)) return null;
  const data = file.data;
  if (!record(data.annual) || !record(data.annual.values) || !Array.isArray(data.archives) || !Array.isArray(data.reviews)) return null;
  return keepHistory(current, normaliseLivingPlan(data));
}

/** Bytes the saved document will take, to warn before the 256 KB save limit. */
export const planBytes = (state: LivingPlanState): number => new TextEncoder().encode(JSON.stringify(state)).length;
export const SIZE_WARNING_BYTES = 200 * 1024;
