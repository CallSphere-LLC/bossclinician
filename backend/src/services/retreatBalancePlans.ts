import crypto from "crypto";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../db/pool";
import { env, stripeEnabled, stripeTestMode } from "../config/env";
import { stripe } from "../stripe/client";
import { sendMail } from "../email/mailer";
import { escapeHtml } from "../email/templates";
import { HttpError, badRequest, conflict, notFound, serviceUnavailable } from "../utils/httpError";
import { formatAmount } from "../utils/money";
import { addInterval } from "./pricing";
import { cleanStatementDescriptor } from "./paymentRules";
import { readSetting } from "./settings";
import { notificationRecipients } from "./notificationRecipients";
import { sendStripeMail } from "./stripeSideEffects";
import { normaliseSettings, type RetreatRow } from "./retreats";

/**
 * Retreat balance plans (migration 230): a guest adds a card on her retreat
 * dashboard, agrees to a schedule the owner set, and the balance is charged
 * monthly until it is paid.
 *
 * The charging itself is not new machinery. A balance plan bills through an
 * ordinary Stripe subscription mirrored as a `payment_plans` row with
 * `order_id NULL` and `offer_id NULL`; the Stripe webhook already advances that
 * row one instalment per paid invoice, marks it `past_due` on a decline and
 * cancels it when Stripe gives up. This module owns everything around it:
 *
 *   draft -> open -> card_on_file -> billing -> completed
 *                 ^------- (card declined / plan defaulted) ------'
 *
 * Rules that hold everywhere below, because the cards are live:
 *
 *  1. A card is charged only by `startBalancePlanBilling`, and only after an
 *     atomic claim that requires `card_on_file`, a recorded authorisation and a
 *     first charge date that has arrived (Pacific). Two callers cannot both win.
 *  2. Before a subscription is created, Stripe is asked whether one already
 *     exists for this plan. A crash or a timeout between "Stripe created it"
 *     and "we wrote it down" is therefore adopted, never repeated.
 *  3. Every Stripe write carries an idempotency key.
 *  4. A plan never collects more than `installment_count` payments: the
 *     subscription is created with `cancel_at`, it is cancelled explicitly the
 *     moment the final instalment is credited, and the hourly job cancels any
 *     finished plan's subscription that is somehow still alive.
 *  5. A guest only ever sees sentences written here. Stripe's own error text
 *     goes to the server log.
 */

/* ───────────────────────────────── types ──────────────────────────────── */

export type BalancePlanStatus = "draft" | "open" | "card_on_file" | "billing" | "completed" | "canceled";
export type BalancePlanState = "draft" | "open" | "card_on_file" | "billing" | "past_due" | "completed" | "canceled";
export type GuestBalancePlanState = Exclude<BalancePlanState, "draft" | "canceled">;
export type InstallmentStatus = "scheduled" | "paid" | "failed" | "skipped";

export interface BalancePlanRow {
  id: number;
  retreat_id: number;
  member_id: number;
  agreed_total_cents: number;
  discount_cents: number;
  discount_note: string;
  prior_paid_cents: number;
  carried_paid_cents: number;
  installment_cents: number;
  installment_count: number;
  first_charge_on: string;
  final_due_on: string | null;
  currency: string;
  status: BalancePlanStatus;
  is_test: boolean;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  authorized_at: Date | null;
  authorization_text: string;
  authorized_ip: string;
  card_added_at: Date | null;
  billing_started_at: Date | null;
  billing_attempts: number;
  subscription_ended_at: Date | null;
  owner_notified_at: Date | null;
  request_email_sent_at: Date | null;
  last_error: string;
  created_at: Date;
  updated_at: Date;
}

/** `::text` on the dates: a pg DATE read as a JS Date shifts by the server's zone. */
const PLAN_COLUMNS = `id, retreat_id, member_id, agreed_total_cents, discount_cents, discount_note,
  prior_paid_cents, carried_paid_cents, installment_cents, installment_count,
  first_charge_on::text AS first_charge_on, final_due_on::text AS final_due_on, currency, status, is_test,
  stripe_customer_id, stripe_payment_method_id, card_brand, card_last4, authorized_at, authorization_text,
  authorized_ip, card_added_at, billing_started_at, billing_attempts, subscription_ended_at,
  owner_notified_at, request_email_sent_at, last_error, created_at, updated_at`;

export interface LinkedInstallment {
  sequence: number;
  amount_cents: number;
  due_at: Date | null;
  paid_at: Date | null;
  status: string;
}

/** One `payment_plans` row this balance plan has billed through. */
export interface LinkedPlan {
  id: number;
  status: string;
  stripe_subscription_id: string | null;
  created_at: Date;
  installments: LinkedInstallment[];
}

export interface ScheduleRow {
  sequence: number;
  amountCents: number;
  /** YYYY-MM-DD */
  dueDate: string;
  status: InstallmentStatus;
}

export interface BalancePlanView {
  state: GuestBalancePlanState;
  currency: string;
  agreedTotalCents: number;
  discountCents: number;
  discountNote: string;
  priorPaidCents: number;
  paidHereCents: number;
  remainingCents: number;
  installmentCents: number;
  installmentCount: number;
  schedule: ScheduleRow[];
  firstChargeDate: string;
  finalDueDate: string | null;
  chargesToday: boolean;
  card: { brand: string; last4: string } | null;
  authorizationText: string;
  problem: string;
}

export interface PlanInput {
  agreedTotalCents: number;
  discountCents: number;
  discountNote: string;
  priorPaidCents: number;
  installmentCents: number;
  installmentCount: number;
  firstChargeOn: string;
  finalDueOn: string | null;
  isTest: boolean;
}

/** A card problem, carrying the one sentence a guest may be shown. */
export class BalancePlanCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalancePlanCardError";
  }
}

/* ───────────────────────────── pure helpers ───────────────────────────── */

export const PACIFIC = "America/Los_Angeles";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The calendar date (YYYY-MM-DD) in America/Los_Angeles at `now`. */
export function pacificDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Today's Pacific calendar date. Every "is the first charge due" question uses this. */
export function pacificToday(now: Date = new Date()): string {
  return pacificDate(now);
}

/** A real calendar date in YYYY-MM-DD form (2027-02-30 is refused). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * `months` calendar months after a date, clamped to the month's last day
 * (January 31 + 1 month = February 28), which is also how Stripe bills a
 * monthly subscription anchored on the 31st.
 */
