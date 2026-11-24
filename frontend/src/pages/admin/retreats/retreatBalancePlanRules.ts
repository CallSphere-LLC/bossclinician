import type { AdminBalancePlan, BalancePlanInput, BalancePlanState } from "@/lib/retreatBalancePlansAdminApi";

/**
 * Pure rules for the admin payment-plan editor: reading dollar amounts, the
 * projected payment dates, and what has to be true before a plan can be saved.
 *
 * No React and no network in here, so every rule can be unit-tested. The server
 * enforces the same rules again (routes/admin/retreatBalancePlans.ts); these
 * exist so the owner sees the problem while she is still typing.
 */

/* ───────────────────────────────── money ───────────────────────────────── */

/**
 * $100,000. The same cap the server enforces (MAX_CENTS in
 * backend/src/services/retreatBalancePlans.ts); keep the two equal, or the
 * editor accepts an amount the save then refuses.
 */
export const MAX_AMOUNT_CENTS = 10_000_000;
export const MAX_INSTALLMENT_COUNT = 36;

const MONEY_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{0,2}))?$/;

/**
 * "1,500", "1500.00", "$1,500.5" → cents. Returns null for an empty box, a
 * negative number, more than two decimals or anything that is not an amount.
 * Works on the digits as text, so there is no floating-point rounding.
 */
export function parseDollarsToCents(input: string): number | null {
  const text = input.trim().replace(/^\$\s*/, "");
  if (text === "" || text === ".") return null;
  const match = MONEY_PATTERN.exec(text);
  if (!match) return null;
  const whole = (match[1] ?? "").replace(/,/g, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  if (whole === "" && (match[2] ?? "") === "") return null;
  const cents = Number(whole || "0") * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/** Why a dollar box cannot be read, as a sentence. "" when it is empty or fine. */
export function dollarInputProblem(input: string): string {
  const text = input.trim();
  if (text === "") return "";
  if (parseDollarsToCents(text) !== null) return "";
  const bare = text.replace(/^\$\s*/, "");
  if (/^[-−(]/.test(bare)) return "Enter an amount of 0 or more, without a minus sign.";
  const plain = bare.replace(/,/g, "");
  if (/^\d*\.\d{3,}$/.test(plain)) return "Use dollars and cents only, for example 1500.00.";
  if (/^\d+(\.\d{0,2})?$/.test(plain) && Number(plain) * 100 > MAX_AMOUNT_CENTS) return `That amount is too large. The most this box takes is ${formatMoney(MAX_AMOUNT_CENTS)}. Check for extra digits.`;
  return "Enter a dollar amount, for example 1,500 or 1500.00.";
}

/** Cents → the text shown in a dollar box: 150000 → "1,500.00". */
export function centsToDollarInput(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Cents → "$1,500.00". */
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "usd").toUpperCase() }).format(cents / 100);
}

/* ───────────────────────────────── dates ───────────────────────────────── */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Reads "YYYY-MM-DD" (a longer timestamp is cut to its date). Null unless it is a real calendar day. */
function parseIsoDate(value: string | null | undefined): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Ymd) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export function isIsoDate(value: string | null | undefined): boolean {
  return parseIsoDate(value) !== null && /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
}

/** Just the date part of a date or timestamp, or "" when there is none. */
export function isoDay(value: string | null | undefined): string {
  const parsed = parseIsoDate(value);
  return parsed ? toIso(parsed) : "";
}

/**
 * The same day of the month, `months` later, pulled back to the last day when
 * that month is shorter: Jan 31 + 1 month = Feb 28 (Feb 29 in a leap year).
 * Works on the calendar numbers only, so no time zone can shift the day.
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const from = parseIsoDate(isoDate);
  if (!from) return "";
  const index = from.year * 12 + (from.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return toIso({ year, month, day: Math.min(from.day, daysInMonth(year, month)) });
}

/** "2027-01-05" → "January 5, 2027". */
export function formatLongDate(isoDate: string | null | undefined): string {
  const d = parseIsoDate(isoDate);
  return d ? `${MONTHS[d.month - 1] ?? ""} ${d.day}, ${d.year}` : "";
}

