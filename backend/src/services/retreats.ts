import crypto from "crypto";
import { z } from "zod";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { notFound } from "../utils/httpError";
import {
  guestQuestionnaireView,
  guestRoomType,
  loadOwnedFiles,
  loadQuestionnaires,
  loadResponses,
  renderWording,
  type Audience,
  type ResponseRow,
  type RoomType,
  type WordingContext,
} from "./retreatQuestionnaires";
import type { BalancePlanView } from "./retreatBalancePlans";

/**
 * FlourisHealer Retreat Dashboard (sheet row 248, Yvette's item 11; migrations
 * 218 + 219). The member routes (routes/member/retreats.ts), the organizer
 * routes (routes/admin/retreats.ts) and the signed media links
 * (routes/public/retreatMedia.ts) all go through this module.
 *
 * Three rules hold everywhere:
 *
 *  1. A guest is a member holding an ACTIVE grant on the retreat's own
 *     dashboard product, on a retreat the owner has PUBLISHED. Nothing else —
 *     not the booking product, not a tag, not an order — opens a dashboard.
 *  2. Every checklist status is computed here from records: the contract
 *     signing record, a form submission, a guest self-report, an organizer
 *     review, an order. A guest request can write "submitted" at most; only an
 *     organizer review produces Verified or Needs attention.
 *  3. Nothing here sends email.
 */

/* ───────────────────────────────── types ──────────────────────────────── */

export const TASK_KEYS = [
  "agreement",
  "guest_profile",
  "flight_preferences",
  "travel_insurance",
  "flight_details",
  "passport",
  "payments",
  "group_call",
] as const;
export type TaskKey = (typeof TASK_KEYS)[number];
export type TaskStatus = "not_started" | "in_progress" | "submitted" | "verified" | "needs_attention";

/** The task the guest marks done herself (a personal check). Guest Profile and flight details are questionnaires now (migration 224). */
export const SELF_REPORTED_TASKS = ["passport"] as const;
export type SelfReportedTask = (typeof SELF_REPORTED_TASKS)[number];

/** Tasks an organizer may mark Verified / Needs attention. The agreement follows its signature only. */
export const REVIEWABLE_TASKS: readonly TaskKey[] = ["passport", "payments", "group_call"];

export const FORM_KEYS = ["flight_preferences", "travel_insurance"] as const;
export type FormKey = (typeof FORM_KEYS)[number];

export type OpenMode = "auto" | "open" | "closed";
export type Phase = "upcoming" | "in_progress" | "ended";

export interface RetreatRow {
  id: number;
  slug: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  timezone: string;
  product_id: number | null;
  booking_product_id: number | null;
  course_id: number | null;
  published: boolean;
  settings: unknown;
  created_at: Date;
  updated_at: Date;
}

/** `::text` on the dates: a pg DATE read as a JS Date shifts by the server's zone. */
export const RETREAT_COLUMNS = `id, slug, title, location, start_date::text AS start_date, end_date::text AS end_date,
  timezone, product_id, booking_product_id, course_id, published, settings, created_at, updated_at`;

/* ─────────────────────────────── settings ─────────────────────────────── */

export interface FeedbackLabels {
  rating: string;
  favoriteMoment: string;
  appreciated: string;
  expectations: string;
  improve: string;
  attendAgain: string;
  recommend: string;
  testimonialText: string;
  testimonialConsent: string;
}

export interface RetreatSettings {
  dashboardTitle: string;
  welcomeMessage: string;
  supportEmail: string;
  airport: string;
  guestProfileUrl: string;
  flightTrackerUrl: string;
  transportNote: string;
  shuttle: { confirmed: boolean; details: string };
  groupCall: { confirmed: boolean; startsAt: string | null; timezone: string; joinUrl: string; notes: string };
  flightGuidance: { status: "researching" | "recommendations_available" | "booking_encouraged"; note: string };
  inclusions: string[];
  itineraryMd: string;
  preparationMd: string;
  passportValidThrough: string | null;
  gallery: { mode: OpenMode; uploadsMode: OpenMode; requireReview: boolean; maxPhotoMb: number; maxVideoMb: number };
  feedback: { mode: OpenMode; labels: FeedbackLabels };
  interest: { mode: OpenMode };
  joinUsAgain: { mode: OpenMode; intro: string };
  /** Planned activities shown under Retreat Details (owner-editable, migration 224). */
  activities: string[];
  /** Owner-set deadlines shown in Important dates; a null date shows "Details coming soon". */
  deadlines: RetreatDeadline[];
  /** Which fixed checklist items this retreat uses (a domestic retreat may not need a passport). */
  checklist: { passport: boolean; groupCall: boolean };
  /** Travel insurance guidance (strongly recommended, never required). */
  insurance: { show: boolean };
}

export interface RetreatDeadline {
  label: string;
  date: string | null;
  note: string;
}

/** The reflection questions as the owner's brief words them (editable per retreat). */
export const DEFAULT_FEEDBACK_LABELS: FeedbackLabels = {
  rating: "Overall retreat experience",
  favoriteMoment: "What was your favorite moment or experience?",
  appreciated:
    "What did you appreciate most about being with like-minded women or stepping away from everyday responsibilities?",
  expectations: "How did the actual experience compare with what you expected?",
  improve: "What could we improve, change, or include next time?",
  attendAgain: "Would you consider attending a future FlourisHealer retreat?",
  recommend: "Would you recommend FlourisHealer to a friend or colleague?",
  testimonialText: "Optional public testimonial, in your own words",
  testimonialConsent: "May FlourisHealer publicly use your optional testimonial?",
};

/** Safe defaults: nothing confirmed, nothing open that the owner has not chosen. */
export const DEFAULT_SETTINGS: RetreatSettings = {
  dashboardTitle: "YOUR RETREAT DASHBOARD",
  welcomeMessage: "",
  supportEmail: "retreats@bossclinician.com",
  airport: "",
  guestProfileUrl: "",
  flightTrackerUrl: "",
  transportNote: "",
  shuttle: { confirmed: false, details: "" },
  groupCall: { confirmed: false, startsAt: null, timezone: "America/Los_Angeles", joinUrl: "", notes: "" },
  flightGuidance: { status: "researching", note: "" },
  inclusions: [],
  itineraryMd: "",
  preparationMd: "",
  passportValidThrough: null,
  gallery: { mode: "auto", uploadsMode: "auto", requireReview: true, maxPhotoMb: 20, maxVideoMb: 200 },
  feedback: { mode: "auto", labels: DEFAULT_FEEDBACK_LABELS },
  interest: { mode: "auto" },
  joinUsAgain: { mode: "closed", intro: "" },
  activities: [],
  deadlines: [],
  checklist: { passport: true, groupCall: true },
  insurance: { show: true },
};

/** Upper bounds the owner cannot raise past (request body + memory/disk). */
export const MAX_PHOTO_MB_CEILING = 30;
export const MAX_VIDEO_MB_CEILING = 400;

const MODE = z.enum(["auto", "open", "closed"]);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const shortText = (max: number) => z.string().trim().max(max);

