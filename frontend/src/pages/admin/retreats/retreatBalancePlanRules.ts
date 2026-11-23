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
export function projectSchedule(firstChargeOn: string, count: number, amountCents: number): ProjectedPayment[] {
  if (!isIsoDate(firstChargeOn) || !Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENT_COUNT) return [];
  return Array.from({ length: count }, (_, i) => ({
    sequence: i + 1,
    amountCents,
    dueDate: addMonthsClamped(firstChargeOn, i),
  }));
}

/**
 * How many monthly payments clear the balance exactly, or null when the balance
 * does not divide evenly (there is no odd final payment) or the answer is
 * outside 1 to 36.
 */
export function suggestInstallmentCount(balanceCents: number | null, installmentCents: number | null): number | null {
  if (balanceCents === null || installmentCents === null) return null;
  if (!Number.isInteger(balanceCents) || !Number.isInteger(installmentCents)) return null;
  if (balanceCents <= 0 || installmentCents <= 0) return null;
  if (balanceCents % installmentCents !== 0) return null;
  const count = balanceCents / installmentCents;
  return count >= 1 && count <= MAX_INSTALLMENT_COUNT ? count : null;
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
}

export type BalancePlanField = "agreedTotal" | "discount" | "priorPaid" | "installment" | "installmentCount" | "firstChargeOn" | "finalDueOn";

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
};

export function formFromPlan(plan: AdminBalancePlan | null | undefined): BalancePlanForm {
  if (!plan) return { ...EMPTY_BALANCE_PLAN_FORM };
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
  };
}

export function sameForm(a: BalancePlanForm, b: BalancePlanForm): boolean {
  const money = (v: string) => parseDollarsToCents(v) ?? v.trim();
  return (
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
  /** Monthly payment x number of payments. */
  plannedTotalCents: number | null;
  /** The dates to show and to check against the deadline. Counted from today when the first charge date has passed. */
  schedule: ProjectedPayment[];
  lastPaymentDate: string;
  /** True when the first charge date has passed, so `schedule` is counted from today. */
  startsLate: boolean;
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

/** "5 payments of $600.00 = $3,000.00" */
export function planSentence(count: number, installmentCents: number, currency = "usd"): string {
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

  const money = (field: "agreedTotal" | "discount" | "priorPaid" | "installment", label: string, required: boolean): number | null => {
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

  const planned = installmentOk !== null && count.value !== null ? installmentOk * count.value : null;
  if (balance !== null && balance > 0 && planned !== null && installmentOk !== null && count.value !== null && planned !== balance) {
    const gap = Math.abs(balance - planned);
    problems.push(
      `The balance is ${formatMoney(balance, currency)}, but ${paymentsWord(count.value)} of ${formatMoney(installmentOk, currency)} come to ${formatMoney(planned, currency)}. ` +
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
  const schedule = effectiveFirst && count.value !== null && installmentOk !== null ? projectSchedule(effectiveFirst, count.value, installmentOk) : [];
  const lastPaymentDate = schedule[schedule.length - 1]?.dueDate ?? "";

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

  const suggestedCount = balance !== null ? suggestInstallmentCount(balance, installmentOk) : null;

  const valid = Object.keys(fieldErrors).length === 0 && missing.length === 0 && problems.length === 0;
  const input: BalancePlanInput | null =
    valid && agreedOk !== null && installmentOk !== null && count.value !== null && discount !== null && prior !== null && first
      ? {
          agreedTotalCents: agreedOk,
          discountCents: discount,
          discountNote: form.discountNote.trim(),
          priorPaidCents: prior,
          installmentCents: installmentOk,
          installmentCount: count.value,
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
    plannedTotalCents: planned,
    schedule,
    lastPaymentDate,
    startsLate,
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