/** "2027-01-05" → "Jan 5, 2027". */
export function formatShortDate(isoDate: string | null | undefined): string {
  const d = parseIsoDate(isoDate);
  return d ? `${(MONTHS[d.month - 1] ?? "").slice(0, 3)} ${d.day}, ${d.year}` : "";
}

/** Today's date where the charges run (Pacific time), as YYYY-MM-DD. */
export function todayInPacific(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* ─────────────────────────────── the schedule ──────────────────────────── */

export interface ProjectedPayment {
  sequence: number;
  amountCents: number;
  dueDate: string;
}

/**
 * One payment a month from the first charge date. Every date is counted from
 * the FIRST date, not from the one before it, so a plan that starts on the 31st
 * goes Jan 31, Feb 28, Mar 31 and does not drift to the 28th for good.
 */
export function projectSchedule(firstChargeOn: string, count: number, amountCents: number, stepUpCents = 0, stepUpCount = 0): ProjectedPayment[] {
  if (!isIsoDate(firstChargeOn) || !Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENT_COUNT) return [];
  const stepped = isSteppedPlan(count, stepUpCents, stepUpCount);
  return Array.from({ length: count }, (_, i) => ({
    sequence: i + 1,
    // The LAST `stepUpCount` payments are the larger ones.
    amountCents: stepped && i >= count - stepUpCount ? stepUpCents : amountCents,
    dueDate: addMonthsClamped(firstChargeOn, i),
  }));
}

/**
 * True when the last payments really are larger: a larger amount, for at least
 * one payment, with at least one regular payment before them. Anything else is
 * read as a plain plan of equal payments.
 */
export function isSteppedPlan(count: number, stepUpCents: number | null | undefined, stepUpCount: number | null | undefined): boolean {
  const cents = stepUpCents ?? 0;
  const last = stepUpCount ?? 0;
  return Number.isInteger(cents) && Number.isInteger(last) && cents > 0 && last > 0 && last < count;
}

/**
 * What the whole plan adds up to: regular x (count - N) + larger x N. With no
 * larger payments (N = 0) that is simply regular x count. This is the one
 * equation the balance is checked against, here and on the server.
 */
export function planTotalCents(count: number, installmentCents: number, stepUpCents = 0, stepUpCount = 0): number {
  if (!isSteppedPlan(count, stepUpCents, stepUpCount)) return installmentCents * count;
  return installmentCents * (count - stepUpCount) + stepUpCents * stepUpCount;
}

/**
 * How many monthly payments clear the balance exactly, or null when the balance
 * does not divide evenly (there is no odd final payment) or the answer is
 * outside 1 to 36.
 *
 * With larger last payments (`stepUpCount` of them at `stepUpCents`), it is the
 * total number of payments for which regular x (count - N) + larger x N equals
 * the balance, with at least one regular payment first.
 */
export function suggestInstallmentCount(balanceCents: number | null, installmentCents: number | null, stepUpCents = 0, stepUpCount = 0): number | null {
  if (balanceCents === null || installmentCents === null) return null;
  if (!Number.isInteger(balanceCents) || !Number.isInteger(installmentCents)) return null;
  if (balanceCents <= 0 || installmentCents <= 0) return null;
  if (stepUpCount > 0 || stepUpCents > 0) {
    if (!Number.isInteger(stepUpCents) || !Number.isInteger(stepUpCount)) return null;
    if (stepUpCount < 1 || stepUpCents <= installmentCents) return null;
    const regularPart = balanceCents - stepUpCents * stepUpCount;
    if (regularPart <= 0 || regularPart % installmentCents !== 0) return null;
    const total = regularPart / installmentCents + stepUpCount;
    return total <= MAX_INSTALLMENT_COUNT ? total : null;
  }
  if (balanceCents % installmentCents !== 0) return null;
  const count = balanceCents / installmentCents;
  return count >= 1 && count <= MAX_INSTALLMENT_COUNT ? count : null;
}

/* ───────────────────────────── fit to the deadline ─────────────────────── */

/** Whole days from one date to a later one (negative when `to` is earlier). Null unless both are real dates. */
export function daysBetween(fromIso: string, toIsoDate: string): number | null {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIsoDate);
  if (!from || !to) return null;
  const ms = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
  return Math.round(ms / 86_400_000);
}