/** A link the owner pasted: https only, or a path on this site. */
export const safeLink = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || (value.startsWith("/") && !value.startsWith("//")) || /^https:\/\/[^\s]+$/i.test(value), {
    message: "Use a full https:// link or a path on this site.",
  });

const labelsSchema = z.object({
  rating: shortText(300),
  favoriteMoment: shortText(300),
  appreciated: shortText(300),
  expectations: shortText(300),
  improve: shortText(300),
  attendAgain: shortText(300),
  recommend: shortText(300),
  testimonialText: shortText(300),
  testimonialConsent: shortText(300),
});

/** What the organizer may PUT; every key optional, nested objects merged. */
export const settingsPatchSchema = z
  .object({
    dashboardTitle: shortText(120),
    welcomeMessage: shortText(4000),
    supportEmail: z.string().trim().email().max(254),
    airport: shortText(200),
    guestProfileUrl: safeLink,
    flightTrackerUrl: safeLink,
    transportNote: shortText(2000),
    shuttle: z.object({ confirmed: z.boolean(), details: shortText(4000) }).partial(),
    groupCall: z
      .object({
        confirmed: z.boolean(),
        startsAt: z.string().datetime({ offset: true }).nullable(),
        timezone: shortText(64),
        joinUrl: safeLink,
        notes: shortText(2000),
      })
      .partial(),
    flightGuidance: z
      .object({ status: z.enum(["researching", "recommendations_available", "booking_encouraged"]), note: shortText(4000) })
      .partial(),
    inclusions: z.array(shortText(300)).max(40),
    itineraryMd: shortText(30000),
    preparationMd: shortText(30000),
    passportValidThrough: z.string().regex(DATE_ONLY).nullable(),
    gallery: z
      .object({
        mode: MODE,
        uploadsMode: MODE,
        requireReview: z.boolean(),
        maxPhotoMb: z.number().int().min(1).max(MAX_PHOTO_MB_CEILING),
        maxVideoMb: z.number().int().min(1).max(MAX_VIDEO_MB_CEILING),
      })
      .partial(),
    feedback: z.object({ mode: MODE, labels: labelsSchema.partial() }).partial(),
    interest: z.object({ mode: MODE }).partial(),
    joinUsAgain: z.object({ mode: MODE, intro: shortText(1000) }).partial(),
    activities: z.array(shortText(300)).max(40),
    deadlines: z
      .array(z.object({ label: shortText(200).min(1), date: z.string().regex(DATE_ONLY).nullable(), note: shortText(500).default("") }).strict())
      .max(20),
    checklist: z.object({ passport: z.boolean(), groupCall: z.boolean() }).partial(),
    insurance: z.object({ show: z.boolean() }).partial(),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Stored settings over the defaults, one level of nesting deep. Anything of the
 * wrong type falls back to the default rather than reaching a guest's screen.
 */
export function normaliseSettings(raw: unknown): RetreatSettings {
  const stored = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS) as [keyof RetreatSettings, unknown][]) {
    const value = stored[key];
    if (key === "deadlines") {
      out[key] = normaliseDeadlines(value);
    } else if (Array.isArray(fallback)) {
      out[key] = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
    } else if (isRecord(fallback)) {
      const nested: Record<string, unknown> = { ...fallback };
      if (isRecord(value)) {
        for (const [nestedKey, nestedFallback] of Object.entries(fallback)) {
          const candidate = value[nestedKey];
          if (isRecord(nestedFallback)) {
            nested[nestedKey] = { ...nestedFallback, ...(isRecord(candidate) ? pickSameTypes(candidate, nestedFallback) : {}) };
          } else if (sameType(candidate, nestedFallback)) {
            nested[nestedKey] = candidate;
          }
        }
      }
      out[key] = nested;
    } else if (fallback === null) {
      out[key] = typeof value === "string" ? value : null;
    } else {
      out[key] = sameType(value, fallback) ? value : fallback;
    }
  }
  return out as unknown as RetreatSettings;
}

function normaliseDeadlines(value: unknown): RetreatDeadline[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((item) => typeof item.label === "string" && item.label.trim() !== "")
    .map((item) => ({
      label: String(item.label),
      date: typeof item.date === "string" && DATE_ONLY.test(item.date) ? item.date : null,
      note: typeof item.note === "string" ? item.note : "",
    }));
}

function sameType(value: unknown, fallback: unknown): boolean {
  if (value === undefined) return false;
  if (fallback === null) return value === null || typeof value === "string";
  return typeof value === typeof fallback;
}

function pickSameTypes(value: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(fallback)) if (sameType(value[key], def)) out[key] = value[key];
  return out;
}

/** Applies a validated patch onto the current settings (nested objects merged). */
export function mergeSettings(current: RetreatSettings, patch: SettingsPatch): RetreatSettings {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = (current as unknown as Record<string, unknown>)[key];
    if (isRecord(value) && isRecord(existing)) {
      const merged: Record<string, unknown> = { ...existing };
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (nestedValue === undefined) continue;
        const nestedExisting = existing[nestedKey];
        merged[nestedKey] = isRecord(nestedValue) && isRecord(nestedExisting) ? { ...nestedExisting, ...nestedValue } : nestedValue;
      }
      next[key] = merged;
    } else {
      next[key] = value;
    }
  }
  return normaliseSettings(next);
}

/* ─────────────────────────────── dates ────────────────────────────────── */

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; UTC when the zone is unknown. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

export function retreatPhase(startDate: string, endDate: string, today: string): { phase: Phase; daysUntilStart: number | null } {
  const t = dayNumber(today);
  const start = dayNumber(startDate);
  const end = dayNumber(endDate);
  if (t < start) return { phase: "upcoming", daysUntilStart: start - t };
  if (t <= end) return { phase: "in_progress", daysUntilStart: 0 };
  return { phase: "ended", daysUntilStart: null };
}

/**
 * Whether a post-retreat area is open. "auto" opens on the retreat's last day
 * (the owner's brief: "open on last retreat day"), so the Day +3/+7/+14 alumni
 * emails land on an open page without anybody remembering to flip a switch.
 */
export function isOpen(mode: OpenMode, endDate: string, today: string): boolean {
  if (mode === "open") return true;
  if (mode === "closed") return false;
  return dayNumber(today) >= dayNumber(endDate);
}

/* ─────────────────────────────── lookups ──────────────────────────────── */

export async function findRetreatBySlug(slug: string): Promise<RetreatRow | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  const result = await pool.query<RetreatRow>(`SELECT ${RETREAT_COLUMNS} FROM retreats WHERE slug = $1`, [slug]);
  return result.rows[0] ?? null;
}

export async function findRetreatById(id: number): Promise<RetreatRow | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null;
  const result = await pool.query<RetreatRow>(`SELECT ${RETREAT_COLUMNS} FROM retreats WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function hasActiveGrant(memberId: number, productId: number | null): Promise<boolean> {
  if (productId === null) return false;
  const result = await pool.query(
    `SELECT 1 FROM access_grants
      WHERE member_id = $1 AND product_id = $2 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [memberId, productId],
  );
  return result.rows.length > 0;
}