export function addMonthsToDate(isoDate: string, months: number): string {
  const m = DATE_ONLY.exec(isoDate);
  if (!m) throw new RangeError(`Not a date: ${isoDate}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const first = new Date(Date.UTC(y, mo - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "January 5, 2027" */
export function longDate(isoDate: string): string {
  const m = DATE_ONLY.exec(isoDate);
  if (!m) return isoDate;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The date the first payment will really be taken: never before today. */
export function effectiveFirstCharge(firstChargeOn: string, today: string): string {
  return firstChargeOn > today ? firstChargeOn : today;
}

/** The schedule a plan would follow if the card were confirmed today. */
export function projectSchedule(input: {
  firstChargeOn: string;
  today: string;
  installmentCents: number;
  installmentCount: number;
  /** Sequence of the first projected row (after any payments already made). */
  startSequence?: number;
}): ScheduleRow[] {
  const start = effectiveFirstCharge(input.firstChargeOn, input.today);
  const offset = input.startSequence ?? 1;
  const rows: ScheduleRow[] = [];
  for (let n = 0; n < input.installmentCount; n += 1) {
    rows.push({
      sequence: offset + n,
      amountCents: input.installmentCents,
      dueDate: addMonthsToDate(start, n),
      status: "scheduled",
    });
  }
  return rows;
}

/**
 * The consent sentence the guest ticks. Built from the numbers on the server,
 * stored word for word with the authorisation, and never taken from the client.
 */
export function buildAuthorizationText(input: {
  retreatTitle: string;
  installmentCents: number;
  installmentCount: number;
  currency: string;
  firstChargeOn: string;
  today: string;
}): string {
  const amount = formatAmount(input.installmentCents, input.currency);
  const total = formatAmount(input.installmentCents * input.installmentCount, input.currency);
  const first = effectiveFirstCharge(input.firstChargeOn, input.today);
  const last = addMonthsToDate(first, input.installmentCount - 1);
  const today = first === input.today;
  const what = `my balance for ${input.retreatTitle}`;
  if (input.installmentCount === 1) {
    return (
      `I authorize Boss Clinician to charge the card I am adding for one payment of ${amount} toward ${what}. ` +
      (today ? `The payment is charged today, ${longDate(first)}.` : `The payment is charged automatically on ${longDate(first)}.`) +
      ` No other charge will be made under this authorization.`
    );
  }
  return (
    `I authorize Boss Clinician to charge the card I am adding for ${input.installmentCount} monthly payments of ` +
    `${amount}, ${total} in total, toward ${what}. ` +
    (today
      ? `The first payment is charged today, ${longDate(first)}, `
      : `The first payment is charged automatically on ${longDate(first)}, `) +
    `and the last on ${longDate(last)}. Each payment is charged automatically on its date, ` +
    `and the charges stop once ${total} has been paid.`
  );
}

/** A short, stable fingerprint of the consent sentence, carried on the SetupIntent. */
export function termsFingerprint(authorizationText: string): string {
  return crypto.createHash("sha256").update(authorizationText).digest("hex").slice(0, 32);
}

const MAX_CENTS = 10_000_000;
const cents = (max: number, min: number) => z.number().int().min(min).max(max);

const planInputSchema = z.object({
  agreedTotalCents: cents(MAX_CENTS, 1),
  discountCents: cents(MAX_CENTS, 0).default(0),
  discountNote: z.string().trim().max(300).default(""),
  priorPaidCents: cents(MAX_CENTS, 0).default(0),
  installmentCents: cents(MAX_CENTS, 1),
  installmentCount: z.number().int().min(1).max(36),
  firstChargeOn: z.string(),
  finalDueOn: z.string().nullable().optional(),
  isTest: z.boolean().default(false),
});

export type PlanValidation = { ok: true; value: PlanInput } | { ok: false; error: string };

/**
 * Checks the owner's numbers before anything is saved. `carriedPaidCents` is
 * what earlier subscriptions of this same plan already collected (zero for a
 * new plan), so "the balance" is always what is still to be charged from here.
 */
export function validatePlanInput(
  raw: unknown,
  context: { carriedPaidCents: number; today: string; currency?: string },
): PlanValidation {
  const currency = context.currency ?? "usd";
  const money = (amount: number) => formatAmount(amount, currency);
  // Said on its own, ahead of the general check: an amount over the cap is
  // nearly always a slipped digit, and the owner should be told which rule.
  if (typeof raw === "object" && raw !== null) {
    const typed = raw as Record<string, unknown>;
    for (const key of ["agreedTotalCents", "discountCents", "priorPaidCents", "installmentCents"]) {
      const value = typed[key];
      if (typeof value === "number" && value > MAX_CENTS) {
        return { ok: false, error: `Each amount must be ${money(MAX_CENTS)} or less. Please check for extra digits.` };
      }
    }
  }
  const parsed = planInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Please check the amounts: each one must be a whole number of cents, and the number of payments must be between 1 and 36." };
  }
  const v = parsed.data;
  if (!isIsoDate(v.firstChargeOn)) return { ok: false, error: "Choose the date of the first charge." };
  const finalDueOn = v.finalDueOn ? v.finalDueOn : null;
  if (finalDueOn !== null && !isIsoDate(finalDueOn)) return { ok: false, error: "The final due date is not a valid date." };

  const balance = v.agreedTotalCents - v.priorPaidCents - context.carriedPaidCents;
  if (balance <= 0) {
    return { ok: false, error: `Nothing is left to charge: the agreed total (${money(v.agreedTotalCents)}) is already covered by what has been paid.` };
  }
  const scheduled = v.installmentCents * v.installmentCount;
  if (balance !== scheduled) {
    return {
      ok: false,
      error:
        `The balance (${money(balance)}) must equal the monthly payment times the number of payments. ` +
        `${money(v.installmentCents)} x ${v.installmentCount} is ${money(scheduled)}.`,
    };
  }
  const last = addMonthsToDate(effectiveFirstCharge(v.firstChargeOn, context.today), v.installmentCount - 1);
  if (finalDueOn !== null && last > finalDueOn) {
    return {
      ok: false,
      error:
        `The last payment would fall on ${longDate(last)}, after the final due date (${longDate(finalDueOn)}). ` +
        `Use fewer payments, an earlier first charge, or a later final due date.`,
    };
  }
  return {
    ok: true,
    value: {
      agreedTotalCents: v.agreedTotalCents,
      discountCents: v.discountCents,
      discountNote: v.discountNote,
      priorPaidCents: v.priorPaidCents,
      installmentCents: v.installmentCents,
      installmentCount: v.installmentCount,
      firstChargeOn: v.firstChargeOn,
      finalDueOn,
      isTest: v.isTest,
    },
  };
}

/**
 * The subscription this plan is billing through NOW: the newest linked plan
 * created after the current authorisation. A plan that defaulted before the
 * guest added her card again is history, not the current one.
 */
export function currentLinkedPlan(
  row: Pick<BalancePlanRow, "authorized_at">,
  linked: LinkedPlan[],
): LinkedPlan | null {
  if (row.authorized_at === null) return null;
  const since = new Date(row.authorized_at).getTime();
  const candidates = linked.filter((plan) => new Date(plan.created_at).getTime() >= since);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/** What the guest and the owner are shown. `past_due` is derived, never stored. */
export function deriveState(status: BalancePlanStatus, currentPlanStatus: string | null): BalancePlanState {
  if (status !== "billing") return status;
  if (currentPlanStatus === "completed") return "completed";
  // A cancelled subscription with money owed shows as overdue until the sync
  // has returned the plan to `open`.
  if (currentPlanStatus === "past_due" || currentPlanStatus === "canceled") return "past_due";
  return "billing";
}

/** Money actually collected here, across every subscription this plan has had. */
export function paidHereCents(linked: LinkedPlan[]): number {
  let total = 0;
  for (const plan of linked) {
    for (const row of plan.installments) if (row.status === "paid") total += row.amount_cents;
  }
  return total;
}

function outstandingCents(plan: LinkedPlan): number {
  return plan.installments.filter((row) => row.status !== "paid").reduce((sum, row) => sum + row.amount_cents, 0);
}

function asInstallmentStatus(status: string): InstallmentStatus {
  return status === "paid" || status === "failed" || status === "skipped" ? status : "scheduled";
}

/**
 * The schedule to show. Payments already made (under any earlier subscription)
 * come first; then the live subscription's real instalments once billing, or a
 * projection from max(first charge date, today) before that.
 */
export function buildSchedule(input: {
  status: BalancePlanStatus;
  linked: LinkedPlan[];
  current: LinkedPlan | null;
  firstChargeOn: string;
  installmentCents: number;
  installmentCount: number;
  today: string;
}): ScheduleRow[] {
  const real = (row: LinkedInstallment): Omit<ScheduleRow, "sequence"> => ({
    amountCents: row.amount_cents,
    dueDate: pacificDate(new Date(row.due_at ?? row.paid_at ?? new Date())),
    status: asInstallmentStatus(row.status),
  });
  const showCurrent = input.current !== null && (input.status === "billing" || input.status === "completed");
  const rows: Omit<ScheduleRow, "sequence">[] = [];
  for (const plan of input.linked) {
    if (showCurrent && plan.id === input.current?.id) continue;
    for (const row of plan.installments) if (row.status === "paid") rows.push(real(row));
  }
  if (showCurrent && input.current) {
    for (const row of input.current.installments) rows.push(real(row));
  } else if (input.status === "draft" || input.status === "open" || input.status === "card_on_file" || input.status === "billing") {
    rows.push(
      ...projectSchedule({
        firstChargeOn: input.firstChargeOn,
        today: input.today,
        installmentCents: input.installmentCents,
        installmentCount: input.installmentCount,
      }).map(({ amountCents, dueDate, status }) => ({ amountCents, dueDate, status })),
    );
  }
  return rows.map((row, index) => ({ sequence: index + 1, ...row }));
}

interface StripeErrorLike {
  type?: string;
  rawType?: string;
  code?: string;
  decline_code?: string;
  param?: string;
  message?: string;
}

const CARD_ERROR_CODES = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "insufficient_funds",
  "authentication_required",
  "processing_error",
  "subscription_payment_intent_requires_action",
  "payment_intent_authentication_failure",
  "payment_method_unactivated",
]);

/**
 * Whether a Stripe error is the CARD's fault (declined, expired, needs the
 * bank's approval, or no longer attached) rather than ours or Stripe's.
 */
export function cardFailureOf(err: unknown): { code: string; declineCode: string } | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as StripeErrorLike;
  const code = String(e.code ?? "");
  const declineCode = String(e.decline_code ?? "");
  if (e.type === "StripeCardError" || e.rawType === "card_error" || CARD_ERROR_CODES.has(code)) {
    return { code, declineCode };
  }
  // The saved card was detached or removed since it was confirmed.
  if (e.type === "StripeInvalidRequestError" && code === "resource_missing" && e.param === "default_payment_method") {
    return { code: "card_unavailable", declineCode: "" };
  }
  return null;
}

/** The sentence a guest sees for a card problem. Never Stripe's own wording. */
export function guestCardMessage(code: string, declineCode = ""): string {
  if (code === "expired_card" || declineCode === "expired_card") {
    return "That card has expired. Please add a current card.";
  }
  if (code === "insufficient_funds" || declineCode === "insufficient_funds") {
    return "Your card was declined for insufficient funds. Please add a different card, or try again once funds are available.";
  }
  if (
    code === "authentication_required" ||
    code === "subscription_payment_intent_requires_action" ||
    code === "payment_intent_authentication_failure" ||
    declineCode === "authentication_required"
  ) {
    return "Your bank needs you to approve this payment. Please add your card again and complete your bank's verification step.";
  }
  if (code === "card_unavailable") {
    return "We could not use the card on file. Please add your card again.";
  }
  return "Your card was declined. Please check with your bank or add a different card.";
}

const NOT_RECOGNISED = "We couldn't find that card. Please add your card again.";
const NO_PLAN = "We couldn't find a payment plan to set up.";
const SCHEDULE_CHANGED = "The payment schedule changed while you were adding your card. Please review it and add your card again.";
const SETUP_PENDING = "Your bank hasn't finished confirming the card yet. Please try again in a minute.";

/**
 * The two 409s of the confirm step, told apart by `details.code`: with
 * `setup_pending` the same SetupIntent can simply be sent again; with
 * `schedule_changed` the guest must read the schedule again and start over.
 */
const scheduleChanged = () => conflict(SCHEDULE_CHANGED, { code: "schedule_changed" });
const setupPending = () => conflict(SETUP_PENDING, { code: "setup_pending" });

/* ──────────────────────────────── emails ──────────────────────────────── */

export interface BalanceEmail {
  subject: string;
  text: string;
  html: string;
}

function siteUrl(): string {
  return (env.publicSiteUrl || "https://www.bossclinician.com").replace(/\/+$/, "");
}

/** The guest's Payments section. Deep links are `/retreats/dashboard/:slug/:section`. */
export function paymentsUrl(retreat: Pick<RetreatRow, "slug">): string {
  return `${siteUrl()}/retreats/dashboard/${retreat.slug}/payments`;
}

/** The guest's retreat dashboard (its home section). */
export function dashboardUrl(retreat: Pick<RetreatRow, "slug">): string {
  return `${siteUrl()}/retreats/dashboard/${retreat.slug}`;
}

/* The one frame every retreat balance email arrives in. Email rules, not web
 * rules: tables for layout, inline styles, web-safe fonts, 600px, no background
 * images. It is a complete document, so the mailer's own brand frame
 * (email/brandShell.ts) passes it through untouched. */

const BRAND_SITE = "https://www.bossclinician.com";
const SIGNATURE_NAME = "Boss Clinician AI Assistant";
const SIGNATURE_BEHALF = "Yvette Howard, LCSW";
/** The last line of every plain-text part. */
export const RETREAT_EMAIL_SIGNATURE = `${SIGNATURE_NAME}, on behalf of ${SIGNATURE_BEHALF}`;
const GUEST_FOOTER = "You are receiving this because of your FlourisHealer retreat booking with Boss Clinician.";
const OWNER_FOOTER = "Sent to you as the owner of Boss Clinician.";

const INK = "#2a1a3e";
const SOFT = "#5b5068";
const MUTED = "#857c8f";
const GOLD = "#b8913f";
const LINK = "#76501b";
const PAGE = "#f6f1ea";
const CARD = "#ffffff";
const HAIRLINE = "#e8e0d4";
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "Arial, Helvetica, sans-serif";

export interface RetreatEmailShell {
  /** The inbox preview line. Hidden in the message itself. */
  preheader: string;
  heading: string;
  /** The whole greeting line, e.g. "Hi Maya," (see `greetingFor`). */
  greeting: string;
  paragraphs: string[];
  /** A two-column summary: label on the left, value on the right. */
  rows?: { label: string; value: string }[];
  button?: { label: string; url: string };
  /** Smaller print under the button. */
  footnote?: string;
  supportEmail: string;
  /** "owner" drops the guest's support line and footer. Default is the guest's. */
  variant?: "guest" | "owner";
}

/** "Hi Maya," or "Hi there," when the first name is not known. */
export function greetingFor(firstName: string): string {
  return `Hi ${firstName.trim() || "there"},`;
}

/** The logo in the signature, served by this site (so staging shows its own). */
export function retreatEmailLogoUrl(): string {
  return `${siteUrl()}/images/boss-clinician-logo.png`;
}

function supportLine(supportEmail: string): string {
  return supportEmail ? `Questions? Reply to this email or write to ${supportEmail}.` : `Questions? Reply to this email.`;
}

/** The HTML part of a retreat balance email. Every value is escaped here. */
export function retreatEmailHtml(input: RetreatEmailShell): string {
  const owner = input.variant === "owner";
  const rows = input.rows ?? [];
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${INK};">${escapeHtml(text)}</p>`;
  const summary =
    rows.length === 0
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;border-top:1px solid ${HAIRLINE};">` +
        rows
          .map(
            (row) =>
              `<tr>` +
              `<td valign="top" style="padding:11px 12px 11px 0;border-bottom:1px solid ${HAIRLINE};font-family:${SANS};font-size:14px;line-height:1.4;color:${SOFT};">${escapeHtml(row.label)}</td>` +
              `<td valign="top" align="right" style="padding:11px 0;border-bottom:1px solid ${HAIRLINE};font-family:${SANS};font-size:15px;line-height:1.4;font-weight:bold;font-variant-numeric:tabular-nums;color:${INK};text-align:right;">${escapeHtml(row.value)}</td>` +
              `</tr>`,
          )
          .join("") +
        `</table>`;
  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr>` +
      `<td align="center" bgcolor="${GOLD}" style="background-color:${GOLD};border-radius:6px;padding:14px 28px;">` +
      `<a href="${escapeHtml(input.button.url)}" target="_blank" style="display:inline-block;font-family:${SANS};font-size:16px;line-height:1.2;font-weight:bold;color:${INK};text-decoration:none;border-radius:6px;">${escapeHtml(input.button.label)}</a>` +
      `</td></tr></table>`
    : "";
  const footnote = input.footnote
    ? `<p style="margin:16px 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${SOFT};">${escapeHtml(input.footnote)}</p>`
    : "";
  const support = owner
    ? ""
    : input.supportEmail
      ? `<br>Questions? Reply to this email or write to <a href="mailto:${escapeHtml(input.supportEmail)}" style="color:${LINK};">${escapeHtml(input.supportEmail)}</a>.`
      : `<br>Questions? Reply to this email.`;
  const signature =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 0;"><tr>` +
    `<td width="120" valign="top" style="width:120px;padding:20px 16px 0 0;border-top:1px solid ${GOLD};">` +
    `<img src="${escapeHtml(retreatEmailLogoUrl())}" width="120" alt="Boss Clinician" style="display:block;border:0">` +
    `</td>` +
    `<td valign="top" style="padding:20px 0 0;border-top:1px solid ${GOLD};font-family:${SANS};font-size:13px;line-height:1.6;color:${SOFT};">` +
    `<strong style="font-size:14px;color:${INK};">${escapeHtml(SIGNATURE_NAME)}</strong>` +
    `<br>On behalf of ${escapeHtml(SIGNATURE_BEHALF)}` +
    `<br>Boss Clinician &middot; <a href="${BRAND_SITE}" style="color:${LINK};">bossclinician.com</a>` +
    support +
    `</td></tr></table>`;

  return [
    `<!doctype html>`,
    `<html lang="en" data-bc-shell="1">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="color-scheme" content="light">`,
    `<meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(input.heading)}</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background-color:${PAGE};-webkit-text-size-adjust:100%;">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(input.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background-color:${PAGE};">`,
    `<tr><td align="center" style="padding:28px 12px 32px;">`,
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">`,
    `<tr><td bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${HAIRLINE};border-radius:10px;padding:32px 28px 28px;">`,
    `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:normal;color:${INK};">${escapeHtml(input.heading)}</h1>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr><td width="56" height="3" bgcolor="${GOLD}" style="width:56px;height:3px;line-height:3px;font-size:0;background-color:${GOLD};">&nbsp;</td></tr></table>`,
    paragraph(input.greeting),
    ...input.paragraphs.map(paragraph),
    summary,
    button,
    footnote,
    signature,
    `</td></tr>`,
    `<tr><td align="center" style="padding:18px 16px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(owner ? OWNER_FOOTER : GUEST_FOOTER)}</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** The plain-text part: the same information, ending with the same signature. */
export function retreatEmailText(input: RetreatEmailShell): string {
  const owner = input.variant === "owner";
  const rows = input.rows ?? [];
  const lines: string[] = [input.greeting, ``];
  for (const text of input.paragraphs) lines.push(text, ``);
  if (rows.length > 0) lines.push(...rows.map((row) => `  ${row.label}: ${row.value}`), ``);
  if (input.button) lines.push(`${input.button.label}: ${input.button.url}`, ``);
  if (input.footnote) lines.push(input.footnote, ``);
  if (!owner) lines.push(supportLine(input.supportEmail));
  lines.push(BRAND_SITE, ``, RETREAT_EMAIL_SIGNATURE);
  return lines.join("\n");
}

function retreatEmail(subject: string, shell: RetreatEmailShell): BalanceEmail {
  return { subject, text: retreatEmailText(shell), html: retreatEmailHtml(shell) };
}

/** The owner's "please add your card" email. Sent only by her explicit action. */
export function buildRequestEmail(input: {
  firstName: string;
  retreatTitle: string;
  currency: string;
  agreedTotalCents: number;
  paidSoFarCents: number;
  remainingCents: number;
  installmentCents: number;
  installmentCount: number;
  firstChargeDate: string;
  chargesWhenAdded: boolean;
  url: string;
  supportEmail: string;
}): BalanceEmail {
  const money = (amount: number) => formatAmount(amount, input.currency);
  const plan =
    input.installmentCount === 1
      ? `one payment of ${money(input.installmentCents)}`
      : `${input.installmentCount} monthly payments of ${money(input.installmentCents)}`;
  const first = input.chargesWhenAdded
    ? `The first payment is charged when you add your card, and you will see the full schedule before you agree to it.`
    : `The first payment is charged on ${longDate(input.firstChargeDate)}, and you will see the full schedule before you agree to it.`;
  const intro = `Your payments for ${input.retreatTitle} are moving to your retreat dashboard, so the remaining balance can be paid automatically from a card you choose.`;
  return retreatEmail(`Add your card for your ${input.retreatTitle} balance`, {
    preheader: `Add a card on your retreat dashboard so your ${input.retreatTitle} balance is paid automatically.`,
    heading: "Add your card",
    greeting: greetingFor(input.firstName),
    paragraphs: [intro, first, `Here is where things stand:`],
    rows: [
      { label: "Retreat", value: input.retreatTitle },
      { label: "Agreed total", value: money(input.agreedTotalCents) },
      { label: "Paid so far", value: money(input.paidSoFarCents) },
      { label: "Remaining balance", value: money(input.remainingCents) },
      { label: "Your plan", value: plan },
    ],
    button: { label: "Add your card", url: input.url },
    footnote:
      `Your card is stored securely by Stripe, our payment processor. We never see or keep the card number. ` +
      `If anything here does not look right, just reply to this email.`,
    supportEmail: input.supportEmail,
  });
}

/** Tells the guest a charge did not go through and how to put it right. */
export function buildCardProblemEmail(input: {
  firstName: string;
  retreatTitle: string;
  problem: string;
  url: string;
  supportEmail: string;
}): BalanceEmail {
  return retreatEmail(`Your ${input.retreatTitle} payment did not go through`, {
    preheader: `Please add a card again so your ${input.retreatTitle} payments can continue.`,
    heading: "Your payment did not go through",
    greeting: greetingFor(input.firstName),
    paragraphs: [
      `We tried to charge the card you saved for your ${input.retreatTitle} balance and the payment did not go through.`,
      input.problem,
      `Nothing else has changed, and your place is not affected by this message. Please add a card again so your payments can continue.`,
    ],
    button: { label: "Add your card", url: input.url },
    supportEmail: input.supportEmail,
  });
}

/** The owner's short "card on file" notice. */
export function buildOwnerNotice(input: {
  guestName: string;
  guestEmail: string;
  retreatTitle: string;
  currency: string;
  installmentCents: number;
  installmentCount: number;
  firstChargeDate: string;
  lastChargeDate: string;
  card: string;
}): BalanceEmail {
  const money = formatAmount(input.installmentCents, input.currency);
  const total = formatAmount(input.installmentCents * input.installmentCount, input.currency);
  const who = input.guestName ? `${input.guestName} (${input.guestEmail})` : input.guestEmail;
  const intro = `A retreat guest has added a card and agreed to her balance payment schedule. The charges run automatically from here.`;
  return retreatEmail(`Card on file: ${input.guestName || input.guestEmail} (${input.retreatTitle} balance)`, {
    variant: "owner",
    preheader: intro,
    heading: "Card on file",
    greeting: "Hello,",
    paragraphs: [intro],
    rows: [
      { label: "Guest", value: who },
      { label: "Retreat", value: input.retreatTitle },
      { label: "Card", value: input.card },
      {
        label: "Schedule",
        value:
          input.installmentCount === 1
            ? `one payment of ${money} on ${longDate(input.firstChargeDate)}`
            : `${input.installmentCount} monthly payments of ${money} (${total} in total), ${longDate(input.firstChargeDate)} to ${longDate(input.lastChargeDate)}`,
      },
    ],
    supportEmail: "",
  });
}

/** "Visa ending 4242", or "" when no card is on record. */
export function cardLabel(brand: string | null | undefined, last4: string | null | undefined): string {
  if (!last4) return "";
  const name = (brand ?? "").trim();
  return `${name ? name.charAt(0).toUpperCase() + name.slice(1) : "Card"} ending ${last4}`;
}

export interface BalanceReceiptInput {
  firstName: string;
  retreatTitle: string;
  currency: string;
  /** What this payment collected. */
  amountCents: number;
  /** This payment's place in the schedule: N of M. */
  sequence: number;
  installmentCount: number;
  /** Everything paid toward the retreat, this payment included. */
  paidSoFarCents: number;
  /** What is still owed after this payment. */
  remainingCents: number;
  /** The next scheduled charge, or null when none is scheduled. */
  next: { date: string; amountCents: number } | null;
  /** "Visa ending 4242", or "" when not known. */
  card: string;
  url: string;
  supportEmail: string;
}

/** The receipt for one balance payment. Never mentions an order or the library. */
export function buildBalanceReceiptEmail(input: BalanceReceiptInput): BalanceEmail {
  const money = (amount: number) => formatAmount(amount, input.currency);
  const amount = money(input.amountCents);
  const position = `${input.sequence} of ${input.installmentCount}`;
  const lineTitle = `${input.retreatTitle}: balance payment ${position}`;
  const paidInFull = input.remainingCents <= 0;
  const status = paidInFull
    ? `Your balance is now paid in full.`
    : input.next
      ? `${money(input.remainingCents)} remains on your balance, and your next payment of ${money(input.next.amountCents)} is scheduled for ${longDate(input.next.date)}.`
      : `${money(input.remainingCents)} remains on your balance. No further payment is scheduled at the moment.`;
  const nextValue = paidInFull
    ? `None. Your balance is paid in full.`
    : input.next
      ? `${longDate(input.next.date)} (${money(input.next.amountCents)})`
      : `None scheduled`;
  return retreatEmail(`Your retreat payment receipt: ${amount}`, {
    preheader: `${lineTitle}. ${status}`,
    heading: "Payment received",
    greeting: greetingFor(input.firstName),
    paragraphs: [`Thank you. We received your payment of ${amount} for ${lineTitle}.`, status],
    rows: [
      { label: "Retreat", value: input.retreatTitle },
      { label: "Payment", value: position },
      { label: "Amount paid", value: amount },
      { label: "Paid so far", value: money(input.paidSoFarCents) },
      { label: "Balance remaining", value: money(Math.max(0, input.remainingCents)) },
      { label: "Next payment", value: nextValue },
      ...(input.card ? [{ label: "Card", value: input.card }] : []),
    ],
    button: { label: "View my retreat payments", url: input.url },
    footnote: `Keep this email for your records.`,
    supportEmail: input.supportEmail,
  });
}

/** Sent when the last balance payment clears. */
export function buildBalanceCompletedEmail(input: {
  firstName: string;
  retreatTitle: string;
  currency: string;
  /** Everything paid toward the retreat. 0 leaves the figure out. */
  totalPaidCents: number;
  url: string;
  supportEmail: string;
}): BalanceEmail {
  return retreatEmail(`Your ${input.retreatTitle} balance is paid in full`, {
    preheader: `Your balance for ${input.retreatTitle} is paid in full. No further charges will be made.`,
    heading: "Paid in full",
    greeting: greetingFor(input.firstName),
    paragraphs: [
      `That was your final payment. Your balance for ${input.retreatTitle} is paid in full, and no further charges will be made to your card.`,
      `Thank you for completing your payments.`,
    ],
    rows: [
      { label: "Retreat", value: input.retreatTitle },
      ...(input.totalPaidCents > 0 ? [{ label: "Total paid", value: formatAmount(input.totalPaidCents, input.currency) }] : []),
      { label: "Balance remaining", value: formatAmount(0, input.currency) },
    ],
    button: { label: "Open my retreat dashboard", url: input.url },
    supportEmail: input.supportEmail,
  });
}

/** Sent when a balance instalment (not the first one) is declined. */
export function buildBalancePaymentFailedEmail(input: {
  firstName: string;
  retreatTitle: string;
  currency: string;
  amountCents: number;
  /** How many attempts have failed, this one included. */
  attempt: number;
  /** YYYY-MM-DD of the next automatic attempt, or null when there will be none. */
  nextAttemptDate: string | null;
  /** Where the card is updated: /account/billing. */
  url: string;
  supportEmail: string;
}): BalanceEmail {
  const amount = formatAmount(input.amountCents, input.currency);
  const last = input.nextAttemptDate === null;
  const when = input.nextAttemptDate
    ? `We will try again on ${longDate(input.nextAttemptDate)}. You can update your card now so that attempt goes through.`
    : `This was the last automatic attempt, so nothing more will be tried. Please update your card to make this payment.`;
  return retreatEmail(
    last ? `Action needed: your retreat balance payment of ${amount}` : `Your retreat balance payment did not go through`,
    {
      preheader: `Your retreat balance payment of ${amount} was declined. Please update your card.`,
      heading: "Your payment did not go through",
      greeting: greetingFor(input.firstName),
      paragraphs: [
        `Your retreat balance payment of ${amount} for ${input.retreatTitle} was declined${input.attempt > 1 ? ` (attempt ${input.attempt})` : ""}.`,
        `Most often this is a card that has expired or been replaced.`,
        when,
      ],
      rows: [
        { label: "Retreat", value: input.retreatTitle },
        { label: "Amount due", value: amount },
      ],
      button: { label: "Update my card", url: input.url },
      supportEmail: input.supportEmail,
    },
  );
}

/** The owner's short plain note about a refunded balance payment. */
export function buildRefundOwnerNote(input: {
  guestName: string;
  guestEmail: string;
  retreatTitle: string;
  currency: string;
  refundedCents: number;
  chargeId: string;
  /** False when the refund could not be written to the ledger. */
  recorded: boolean;
  isTest: boolean;
}): { subject: string; text: string } {
  const amount = formatAmount(input.refundedCents, input.currency);
  const who = input.guestName && input.guestEmail ? `${input.guestName} (${input.guestEmail})` : input.guestName || input.guestEmail || "(unknown guest)";
  return {
    subject: `Retreat balance payment refunded: ${amount} (${input.retreatTitle})`,
    text: [
      `A retreat balance payment was refunded in Stripe.`,
      ``,
      `Guest: ${who}`,
      `Retreat: ${input.retreatTitle}${input.isTest ? " (test plan)" : ""}`,
      `Refunded: ${amount}`,
      `Stripe charge: ${input.chargeId}`,
      ``,
      input.recorded
        ? `The refund is recorded in the payments ledger.`
        : `The refund could NOT be recorded in the payments ledger. Please check the server log.`,
      `The guest's payment schedule was not changed automatically: the instalment still shows as paid and her balance is unchanged. If she should pay this amount again, please adjust her plan.`,
    ].join("\n"),
  };
}