/**
 * How many monthly payment dates, counted from `firstChargeOn`, fall on or
 * before the deadline. Never more than 36, the most a plan can have.
 */
export function countPaymentDatesByDeadline(firstChargeOn: string, finalDueOn: string): number {
  if (!isIsoDate(firstChargeOn) || !isIsoDate(finalDueOn)) return 0;
  let count = 0;
  while (count < MAX_INSTALLMENT_COUNT && addMonthsClamped(firstChargeOn, count) <= finalDueOn) count += 1;
  return count;
}

export interface DeadlineFitInput {
  balanceCents: number | null;
  /** The regular monthly amount. */
  installmentCents: number | null;
  firstChargeOn: string;
  finalDueOn: string;
  /** YYYY-MM-DD in Pacific time. A first charge date that has passed is counted from this day, as everywhere else. */
  today?: string;
}

export type DeadlineFit =
  /** The regular amount alone clears the balance in time: `count` equal payments, nothing larger. */
  | { kind: "even"; count: number; datesThatFit: number }
  /** `count` payments in all; the last `stepUpCount` of them are `stepUpCents` each. */
  | { kind: "stepped"; count: number; stepUpCount: number; stepUpCents: number; datesThatFit: number }
  /** It cannot be paid off in time at this monthly amount: the monthly amount must be raised. */
  | { kind: "raise"; datesThatFit: number }
  /** The monthly amount is more than the whole balance. */
  | { kind: "too-much"; datesThatFit: number }
  /** No payment date falls on or before the deadline. */
  | { kind: "no-dates" };

/**
 * Works out a plan that is paid off by the final deadline while keeping the
 * guest's regular monthly amount for as long as possible.
 *
 * 1. Count the monthly dates that fall on or before the deadline, from the
 *    later of the first charge date and today.
 * 2. If the regular amount alone clears the balance exactly within that many
 *    payments, that is the answer and nothing is made larger.
 * 3. Otherwise the last N payments are made larger, by one single amount, so
 *    that regular x (count - N) + larger x N is the balance to the cent. A
 *    whole-dollar larger amount is preferred over one with cents. The increase
 *    is spread over 2 payments when it can be ("the last few payments"), then
 *    3 and so on; a single larger payment is used only when nothing else works.
 *
 * When the regular amount would finish early but does not divide the balance
 * evenly, fewer payments are used (the larger amount can never be smaller than
 * the regular one). Null while a number or a date is still missing.
 */
export function fitToDeadline(input: DeadlineFitInput): DeadlineFit | null {
  const balance = input.balanceCents;
  const regular = input.installmentCents;
  if (balance === null || regular === null) return null;
  if (!Number.isInteger(balance) || !Number.isInteger(regular) || balance <= 0 || regular <= 0) return null;
  if (!isIsoDate(input.firstChargeOn) || !isIsoDate(input.finalDueOn)) return null;

  const today = input.today && isIsoDate(input.today) ? input.today : "";
  const start = today && input.firstChargeOn < today ? today : input.firstChargeOn;
  const datesThatFit = countPaymentDatesByDeadline(start, input.finalDueOn);
  if (datesThatFit === 0) return { kind: "no-dates" };

  const regularPayments = Math.floor(balance / regular);
  if (regularPayments === 0) return { kind: "too-much", datesThatFit };
  const count = Math.min(datesThatFit, regularPayments);
  if (regular * count === balance) return { kind: "even", count, datesThatFit };
  // One payment cannot be split into a regular part and a larger part.
  if (count < 2) return { kind: "raise", datesThatFit };

  // Two larger payments first, then three and so on; one on its own comes last.
  const order: number[] = [];
  for (let n = 2; n <= count - 1; n += 1) order.push(n);
  order.push(1);
  for (const wholeDollars of [true, false]) {
    for (const n of order) {
      const forLarger = balance - regular * (count - n);
      if (forLarger % n !== 0) continue;
      const larger = forLarger / n;
      if (larger <= regular || larger > MAX_AMOUNT_CENTS) continue;
      if (wholeDollars && larger % 100 !== 0) continue;
      return { kind: "stepped", count, stepUpCount: n, stepUpCents: larger, datesThatFit };
    }
  }
  return { kind: "raise", datesThatFit };
}