/** Rule 1: published retreat + active grant on its dashboard product. */
export async function isRetreatGuest(memberId: number, retreat: RetreatRow): Promise<boolean> {
  if (!retreat.published) return false;
  return hasActiveGrant(memberId, retreat.product_id);
}

export const RETREAT_MISSING = "We couldn't find that retreat dashboard.";

/**
 * The retreat behind a guest URL, or a 404. Deliberately the same 404 for "no
 * such retreat", "not published" and "not your retreat", so a slug cannot be
 * probed for existence.
 */
export async function loadGuestRetreat(memberId: number, slug: string): Promise<RetreatRow> {
  const retreat = await findRetreatBySlug(slug);
  if (!retreat || !(await isRetreatGuest(memberId, retreat))) throw notFound(RETREAT_MISSING);
  return retreat;
}

/** Every published retreat this member is a guest of (the portal nav and /retreats/dashboard). */
export async function listMemberRetreats(memberId: number) {
  const result = await pool.query<{ slug: string; title: string; location: string; start_date: string; end_date: string }>(
    `SELECT r.slug, r.title, r.location, r.start_date::text AS start_date, r.end_date::text AS end_date
       FROM retreats r
       JOIN access_grants g ON g.product_id = r.product_id
      WHERE r.published AND g.member_id = $1 AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
      ORDER BY r.start_date DESC`,
    [memberId],
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}

export async function memberIdentity(memberId: number): Promise<{ firstName: string; name: string; email: string; contactId: number | null }> {
  const result = await pool.query<{ first_name: string | null; name: string | null; email: string; contact_id: number | null }>(
    `SELECT first_name, name, email::text AS email, contact_id FROM members WHERE id = $1`,
    [memberId],
  );
  const row = result.rows[0];
  const name = (row?.name ?? "").trim();
  const firstName = (row?.first_name ?? "").trim() || name.split(/\s+/)[0] || "";
  return { firstName, name: name || [row?.first_name].filter(Boolean).join(" "), email: row?.email ?? "", contactId: row?.contact_id ?? null };
}

/* ────────────────────────── task + form records ───────────────────────── */

export interface TaskRecord {
  task_key: TaskKey;
  guest_status: "none" | "submitted";
  guest_data: Record<string, unknown>;
  guest_updated_at: Date | null;
  review_status: "verified" | "needs_attention" | null;
  review_note: string;
  reviewed_at: Date | null;
}

export interface FormRecord {
  id: number;
  form_key: FormKey;
  data: Record<string, unknown>;
  state: "draft" | "submitted";
  revision: number;
  updated_at: Date;
  submitted_at: Date | null;
}

export async function loadTaskRecords(retreatId: number, memberId: number): Promise<Map<TaskKey, TaskRecord>> {
  const result = await pool.query<TaskRecord>(
    `SELECT task_key, guest_status, guest_data, guest_updated_at, review_status, review_note, reviewed_at
       FROM retreat_guest_tasks WHERE retreat_id = $1 AND member_id = $2`,
    [retreatId, memberId],
  );
  return new Map(result.rows.map((row) => [row.task_key, row]));
}

export async function loadFormRecords(retreatId: number, memberId: number): Promise<Map<FormKey, FormRecord>> {
  const result = await pool.query<FormRecord>(
    `SELECT id, form_key, data, state, revision, updated_at, submitted_at
       FROM retreat_form_responses WHERE retreat_id = $1 AND member_id = $2`,
    [retreatId, memberId],
  );
  return new Map(result.rows.map((row) => [row.form_key, row]));
}

export interface FormResponseView {
  state: "none" | "draft" | "submitted";
  data: Record<string, unknown>;
  updatedAt: string | null;
  submittedAt: string | null;
  revision: number;
}

export function formView(record: FormRecord | undefined): FormResponseView {
  if (!record) return { state: "none", data: {}, updatedAt: null, submittedAt: null, revision: 0 };
  return {
    state: record.state,
    data: record.data,
    updatedAt: new Date(record.updated_at).toISOString(),
    submittedAt: record.submitted_at ? new Date(record.submitted_at).toISOString() : null,
    revision: record.revision,
  };
}

/**
 * The status a guest sees. An organizer review wins only while it is newer than
 * the guest's latest change: a guest who fixes what she was asked to fix goes
 * back to Submitted, and the organizer sees that she did.
 */
export function effectiveStatus(
  base: TaskStatus,
  baseAt: Date | null,
  review: { status: "verified" | "needs_attention" | null; at: Date | null } | null,
): TaskStatus {
  if (review?.status && review.at && (!baseAt || new Date(review.at).getTime() >= new Date(baseAt).getTime())) {
    return review.status;
  }
  return base;
}

export function formBaseStatus(record: FormRecord | undefined): TaskStatus {
  if (!record) return "not_started";
  return record.state === "submitted" ? "submitted" : "in_progress";
}

/* ─────────────────────────────── agreement ────────────────────────────── */

export interface AgreementView {
  status: TaskStatus;
  signedAt: string | null;
  awaitingSignature: boolean;
}

export interface AgreementAssignment {
  id: number;
  status: string;
  signed_at: Date | null;
}

export async function loadAgreementAssignments(retreatId: number, memberId: number): Promise<AgreementAssignment[]> {
  const result = await pool.query<{ id: string | number; status: string; signed_at: Date | null }>(
    `SELECT a.id, a.status, a.signed_at
       FROM participant_contract_assignments a
       JOIN retreat_contracts rc ON rc.contract_id = a.contract_id AND rc.retreat_id = $1
      WHERE a.member_id = $2
      ORDER BY a.id DESC`,
    [retreatId, memberId],
  );
  return result.rows.map((row) => ({ id: Number(row.id), status: row.status, signed_at: row.signed_at }));
}

/** Verified only when a signed record exists. Opening or reading the PDF changes nothing. */
export function agreementView(assignments: AgreementAssignment[]): AgreementView {
  const signed = assignments.find((a) => a.status === "signed" && a.signed_at);
  if (signed) return { status: "verified", signedAt: new Date(signed.signed_at!).toISOString(), awaitingSignature: false };
  const pending = assignments.some((a) => a.status === "pending");
  return { status: "not_started", signedAt: null, awaitingSignature: pending };
}

/* ─────────────────────────────── payments ─────────────────────────────── */

export interface PaymentsSummary {
  status: "complete" | "incomplete";
  currency: string;
  agreedCents: number | null;
  paidCents: number | null;
  balanceCents: number | null;
  arrangement: string;
  nextPayment: { amountCents: number; dueDate: string } | null;
  finalPaymentDue: string | null;
  installments: { sequence: number; amountCents: number; dueDate: string | null; paid: boolean }[];
  roomLabel: string | null;
}

export interface PaymentOrderRow {
  id: number;
  total_cents: number | null;
  refunded_cents: number | null;
  currency: string | null;
  pricing_type: string | null;
  balance_due_by: string | null;
  offer_label: string | null;
  enrollment_terms: { paymentArrangement?: unknown } | null;
}

export interface PaymentPlanRow {
  id: number;
  order_id: number;
  status: string;
}

export interface InstallmentRow {
  payment_plan_id: number;
  sequence: number;
  amount_cents: number;
  due_at: Date | null;
  paid_at: Date | null;
}

const INCOMPLETE: PaymentsSummary = {
  status: "incomplete",
  currency: "usd",
  agreedCents: null,
  paidCents: null,
  balanceCents: null,
  arrangement: "",
  nextPayment: null,
  finalPaymentDue: null,
  installments: [],
  roomLabel: null,
};

function isoDay(value: Date | null): string | null {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

/**
 * Figures only when the records on THIS site account for the booking: exactly
 * one paid order for the retreat's offers, nothing refunded, and — for an
 * installment option — the plan and its schedule. Anything less (a booking
 * billed in Kajabi, a partial refund, two orders) is "incomplete" and the guest
 * is asked to contact us rather than shown a number that may be wrong.
 */
export function summarisePayments(
  orders: PaymentOrderRow[],
  plans: PaymentPlanRow[],
  installments: InstallmentRow[],
): PaymentsSummary {
  if (orders.length !== 1) return INCOMPLETE;
  const order = orders[0];
  if ((order.refunded_cents ?? 0) > 0 || order.total_cents === null) return INCOMPLETE;
  const currency = order.currency || "usd";
  const arrangementFromTerms =
    typeof order.enrollment_terms?.paymentArrangement === "string" ? order.enrollment_terms.paymentArrangement : "";
  const roomLabel = order.offer_label?.trim() || null;
  const finalPaymentDue = order.balance_due_by ? order.balance_due_by.slice(0, 10) : null;
  const plan = plans.find((p) => p.order_id === order.id);

  if (!plan) {
    if (order.pricing_type === "payment_plan") return INCOMPLETE; // the plan record is missing
    return {
      status: "complete",
      currency,
      agreedCents: order.total_cents,
      paidCents: order.total_cents,
      balanceCents: 0,
      arrangement: arrangementFromTerms || "Paid in full",
      nextPayment: null,
      finalPaymentDue,
      installments: [],
      roomLabel,
    };
  }

  const schedule = installments
    .filter((row) => row.payment_plan_id === plan.id)
    .sort((a, b) => a.sequence - b.sequence);
  if (schedule.length === 0) return INCOMPLETE;

  const agreed = schedule.reduce((sum, row) => sum + row.amount_cents, 0);
  const paid = schedule.filter((row) => row.paid_at).reduce((sum, row) => sum + row.amount_cents, 0);
  const unpaid = schedule.filter((row) => !row.paid_at);
  const next = unpaid.find((row) => row.due_at) ?? null;
  return {
    status: "complete",
    currency,
    agreedCents: agreed,
    paidCents: paid,
    balanceCents: agreed - paid,
    arrangement: arrangementFromTerms || `${schedule.length} scheduled payments`,
    nextPayment: next ? { amountCents: next.amount_cents, dueDate: isoDay(next.due_at)! } : null,
    finalPaymentDue,
    installments: schedule.map((row) => ({
      sequence: row.sequence,
      amountCents: row.amount_cents,
      dueDate: isoDay(row.due_at),
      paid: row.paid_at !== null,
    })),
    roomLabel,
  };
}

export async function loadPayments(retreatId: number, memberId: number): Promise<PaymentsSummary> {
  const orders = await pool.query<PaymentOrderRow>(
    `SELECT o.id, o.total_cents, o.refunded_cents, o.currency, po.pricing_type,
            po.balance_due_by::text AS balance_due_by,
            NULLIF(ofr.internal_title, '') AS offer_label,
            o.enrollment_terms
       FROM orders o
       JOIN retreat_offers ro ON ro.offer_id = o.offer_id AND ro.retreat_id = $1
       JOIN offers ofr ON ofr.id = o.offer_id
       LEFT JOIN offer_pricing_options po ON po.id = o.pricing_option_id
      WHERE o.member_id = $2 AND o.status = 'paid'
      ORDER BY o.created_at`,
    [retreatId, memberId],
  );
  if (orders.rows.length === 0) return INCOMPLETE;
  const orderIds = orders.rows.map((row) => row.id);
  const plans = await pool.query<PaymentPlanRow>(
    `SELECT id, order_id, status FROM payment_plans WHERE order_id = ANY($1::int[])`,
    [orderIds],
  );
  const planIds = plans.rows.map((row) => row.id);
  const installments = planIds.length
    ? await pool.query<InstallmentRow>(
        `SELECT payment_plan_id, sequence, amount_cents, due_at, paid_at
           FROM payment_plan_installments WHERE payment_plan_id = ANY($1::int[])`,
        [planIds],
      )
    : { rows: [] as InstallmentRow[] };
  return summarisePayments(orders.rows, plans.rows, installments.rows);
}

/* ─────────────────────────────── checklist ────────────────────────────── */

export interface ChecklistItem {
  /** A fixed task key, or "questionnaire:<key>" for an owner-built questionnaire. */
  key: string;
  label: string;
  status: TaskStatus;
  detail: string;
  reviewNote: string | null;
  updatedAt: string | null;
  section: string;
}

export const TASK_LABELS: Record<TaskKey, string> = {
  agreement: "Sign your retreat agreement",
  guest_profile: "Guest Profile",
  flight_preferences: "Flight Preferences",
  travel_insurance: "Travel Insurance",
  flight_details: "Booked flight details",
  passport: "Passport & preparation",
  payments: "Payments",
  group_call: "Pre-trip group call",
};

const TASK_SECTIONS: Record<TaskKey, string> = {
  agreement: "agreement",
  guest_profile: "guest-profile",
  flight_preferences: "travel-flights",
  travel_insurance: "travel-insurance",
  flight_details: "travel-flights",
  passport: "passport-preparation",
  payments: "payments",
  group_call: "guest-connection",
};

const LONG_DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "America/Los_Angeles" });