/* ─────────────────────────────── lookups ──────────────────────────────── */

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[retreat-balance] ${message}`);
}

function logError(message: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[retreat-balance] ${message}:`, err instanceof Error ? err.message : err);
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

async function findPlan(retreatId: number, memberId: number): Promise<BalancePlanRow | null> {
  const res = await pool.query<BalancePlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM retreat_balance_plans WHERE retreat_id = $1 AND member_id = $2`,
    [retreatId, memberId],
  );
  return res.rows[0] ?? null;
}

async function findPlanById(id: number): Promise<BalancePlanRow | null> {
  const res = await pool.query<BalancePlanRow>(`SELECT ${PLAN_COLUMNS} FROM retreat_balance_plans WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

async function loadLinkedPlans(balancePlanIds: number[]): Promise<Map<number, LinkedPlan[]>> {
  const byPlan = new Map<number, LinkedPlan[]>();
  if (balancePlanIds.length === 0) return byPlan;
  const plans = await pool.query<{
    id: number;
    retreat_balance_plan_id: number;
    status: string;
    stripe_subscription_id: string | null;
    created_at: Date;
  }>(
    `SELECT id, retreat_balance_plan_id, status, stripe_subscription_id, created_at
       FROM payment_plans
      WHERE retreat_balance_plan_id = ANY($1::int[])
      ORDER BY id`,
    [balancePlanIds],
  );
  const byId = new Map<number, LinkedPlan>();
  for (const row of plans.rows) {
    const plan: LinkedPlan = {
      id: row.id,
      status: row.status,
      stripe_subscription_id: row.stripe_subscription_id,
      created_at: row.created_at,
      installments: [],
    };
    byId.set(row.id, plan);
    const list = byPlan.get(row.retreat_balance_plan_id) ?? [];
    list.push(plan);
    byPlan.set(row.retreat_balance_plan_id, list);
  }
  if (byId.size > 0) {
    const installments = await pool.query<LinkedInstallment & { payment_plan_id: number }>(
      `SELECT payment_plan_id, sequence, amount_cents, due_at, paid_at, status
         FROM payment_plan_installments
        WHERE payment_plan_id = ANY($1::int[])
        ORDER BY payment_plan_id, sequence`,
      [[...byId.keys()]],
    );
    for (const row of installments.rows) {
      byId.get(row.payment_plan_id)?.installments.push({
        sequence: row.sequence,
        amount_cents: row.amount_cents,
        due_at: row.due_at,
        paid_at: row.paid_at,
        status: row.status,
      });
    }
  }
  return byPlan;
}

async function loadLinkedFor(balancePlanId: number): Promise<LinkedPlan[]> {
  return (await loadLinkedPlans([balancePlanId])).get(balancePlanId) ?? [];
}

interface MemberFacts {
  email: string;
  name: string;
  firstName: string;
}

async function memberFacts(memberId: number): Promise<MemberFacts> {
  const res = await pool.query<{ email: string; name: string | null; first_name: string | null; last_name: string | null }>(
    `SELECT email::text AS email, name, first_name, last_name FROM members WHERE id = $1`,
    [memberId],
  );
  const row = res.rows[0];
  const full = (row?.name ?? "").trim() || [row?.first_name, row?.last_name].map((part) => (part ?? "").trim()).filter(Boolean).join(" ");
  const firstName = (row?.first_name ?? "").trim() || full.split(/\s+/)[0] || "";
  return { email: row?.email ?? "", name: full, firstName };
}

async function findRetreat(retreatId: number): Promise<Pick<RetreatRow, "id" | "slug" | "title" | "settings"> | null> {
  const res = await pool.query<Pick<RetreatRow, "id" | "slug" | "title" | "settings">>(
    `SELECT id, slug, title, settings FROM retreats WHERE id = $1`,
    [retreatId],
  );
  return res.rows[0] ?? null;
}

type RetreatFacts = Pick<RetreatRow, "id" | "slug" | "title" | "settings">;

function supportEmailOf(retreat: Pick<RetreatRow, "settings">): string {
  return normaliseSettings(retreat.settings).supportEmail || "";
}

/* ───────────────────────────────── views ──────────────────────────────── */

function remainingOf(row: BalancePlanRow, paidHere: number): number {
  return Math.max(0, row.agreed_total_cents - row.prior_paid_cents - paidHere);
}

function guestView(row: BalancePlanRow, linked: LinkedPlan[], retreatTitle: string, today: string): BalancePlanView | null {
  const current = currentLinkedPlan(row, linked);
  const state = deriveState(row.status, current?.status ?? null);
  if (state === "draft" || state === "canceled") return null;
  const paidHere = paidHereCents(linked);
  const schedule = buildSchedule({
    status: row.status,
    linked,
    current,
    firstChargeOn: row.first_charge_on,
    installmentCents: row.installment_cents,
    installmentCount: row.installment_count,
    today,
  });
  const firstUnpaid = schedule.find((item) => item.status !== "paid");
  const preBilling = row.status === "open" || row.status === "card_on_file";
  return {
    state,
    currency: row.currency,
    agreedTotalCents: row.agreed_total_cents,
    discountCents: row.discount_cents,
    discountNote: row.discount_note,
    priorPaidCents: row.prior_paid_cents,
    paidHereCents: paidHere,
    remainingCents: remainingOf(row, paidHere),
    installmentCents: row.installment_cents,
    installmentCount: row.installment_count,
    schedule,
    firstChargeDate: preBilling
      ? effectiveFirstCharge(row.first_charge_on, today)
      : (firstUnpaid?.dueDate ?? schedule[0]?.dueDate ?? row.first_charge_on),
    finalDueDate: row.final_due_on,
    chargesToday: row.status === "open" && row.first_charge_on <= today,
    card: row.card_last4 ? { brand: row.card_brand ?? "", last4: row.card_last4 } : null,
    authorizationText:
      row.status === "open"
        ? buildAuthorizationText({
            retreatTitle,
            installmentCents: row.installment_cents,
            installmentCount: row.installment_count,
            currency: row.currency,
            firstChargeOn: row.first_charge_on,
            today,
          })
        : row.authorization_text,
    problem: row.status === "open" ? row.last_error : "",
  };
}

const iso = (value: Date | null): string | null => (value ? new Date(value).toISOString() : null);

function adminJson(row: BalancePlanRow, linked: LinkedPlan[], member: { name: string; email: string }, today: string) {
  const current = currentLinkedPlan(row, linked);
  const paidHere = paidHereCents(linked);
  const latest = linked.length ? linked[linked.length - 1] : null;
  return {
    id: row.id,
    retreatId: row.retreat_id,
    memberId: row.member_id,
    memberName: member.name,
    memberEmail: member.email,
    agreedTotalCents: row.agreed_total_cents,
    discountCents: row.discount_cents,
    discountNote: row.discount_note,
    priorPaidCents: row.prior_paid_cents,
    carriedPaidCents: row.carried_paid_cents,
    installmentCents: row.installment_cents,
    installmentCount: row.installment_count,
    firstChargeOn: row.first_charge_on,
    finalDueOn: row.final_due_on,
    currency: row.currency,
    status: row.status,
    state: deriveState(row.status, current?.status ?? null),
    isTest: row.is_test,
    stripeCustomerId: row.stripe_customer_id,
    stripePaymentMethodId: row.stripe_payment_method_id,
    stripeSubscriptionId: (current ?? latest)?.stripe_subscription_id ?? null,
    cardBrand: row.card_brand,
    cardLast4: row.card_last4,
    authorizedAt: iso(row.authorized_at),
    authorizationText: row.authorization_text,
    authorizedIp: row.authorized_ip,
    cardAddedAt: iso(row.card_added_at),
    billingStartedAt: iso(row.billing_started_at),
    billingAttempts: row.billing_attempts,
    subscriptionEndedAt: iso(row.subscription_ended_at),
    ownerNotifiedAt: iso(row.owner_notified_at),
    requestEmailSentAt: iso(row.request_email_sent_at),
    lastError: row.last_error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    paidHereCents: paidHere,
    remainingCents: remainingOf(row, paidHere),
    schedule: buildSchedule({
      status: row.status,
      linked,
      current,
      firstChargeOn: row.first_charge_on,
      installmentCents: row.installment_cents,
      installmentCount: row.installment_count,
      today,
    }),
  };
}

export type AdminBalancePlan = ReturnType<typeof adminJson>;

/* ────────────────────────── Stripe: small pieces ──────────────────────── */

const hourBucket = (): number => Math.floor(Date.now() / 3_600_000);

const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "past_due", "unpaid", "trialing", "incomplete", "paused"]);