/* ──────────────────────────────── the form ─────────────────────────────── */

/** The editor's boxes, as typed. */
export interface BalancePlanForm {
  agreedTotal: string;
  discount: string;
  discountNote: string;
  priorPaid: string;
  installment: string;
  installmentCount: string;
  firstChargeOn: string;
  finalDueOn: string;
  isTest: boolean;
  /** "Make the last payments larger" is ticked. While it is not, the two boxes below are ignored. */
  stepUp: boolean;
  /** Larger payment amount, in dollars as typed. */
  stepUpAmount: string;
  /** How many of the last payments are the larger amount. */
  stepUpCount: string;
}

export type BalancePlanField =
  | "agreedTotal"
  | "discount"
  | "priorPaid"
  | "installment"
  | "installmentCount"
  | "stepUpAmount"
  | "stepUpCount"
  | "firstChargeOn"
  | "finalDueOn";

export const EMPTY_BALANCE_PLAN_FORM: BalancePlanForm = {
  agreedTotal: "",
  discount: "",
  discountNote: "",
  priorPaid: "",
  installment: "",
  installmentCount: "",
  firstChargeOn: "",
  finalDueOn: "",
  isTest: false,
  stepUp: false,
  stepUpAmount: "",
  stepUpCount: "",
};

export function formFromPlan(plan: AdminBalancePlan | null | undefined): BalancePlanForm {
  if (!plan) return { ...EMPTY_BALANCE_PLAN_FORM };
  // An answer from before larger last payments existed has neither field: no larger payments.
  const stepUpCents = plan.stepUpCents ?? 0;
  const stepUpCount = plan.stepUpCount ?? 0;
  const stepped = stepUpCents > 0 && stepUpCount > 0;
  return {
    agreedTotal: centsToDollarInput(plan.agreedTotalCents),
    discount: plan.discountCents > 0 ? centsToDollarInput(plan.discountCents) : "",
    discountNote: plan.discountNote ?? "",
    priorPaid: centsToDollarInput(plan.priorPaidCents),
    installment: centsToDollarInput(plan.installmentCents),
    installmentCount: String(plan.installmentCount),
    firstChargeOn: isoDay(plan.firstChargeOn),
    finalDueOn: isoDay(plan.finalDueOn),
    isTest: Boolean(plan.isTest),
    stepUp: stepped,
    stepUpAmount: stepped ? centsToDollarInput(stepUpCents) : "",
    stepUpCount: stepped ? String(stepUpCount) : "",
  };
}

export function sameForm(a: BalancePlanForm, b: BalancePlanForm): boolean {
  const money = (v: string) => parseDollarsToCents(v) ?? v.trim();
  // Unticked is "no larger payments" whatever is left in the two hidden boxes.
  const step = (f: BalancePlanForm) => (f.stepUp ? `${money(f.stepUpAmount)}|${f.stepUpCount.trim()}` : "off");
  return (
    step(a) === step(b) &&
    money(a.agreedTotal) === money(b.agreedTotal) &&
    (parseDollarsToCents(a.discount) ?? 0) === (parseDollarsToCents(b.discount) ?? 0) &&
    a.discountNote.trim() === b.discountNote.trim() &&
    (parseDollarsToCents(a.priorPaid) ?? (a.priorPaid.trim() === "" ? 0 : a.priorPaid.trim())) ===
      (parseDollarsToCents(b.priorPaid) ?? (b.priorPaid.trim() === "" ? 0 : b.priorPaid.trim())) &&
    money(a.installment) === money(b.installment) &&
    a.installmentCount.trim() === b.installmentCount.trim() &&
    a.firstChargeOn === b.firstChargeOn &&
    a.finalDueOn === b.finalDueOn &&
    a.isTest === b.isTest
  );
}