/** One owner-built questionnaire's line on the checklist (status from its response record). */
export interface QuestionnaireChecklistInput {
  key: string;
  title: string;
  status: TaskStatus;
  updatedAt: Date | null;
  reviewNote: string | null;
}

export const COMING_SOON = "Details coming soon";

export interface ChecklistInputs {
  agreement: AgreementView;
  tasks: Map<TaskKey, TaskRecord>;
  payments: PaymentsSummary;
  groupCallConfirmed: boolean;
  /** The retreat's questionnaires that appear on the checklist, in order. */
  questionnaires?: QuestionnaireChecklistInput[];
  /** Fixed items this retreat uses; both default on. */
  enabled?: { passport: boolean; groupCall: boolean };
}

/**
 * Pure: the checklist from the records already loaded — the agreement, each
 * questionnaire, then passport, payments and the group call. Travel insurance
 * is guidance only (strongly recommended, not required) and is not a task.
 */
export function buildChecklist(input: ChecklistInputs): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const enabled = input.enabled ?? { passport: true, groupCall: true };
  const review = (key: TaskKey) => {
    const record = input.tasks.get(key);
    return record ? { status: record.review_status, at: record.reviewed_at } : null;
  };
  const note = (key: TaskKey, status: TaskStatus): string | null => {
    const record = input.tasks.get(key);
    return status === "needs_attention" && record?.review_note ? record.review_note : null;
  };
  const push = (key: TaskKey, base: TaskStatus, baseAt: Date | null, detail: Partial<Record<TaskStatus, string>>) => {
    const status = key === "agreement" ? base : effectiveStatus(base, baseAt, review(key));
    const reviewedAt = input.tasks.get(key)?.reviewed_at ?? null;
    const at = status === "verified" || status === "needs_attention" ? reviewedAt : baseAt;
    items.push({
      key,
      label: TASK_LABELS[key],
      status,
      detail: detail[status] ?? DEFAULT_DETAIL[status],
      reviewNote: note(key, status),
      updatedAt: at ? new Date(at).toISOString() : null,
      section: TASK_SECTIONS[key],
    });
  };

  const a = input.agreement;
  push("agreement", a.status, a.signedAt ? new Date(a.signedAt) : null, {
    verified: a.signedAt ? `Signed ${LONG_DATE.format(new Date(a.signedAt))}` : "Signed",
    not_started: a.awaitingSignature
      ? "Your agreement is ready for you to review and sign."
      : "Your agreement will appear here when it is ready for you to sign.",
  });

  for (const q of input.questionnaires ?? []) {
    items.push({
      key: `questionnaire:${q.key}`,
      label: q.title,
      status: q.status,
      detail: QUESTIONNAIRE_DETAIL[q.status],
      reviewNote: q.status === "needs_attention" ? q.reviewNote : null,
      updatedAt: q.updatedAt ? new Date(q.updatedAt).toISOString() : null,
      section: `questionnaire-${q.key}`,
    });
  }

  if (enabled.passport) {
    const record = input.tasks.get("passport");
    const base: TaskStatus = record?.guest_status === "submitted" ? "submitted" : "not_started";
    push("passport", base, record?.guest_updated_at ?? null, { submitted: "You've checked your passport." });
  }

  const p = input.payments;
  const paymentsBase: TaskStatus = p.status === "complete" && (p.balanceCents ?? 1) <= 0 ? "verified" : "in_progress";
  push("payments", paymentsBase, null, {
    verified: "Paid in full.",
    in_progress:
      p.status === "complete"
        ? "Your payment schedule is on file."
        : "Contact us about your payment schedule.",
  });

  if (enabled.groupCall) {
    const call = input.tasks.get("group_call");
    const rsvp = typeof call?.guest_data?.rsvp === "string" ? call.guest_data.rsvp : null;
    const callBase: TaskStatus = input.groupCallConfirmed && rsvp ? "submitted" : "not_started";
    push("group_call", callBase, call?.guest_updated_at ?? null, {
      not_started: input.groupCallConfirmed ? "Let us know if you can join." : `${COMING_SOON}.`,
      submitted: "Thanks — your RSVP is saved.",
    });
  }

  return items;
}