/**
 * Cancels a subscription unless it is already over. No proration and no final
 * invoice: ending a plan must never produce a charge or a credit of its own.
 */
async function cancelSubscriptionIfLive(stripeSubscriptionId: string): Promise<boolean> {
  const sub = await stripe().subscriptions.retrieve(stripeSubscriptionId);
  if (!LIVE_SUBSCRIPTION_STATUSES.has(sub.status)) return false;
  await stripe().subscriptions.cancel(
    stripeSubscriptionId,
    { prorate: false, invoice_now: false },
    // The hour is part of the key so a failed attempt is not replayed from
    // Stripe's idempotency cache when the job tries again later.
    { idempotencyKey: `retreat-balance-cancel-${stripeSubscriptionId}-${hourBucket()}` },
  );
  return true;
}

/**
 * Ends a subscription that stopped with money still owed, for good: cancels it
 * if it is somehow still alive, then voids every invoice it left open.
 *
 * The voiding matters as much as the cancelling. Stripe leaves a cancelled
 * subscription's unpaid invoice open and payable (the payment-failed email
 * links straight to it, and the billing page retries failed invoices on a new
 * card). Once this plan has been handed back to the guest to add a card again,
 * the same instalment is inside the NEXT subscription, so a payment on the old
 * invoice would be that instalment collected twice. Throws if Stripe cannot
 * confirm it; callers must not reopen the plan in that case.
 */
async function closeOutSubscription(stripeSubscriptionId: string): Promise<void> {
  await cancelSubscriptionIfLive(stripeSubscriptionId);
  const voided: string[] = [];
  for (const status of ["open", "uncollectible"] as const) {
    const invoices = await stripe().invoices.list({ subscription: stripeSubscriptionId, status, limit: 100 });
    for (const invoice of invoices.data) {
      if (typeof invoice.id !== "string") continue;
      await stripe().invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `retreat-balance-void-${invoice.id}-${hourBucket()}` });
      voided.push(invoice.id);
    }
  }
  if (voided.length > 0) {
    // No retry of ours may pay it either (services/dunning.ts, billingPortal.ts).
    await pool.query(
      `UPDATE invoices
          SET dunning_ended_at = COALESCE(dunning_ended_at, now()),
              dunning_outcome  = CASE WHEN dunning_outcome = '' THEN 'canceled' ELSE dunning_outcome END,
              next_retry_at    = NULL
        WHERE stripe_invoice_id = ANY($1::text[])`,
      [voided],
    );
    log(`subscription ${stripeSubscriptionId}: voided ${voided.length} unpaid invoice(s) so they cannot be paid later`);
  }
}

/**
 * Makes sure a FINISHED plan's subscription cannot bill another cycle, and
 * records that it is over. Never throws: `cancel_at` is still behind it, and
 * the hourly job tries again until `subscription_ended_at` is stamped.
 */
async function endFinishedSubscription(balancePlanId: number, stripeSubscriptionId: string | null): Promise<boolean> {
  try {
    if (stripeSubscriptionId && stripeEnabled()) {
      const cancelled = await cancelSubscriptionIfLive(stripeSubscriptionId);
      if (cancelled) log(`plan ${balancePlanId}: paid in full, subscription ${stripeSubscriptionId} cancelled so no further cycle can bill`);
    } else if (stripeSubscriptionId) {
      return false;
    }
    await pool.query(
      `UPDATE retreat_balance_plans SET subscription_ended_at = now(), updated_at = now()
        WHERE id = $1 AND subscription_ended_at IS NULL`,
      [balancePlanId],
    );
    return true;
  } catch (err) {
    logError(`plan ${balancePlanId}: could not confirm subscription ${stripeSubscriptionId} is cancelled (will retry)`, err);
    return false;
  }
}

/**
 * Called by the Stripe webhook the moment a payment plan's final instalment is
 * credited. For a retreat balance plan it cancels the subscription there and
 * then, and marks the balance plan completed. Any other plan is left alone.
 * Never throws: the payment is already recorded when this runs.
 */
export async function onLinkedPlanCompleted(paymentPlanId: number): Promise<void> {
  try {
    const res = await pool.query<{ retreat_balance_plan_id: number | null; stripe_subscription_id: string | null }>(
      `SELECT retreat_balance_plan_id, stripe_subscription_id FROM payment_plans WHERE id = $1`,
      [paymentPlanId],
    );
    const plan = res.rows[0];
    if (!plan || plan.retreat_balance_plan_id === null) return;
    await endFinishedSubscription(plan.retreat_balance_plan_id, plan.stripe_subscription_id);
    await pool.query(
      `UPDATE retreat_balance_plans SET status = 'completed', last_error = '', updated_at = now()
        WHERE id = $1 AND status = 'billing'`,
      [plan.retreat_balance_plan_id],
    );
  } catch (err) {
    logError(`payment plan ${paymentPlanId}: completion follow-up failed (the hourly job will finish it)`, err);
  }
}

const PRODUCT_SETTING_KEY = "retreat_balance_billing";
let cachedProductId: string | null = null;

/**
 * The one Stripe Product every balance subscription bills against ("Retreat
 * balance payments"). Created once per Stripe mode, remembered in `settings`,
 * and verified once per process so a product from the other mode is replaced.
 */