export interface BalancePlanCheck {
  /** True when Save may be pressed. */
  valid: boolean;
  /** The body to send. Null while anything is missing or wrong. */
  input: BalancePlanInput | null;
  /** A box whose text cannot be used, by box. */
  fieldErrors: Partial<Record<BalancePlanField, string>>;
  /** Labels of required boxes that are still empty. */
  missing: string[];
  /** Numbers that do not agree with each other. Each one blocks Save. */
  problems: string[];
  /** Worth knowing, but does not block Save. */
  warnings: string[];
  agreedTotalCents: number | null;
  priorPaidCents: number;
  /** Price, less what was paid before, less anything already paid on this site. */
  balanceCents: number | null;
  installmentCents: number | null;
  installmentCount: number | null;
  /** True when "Make the last payments larger" is ticked. */
  stepUp: boolean;
  /** The larger amount and how many of the last payments use it. Both 0 unless ticked and both boxes are usable. */
  stepUpCents: number;
  stepUpCount: number;
  /** False while larger payments are ticked but their two boxes are not both usable yet. True otherwise. */
  stepUpReady: boolean;
  /**
   * The larger amount and the number of larger payments as typed, before the
   * number is checked against the number of payments. They are what
   * `suggestedCount` is worked out from. Null when unticked or not usable.
   */
  typedStepUpCents: number | null;
  typedStepUpCount: number | null;
  /** Monthly payment x number of payments, or regular x (count - N) + larger x N with larger last payments. */
  plannedTotalCents: number | null;
  /** The dates to show, each with its own amount. Counted from today when the first charge date has passed. */
  schedule: ProjectedPayment[];
  /** The date of the first payment in `schedule` terms: the later of the first charge date and today. */
  firstPaymentDate: string;
  lastPaymentDate: string;
  /** True when the first charge date has passed, so `schedule` is counted from today. */
  startsLate: boolean;
  /**
   * True when the last payment meets the final deadline with 31 days or fewer
   * to spare, so a guest who adds her card late could push it past the deadline.
   */
  deadlineIsClose: boolean;
  /** The count that would clear the balance exactly, when there is one. */
  suggestedCount: number | null;
}

export interface BalancePlanCheckOptions {
  /** Already collected by this site for this plan (after a restarted plan). Usually 0. */
  paidHereCents?: number;
  /** YYYY-MM-DD in Pacific time; pass it in so the rule stays testable. */
  today?: string;
  currency?: string;
}

function readCount(text: string): { value: number | null; error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, error: "" };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: `Enter a whole number from 1 to ${MAX_INSTALLMENT_COUNT}.` };
  const value = Number(trimmed);
  if (value < 1 || value > MAX_INSTALLMENT_COUNT) return { value: null, error: `Enter a whole number from 1 to ${MAX_INSTALLMENT_COUNT}.` };
  return { value, error: "" };
}

const paymentsWord = (n: number) => (n === 1 ? "1 payment" : `${n} payments`);

/**
 * "5 payments of $600.00 = $3,000.00", or with larger last payments
 * "4 payments of $400.00, then 2 payments of $600.00 = $2,800.00".
 */
export function planSentence(count: number, installmentCents: number, currency = "usd", stepUpCents = 0, stepUpCount = 0): string {
  if (isSteppedPlan(count, stepUpCents, stepUpCount)) {
    return (
      `${paymentsWord(count - stepUpCount)} of ${formatMoney(installmentCents, currency)}, then ` +
      `${paymentsWord(stepUpCount)} of ${formatMoney(stepUpCents, currency)} = ` +
      formatMoney(planTotalCents(count, installmentCents, stepUpCents, stepUpCount), currency)
    );
  }
  return `${paymentsWord(count)} of ${formatMoney(installmentCents, currency)} = ${formatMoney(count * installmentCents, currency)}`;
}

/**
 * Everything the editor needs to show for the numbers as typed: the balance,
 * the plan total, the projected dates, and what is stopping a save.
 */