const QUESTIONNAIRE_DETAIL: Record<TaskStatus, string> = {
  not_started: "Not started yet. You can save your progress and finish later.",
  in_progress: "Progress saved. Continue when you're ready.",
  submitted: "Submitted. You can update your answers at any time.",
  verified: "Reviewed by our team. You can still update your answers.",
  needs_attention: "We need a little more from you.",
};

const DEFAULT_DETAIL: Record<TaskStatus, string> = {
  not_started: "Not started yet.",
  in_progress: "In progress.",
  submitted: "Submitted. We'll review it.",
  verified: "Verified by our team.",
  needs_attention: "We need a little more from you.",
};

export function checklistProgress(items: ChecklistItem[]): { completed: number; total: number } {
  return {
    completed: items.filter((item) => item.status === "submitted" || item.status === "verified").length,
    total: items.length,
  };
}

/* ─────────────────────────────── form rules ───────────────────────────── */

export interface FormValidation {
  clean: Record<string, unknown>;
  errors: Record<string, string>;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? undefined : trimmed;
}

function cleanDate(value: unknown): string | undefined {
  return typeof value === "string" && DATE_ONLY.test(value) ? value : undefined;
}

function cleanEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const CONNECTIONS = ["nonstop_preferred", "one_stop_ok", "multiple_ok", "no_preference"] as const;
const YES_MAYBE_NO = ["yes", "maybe", "no"] as const;
const EXTENSIONS = ["none", "before", "after", "both", "not_sure"] as const;
export const COVERAGE = ["not_purchased", "researching", "purchased", "decline_or_support"] as const;

/**
 * Flight Preferences (a NEW native form, before flights are bought). Only the
 * known keys survive; a draft keeps whatever is valid so far, a submission
 * needs the required answers. No passport numbers or medical detail fields.
 */
export function validateFlightPreferences(raw: unknown, submit: boolean): FormValidation {
  const data = isRecord(raw) ? raw : {};
  const clean: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) clean[key] = value;
  };
  set("departureAirport", cleanText(data.departureAirport, 200));
  set("outboundDate", cleanDate(data.outboundDate));
  set("returnDate", cleanDate(data.returnDate));
  set("budgetRange", cleanText(data.budgetRange, 200));
  set("connections", cleanEnum(data.connections, CONNECTIONS));
  set("layoverComfort", cleanText(data.layoverComfort, 500));
  set("groupTravel", cleanEnum(data.groupTravel, YES_MAYBE_NO));
  set("pointsMiles", cleanText(data.pointsMiles, 500));
  set("extension", cleanEnum(data.extension, EXTENSIONS));
  set("considerations", cleanText(data.considerations, 2000));
  set("questions", cleanText(data.questions, 2000));

  const errors: Record<string, string> = {};
  if (submit) {
    if (!clean.departureAirport) errors.departureAirport = "Tell us the city or airport you'd fly from.";
    if (!clean.connections) errors.connections = "Choose your connection preference.";
    if (!clean.groupTravel) errors.groupTravel = "Let us know if you're open to travelling with other guests.";
    if (clean.outboundDate && clean.returnDate && String(clean.returnDate) < String(clean.outboundDate)) {
      errors.returnDate = "The return date is before the outbound date.";
    }
  }
  return { clean, errors };
}

/**
 * Travel insurance acknowledgement + status. Never a participation gate: the
 * agreement's "recommended" vs "required" wording is unresolved (owner/attorney).
 */