async function ensureBalanceProduct(): Promise<string> {
  if (cachedProductId) return cachedProductId;
  const field = stripeTestMode() ? "productIdTest" : "productIdLive";
  const stored = await pool.query<{ value: Record<string, unknown> | null }>(`SELECT value FROM settings WHERE key = $1`, [PRODUCT_SETTING_KEY]);
  const known = stored.rows[0]?.value?.[field];
  if (typeof known === "string" && known) {
    try {
      const product = await stripe().products.retrieve(known);
      if (!("deleted" in product && product.deleted) && product.active) {
        cachedProductId = known;
        return known;
      }
    } catch (err) {
      if ((err as StripeErrorLike).code !== "resource_missing") throw err;
    }
  }
  const descriptor = cleanStatementDescriptor((await readSetting("customer_payments")).statementDescriptor);
  const product = await stripe().products.create(
    {
      name: "Retreat balance payments",
      metadata: { purpose: "retreat_balance" },
      ...(descriptor ? { statement_descriptor: descriptor } : {}),
    },
    { idempotencyKey: `retreat-balance-product-${field}-${typeof known === "string" && known ? known : "first"}` },
  );
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, jsonb_build_object($2::text, $3::text))
     ON CONFLICT (key) DO UPDATE SET value = COALESCE(settings.value, '{}'::jsonb) || jsonb_build_object($2::text, $3::text)`,
    [PRODUCT_SETTING_KEY, field, product.id],
  );
  cachedProductId = product.id;
  return product.id;
}

/** The Stripe customer whose card matters most to this member (same order as the billing page). */
async function knownCustomerId(memberId: number): Promise<string | null> {
  const found = await pool.query<{ customer_id: string }>(
    `SELECT c.customer_id
       FROM (
         SELECT s.stripe_customer_id AS customer_id,
                CASE WHEN s.status IN ('active','trialing','past_due','unpaid') THEN 0 ELSE 2 END AS priority,
                s.updated_at
           FROM subscriptions s
          WHERE s.member_id = $1 AND s.stripe_customer_id IS NOT NULL
         UNION ALL
         SELECT pp.stripe_customer_id,
                CASE WHEN pp.status IN ('active','past_due') THEN 1 ELSE 2 END,
                pp.updated_at
           FROM payment_plans pp
          WHERE pp.member_id = $1 AND pp.stripe_customer_id IS NOT NULL
         UNION ALL
         SELECT o.stripe_customer_id, 3, o.updated_at
           FROM orders o
          WHERE o.member_id = $1 AND o.stripe_customer_id IS NOT NULL
       ) c
      ORDER BY c.priority, c.updated_at DESC
      LIMIT 1`,
    [memberId],
  );
  return found.rows[0]?.customer_id ?? null;
}

async function customerExists(customerId: string): Promise<boolean> {
  try {
    const customer = await stripe().customers.retrieve(customerId);
    return !customer.deleted;
  } catch (err) {
    // A live customer id does not exist in a sandbox (or another account).
    if ((err as StripeErrorLike).code === "resource_missing") return false;
    throw err;
  }
}

/** Finds or creates the member's Stripe customer and pins it on the plan. */
async function ensureCustomer(row: BalancePlanRow, member: MemberFacts): Promise<string> {
  if (row.stripe_customer_id && (await customerExists(row.stripe_customer_id))) return row.stripe_customer_id;
  let customerId = await knownCustomerId(row.member_id);
  if (customerId === row.stripe_customer_id || (customerId !== null && !(await customerExists(customerId)))) customerId = null;
  if (customerId === null) {
    const created = await stripe().customers.create(
      {
        email: member.email,
        ...(member.name ? { name: member.name } : {}),
        metadata: { memberId: String(row.member_id) },
      },
      { idempotencyKey: `retreat-balance-customer-${row.id}-${row.stripe_customer_id ?? "first"}` },
    );
    customerId = created.id;
  }
  const pinned = await pool.query<{ stripe_customer_id: string }>(
    `UPDATE retreat_balance_plans SET stripe_customer_id = $2, updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING stripe_customer_id`,
    [row.id, customerId],
  );
  if (!pinned.rows[0]) throw conflict("This payment plan has changed. Please refresh the page.");
  return pinned.rows[0].stripe_customer_id;
}

/* ────────────────────────────── guest: read ───────────────────────────── */

/**
 * The guest's balance plan for her dashboard, or null when the owner has not
 * opened one (no plan, draft, cancelled). Syncs a billing plan with its
 * subscription first, so "paid in full" appears without waiting for the job.
 */
export async function loadGuestBalancePlan(
  retreat: Pick<RetreatRow, "id" | "slug" | "title" | "settings">,
  memberId: number,
  now: Date = new Date(),
): Promise<BalancePlanView | null> {
  let row = await findPlan(retreat.id, memberId);
  if (!row || row.status === "draft" || row.status === "canceled") return null;
  let linked = await loadLinkedFor(row.id);
  if (row.status === "billing") {
    try {
      const synced = await syncBalancePlan(row, linked, retreat);
      if (synced !== row) {
        row = synced;
        linked = await loadLinkedFor(row.id);
      }
    } catch (err) {
      logError(`plan ${row.id}: sync on load failed`, err);
    }
  }
  return guestView(row, linked, retreat.title, pacificToday(now));
}

/* ───────────────────────────── guest: card ────────────────────────────── */

function currentAuthorizationText(row: BalancePlanRow, retreatTitle: string, today: string): string {
  return buildAuthorizationText({
    retreatTitle,
    installmentCents: row.installment_cents,
    installmentCount: row.installment_count,
    currency: row.currency,
    firstChargeOn: row.first_charge_on,
    today,
  });
}

/**
 * Starts card collection for an OPEN plan and returns the SetupIntent's client
 * secret together with the plan as it stands at this moment. The intent is
 * stamped with the member, the plan and a fingerprint of the consent sentence;
 * the confirm step checks all three.
 *
 * The view returned here is built from the very row and the very date the
 * fingerprint was taken from, so the sentence the page shows beside the card
 * form is the sentence the fingerprint stands for. The page must render the
 * form from this view, not from an earlier dashboard load.
 */
export async function createBalancePlanSetupIntent(
  retreat: RetreatFacts,
  memberId: number,
): Promise<{ clientSecret: string; balancePlan: BalancePlanView }> {
  if (!stripeEnabled()) throw serviceUnavailable("Payments are not available right now. Please try again shortly.");
  const row = await findPlan(retreat.id, memberId);
  if (!row || row.status === "draft" || row.status === "canceled") throw notFound(NO_PLAN);
  if (row.status !== "open") throw badRequest("A card is already saved for this payment plan.");

  const member = await memberFacts(memberId);
  if (!member.email) throw badRequest("Your account has no email address. Please contact us.");
  const customerId = await ensureCustomer(row, member);
  const today = pacificToday();
  const balancePlan = guestView(row, await loadLinkedFor(row.id), retreat.title, today);
  if (!balancePlan) throw notFound(NO_PLAN);
  const terms = termsFingerprint(balancePlan.authorizationText);
  const intent = await stripe().setupIntents.create(
    {
      customer: customerId,
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { memberId: String(memberId), retreatBalancePlanId: String(row.id), terms },
    },
    // A new intent per request by design (the page may be opened twice); the
    // key only protects one request from being sent to Stripe twice.
    { idempotencyKey: `retreat-balance-setup-${row.id}-${crypto.randomUUID()}` },
  );
  if (!intent.client_secret) throw serviceUnavailable("Payments are not available right now. Please try again shortly.");
  return { clientSecret: intent.client_secret, balancePlan };
}

export interface ConfirmResult {
  balancePlan: BalancePlanView;
  charged: boolean;
}

async function viewOrThrow(retreat: RetreatFacts, memberId: number): Promise<BalancePlanView> {
  const view = await loadGuestBalancePlan(retreat, memberId);
  if (!view) throw notFound(NO_PLAN);
  return view;
}

/** Tells the owner once per saved card. Never throws. */
async function notifyOwnerOfCard(row: BalancePlanRow, retreat: RetreatFacts, member: MemberFacts): Promise<void> {
  if (row.is_test) return;
  try {
    const claimed = await pool.query(
      `UPDATE retreat_balance_plans SET owner_notified_at = now(), updated_at = now()
        WHERE id = $1 AND owner_notified_at IS NULL
        RETURNING id`,
      [row.id],
    );
    if (!claimed.rows[0]) return;
    const to = await notificationRecipients("alert");
    if (!to) return;
    const first = effectiveFirstCharge(row.first_charge_on, pacificToday());
    const notice = buildOwnerNotice({
      guestName: member.name,
      guestEmail: member.email,
      retreatTitle: retreat.title,
      currency: row.currency,
      installmentCents: row.installment_cents,
      installmentCount: row.installment_count,
      firstChargeDate: first,
      lastChargeDate: addMonthsToDate(first, row.installment_count - 1),
      card: `${row.card_brand || "card"} ending ${row.card_last4 ?? ""}`.trim(),
    });
    await sendStripeMail({ to, ...notice, topic: "retreat_balance_card_on_file", memberId: row.member_id });
  } catch (err) {
    logError(`plan ${row.id}: owner notice failed`, err);
  }
}

/**
 * Saves the card from a succeeded SetupIntent and records the guest's
 * agreement. Then, if the first charge date has arrived, starts billing.
 *
 * Ownership is checked three ways and all three must hold: the intent belongs
 * to the Stripe customer pinned on THIS member's plan, its metadata names this
 * member, and its metadata names this plan. Intents are only ever created by
 * this server, so a member cannot present another member's intent, an intent
 * made on the billing page, or a made-up id.
 *
 * Consent is checked two ways and both must hold: the intent's fingerprint
 * matches the sentence as it stands now (nothing changed since the card form
 * was opened), and `authorizationText`, the sentence the page actually showed
 * beside the tick box, is that same sentence word for word. What is stored is
 * always the sentence built here, never the client's copy. Either mismatch
 * answers 409 `schedule_changed` and nothing is saved.
 *
 * Throws `BalancePlanCardError` when the first charge is declined (the route
 * answers 402 with its sentence).
 */
export async function confirmBalancePlanCard(input: {
  retreat: RetreatFacts;
  memberId: number;
  setupIntentId: string;
  /** The consent sentence exactly as the guest's page displayed it. */
  authorizationText: string;
  ip: string;
}): Promise<ConfirmResult> {
  const { retreat, memberId } = input;
  if (!stripeEnabled()) throw serviceUnavailable("Payments are not available right now. Please try again shortly.");
  let row = await findPlan(retreat.id, memberId);
  if (!row || row.status === "draft" || row.status === "canceled") throw notFound(NO_PLAN);
  let savedNow: BalancePlanRow | null = null;

  if (row.status === "open") {
    if (!row.stripe_customer_id) throw notFound(NOT_RECOGNISED);
    let intent: Stripe.SetupIntent;
    try {
      intent = await stripe().setupIntents.retrieve(input.setupIntentId, { expand: ["payment_method"] });
    } catch (err) {
      // An id Stripe has never heard of is answered exactly like somebody else's.
      if ((err as StripeErrorLike).code === "resource_missing") throw notFound(NOT_RECOGNISED);
      throw err;
    }
    const metadata = intent.metadata ?? {};
    if (
      idOf(intent.customer) !== row.stripe_customer_id ||
      metadata.memberId !== String(memberId) ||
      metadata.retreatBalancePlanId !== String(row.id)
    ) {
      throw notFound(NOT_RECOGNISED);
    }
    // Not a refusal: the same SetupIntent is good once the bank has answered.
    if (intent.status !== "succeeded") throw setupPending();
    const method = intent.payment_method;
    const paymentMethodId = idOf(method);
    if (paymentMethodId === null) throw notFound(NOT_RECOGNISED);

    const today = pacificToday();
    const authorizationText = currentAuthorizationText(row, retreat.title, today);
    if (metadata.terms !== termsFingerprint(authorizationText)) throw scheduleChanged();
    // The sentence she ticked must be the sentence stored. A page that showed
    // an older schedule (or sent none at all) is sent back to read this one.
    if (input.authorizationText !== authorizationText) throw scheduleChanged();
    const card = typeof method === "object" && method !== null ? (method.card ?? null) : null;

    await stripe().customers.update(
      row.stripe_customer_id,
      { invoice_settings: { default_payment_method: paymentMethodId } },
      { idempotencyKey: `retreat-balance-default-${input.setupIntentId}-${hourBucket()}` },
    );

    // Guarded on the very numbers the consent sentence was built from: an edit
    // by the owner between the read above and this write saves nothing.
    const saved = await pool.query<BalancePlanRow>(
      `UPDATE retreat_balance_plans
          SET status = 'card_on_file',
              stripe_payment_method_id = $2,
              card_brand = $3,
              card_last4 = $4,
              authorized_at = now(),
              authorization_text = $5,
              authorized_ip = $6,
              card_added_at = now(),
              billing_started_at = NULL,
              last_error = '',
              updated_at = now()
        WHERE id = $1 AND status = 'open' AND stripe_customer_id = $7
          AND installment_cents = $8 AND installment_count = $9
          AND first_charge_on = $10::date AND agreed_total_cents = $11
          AND prior_paid_cents = $12 AND carried_paid_cents = $13
        RETURNING ${PLAN_COLUMNS}`,
      [
        row.id,
        paymentMethodId,
        card?.brand ?? "",
        card?.last4 ?? "",
        authorizationText,
        input.ip.slice(0, 100),
        row.stripe_customer_id,
        row.installment_cents,
        row.installment_count,
        row.first_charge_on,
        row.agreed_total_cents,
        row.prior_paid_cents,
        row.carried_paid_cents,
      ],
    );
    if (!saved.rows[0]) {
      const latest = await findPlan(retreat.id, memberId);
      if (!latest || latest.status === "open" || latest.status === "draft" || latest.status === "canceled") {
        throw scheduleChanged();
      }
      row = latest; // a second tab confirmed first
    } else {
      row = saved.rows[0];
      savedNow = row;
      log(`plan ${row.id}: card saved and schedule authorised by member ${memberId}`);
    }
  }

  let charged = false;
  if (row.status === "card_on_file" && row.first_charge_on <= pacificToday()) {
    try {
      charged = (await startBalancePlanBilling(row.id, { source: "confirm" })).charged;
    } catch (err) {
      // Declined: the plan is open again with no card, so there is no "card on
      // file" to tell the owner about.
      if (err instanceof BalancePlanCardError) throw err;
      // Not the card's fault and not the guest's to fix: the card is saved and
      // the hourly job starts the plan. The view below says so truthfully.
      logError(`plan ${row.id}: could not start billing at confirm (the hourly job will retry)`, err);
    }
  }
  // After the charge attempt on purpose, so a declined first payment never
  // produces a "card on file" notice.
  if (savedNow) await notifyOwnerOfCard(savedNow, retreat, await memberFacts(memberId));
  return { balancePlan: await viewOrThrow(retreat, memberId), charged };
}

/* ──────────────────────────── starting billing ────────────────────────── */

/** A live subscription Stripe already holds for this plan that we never wrote down. */
async function findUnrecordedSubscription(row: BalancePlanRow): Promise<Stripe.Subscription | null> {
  if (!row.stripe_customer_id) return null;
  const mine: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const list = await stripe().subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const sub of list.data) {
      if (sub.metadata?.retreatBalancePlanId === String(row.id) && LIVE_SUBSCRIPTION_STATUSES.has(sub.status)) mine.push(sub);
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  if (mine.length === 0) return null;
  const recorded = await pool.query<{ stripe_subscription_id: string }>(
    `SELECT stripe_subscription_id FROM payment_plans WHERE stripe_subscription_id = ANY($1::text[])`,
    [mine.map((sub) => sub.id)],
  );
  const known = new Set(recorded.rows.map((r) => r.stripe_subscription_id));
  const unrecorded = mine.filter((sub) => !known.has(sub.id)).sort((a, b) => a.created - b.created);
  if (unrecorded.length === 0) return null;

  // More than one should be impossible (the claim plus this very check). If it
  // ever happens the guest is being billed twice, so the extras are stopped at
  // once and the owner is told to look.
  for (const extra of unrecorded.slice(1)) {
    try {
      await cancelSubscriptionIfLive(extra.id);
    } catch (err) {
      logError(`plan ${row.id}: could not cancel duplicate subscription ${extra.id}`, err);
    }
    await alertOwner(
      `Retreat balance plan ${row.id}: a duplicate subscription was stopped`,
      `Stripe held more than one live subscription for retreat balance plan ${row.id} (member ${row.member_id}). ` +
        `The extra one, ${extra.id}, was cancelled. Please check in Stripe whether it took a payment that needs refunding.`,
    );
  }
  return unrecorded[0];
}

async function alertOwner(subject: string, text: string): Promise<void> {
  try {
    const to = await notificationRecipients("alert");
    if (to) await sendMail({ to, subject, text, topic: "retreat_balance_alert" });
  } catch (err) {
    logError("owner alert failed", err);
  }
}

async function createSubscription(row: BalancePlanRow, retreatTitle: string): Promise<Stripe.Subscription> {
  if (!row.stripe_customer_id || !row.stripe_payment_method_id) throw new Error("No card on file");
  const product = await ensureBalanceProduct();
  // Same rule as the checkout (routes/public/checkoutOffer.ts): the
  // subscription stops itself one interval after the final instalment, so the
  // charge after the last one is never raised. A 1-payment plan gets the same
  // treatment: it ends one month after its only charge.
  const cancelAt = addInterval(new Date(), "month", row.installment_count);
  const params: Stripe.SubscriptionCreateParams = {
    customer: row.stripe_customer_id,
    default_payment_method: row.stripe_payment_method_id,
    off_session: true,
    payment_behavior: "error_if_incomplete",
    items: [
      {
        price_data: {
          currency: row.currency,
          product,
          unit_amount: row.installment_cents,
          recurring: { interval: "month" },
        },
      },
    ],
    cancel_at: Math.floor(cancelAt.getTime() / 1000),
    description: `${retreatTitle}: balance payments`.slice(0, 500),
    metadata: {
      pricingType: "payment_plan",
      retreatBalancePlanId: String(row.id),
      memberId: String(row.member_id),
    },
  };
  return stripe().subscriptions.create(params, {
    idempotencyKey: `retreat-balance-start-${row.id}-${row.billing_attempts}`,
  });
}

/** Mirrors the subscription as a payment plan with its instalments. Safe to repeat. */
async function recordSubscription(row: BalancePlanRow, sub: Stripe.Subscription, email: string): Promise<number> {
  const startAt = new Date((sub.start_date ?? sub.created) * 1000);
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO payment_plans
         (order_id, offer_id, member_id, email, installment_cents, installment_count,
          installments_paid, currency, interval, interval_count, status, next_charge_at,
          stripe_customer_id, stripe_subscription_id, retreat_balance_plan_id)
       VALUES (NULL, NULL, $1, $2, $3, $4, 0, $5, 'month', 1, 'active', $6, $7, $8, $9)
       ON CONFLICT (stripe_subscription_id) DO NOTHING
       RETURNING id`,
      [
        row.member_id,
        email,
        row.installment_cents,
        row.installment_count,
        row.currency,
        startAt,
        row.stripe_customer_id,
        sub.id,
        row.id,
      ],
    );
    let planId = inserted.rows[0]?.id;
    if (planId === undefined) {
      const existing = await client.query<{ id: number; retreat_balance_plan_id: number | null }>(
        `SELECT id, retreat_balance_plan_id FROM payment_plans WHERE stripe_subscription_id = $1`,
        [sub.id],
      );
      if (existing.rows[0]?.retreat_balance_plan_id !== row.id) {
        throw new Error(`Subscription ${sub.id} is already recorded against a different plan`);
      }
      planId = existing.rows[0].id;
    }
    for (let n = 1; n <= row.installment_count; n += 1) {
      await client.query(
        `INSERT INTO payment_plan_installments (payment_plan_id, sequence, amount_cents, due_at, status)
         VALUES ($1, $2, $3, $4, 'scheduled')
         ON CONFLICT (payment_plan_id, sequence) DO NOTHING`,
        [planId, n, row.installment_cents, addInterval(startAt, "month", n - 1)],
      );
    }
    await client.query("COMMIT");
    return planId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function invoicePaymentIntentId(invoiceId: string): Promise<string | null> {
  const payments = await stripe().invoicePayments.list({ invoice: invoiceId, status: "paid", limit: 100 });
  for (const payment of payments.data) {
    const intentId = idOf(payment.payment?.payment_intent);
    if (intentId) return intentId;
  }
  return null;
}

/**
 * Credits every paid invoice of the subscription that the plan has not been
 * credited for yet.
 *
 * `invoice.paid` can reach the webhook before the payment_plans row exists; the
 * webhook then records the money but finds no plan to advance. This closes that
 * gap. `advancePaymentPlan` is idempotent on the invoice id, so the webhook and
 * this may both run, in either order, and one instalment is credited once.
 */
async function reconcilePaidInvoices(row: BalancePlanRow, paymentPlanId: number, stripeSubscriptionId: string): Promise<void> {
  const invoices = await stripe().invoices.list({ subscription: stripeSubscriptionId, status: "paid", limit: 100 });
  const paid = invoices.data
    .filter((invoice) => typeof invoice.id === "string" && invoice.amount_paid > 0)
    .sort((a, b) => a.created - b.created);
  if (paid.length === 0) return;

  // Lazy on purpose: the webhook module must never be a static dependency of
  // this one (it calls back into `onLinkedPlanCompleted`).
  const { advancePaymentPlan } = await import("../routes/public/stripeWebhook");
  const invoiceIds: string[] = [];
  const intentIds: string[] = [];
  for (const invoice of paid) {
    const invoiceId = invoice.id as string;
    invoiceIds.push(invoiceId);
    const already = await pool.query(`SELECT 1 FROM payment_plan_installments WHERE stripe_invoice_id = $1`, [invoiceId]);
    if (already.rows.length > 0) continue;
    const intentId = await invoicePaymentIntentId(invoiceId).catch(() => null);
    if (intentId) intentIds.push(intentId);
    const transaction = intentId
      ? await pool.query<{ id: number }>(`SELECT id FROM transactions WHERE stripe_payment_intent_id = $1 ORDER BY id LIMIT 1`, [intentId])
      : { rows: [] as { id: number }[] };
    const paidAtUnix = invoice.status_transitions?.paid_at ?? invoice.created;
    await advancePaymentPlan({
      stripeSubscriptionId,
      stripeInvoiceId: invoiceId,
      transactionId: transaction.rows[0]?.id ?? null,
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      paidAt: new Date(paidAtUnix * 1000),
    });
  }

  // What the webhook wrote before the plan existed has no plan and no member.
  await pool.query(
    `UPDATE invoices
        SET payment_plan_id = COALESCE(payment_plan_id, $2), member_id = COALESCE(member_id, $3)
      WHERE stripe_invoice_id = ANY($1::text[]) AND (payment_plan_id IS NULL OR member_id IS NULL)`,
    [invoiceIds, paymentPlanId, row.member_id],
  );
  if (intentIds.length > 0) {
    await pool.query(
      `UPDATE transactions SET member_id = $2
        WHERE stripe_payment_intent_id = ANY($1::text[]) AND member_id IS NULL`,
      [intentIds, row.member_id],
    );
  }
}