export function checkBalancePlan(form: BalancePlanForm, options: BalancePlanCheckOptions = {}): BalancePlanCheck {
  const currency = options.currency ?? "usd";
  const paidHere = Math.max(0, options.paidHereCents ?? 0);
  const fieldErrors: Partial<Record<BalancePlanField, string>> = {};
  const missing: string[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];

  const money = (field: "agreedTotal" | "discount" | "priorPaid" | "installment" | "stepUpAmount", label: string, required: boolean): number | null => {
    const text = form[field];
    const problem = dollarInputProblem(text);
    if (problem) {
      fieldErrors[field] = problem;
      return null;
    }
    const cents = parseDollarsToCents(text);
    if (cents === null && required) missing.push(label);
    return cents;
  };

  const agreed = money("agreedTotal", "Agreed retreat price", true);
  const discountRaw = money("discount", "Discount amount", false);
  const priorRaw = money("priorPaid", "Paid before", false);
  const installment = money("installment", "Monthly payment", true);
  const discount = fieldErrors.discount ? null : (discountRaw ?? 0);
  const prior = fieldErrors.priorPaid ? null : (priorRaw ?? 0);

  if (agreed === 0) fieldErrors.agreedTotal = "Enter the agreed price. It must be more than 0.";
  if (installment === 0) fieldErrors.installment = "The monthly payment must be more than 0.";

  const count = readCount(form.installmentCount);
  if (count.error) fieldErrors.installmentCount = count.error;
  else if (count.value === null) missing.push("Number of payments");

  // Larger last payments. The same three rules the server enforces:
  //   1. the larger amount is more than the regular monthly amount;
  //   2. the number of larger payments is at least 1 and less than the number
  //      of payments (at least one regular payment comes first);
  //   3. regular x (count - N) + larger x N is the balance (checked below).
  // Unticked, the two boxes are ignored and 0 / 0 is sent.
  const stepUp = form.stepUp;
  /** The larger amount, once it is more than the monthly amount (or the monthly amount is not known yet). */
  let larger: number | null = null;
  /** How many larger payments, as typed: a whole number of 1 or more. Checked against the count separately. */
  let largerCount: number | null = null;
  /** True once `largerCount` is also less than the number of payments. */
  let largerCountFits = false;
  if (stepUp) {
    const typedLarger = money("stepUpAmount", "Larger payment amount", true);
    if (typedLarger !== null) {
      if (typedLarger === 0) fieldErrors.stepUpAmount = "The larger payment must be more than 0.";
      else if (installment !== null && installment > 0 && typedLarger <= installment) {
        fieldErrors.stepUpAmount = `The larger payment must be more than the monthly payment of ${formatMoney(installment, currency)}.`;
      } else larger = typedLarger;
    }

    const typedCount = form.stepUpCount.trim();
    const most = count.value !== null ? count.value - 1 : MAX_INSTALLMENT_COUNT - 1;
    const range =
      most === 1 ? "Enter 1. With 2 payments, only the last one can be larger." : `Enter a whole number from 1 to ${most}. At least one payment must stay at the monthly amount.`;
    const wholeNumber = /^\d+$/.test(typedCount) ? Number(typedCount) : null;
    // Kept even when it is too many for the number of payments typed so far,
    // so "Suggest number of payments" can still offer a count that works.
    if (wholeNumber !== null && wholeNumber >= 1 && wholeNumber <= MAX_INSTALLMENT_COUNT - 1) largerCount = wholeNumber;
    if (typedCount === "") missing.push("How many of the last payments");
    else if (count.value === 1) fieldErrors.stepUpCount = "A plan with 1 payment cannot have larger last payments. Use 2 or more payments.";
    else if (largerCount === null || largerCount > most) fieldErrors.stepUpCount = range;
    else largerCountFits = count.value !== null;
  }
  const stepUpReady = !stepUp || (larger !== null && largerCount !== null && largerCountFits);
  const stepUpCents = stepUp && stepUpReady && larger !== null ? larger : 0;
  const stepUpCount = stepUp && stepUpReady && largerCount !== null ? largerCount : 0;

  let first = "";
  if (form.firstChargeOn.trim() === "") missing.push("First charge date");
  else if (!isIsoDate(form.firstChargeOn)) fieldErrors.firstChargeOn = "Choose a date from the calendar.";
  else first = form.firstChargeOn;

  let deadline = "";
  if (form.finalDueOn.trim() !== "") {
    if (!isIsoDate(form.finalDueOn)) fieldErrors.finalDueOn = "Choose a date from the calendar.";
    else deadline = form.finalDueOn;
  }

  const agreedOk = agreed !== null && agreed > 0 ? agreed : null;
  const installmentOk = installment !== null && installment > 0 ? installment : null;

  let balance: number | null = null;
  if (agreedOk !== null && prior !== null) {
    balance = agreedOk - prior - paidHere;
    if (prior > agreedOk) {
      problems.push(`Paid before (${formatMoney(prior, currency)}) is more than the agreed price (${formatMoney(agreedOk, currency)}). Check both amounts.`);
    } else if (balance <= 0) {
      problems.push("There is nothing left to pay, so there is no balance to put on a plan.");
    }
  }

  // One equation everywhere: regular x (count - N) + larger x N, where N is 0
  // without larger payments. Not worked out while the larger-payment boxes are
  // still incomplete, so a half-typed plan is never called "short".
  const planned =
    installmentOk !== null && count.value !== null && stepUpReady ? planTotalCents(count.value, installmentOk, stepUpCents, stepUpCount) : null;
  if (balance !== null && balance > 0 && planned !== null && installmentOk !== null && count.value !== null && planned !== balance) {
    const gap = Math.abs(balance - planned);
    problems.push(
      stepUpCount > 0
        ? `The balance is ${formatMoney(balance, currency)}, but ${paymentsWord(count.value - stepUpCount)} of ${formatMoney(installmentOk, currency)} and ` +
            `${paymentsWord(stepUpCount)} of ${formatMoney(stepUpCents, currency)} come to ${formatMoney(planned, currency)}. ` +
            `That is ${formatMoney(gap, currency)} ${planned < balance ? "short" : "too much"}. The two must match exactly, so change an amount or the number of payments.`
        : `The balance is ${formatMoney(balance, currency)}, but ${paymentsWord(count.value)} of ${formatMoney(installmentOk, currency)} come to ${formatMoney(planned, currency)}. ` +
            `That is ${formatMoney(gap, currency)} ${planned < balance ? "short" : "too much"}. The two must match exactly, so change the monthly payment or the number of payments.`,
    );
  }

  // A first charge date that has passed cannot be charged in the past: the
  // first payment is taken the day the guest adds her card, and the rest are
  // counted from that day. So the schedule starts on the LATER of the typed
  // date and today (Pacific), which is exactly how the server counts it
  // (effectiveFirstCharge in backend/src/services/retreatBalancePlans.ts).
  // Without a `today` (some callers and tests) the typed date stands.
  const today = options.today && isIsoDate(options.today) ? options.today : "";
  const startsLate = Boolean(first && today && first < today);
  const effectiveFirst = startsLate ? today : first;
  const dates = effectiveFirst && count.value !== null && installmentOk !== null ? projectSchedule(effectiveFirst, count.value, installmentOk, stepUpCents, stepUpCount) : [];
  const firstPaymentDate = dates[0]?.dueDate ?? "";
  const lastPaymentDate = dates[dates.length - 1]?.dueDate ?? "";
  // The dates do not depend on the amounts, so the deadline is still checked
  // while the larger-payment boxes are incomplete. The list itself is held
  // back until then: it would show amounts that are not the plan.
  const schedule = stepUpReady ? dates : [];

  // The rule the server enforces, on the same dates: the last payment, counted
  // from max(first charge date, today), must not fall after the deadline. It
  // blocks Save here because the server refuses the save and the open.
  if (lastPaymentDate && deadline && lastPaymentDate > deadline) {
    problems.push(
      startsLate
        ? `The first charge date has already passed, so the payments are counted from today. The last payment would be on ${formatLongDate(lastPaymentDate)}, ` +
            `which is after the final payment deadline of ${formatLongDate(deadline)}. Use fewer, larger payments or a later deadline.`
        : `The last payment would be on ${formatLongDate(lastPaymentDate)}, which is after the final payment deadline of ${formatLongDate(deadline)}. ` +
            "Use fewer, larger payments, an earlier first charge date, or a later deadline.",
    );
  }

  // A passed first charge date is allowed (the server accepts it too), so this
  // is a note, not a block.
  if (startsLate) {
    warnings.push(
      "The first charge date has already passed. The first payment will be charged as soon as the guest adds a card and agrees, and the following payments are counted from that day. The dates below are the earliest possible.",
    );
  }

  // Plain information for a deadline that is met, but only just: the dates
  // move later by a day for every day the guest waits past the first one.
  const spare = lastPaymentDate && deadline && lastPaymentDate <= deadline ? daysBetween(lastPaymentDate, deadline) : null;
  const deadlineIsClose = spare !== null && spare >= 0 && spare <= 31;

  // With larger payments ticked, the suggestion uses the same equation: the
  // count for which regular x (count - N) + larger x N is the balance.
  const suggestedCount =
    balance === null
      ? null
      : !stepUp
        ? suggestInstallmentCount(balance, installmentOk)
        : larger !== null && largerCount !== null
          ? suggestInstallmentCount(balance, installmentOk, larger, largerCount)
          : null;

  const valid = Object.keys(fieldErrors).length === 0 && missing.length === 0 && problems.length === 0 && stepUpReady;
  const input: BalancePlanInput | null =
    valid && agreedOk !== null && installmentOk !== null && count.value !== null && discount !== null && prior !== null && first
      ? {
          agreedTotalCents: agreedOk,
          discountCents: discount,
          discountNote: form.discountNote.trim(),
          priorPaidCents: prior,
          installmentCents: installmentOk,
          installmentCount: count.value,
          stepUpCents,
          stepUpCount,
          firstChargeOn: first,
          finalDueOn: deadline || null,
          isTest: form.isTest,
        }
      : null;

  return {
    valid: valid && input !== null,
    input,
    fieldErrors,
    missing,
    problems,
    warnings,
    agreedTotalCents: agreedOk,
    priorPaidCents: prior ?? 0,
    balanceCents: balance,
    installmentCents: installmentOk,
    installmentCount: count.value,
    stepUp,
    stepUpCents,
    stepUpCount,
    stepUpReady,
    typedStepUpCents: larger,
    typedStepUpCount: largerCount,
    plannedTotalCents: planned,
    schedule,
    firstPaymentDate,
    lastPaymentDate,
    startsLate,
    deadlineIsClose,
    suggestedCount,
  };
}