export function validateTravelInsurance(raw: unknown, submit: boolean): FormValidation {
  const data = isRecord(raw) ? raw : {};
  const clean: Record<string, unknown> = {};
  if (data.acknowledged === true) clean.acknowledged = true;
  const coverage = cleanEnum(data.coverageStatus, COVERAGE);
  if (coverage) clean.coverageStatus = coverage;
  const provider = cleanText(data.provider, 200);
  if (provider) clean.provider = provider;
  const purchaseDate = cleanDate(data.purchaseDate);
  if (purchaseDate) clean.purchaseDate = purchaseDate;
  const confirmation = cleanText(data.confirmation, 200);
  if (confirmation) clean.confirmation = confirmation;

  const errors: Record<string, string> = {};
  if (submit) {
    if (clean.acknowledged !== true) errors.acknowledged = "Please confirm you have read the travel insurance guidance.";
    if (!clean.coverageStatus) errors.coverageStatus = "Choose where you are with travel insurance.";
  }
  return { clean, errors };
}

export function validateForm(formKey: FormKey, raw: unknown, submit: boolean): FormValidation {
  return formKey === "flight_preferences" ? validateFlightPreferences(raw, submit) : validateTravelInsurance(raw, submit);
}

export const TESTIMONIAL_CONSENTS = ["no", "first_name", "first_name_role", "full_name"] as const;
export type TestimonialConsent = (typeof TESTIMONIAL_CONSENTS)[number];

export interface FeedbackInput {
  answers: Record<string, unknown>;
  testimonialText: string;
  testimonialConsent: TestimonialConsent;
  testimonialRole: string;
}

/** The private reflection, and the separate public-testimonial choice. */
export function validateFeedback(raw: unknown, submit: boolean): { clean: FeedbackInput; errors: Record<string, string> } {
  const body = isRecord(raw) ? raw : {};
  const answersRaw = isRecord(body.answers) ? body.answers : {};
  const answers: Record<string, unknown> = {};
  const rating = answersRaw.rating;
  if (typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5) answers.rating = rating;
  for (const key of ["ratingWhy", "favoriteMoment", "appreciated", "expectations", "improve", "attendAgainWhere", "recommendWhy"]) {
    const value = cleanText(answersRaw[key], 5000);
    if (value) answers[key] = value;
  }
  const attendAgain = cleanEnum(answersRaw.attendAgain, YES_MAYBE_NO);
  if (attendAgain) answers.attendAgain = attendAgain;
  const recommend = cleanEnum(answersRaw.recommend, YES_MAYBE_NO);
  if (recommend) answers.recommend = recommend;

  const clean: FeedbackInput = {
    answers,
    testimonialText: cleanText(body.testimonialText, 3000) ?? "",
    testimonialConsent: cleanEnum(body.testimonialConsent, TESTIMONIAL_CONSENTS) ?? "no",
    testimonialRole: cleanText(body.testimonialRole, 200) ?? "",
  };

  const errors: Record<string, string> = {};
  if (submit) {
    if (answers.rating === undefined) errors.rating = "Choose a rating from 1 to 5.";
    if (clean.testimonialConsent !== "no" && !clean.testimonialText) {
      errors.testimonialText = "Add your testimonial, or choose No for public use.";
    }
    if (clean.testimonialConsent === "first_name_role" && !clean.testimonialRole) {
      errors.testimonialRole = "Tell us the professional role to show with your first name.";
    }
  }
  return { clean, errors };
}

export const INTEREST_CHOICES = ["international", "domestic_business", "both", "not_now"] as const;
export type InterestChoice = (typeof INTEREST_CHOICES)[number];

export const interestSchema = z
  .object({
    interest: z.enum(INTEREST_CHOICES),
    destinations: z.string().trim().max(500).default(""),
    marketingOptIn: z.boolean().default(false),
  })
  .strict();

/* ─────────────────────────────── feedback + interest views ───────────── */

export interface FeedbackRow {
  id: number;
  answers: Record<string, unknown>;
  testimonial_text: string;
  testimonial_consent: TestimonialConsent;
  testimonial_role: string;
  approved_for_publication_at: Date | null;
  updated_at: Date;
  submitted_at: Date | null;
}

export interface FeedbackView {
  state: "none" | "draft" | "submitted";
  answers: Record<string, unknown>;
  testimonialText: string;
  testimonialConsent: TestimonialConsent;
  testimonialRole: string;
  updatedAt: string | null;
  submittedAt: string | null;
}

export function feedbackView(row: FeedbackRow | undefined): FeedbackView {
  if (!row) {
    return { state: "none", answers: {}, testimonialText: "", testimonialConsent: "no", testimonialRole: "", updatedAt: null, submittedAt: null };
  }
  return {
    state: row.submitted_at ? "submitted" : "draft",
    answers: row.answers,
    testimonialText: row.testimonial_text,
    testimonialConsent: row.testimonial_consent,
    testimonialRole: row.testimonial_role,
    updatedAt: new Date(row.updated_at).toISOString(),
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
  };
}

export async function loadFeedbackRow(retreatId: number, memberId: number): Promise<FeedbackRow | undefined> {
  const result = await pool.query<FeedbackRow>(
    `SELECT id, answers, testimonial_text, testimonial_consent, testimonial_role,
            approved_for_publication_at, updated_at, submitted_at
       FROM retreat_feedback WHERE retreat_id = $1 AND member_id = $2`,
    [retreatId, memberId],
  );
  return result.rows[0];
}

export interface InterestView {
  interest: InterestChoice | null;
  destinations: string;
  marketingOptIn: boolean;
  updatedAt: string | null;
}

export async function loadInterest(retreatId: number, memberId: number): Promise<InterestView> {
  const result = await pool.query<{ interest: InterestChoice; destinations: string; marketing_opt_in: boolean; updated_at: Date }>(
    `SELECT interest, destinations, marketing_opt_in, updated_at FROM retreat_interest WHERE retreat_id = $1 AND member_id = $2`,
    [retreatId, memberId],
  );
  const row = result.rows[0];
  return row
    ? { interest: row.interest, destinations: row.destinations, marketingOptIn: row.marketing_opt_in, updatedAt: new Date(row.updated_at).toISOString() }
    : { interest: null, destinations: "", marketingOptIn: false, updatedAt: null };
}

/* ─────────────────────────────── offer cards ──────────────────────────── */

export interface OfferCardRow {
  id: number;
  title: string;
  kind: "international" | "domestic_business";
  destination: string;
  dates_text: string;
  description: string;
  image_url: string;
  status: "draft" | "interest_list" | "registration_open" | "sold_out";
  cta_label: string;
  cta_url: string;
  booked_product_id: number | null;
  visible: boolean;
  display_from: Date | null;
  display_until: Date | null;
  sort: number;
}

/** Only cards the owner switched on, out of Draft, inside their display window. */
export async function loadGuestCards(retreatId: number, memberId: number | null, now: Date = new Date()) {
  const result = await pool.query<OfferCardRow>(
    `SELECT * FROM retreat_offer_cards
      WHERE retreat_id = $1 AND visible AND status <> 'draft'
        AND (display_from IS NULL OR display_from <= $2)
        AND (display_until IS NULL OR display_until > $2)
      ORDER BY sort, id`,
    [retreatId, now],
  );
  const cards = [];
  for (const row of result.rows) {
    const booked = memberId !== null && (await hasActiveGrant(memberId, row.booked_product_id));
    cards.push({
      id: row.id,
      title: row.title,
      kind: row.kind,
      destination: row.destination,
      datesText: row.dates_text,
      description: row.description,
      imageUrl: row.image_url,
      status: row.status,
      ctaLabel: row.cta_label,
      ctaUrl: row.status === "sold_out" || booked ? "" : row.cta_url,
      booked,
    });
  }
  return cards;
}