/** After a subscription exists at Stripe: write it down, credit what it has collected. */
async function settleSubscription(row: BalancePlanRow, sub: Stripe.Subscription, retreat: RetreatFacts | null): Promise<{ charged: boolean }> {
  const member = await memberFacts(row.member_id);
  const paymentPlanId = await recordSubscription(row, sub, member.email);
  log(`plan ${row.id}: subscription ${sub.id} recorded as payment plan ${paymentPlanId}`);

  try {
    await reconcilePaidInvoices(row, paymentPlanId, sub.id);
  } catch (err) {
    // The webhook credits the same invoices; the hourly job runs this again.
    logError(`plan ${row.id}: reconcile after start failed (webhook and hourly job will finish it)`, err);
  }

  const state = await pool.query<{ status: string; installments_paid: number }>(
    `SELECT status, installments_paid FROM payment_plans WHERE id = $1`,
    [paymentPlanId],
  );
  const plan = state.rows[0];
  if (plan?.status === "completed") await onLinkedPlanCompleted(paymentPlanId);

  // The owner cancelled while the subscription was being created. The payment
  // is recorded above; the subscription must not live on.
  const latest = await findPlanById(row.id);
  if (latest && latest.status === "canceled") {
    try {
      await cancelSubscriptionIfLive(sub.id);
    } catch (err) {
      logError(`plan ${row.id}: cancelled by the owner mid-start but subscription ${sub.id} could not be cancelled`, err);
    }
    await alertOwner(
      `Retreat balance plan ${row.id} was cancelled while its first charge was running`,
      `The plan for member ${row.member_id}${retreat ? ` (${retreat.title})` : ""} was cancelled at the same moment its subscription ${sub.id} started. ` +
        `The subscription has been stopped. Please check in Stripe whether the first payment went through and needs refunding.`,
    );
  }
  return { charged: (plan?.installments_paid ?? 0) > 0 || sub.status === "active" };
}

/** Returns a plan whose card failed to `open`, clears the card, and (job only) tells the guest. */
async function reopenForCardProblem(
  row: BalancePlanRow,
  problem: string,
  options: { emailGuest: boolean; retreat: RetreatFacts | null; fromStatus: "billing" },
): Promise<boolean> {
  const reverted = await pool.query(
    `UPDATE retreat_balance_plans
        SET status = 'open',
            stripe_payment_method_id = NULL, card_brand = NULL, card_last4 = NULL,
            authorized_at = NULL, authorization_text = '', authorized_ip = '',
            card_added_at = NULL, billing_started_at = NULL, owner_notified_at = NULL,
            last_error = $2, updated_at = now()
      WHERE id = $1 AND status = $3
      RETURNING id`,
    [row.id, problem, options.fromStatus],
  );
  if (!reverted.rows[0]) return false;
  if (options.emailGuest) await emailGuestCardProblem(row, problem, options.retreat);
  return true;
}

async function emailGuestCardProblem(row: BalancePlanRow, problem: string, known: RetreatFacts | null): Promise<void> {
  try {
    const retreat = known ?? (await findRetreat(row.retreat_id));
    if (!retreat) return;
    const member = await memberFacts(row.member_id);
    if (!member.email) return;
    const supportEmail = supportEmailOf(retreat);
    const email = buildCardProblemEmail({
      firstName: member.firstName,
      retreatTitle: retreat.title,
      problem,
      url: paymentsUrl(retreat),
      supportEmail,
    });
    await sendStripeMail({
      to: member.email,
      ...email,
      ...(supportEmail ? { replyTo: supportEmail } : {}),
      topic: "retreat_balance_card_problem",
      memberId: row.member_id,
    });
  } catch (err) {
    logError(`plan ${row.id}: card problem email failed`, err);
  }
}

/**
 * Starts charging a plan. The ONE place a balance subscription is created,
 * used by the confirm request (first charge date already here) and the hourly
 * job.
 *
 *  1. Claim. Only a `card_on_file` plan with a recorded authorisation, a saved
 *     card and a first charge date that has arrived (Pacific) can be claimed,
 *     and only by one caller. No row means somebody else has it, or it is not
 *     due: nothing is charged.
 *  2. Adopt or create. If Stripe already holds a live subscription for this
 *     plan that was never written down (a crash or timeout last time), that one
 *     is used. Otherwise the subscription is created, off session, failing
 *     outright rather than leaving an incomplete subscription behind.
 *  3. Record it as a payment plan with its instalments.
 *  4. Credit what it has already collected (the webhook may have arrived first).
 *  5. A card failure returns the plan to `open` with a sentence for the guest;
 *     anything else returns it to `card_on_file` for the next hourly run.
 */
export async function startBalancePlanBilling(
  planId: number,
  options: { source: "confirm" | "job" } = { source: "job" },
): Promise<{ started: boolean; charged: boolean }> {
  if (!stripeEnabled()) return { started: false, charged: false };
  const claimed = await pool.query<BalancePlanRow>(
    `UPDATE retreat_balance_plans
        SET status = 'billing', billing_started_at = now(),
            billing_attempts = billing_attempts + 1, updated_at = now()
      WHERE id = $1 AND status = 'card_on_file' AND authorized_at IS NOT NULL
        AND stripe_payment_method_id IS NOT NULL AND stripe_customer_id IS NOT NULL
        AND first_charge_on <= $2::date
      RETURNING ${PLAN_COLUMNS}`,
    [planId, pacificToday()],
  );
  const row = claimed.rows[0];
  if (!row) return { started: false, charged: false };

  const retreat = await findRetreat(row.retreat_id);
  let sub: Stripe.Subscription;
  try {
    sub = (await findUnrecordedSubscription(row)) ?? (await createSubscription(row, retreat?.title ?? "Retreat"));
  } catch (err) {
    const failure = cardFailureOf(err);
    if (failure) {
      const problem = guestCardMessage(failure.code, failure.declineCode);
      logError(`plan ${row.id}: first charge failed (${failure.code || "card_error"}${failure.declineCode ? `/${failure.declineCode}` : ""})`, err);
      await reopenForCardProblem(row, problem, { emailGuest: options.source === "job", retreat, fromStatus: "billing" });
      throw new BalancePlanCardError(problem);
    }
    await pool.query(
      `UPDATE retreat_balance_plans SET status = 'card_on_file', billing_started_at = NULL, updated_at = now()
        WHERE id = $1 AND status = 'billing'`,
      [row.id],
    );
    logError(`plan ${row.id}: could not start billing (attempt ${row.billing_attempts}); left on file for the next run`, err);
    // A request Stripe refused outright will be refused again next hour, so the
    // owner hears about it: at once, and then once a day while it lasts.
    if ((err as StripeErrorLike).type === "StripeInvalidRequestError" && (row.billing_attempts === 1 || row.billing_attempts % 24 === 0)) {
      await alertOwner(
        `Retreat balance plan ${row.id} could not start billing`,
        `Stripe refused to start the payments for retreat balance plan ${row.id} (member ${row.member_id}). ` +
          `Nothing was charged. It will be tried again every hour. Stripe said: ${String((err as StripeErrorLike).message ?? "").slice(0, 300)}`,
      );
    }
    throw err;
  }

  // From here a subscription exists. Nothing below reverts the claim: a failure
  // leaves the plan `billing` with no payment plan, which the hourly job
  // repairs by adopting this same subscription.
  const settled = await settleSubscription(row, sub, retreat);
  return { started: true, charged: settled.charged };
}

/* ───────────────────────────────── sync ───────────────────────────────── */

/**
 * Brings a `billing` plan in step with its subscription:
 *   - the payment plan completed          -> `completed` (subscription cancelled first)
 *   - Stripe gave up with money still owed -> back to `open` with the unpaid
 *     count, the card cleared and a sentence for the guest, so she can add a
 *     card again. The old subscription is confirmed dead BEFORE that happens,
 *     so it can never charge alongside the next one.
 * Returns the same object when nothing changed.
 */
async function syncBalancePlan(row: BalancePlanRow, linked: LinkedPlan[], known: RetreatFacts | null = null): Promise<BalancePlanRow> {
  if (row.status !== "billing") return row;
  const current = currentLinkedPlan(row, linked);
  if (!current) return row;

  const finished = current.status === "completed" || (current.status === "canceled" && outstandingCents(current) <= 0);
  if (finished) {
    await endFinishedSubscription(row.id, current.stripe_subscription_id);
    const done = await pool.query<BalancePlanRow>(
      `UPDATE retreat_balance_plans SET status = 'completed', last_error = '', updated_at = now()
        WHERE id = $1 AND status = 'billing'
        RETURNING ${PLAN_COLUMNS}`,
      [row.id],
    );
    return done.rows[0] ?? (await findPlanById(row.id)) ?? row;
  }

  if (current.status !== "canceled") return row;

  if (current.stripe_subscription_id) {
    if (!stripeEnabled()) return row;
    try {
      await closeOutSubscription(current.stripe_subscription_id);
    } catch (err) {
      logError(`plan ${row.id}: could not confirm the old subscription is cancelled and its invoices voided; not reopening yet`, err);
      return row;
    }
    // A payment that landed on the old invoice a moment before it was voided
    // has been credited by the webhook since `linked` was read.
    linked = await loadLinkedFor(row.id);
    const again = currentLinkedPlan(row, linked);
    if (!again || again.status !== "canceled") return row;
  }

  const paidHere = paidHereCents(linked);
  const remaining = row.agreed_total_cents - row.prior_paid_cents - paidHere;
  if (remaining <= 0) {
    const done = await pool.query<BalancePlanRow>(
      `UPDATE retreat_balance_plans SET status = 'completed', last_error = '', updated_at = now()
        WHERE id = $1 AND status = 'billing'
        RETURNING ${PLAN_COLUMNS}`,
      [row.id],
    );
    return done.rows[0] ?? row;
  }
  // Every instalment is the same amount, so what is left always divides. If a
  // record was ever edited by hand so that it does not, the plan goes back to
  // the owner as a draft instead of being offered to the guest with odd numbers.
  const divides = remaining % row.installment_cents === 0 && remaining / row.installment_cents <= 36;
  const problem = "We could not charge your card and the payments stopped. Please add a card again to continue.";
  const reopened = await pool.query<BalancePlanRow>(
    `UPDATE retreat_balance_plans
        SET status = $2, installment_cents = $3, installment_count = $4, carried_paid_cents = $5,
            stripe_payment_method_id = NULL, card_brand = NULL, card_last4 = NULL,
            authorized_at = NULL, authorization_text = '', authorized_ip = '',
            card_added_at = NULL, billing_started_at = NULL, owner_notified_at = NULL,
            last_error = $6, updated_at = now()
      WHERE id = $1 AND status = 'billing'
      RETURNING ${PLAN_COLUMNS}`,
    [
      row.id,
      divides ? "open" : "draft",
      divides ? row.installment_cents : remaining,
      divides ? remaining / row.installment_cents : 1,
      paidHere,
      problem,
    ],
  );
  const next = reopened.rows[0];
  if (!next) return (await findPlanById(row.id)) ?? row;
  log(`plan ${row.id}: subscription ended with ${remaining} still owed; ${divides ? "reopened for a new card" : "returned to draft for the owner"}`);
  if (divides) await emailGuestCardProblem(next, problem, known);
  return next;
}

/**
 * The hourly job (`retreat-balance-start`).
 *   a. sync every billing plan (completed / cancelled with debt);
 *   b. finish cancelling finished plans' subscriptions, and stop any
 *      subscription still alive under a plan the owner cancelled;
 *   c. repair a plan stuck `billing` with nothing recorded (a crash mid-start);
 *   d. start billing for `card_on_file` plans whose first charge date (Pacific)
 *      has arrived;
 *   e. link invoices and transactions the webhook wrote before the plan existed.
 * One plan's failure never stops the others.
 */
export async function runRetreatBalanceJob(now: Date = new Date()): Promise<{
  started: number;
  declined: number;
  failed: number;
  synced: number;
  repaired: number;
}> {
  const result = { started: 0, declined: 0, failed: 0, synced: 0, repaired: 0 };
  if (!stripeEnabled()) return result;

  // a.
  const billing = await pool.query<BalancePlanRow>(`SELECT ${PLAN_COLUMNS} FROM retreat_balance_plans WHERE status = 'billing' ORDER BY id`);
  const linkedByPlan = await loadLinkedPlans(billing.rows.map((row) => row.id));
  for (const row of billing.rows) {
    try {
      const linked = linkedByPlan.get(row.id) ?? [];
      const current = currentLinkedPlan(row, linked);
      if (current?.stripe_subscription_id && (current.status === "active" || current.status === "past_due")) {
        // A credit the webhook could not make (it arrived before the plan row).
        await reconcilePaidInvoices(row, current.id, current.stripe_subscription_id);
        const refreshed = await loadLinkedFor(row.id);
        if ((await syncBalancePlan(row, refreshed)) !== row) result.synced += 1;
      } else if ((await syncBalancePlan(row, linked)) !== row) {
        result.synced += 1;
      }
    } catch (err) {
      result.failed += 1;
      logError(`plan ${row.id}: hourly sync failed`, err);
    }
  }

  // b.
  const unfinished = await pool.query<{ id: number; stripe_subscription_id: string | null }>(
    `SELECT rbp.id, pp.stripe_subscription_id
       FROM retreat_balance_plans rbp
       JOIN LATERAL (
         SELECT p.stripe_subscription_id FROM payment_plans p
          WHERE p.retreat_balance_plan_id = rbp.id ORDER BY p.id DESC LIMIT 1
       ) pp ON true
      WHERE rbp.status = 'completed' AND rbp.subscription_ended_at IS NULL`,
  );
  for (const row of unfinished.rows) await endFinishedSubscription(row.id, row.stripe_subscription_id);

  const strays = await pool.query<{ id: number; stripe_subscription_id: string }>(
    `SELECT rbp.id, pp.stripe_subscription_id
       FROM retreat_balance_plans rbp
       JOIN payment_plans pp ON pp.retreat_balance_plan_id = rbp.id
      WHERE rbp.status = 'canceled' AND pp.status IN ('active', 'past_due') AND pp.stripe_subscription_id IS NOT NULL`,
  );
  for (const row of strays.rows) {
    try {
      await closeOutSubscription(row.stripe_subscription_id);
    } catch (err) {
      result.failed += 1;
      logError(`plan ${row.id}: cancelled plan still has subscription ${row.stripe_subscription_id}`, err);
    }
  }

  // c. Re-claimed first, so two workers cannot both repair the same plan.
  const stuck = await pool.query<BalancePlanRow>(
    `UPDATE retreat_balance_plans rbp
        SET billing_started_at = now(), updated_at = now()
      WHERE rbp.status = 'billing'
        AND rbp.billing_started_at < now() - interval '10 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM payment_plans pp
           WHERE pp.retreat_balance_plan_id = rbp.id AND pp.created_at >= rbp.authorized_at
        )
      RETURNING ${PLAN_COLUMNS}`,
  );
  for (const row of stuck.rows) {
    try {
      const existing = await findUnrecordedSubscription(row);
      if (existing) {
        await settleSubscription(row, existing, await findRetreat(row.retreat_id));
        log(`plan ${row.id}: adopted subscription ${existing.id} left unrecorded by an interrupted start`);
      } else {
        // Stripe holds nothing for this attempt, so nothing was charged: hand
        // the plan back to step d.
        await pool.query(
          `UPDATE retreat_balance_plans SET status = 'card_on_file', billing_started_at = NULL, updated_at = now()
            WHERE id = $1 AND status = 'billing'`,
          [row.id],
        );
      }
      result.repaired += 1;
    } catch (err) {
      result.failed += 1;
      logError(`plan ${row.id}: repair failed`, err);
    }
  }

  // d.
  const due = await pool.query<{ id: number }>(
    `SELECT id FROM retreat_balance_plans
      WHERE status = 'card_on_file' AND authorized_at IS NOT NULL AND first_charge_on <= $1::date
      ORDER BY id`,
    [pacificToday(now)],
  );
  for (const row of due.rows) {
    try {
      const outcome = await startBalancePlanBilling(row.id, { source: "job" });
      if (outcome.started) result.started += 1;
    } catch (err) {
      if (err instanceof BalancePlanCardError) result.declined += 1;
      else result.failed += 1;
    }
  }

  // e.
  await pool.query(
    `UPDATE invoices i
        SET payment_plan_id = COALESCE(i.payment_plan_id, pp.id), member_id = COALESCE(i.member_id, pp.member_id)
       FROM payment_plan_installments ppi
       JOIN payment_plans pp ON pp.id = ppi.payment_plan_id
      WHERE pp.retreat_balance_plan_id IS NOT NULL
        AND ppi.stripe_invoice_id = i.stripe_invoice_id
        AND (i.payment_plan_id IS NULL OR i.member_id IS NULL)`,
  );
  await pool.query(
    `UPDATE transactions t
        SET member_id = pp.member_id
       FROM payment_plan_installments ppi
       JOIN payment_plans pp ON pp.id = ppi.payment_plan_id
      WHERE pp.retreat_balance_plan_id IS NOT NULL
        AND ppi.transaction_id = t.id
        AND t.member_id IS NULL AND pp.member_id IS NOT NULL`,
  );

  return result;
}