/* ─────────────────────────────── status chip ───────────────────────────── */

export type PlanChipTone = "neutral" | "slate" | "gold" | "green" | "red";

export interface PlanChip {
  label: string;
  tone: PlanChipTone;
}

type ChipPlan = Pick<AdminBalancePlan, "state" | "firstChargeOn" | "installmentCount" | "schedule">;

/** Paid so far and payments in all, from the real schedule when there is one. */
export function paidProgress(plan: Pick<AdminBalancePlan, "installmentCount" | "schedule">): { paid: number; count: number } {
  const schedule = Array.isArray(plan.schedule) ? plan.schedule : [];
  return {
    paid: schedule.filter((row) => row.status === "paid").length,
    count: schedule.length > 0 ? schedule.length : plan.installmentCount,
  };
}

/** The short status shown in each guest's row. */
export function planChip(plan: ChipPlan | null | undefined): PlanChip {
  if (!plan) return { label: "No plan", tone: "neutral" };
  const state: BalancePlanState = plan.state;
  switch (state) {
    case "draft":
      return { label: "Draft", tone: "slate" };
    case "open":
      return { label: "Waiting for card", tone: "gold" };
    case "card_on_file": {
      const date = formatShortDate(plan.firstChargeOn);
      return { label: date ? `Card on file (first charge ${date})` : "Card on file", tone: "green" };
    }
    case "billing": {
      const { paid, count } = paidProgress(plan);
      return { label: `Charging monthly (${paid} of ${count} paid)`, tone: "green" };
    }
    case "past_due":
      return { label: "Payment problem", tone: "red" };
    case "completed":
      return { label: "Paid in full", tone: "green" };
    case "canceled":
      return { label: "Cancelled", tone: "slate" };
    default:
      return { label: "No plan", tone: "neutral" };
  }
}

/**
 * True while the owner may change the numbers: before any card is on file, and
 * again once a plan has been cancelled. Saving a cancelled plan returns it to
 * draft (the server does this, and refuses while the old subscription is still
 * closing at Stripe), which is how a new plan is set up for the same guest.
 */
export function isEditableState(state: BalancePlanState | null | undefined): boolean {
  return state === null || state === undefined || state === "draft" || state === "open" || state === "canceled";
}