/* ─────────────────────────────── dashboard ────────────────────────────── */

export interface BuildOptions {
  preview: boolean;
  now?: Date;
  /**
   * Which room-specific questions to include. Defaults to the guest's own
   * room type; the owner's blank preview defaults to "all" (every question,
   * each marked with who sees it).
   */
  audience?: Audience;
}

/** The fill-ins for {{destination}}, {{dates}}, {{retreat}} and {{airport}}. */
export function wordingContext(retreat: RetreatRow, settings: RetreatSettings): WordingContext {
  return {
    destination: retreat.location,
    startDate: retreat.start_date,
    endDate: retreat.end_date,
    title: retreat.title,
    airport: settings.airport,
  };
}

/**
 * The whole guest dashboard. `memberId` null is the owner's blank preview: what
 * a brand-new guest sees, with no guest named and nothing on file. Every
 * record below is loaded for (this retreat, this member) only.
 */
export async function buildDashboard(retreat: RetreatRow, memberId: number | null, options: BuildOptions) {
  const now = options.now ?? new Date();
  const settings = normaliseSettings(retreat.settings);
  const ctx = wordingContext(retreat, settings);
  const today = todayIn(retreat.timezone, now);
  const { phase, daysUntilStart } = retreatPhase(retreat.start_date, retreat.end_date, today);

  let tasks = new Map<TaskKey, TaskRecord>();
  let assignments: AgreementAssignment[] = [];
  let payments: PaymentsSummary = INCOMPLETE;
  let feedbackRow: FeedbackRow | undefined;
  let interest: InterestView = emptyInterest();
  let identity: Awaited<ReturnType<typeof memberIdentity>> | null = null;
  let responses = new Map<number, ResponseRow>();
  let roomType: RoomType | "unknown" = "unknown";
  if (memberId !== null) {
    [tasks, assignments, payments, feedbackRow, interest, identity, responses, roomType] = await Promise.all([
      loadTaskRecords(retreat.id, memberId),
      loadAgreementAssignments(retreat.id, memberId),
      loadPayments(retreat.id, memberId),
      loadFeedbackRow(retreat.id, memberId),
      loadInterest(retreat.id, memberId),
      memberIdentity(memberId),
      loadResponses(retreat.id, memberId),
      guestRoomType(retreat.id, memberId),
    ]);
  }
  const audience: Audience = options.audience ?? (memberId === null ? "all" : roomType);

  const questionnaireRows = await loadQuestionnaires(retreat.id);
  const questionnaires = [];
  for (const q of questionnaireRows) {
    const files = memberId === null ? [] : await loadOwnedFiles(q.id, memberId);
    questionnaires.push({ ...guestQuestionnaireView(q, responses.get(q.id), files, audience, ctx), inChecklist: q.in_checklist });
  }

  const agreement = agreementView(assignments);
  const groupCallConfirmed = settings.groupCall.confirmed && Boolean(settings.groupCall.startsAt);
  const checklist = buildChecklist({
    agreement,
    tasks,
    payments,
    groupCallConfirmed,
    enabled: settings.checklist,
    questionnaires: questionnaires
      .filter((q) => q.inChecklist)
      .map((q) => ({
        key: q.key,
        title: q.title,
        status: q.status,
        updatedAt: q.response.updatedAt ? new Date(q.response.updatedAt) : null,
        reviewNote: q.reviewNote,
      })),
  });
  const statusOf = (key: string) => checklist.find((item) => item.key === key)?.status ?? "not_started";
  const call = tasks.get("group_call");
  const rsvp = typeof call?.guest_data?.rsvp === "string" ? (call.guest_data.rsvp as "yes" | "no" | "maybe") : null;

  const announcements = await pool.query<{ id: number; title: string; body_md: string; published_at: Date }>(
    `SELECT id, title, body_md, published_at FROM retreat_announcements
      WHERE retreat_id = $1 AND published AND published_at IS NOT NULL
      ORDER BY published_at DESC LIMIT 50`,
    [retreat.id],
  );

  const galleryOpen = isOpen(settings.gallery.mode, retreat.end_date, today);
  const feedbackOpen = isOpen(settings.feedback.mode, retreat.end_date, today);
  const interestOpen = isOpen(settings.interest.mode, retreat.end_date, today);
  const joinOpen = isOpen(settings.joinUsAgain.mode, retreat.end_date, today);

  const importantDates = [
    { label: "Arrival", date: retreat.start_date, note: settings.airport },
    { label: "Checkout", date: retreat.end_date, note: "" },
    {
      label: "Final payment deadline",
      date: payments.status === "complete" ? payments.finalPaymentDue : null,
      note: payments.status === "complete" ? "" : "As set out in your signed agreement. Contact us with any questions.",
    },
    ...(settings.checklist.groupCall
      ? [
          {
            label: "Pre-trip group call",
            date: groupCallConfirmed ? todayIn(settings.groupCall.timezone || retreat.timezone, new Date(settings.groupCall.startsAt!)) : null,
            note: groupCallConfirmed ? "" : COMING_SOON,
          },
        ]
      : []),
    ...questionnaires
      .filter((q) => q.dueDate)
      .map((q) => ({ label: `${q.title} due`, date: q.dueDate, note: "" })),
    ...settings.deadlines.map((d) => ({
      label: renderWording(d.label, ctx),
      date: d.date,
      note: d.date ? renderWording(d.note, ctx) : COMING_SOON,
    })),
    ...(settings.checklist.passport && settings.passportValidThrough
      ? [{ label: "Passport valid through at least", date: settings.passportValidThrough, note: "Recommended" }]
      : []),
  ];

  return {
    preview: options.preview,
    audience,
    retreat: {
      slug: retreat.slug,
      title: retreat.title,
      location: retreat.location,
      startDate: retreat.start_date,
      endDate: retreat.end_date,
      timezone: retreat.timezone,
      airport: settings.airport,
      phase,
      daysUntilStart,
    },
    guest: identity ? { firstName: identity.firstName } : null,
    dashboardTitle: renderWording(settings.dashboardTitle, ctx),
    welcomeMessage: renderWording(settings.welcomeMessage, ctx),
    supportEmail: settings.supportEmail,
    checklist,
    progress: checklistProgress(checklist),
    importantDates,
    agreement,
    questionnaires: questionnaires.map(({ inChecklist: _inChecklist, ...q }) => q),
    flightGuidance: { status: settings.flightGuidance.status, note: renderWording(settings.flightGuidance.note, ctx) },
    insurance: settings.insurance,
    passport: { enabled: settings.checklist.passport, status: statusOf("passport") },
    details: {
      inclusions: settings.inclusions.map((item) => renderWording(item, ctx)),
      activities: settings.activities.map((item) => renderWording(item, ctx)),
      transportNote: renderWording(settings.transportNote, ctx),
      // Shuttle windows stay "Details coming soon" until the owner enters confirmed ones.
      shuttle: settings.shuttle.confirmed
        ? { confirmed: true, details: renderWording(settings.shuttle.details, ctx) }
        : { confirmed: false, details: "" },
      itineraryMd: renderWording(settings.itineraryMd, ctx),
    },
    preparationMd: renderWording(settings.preparationMd, ctx),
    payments,
    // Card on file + monthly charges (migration 230). Always null from here:
    // the routes that serve a real guest fill it in from
    // services/retreatBalancePlans.ts, which this module must not import (it
    // would pull Stripe into every caller of the dashboard builder).
    balancePlan: null as BalancePlanView | null,
    groupCall: !settings.checklist.groupCall
      ? { enabled: false, confirmed: false, startsAt: null, timezone: null, joinUrl: null, notes: "", rsvp: null }
      : groupCallConfirmed
        ? {
            enabled: true,
            confirmed: true,
            startsAt: settings.groupCall.startsAt,
            timezone: settings.groupCall.timezone,
            joinUrl: settings.groupCall.joinUrl || null,
            notes: renderWording(settings.groupCall.notes, ctx),
            rsvp,
          }
        : { enabled: true, confirmed: false, startsAt: null, timezone: null, joinUrl: null, notes: "", rsvp: null },
    announcements: announcements.rows.map((row) => ({
      id: row.id,
      title: row.title,
      bodyMd: row.body_md,
      publishedAt: new Date(row.published_at).toISOString(),
    })),
    memories: { available: galleryOpen, uploadsOpen: galleryOpen && isOpen(settings.gallery.uploadsMode, retreat.end_date, today) },
    feedback: { available: feedbackOpen, labels: settings.feedback.labels, current: feedbackView(feedbackRow) },
    interest: { available: interestOpen, current: interest },
    joinUsAgain: {
      available: joinOpen,
      intro: settings.joinUsAgain.intro,
      cards: joinOpen ? await loadGuestCards(retreat.id, memberId, now) : [],
    },
  };
}