/* ─────────────────── emails the Stripe webhook asks for ────────────────── */

/** A composed email with its recipient. Nothing here sends. */
export interface RetreatMail extends BalanceEmail {
  to: string;
  memberId: number;
  replyTo?: string;
}

/** What one payment looks like on its receipt, before any wording. */
interface ReceiptFacts {
  /** The linked payment plan the payment belongs to, when it is written down. */
  plan: LinkedPlan | null;
  sequence: number;
  amountCents: number;
  /** Whether `linked` already shows this payment as a paid instalment. */
  counted: boolean;
  paidAt: Date;
}

async function composeReceipt(row: BalancePlanRow, linked: LinkedPlan[], facts: ReceiptFacts): Promise<RetreatMail | null> {
  const retreat = await findRetreat(row.retreat_id);
  if (!retreat) return null;
  const member = await memberFacts(row.member_id);
  const paidHere = paidHereCents(linked) + (facts.counted ? 0 : facts.amountCents);
  const remaining = remainingOf(row, paidHere);
  const count = facts.plan && facts.plan.installments.length > 0 ? facts.plan.installments.length : row.installment_count;

  let next: { date: string; amountCents: number } | null = null;
  // Only a plan that is billing has a next charge: a cancelled, reopened or
  // completed balance plan has nothing scheduled, whatever its rows still say.
  if (remaining > 0 && row.status === "billing") {
    if (facts.plan) {
      // A cancelled plan keeps its unpaid rows as `scheduled`; only a live plan
      // will really charge them.
      if (facts.plan.status === "active" || facts.plan.status === "past_due") {
        const upcoming = facts.plan.installments.find((item) => item.sequence > facts.sequence && item.status !== "paid");
        if (upcoming?.due_at) next = { date: pacificDate(new Date(upcoming.due_at)), amountCents: upcoming.amount_cents };
      }
    } else if (facts.sequence < count) {
      // The opening invoice, before the plan is written down: Stripe bills the
      // next one a month after this one.
      next = { date: addMonthsToDate(pacificDate(facts.paidAt), 1), amountCents: row.installment_cents };
    }
  }

  const supportEmail = supportEmailOf(retreat);
  const email = buildBalanceReceiptEmail({
    firstName: member.firstName,
    retreatTitle: retreat.title,
    currency: row.currency,
    amountCents: facts.amountCents,
    sequence: facts.sequence,
    installmentCount: Math.max(count, facts.sequence),
    paidSoFarCents: row.prior_paid_cents + paidHere,
    remainingCents: remaining,
    next,
    card: cardLabel(row.card_brand, row.card_last4),
    url: paymentsUrl(retreat),
    supportEmail,
  });
  return { ...email, to: member.email, memberId: row.member_id, ...(supportEmail ? { replyTo: supportEmail } : {}) };
}

/**
 * The receipt for a balance payment the webhook has just recorded, or null when
 * this is not a balance plan's payment (the webhook then sends its own receipt).
 *
 * The webhook sends the receipt BEFORE it advances the plan, and the opening
 * invoice can arrive before the plan row exists at all, so the instalments may
 * or may not show this payment yet. The one fact that settles it is whether an
 * instalment already carries this invoice's id.
 */
export async function retreatReceiptMail(input: {
  retreatBalancePlanId: number;
  /** The payment_plans row the invoice belongs to, when it exists already. */
  paymentPlanId: number | null;
  stripeInvoiceId: string;
  stripeCustomerId: string | null;
  collectedCents: number;
  paidAt: Date;
}): Promise<RetreatMail | null> {
  const row = await findPlanById(input.retreatBalancePlanId);
  if (!row) return null;
  // The id comes from Stripe metadata this server wrote; the customer must
  // still be the one pinned on the plan.
  if (input.stripeCustomerId && row.stripe_customer_id && input.stripeCustomerId !== row.stripe_customer_id) return null;
  const linked = await loadLinkedFor(row.id);
  const credited = await pool.query<{ payment_plan_id: number; sequence: number }>(
    `SELECT payment_plan_id, sequence FROM payment_plan_installments WHERE stripe_invoice_id = $1 LIMIT 1`,
    [input.stripeInvoiceId],
  );
  const done = credited.rows[0];
  if (done) {
    const plan = linked.find((item) => item.id === done.payment_plan_id) ?? null;
    if (!plan) return null; // credited to a plan that is not this balance plan's
    return composeReceipt(row, linked, { plan, sequence: done.sequence, amountCents: input.collectedCents, counted: true, paidAt: input.paidAt });
  }
  const plan = input.paymentPlanId !== null ? (linked.find((item) => item.id === input.paymentPlanId) ?? null) : null;
  if (input.paymentPlanId !== null && !plan) return null;
  const paidBefore = plan ? plan.installments.filter((item) => item.status === "paid").length : 0;
  return composeReceipt(row, linked, { plan, sequence: paidBefore + 1, amountCents: input.collectedCents, counted: false, paidAt: input.paidAt });
}

/**
 * The receipt for the most recent paid instalment of a balance plan, exactly
 * as the webhook would word it today. Sends nothing: for a one-off script that
 * needs to send a receipt again. Works on a plan in any state (a cancelled
 * plan's receipt says no further payment is scheduled). Null when the plan
 * does not exist or has no paid instalment.
 */
export async function buildTestReceiptEmail(retreatBalancePlanId: number): Promise<RetreatMail | null> {
  const row = await findPlanById(retreatBalancePlanId);
  if (!row) return null;
  const linked = await loadLinkedFor(row.id);
  let latest: { plan: LinkedPlan; item: LinkedInstallment; at: number } | null = null;
  for (const plan of linked) {
    for (const item of plan.installments) {
      if (item.status !== "paid") continue;
      const at = new Date(item.paid_at ?? item.due_at ?? plan.created_at).getTime();
      if (latest === null || at >= latest.at) latest = { plan, item, at };
    }
  }
  if (latest === null) return null;
  return composeReceipt(row, linked, {
    plan: latest.plan,
    sequence: latest.item.sequence,
    amountCents: latest.item.amount_cents,
    counted: true,
    paidAt: new Date(latest.at),
  });
}

async function balancePlanOfPaymentPlan(paymentPlanId: number): Promise<BalancePlanRow | null> {
  const res = await pool.query<{ retreat_balance_plan_id: number | null }>(
    `SELECT retreat_balance_plan_id FROM payment_plans WHERE id = $1`,
    [paymentPlanId],
  );
  const id = res.rows[0]?.retreat_balance_plan_id ?? null;
  return id === null ? null : findPlanById(id);
}

/** The "paid in full" email for a completed payment plan, or null when it is not a balance plan's. */
export async function retreatCompletedMail(paymentPlanId: number): Promise<RetreatMail | null> {
  const row = await balancePlanOfPaymentPlan(paymentPlanId);
  if (!row) return null;
  const retreat = await findRetreat(row.retreat_id);
  if (!retreat) return null;
  const member = await memberFacts(row.member_id);
  const supportEmail = supportEmailOf(retreat);
  const email = buildBalanceCompletedEmail({
    firstName: member.firstName,
    retreatTitle: retreat.title,
    currency: row.currency,
    totalPaidCents: row.prior_paid_cents + paidHereCents(await loadLinkedFor(row.id)),
    url: dashboardUrl(retreat),
    supportEmail,
  });
  return { ...email, to: member.email, memberId: row.member_id, ...(supportEmail ? { replyTo: supportEmail } : {}) };
}

/** The declined-instalment email for a payment plan, or null when it is not a balance plan's. */
export async function retreatPaymentFailedMail(input: {
  paymentPlanId: number;
  amountCents: number;
  currency: string;
  attempt: number;
  nextAttemptAt: Date | null;
}): Promise<RetreatMail | null> {
  const row = await balancePlanOfPaymentPlan(input.paymentPlanId);
  if (!row) return null;
  const retreat = await findRetreat(row.retreat_id);
  if (!retreat) return null;
  const member = await memberFacts(row.member_id);
  const supportEmail = supportEmailOf(retreat);
  const email = buildBalancePaymentFailedEmail({
    firstName: member.firstName,
    retreatTitle: retreat.title,
    currency: input.currency,
    amountCents: input.amountCents,
    attempt: input.attempt,
    nextAttemptDate: input.nextAttemptAt ? pacificDate(input.nextAttemptAt) : null,
    url: `${siteUrl()}/account/billing`,
    supportEmail,
  });
  return { ...email, to: member.email, memberId: row.member_id, ...(supportEmail ? { replyTo: supportEmail } : {}) };
}

/**
 * A refund Stripe reports on a charge whose ledger row has no order. When that
 * row is a retreat balance payment, the refund is written to `refunds` and the
 * ledger the way an order's refund is (services/fulfillment.ts `recordRefund`,
 * minus everything that touches an order), and the owner is told.
 *
 * Deliberately NOT touched: the instalment, the payment plan and the balance
 * plan. The guest's dashboard still shows the payment as made; what happens to
 * her schedule is the owner's decision.
 *
 * Returns whether the charge was a balance payment. Never throws.
 */