function emptyInterest(): InterestView {
  return { interest: null, destinations: "", marketingOptIn: false, updatedAt: null };
}

/* ─────────────────────────────── media ────────────────────────────────── */

const MEDIA_INFO = "bossclinician/retreat-media/v1";
const MEDIA_TOKEN_VERSION = "r1";
/** Long enough for a video to be watched; short enough that a leaked link dies today. */
export const MEDIA_TTL_SECONDS = 2 * 60 * 60;

let mediaKey: Buffer | null = null;
function mediaSigningKey(): Buffer {
  if (mediaKey === null) {
    mediaKey = Buffer.from(
      crypto.hkdfSync("sha256", Buffer.from(env.jwtSecret, "utf8"), Buffer.alloc(0), Buffer.from(MEDIA_INFO, "utf8"), 32),
    );
  }
  return mediaKey;
}

export interface MediaTokenPayload {
  /** "m" = a member guest, "a" = an admin user. */
  audience: "m" | "a";
  principalId: number;
  mediaId: number;
  expiresAt: number;
}

export function signMediaToken(input: Omit<MediaTokenPayload, "expiresAt">, now: Date = new Date()): string {
  const expiresAt = Math.floor(now.getTime() / 1000) + MEDIA_TTL_SECONDS;
  const body = Buffer.from([MEDIA_TOKEN_VERSION, input.audience, input.principalId, input.mediaId, expiresAt].join("."), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", mediaSigningKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyMediaToken(token: string, now: Date = new Date()): MediaTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, provided] = parts;
  const expected = crypto.createHmac("sha256", mediaSigningKey()).update(body).digest("base64url");
  if (provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  const fields = Buffer.from(body, "base64url").toString("utf8").split(".");
  if (fields.length !== 5 || fields[0] !== MEDIA_TOKEN_VERSION) return null;
  const audience = fields[1];
  if (audience !== "m" && audience !== "a") return null;
  const principalId = Number(fields[2]);
  const mediaId = Number(fields[3]);
  const expiresAt = Number(fields[4]);
  if (![principalId, mediaId, expiresAt].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  if (expiresAt * 1000 <= now.getTime()) return null;
  return { audience, principalId, mediaId, expiresAt };
}

/**
 * Where a token is redeemed. Guests use the public path on www; admins use the
 * admin host's /api/admin/ path, because the admin host proxies nothing else.
 */
export function mediaUrl(token: string, audience: "m" | "a" = "m"): string {
  return audience === "a" ? `/api/admin/retreat-media/${token}` : `/api/retreat-media/${token}`;
}

export interface MediaRow {
  id: number;
  retreat_id: number;
  member_id: number | null;
  admin_user_id: number | null;
  storage_ref: string;
  mime: string;
  kind: "photo" | "video";
  size_bytes: string | number;
  original_name: string;
  caption: string;
  sharing_consent: boolean;
  status: "pending" | "approved" | "hidden" | "removed";
  created_at: Date;
  uploader_name: string | null;
}

export const MEDIA_SELECT = `SELECT m.id, m.retreat_id, m.member_id, m.admin_user_id, m.storage_ref, m.mime, m.kind,
    m.size_bytes, m.original_name, m.caption, m.sharing_consent, m.status, m.created_at,
    COALESCE(NULLIF(mem.first_name, ''), NULLIF(split_part(mem.name, ' ', 1), '')) AS uploader_name
  FROM retreat_media m LEFT JOIN members mem ON mem.id = m.member_id`;

/** What one guest may see in the gallery: approved items, plus her own items awaiting review. */
export function guestMayView(row: Pick<MediaRow, "status" | "member_id">, memberId: number): boolean {
  if (row.status === "approved") return true;
  return row.status === "pending" && row.member_id === memberId;
}

/**
 * Identifies a photo or video from its first bytes. The browser's declared type
 * and the file name are the uploader's claims; these bytes are not. SVG, HTML
 * and HEIC (which most browsers cannot display) are refused.
 */
export function sniffMemoryMime(head: Buffer): { mime: string; kind: "photo" | "video"; ext: string } | null {
  const starts = (...bytes: number[]) => head.length >= bytes.length && bytes.every((byte, i) => head[i] === byte);
  if (starts(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", kind: "photo", ext: ".jpg" };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", kind: "photo", ext: ".png" };
  if (starts(0x47, 0x49, 0x46, 0x38)) return { mime: "image/gif", kind: "photo", ext: ".gif" };
  if (starts(0x52, 0x49, 0x46, 0x46) && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mime: "image/webp", kind: "photo", ext: ".webp" };
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return { mime: "video/webm", kind: "video", ext: ".webm" };
  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif"].includes(brand)) return null;
    if (brand === "qt  ") return { mime: "video/quicktime", kind: "video", ext: ".mov" };
    return { mime: "video/mp4", kind: "video", ext: ".mp4" };
  }
  return null;
}