export async function onBalancePaymentRefunded(input: {
  transactionId: number;
  chargeId: string;
  chargeAmountCents: number;
  amountRefundedCents: number;
  currency: string;
  /** Stripe's itemised refunds on the charge; may be empty. */
  refunds: { id: string; amountCents: number; currency: string; reason: string }[];
}): Promise<boolean> {
  let owned: { retreat_balance_plan_id: number; member_id: number | null; email: string } | undefined;
  try {
    const found = await pool.query<{ retreat_balance_plan_id: number; member_id: number | null; email: string }>(
      `SELECT pp.retreat_balance_plan_id, pp.member_id, pp.email
         FROM payment_plan_installments i
         JOIN payment_plans pp ON pp.id = i.payment_plan_id
        WHERE i.transaction_id = $1 AND pp.retreat_balance_plan_id IS NOT NULL
        LIMIT 1`,
      [input.transactionId],
    );
    owned = found.rows[0];
  } catch (err) {
    logError(`charge ${input.chargeId}: could not look up the refunded payment`, err);
    return false;
  }
  if (!owned) return false;

  let recordedCents = 0;
  let ledgerFailed = false;
  try {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      let entries = input.refunds.map((refund) => ({
        key: refund.id,
        amountCents: refund.amountCents,
        currency: refund.currency || input.currency,
        reason: refund.reason,
      }));
      if (entries.length === 0 && input.amountRefundedCents > 0) {
        // Stripe did not itemise: record what the charge's running total says
        // is not written down yet, under the same key the order path uses.
        const already = await client.query<{ cents: number }>(
          `SELECT COALESCE(SUM(amount_cents), 0)::int AS cents FROM refunds WHERE transaction_id = $1`,
          [input.transactionId],
        );
        const outstanding = input.amountRefundedCents - (already.rows[0]?.cents ?? 0);
        if (outstanding > 0) {
          entries = [{ key: `${input.chargeId}:refunded:${input.amountRefundedCents}`, amountCents: outstanding, currency: input.currency, reason: "" }];
        }
      }
      for (const entry of entries) {
        // The unique Stripe refund id makes a second delivery a no-op.
        const inserted = await client.query<{ id: number }>(
          `INSERT INTO refunds
             (order_id, transaction_id, amount_cents, currency, reason, revoked_access, stripe_refund_id, created_by_email)
           VALUES (NULL, $1, $2, $3, $4, false, $5, 'stripe')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [input.transactionId, entry.amountCents, entry.currency, entry.reason.slice(0, 500), entry.key],
        );
        if (!inserted.rows[0]) continue;
        await client.query(
          `INSERT INTO transactions
             (order_id, member_id, email, kind, status, amount_cents, currency, occurred_at)
           VALUES (NULL, $1, $2, 'refund', 'succeeded', $3, $4, now())`,
          [owned.member_id, owned.email, entry.amountCents, entry.currency],
        );
        recordedCents += entry.amountCents;
      }
      if (input.amountRefundedCents >= input.chargeAmountCents) {
        await client.query(`UPDATE transactions SET status = 'refunded' WHERE id = $1 AND kind = 'payment'`, [input.transactionId]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    ledgerFailed = true;
    recordedCents = 0;
    logError(`charge ${input.chargeId}: refund of a balance payment could not be recorded`, err);
  }

  // Only for a refund seen for the first time, so a redelivery stays quiet.
  if (recordedCents <= 0 && !ledgerFailed) return true;
  try {
    const row = await findPlanById(owned.retreat_balance_plan_id);
    const retreat = row ? await findRetreat(row.retreat_id) : null;
    const member = owned.member_id !== null ? await memberFacts(owned.member_id) : { email: owned.email, name: "", firstName: "" };
    const note = buildRefundOwnerNote({
      guestName: member.name,
      guestEmail: member.email || owned.email,
      retreatTitle: retreat?.title ?? "a retreat",
      currency: input.currency,
      refundedCents: ledgerFailed ? input.amountRefundedCents : recordedCents,
      chargeId: input.chargeId,
      recorded: !ledgerFailed,
      isTest: row?.is_test ?? false,
    });
    await alertOwner(note.subject, note.text);
    log(`plan ${owned.retreat_balance_plan_id}: charge ${input.chargeId} refunded; ${ledgerFailed ? "NOT recorded" : `recorded ${recordedCents}`}, owner told, schedule untouched`);
  } catch (err) {
    logError(`charge ${input.chargeId}: owner note about the refund failed`, err);
  }
  return true;
}

/* ──────────────────────────────── admin ───────────────────────────────── */

const GUEST_MISSING = "We couldn't find a balance plan for that guest.";

/** A member the organizer can see on this retreat (same rule as the Guests list). */
async function isRetreatPerson(retreat: Pick<RetreatRow, "id" | "product_id" | "booking_product_id">, memberId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1
       FROM members m
      WHERE m.id = $4 AND m.status <> 'deleted'
        AND (
          EXISTS (SELECT 1 FROM access_grants g
                   WHERE g.member_id = m.id AND g.product_id IN ($1, $2) AND g.status = 'active'
                     AND (g.expires_at IS NULL OR g.expires_at > now()))
          OR EXISTS (SELECT 1 FROM retreat_guests rg
                      WHERE rg.retreat_id = $3 AND rg.member_id = m.id AND rg.access_granted_at IS NOT NULL)
        )`,
    [retreat.product_id ?? -1, retreat.booking_product_id ?? -1, retreat.id, memberId],
  );
  return res.rows.length > 0;
}

async function adminPlanJson(row: BalancePlanRow): Promise<AdminBalancePlan> {
  const [linked, member] = await Promise.all([loadLinkedFor(row.id), memberFacts(row.member_id)]);
  return adminJson(row, linked, member, pacificToday());
}

/** Every balance plan on a retreat, each synced with its subscription first. */
export async function listAdminBalancePlans(retreat: RetreatRow): Promise<AdminBalancePlan[]> {
  const res = await pool.query<BalancePlanRow & { member_name: string; member_email: string }>(
    `SELECT ${PLAN_COLUMNS.split(",").map((column) => `rbp.${column.trim()}`).join(", ")},
            COALESCE(NULLIF(TRIM(m.name), ''), TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, ''))) AS member_name,
            m.email::text AS member_email
       FROM retreat_balance_plans rbp
       JOIN members m ON m.id = rbp.member_id
      WHERE rbp.retreat_id = $1
      ORDER BY member_name, rbp.id`,
    [retreat.id],
  );
  const today = pacificToday();
  let linkedByPlan = await loadLinkedPlans(res.rows.map((row) => row.id));
  const plans: AdminBalancePlan[] = [];
  for (const found of res.rows) {
    let row: BalancePlanRow = found;
    if (row.status === "billing") {
      try {
        const synced = await syncBalancePlan(row, linkedByPlan.get(row.id) ?? [], retreat);
        if (synced !== row) {
          row = synced;
          linkedByPlan = new Map(linkedByPlan).set(row.id, await loadLinkedFor(row.id));
        }
      } catch (err) {
        logError(`plan ${row.id}: sync on admin list failed`, err);
      }
    }
    plans.push(adminJson(row, linkedByPlan.get(row.id) ?? [], { name: found.member_name, email: found.member_email }, today));
  }
  return plans;
}

/**
 * Creates the plan for a guest or changes its numbers. Only while no card is
 * involved: `draft` or `open` (and a cancelled plan with nothing still billing,
 * which goes back to `draft`). The row is locked for the decision.
 */
export async function upsertBalancePlan(retreat: RetreatRow, memberId: number, raw: unknown): Promise<AdminBalancePlan> {
  if (!(await isRetreatPerson(retreat, memberId))) {
    throw badRequest("That person is not a guest of this retreat. Give her dashboard access first.");
  }
  const client: PoolClient = await pool.connect();
  let saved: BalancePlanRow;
  try {
    await client.query("BEGIN");
    const existing = await client.query<BalancePlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM retreat_balance_plans WHERE retreat_id = $1 AND member_id = $2 FOR UPDATE`,
      [retreat.id, memberId],
    );
    const current = existing.rows[0] ?? null;
    if (current && current.status !== "draft" && current.status !== "open" && current.status !== "canceled") {
      throw badRequest(
        current.status === "completed"
          ? "This plan is paid in full, so its numbers can't be changed."
          : "This guest has already saved a card for this plan, so its numbers can't be changed. Cancel the plan first if it needs to change.",
      );
    }
    let carried = current?.carried_paid_cents ?? 0;
    if (current?.status === "canceled") {
      const live = await client.query(
        `SELECT 1 FROM payment_plans WHERE retreat_balance_plan_id = $1 AND status IN ('active', 'past_due') LIMIT 1`,
        [current.id],
      );
      if (live.rows.length > 0) {
        throw badRequest("The cancelled plan's subscription has not finished closing at Stripe yet. Please try again in a few minutes.");
      }
      const paid = await client.query<{ cents: number }>(
        `SELECT COALESCE(SUM(i.amount_cents), 0)::int AS cents
           FROM payment_plan_installments i
           JOIN payment_plans pp ON pp.id = i.payment_plan_id
          WHERE pp.retreat_balance_plan_id = $1 AND i.status = 'paid'`,
        [current.id],
      );
      carried = paid.rows[0]?.cents ?? 0;
    }
    const checked = validatePlanInput(raw, { carriedPaidCents: carried, today: pacificToday(), currency: current?.currency ?? "usd" });
    if (!checked.ok) throw badRequest(checked.error);
    const v = checked.value;

    if (current) {
      const updated = await client.query<BalancePlanRow>(
        `UPDATE retreat_balance_plans
            SET agreed_total_cents = $2, discount_cents = $3, discount_note = $4, prior_paid_cents = $5,
                installment_cents = $6, installment_count = $7, first_charge_on = $8::date,
                final_due_on = $9::date, is_test = $10, carried_paid_cents = $11,
                status = CASE WHEN status = 'canceled' THEN 'draft' ELSE status END,
                stripe_payment_method_id = NULL, card_brand = NULL, card_last4 = NULL,
                authorized_at = NULL, authorization_text = '', authorized_ip = '',
                card_added_at = NULL, billing_started_at = NULL,
                -- A cancelled plan set up again must tell the owner about its new card.
                owner_notified_at = NULL,
                updated_at = now()
          WHERE id = $1
          RETURNING ${PLAN_COLUMNS}`,
        [current.id, v.agreedTotalCents, v.discountCents, v.discountNote, v.priorPaidCents, v.installmentCents, v.installmentCount, v.firstChargeOn, v.finalDueOn, v.isTest, carried],
      );
      saved = updated.rows[0];
    } else {
      const inserted = await client.query<BalancePlanRow>(
        `INSERT INTO retreat_balance_plans
           (retreat_id, member_id, agreed_total_cents, discount_cents, discount_note, prior_paid_cents,
            installment_cents, installment_count, first_charge_on, final_due_on, is_test)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11)
         RETURNING ${PLAN_COLUMNS}`,
        [retreat.id, memberId, v.agreedTotalCents, v.discountCents, v.discountNote, v.priorPaidCents, v.installmentCents, v.installmentCount, v.firstChargeOn, v.finalDueOn, v.isTest],
      );
      saved = inserted.rows[0];
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return adminPlanJson(saved);
}

async function requirePlan(retreat: RetreatRow, memberId: number): Promise<BalancePlanRow> {
  const row = await findPlan(retreat.id, memberId);
  if (!row) throw notFound(GUEST_MISSING);
  return row;
}

async function moveStatus(row: BalancePlanRow, from: BalancePlanStatus, to: BalancePlanStatus, refusal: string): Promise<AdminBalancePlan> {
  const moved = await pool.query<BalancePlanRow>(
    `UPDATE retreat_balance_plans SET status = $3, updated_at = now()
      WHERE id = $1 AND status = $2
      RETURNING ${PLAN_COLUMNS}`,
    [row.id, from, to],
  );
  if (!moved.rows[0]) throw badRequest(refusal);
  return adminPlanJson(moved.rows[0]);
}

/** draft -> open: from here the guest sees the plan and can add her card. */
export async function openBalancePlan(retreat: RetreatRow, memberId: number): Promise<AdminBalancePlan> {
  const row = await requirePlan(retreat, memberId);
  if (row.status === "open") return adminPlanJson(row);
  const checked = validatePlanInput(
    {
      agreedTotalCents: row.agreed_total_cents,
      discountCents: row.discount_cents,
      discountNote: row.discount_note,
      priorPaidCents: row.prior_paid_cents,
      installmentCents: row.installment_cents,
      installmentCount: row.installment_count,
      firstChargeOn: row.first_charge_on,
      finalDueOn: row.final_due_on,
      isTest: row.is_test,
    },
    { carriedPaidCents: row.carried_paid_cents, today: pacificToday(), currency: row.currency },
  );
  // Dates move on: a draft saved last month can now end after its due date.
  if (!checked.ok) throw badRequest(checked.error);
  return moveStatus(row, "draft", "open", "Only a draft plan can be opened.");
}

/** open -> draft: the guest no longer sees it. Refused once a card is saved. */
export async function closeBalancePlan(retreat: RetreatRow, memberId: number): Promise<AdminBalancePlan> {
  const row = await requirePlan(retreat, memberId);
  if (row.status === "draft") return adminPlanJson(row);
  return moveStatus(row, "open", "draft", "Only an open plan with no card saved can be closed. Cancel it instead.");
}

/**
 * Cancels a plan. Before billing that is only a status. While billing, the
 * plan is marked cancelled FIRST (so the sync cannot reopen it for a new card)
 * and then the subscription is cancelled at Stripe; the webhook closes the
 * linked payment plan. Safe to press again if Stripe could not be reached.
 */
export async function cancelBalancePlan(retreat: RetreatRow, memberId: number): Promise<AdminBalancePlan> {
  const row = await requirePlan(retreat, memberId);
  if (row.status === "completed") throw badRequest("This plan is paid in full. There is nothing left to cancel.");
  const wasBilling = row.status === "billing" || row.status === "canceled";
  if (row.status !== "canceled") {
    const cancelled = await pool.query(
      `UPDATE retreat_balance_plans SET status = 'canceled', updated_at = now()
        WHERE id = $1 AND status = $2
        RETURNING id`,
      [row.id, row.status],
    );
    if (!cancelled.rows[0]) throw conflict("This plan changed a moment ago. Please refresh and try again.");
  }

  if (wasBilling || row.stripe_customer_id) {
    const linked = await loadLinkedFor(row.id);
    const live = linked.filter((plan) => plan.stripe_subscription_id && (plan.status === "active" || plan.status === "past_due"));
    const everBilled = linked.filter((plan) => plan.stripe_subscription_id);
    if (everBilled.length > 0 || wasBilling || row.billing_attempts > 0) {
      if (!stripeEnabled()) throw serviceUnavailable("The plan is cancelled here, but Stripe could not be reached to stop the payments. Please press Cancel again shortly.");
      try {
        // Live ones are cancelled; every one has its unpaid invoices voided, so
        // nothing of this plan can be paid after the owner has cancelled it.
        for (const plan of everBilled) {
          if (live.includes(plan) || plan.status === "canceled") await closeOutSubscription(plan.stripe_subscription_id as string);
        }
        // A start interrupted before it was written down.
        const stray = await findUnrecordedSubscription(row);
        if (stray) await closeOutSubscription(stray.id);
      } catch (err) {
        logError(`plan ${row.id}: cancelled here but the Stripe subscription could not be cancelled`, err);
        throw serviceUnavailable("The plan is cancelled here, but Stripe could not be reached to stop the payments. Please press Cancel again shortly.");
      }
    }
  }
  const latest = (await findPlanById(row.id)) ?? row;
  return adminPlanJson(latest);
}

interface RequestEmailContext {
  row: BalancePlanRow;
  member: MemberFacts;
  email: BalanceEmail;
  supportEmail: string;
}

async function requestEmailContext(retreat: RetreatRow, memberId: number): Promise<RequestEmailContext> {
  const row = await requirePlan(retreat, memberId);
  const [linked, member] = await Promise.all([loadLinkedFor(row.id), memberFacts(memberId)]);
  const paidHere = paidHereCents(linked);
  const today = pacificToday();
  const supportEmail = supportEmailOf(retreat);
  const email = buildRequestEmail({
    firstName: member.firstName,
    retreatTitle: retreat.title,
    currency: row.currency,
    agreedTotalCents: row.agreed_total_cents,
    paidSoFarCents: row.prior_paid_cents + paidHere,
    remainingCents: remainingOf(row, paidHere),
    installmentCents: row.installment_cents,
    installmentCount: row.installment_count,
    firstChargeDate: effectiveFirstCharge(row.first_charge_on, today),
    chargesWhenAdded: row.first_charge_on <= today,
    url: paymentsUrl(retreat),
    supportEmail,
  });
  return { row, member, email, supportEmail };
}

/** Why the "add your card" email can't go yet (empty = it can). */
async function requestEmailBlockers(retreat: RetreatRow, context: RequestEmailContext): Promise<string[]> {
  const blockers: string[] = [];
  if (context.row.status !== "open") blockers.push("Open the plan first. The email is only sent while the plan is open and waiting for a card.");
  if (!retreat.published) blockers.push("Publish the retreat dashboard first, or the link will not open for her.");
  const grant = await pool.query(
    `SELECT 1 FROM access_grants WHERE member_id = $1 AND product_id = $2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > now())`,
    [context.row.member_id, retreat.product_id ?? -1],
  );
  if (grant.rows.length === 0) blockers.push("Give her dashboard access first.");
  if (!context.member.email) blockers.push("Her account has no email address.");
  return blockers;
}

/** The "add your card" email exactly as it would be sent. Sends nothing. */
export async function previewRequestEmail(retreat: RetreatRow, memberId: number) {
  const context = await requestEmailContext(retreat, memberId);
  return {
    ...context.email,
    to: context.member.email,
    replyTo: context.supportEmail,
    blockers: await requestEmailBlockers(retreat, context),
  };
}

/** Sends the "add your card" email. Only on the owner's explicit action, only while `open`. */
export async function sendRequestEmail(retreat: RetreatRow, memberId: number): Promise<{ sent: true; plan: AdminBalancePlan }> {
  const context = await requestEmailContext(retreat, memberId);
  const blockers = await requestEmailBlockers(retreat, context);
  if (blockers.length > 0) throw badRequest(blockers.join(" "));
  const outcome = await sendMail({
    to: context.member.email,
    ...context.email,
    ...(context.supportEmail ? { replyTo: context.supportEmail } : {}),
    topic: "retreat_balance_request",
    memberId,
  });
  // A failed send must not look like a sent one: the organizer's screen treats
  // any 2xx as "done". The transport's own words stay in the server log.
  if (!outcome.sent) {
    logError(`plan ${context.row.id}: the add-your-card email was not sent`, outcome.error);
    throw serviceUnavailable("The email could not be sent. Nothing was sent to the guest. Please try again in a few minutes.");
  }
  const stamped = await pool.query<BalancePlanRow>(
    `UPDATE retreat_balance_plans SET request_email_sent_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING ${PLAN_COLUMNS}`,
    [context.row.id],
  );
  return { sent: true, plan: await adminPlanJson(stamped.rows[0] ?? context.row) };
}

/**
 * For the guest routes: a card problem becomes the 402 the page expects, with a
 * sentence of ours. That includes a Stripe card error from anywhere else in the
 * request, which the app's error handler would otherwise answer with Stripe's
 * own message. Everything else passes through (the handler answers other Stripe
 * failures with its generic "payments are temporarily unavailable").
 */
export function asHttpError(err: unknown): unknown {
  if (err instanceof BalancePlanCardError) return new HttpError(402, err.message);
  if (err instanceof HttpError) return err;
  const failure = cardFailureOf(err);
  if (failure) {
    logError("card error outside the charge step", err);
    return new HttpError(402, guestCardMessage(failure.code, failure.declineCode));
  }
  return err;
}
