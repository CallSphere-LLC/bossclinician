/**
 * The arithmetic behind the in-lesson calculators, kept pure so it can be
 * tested without a DOM and so each component is only layout.
 *
 * Every function returns `null` rather than NaN/Infinity when an input is
 * missing or would divide by zero: the component shows a dash, never "NaN USD".
 */

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * Ramp-Up Rate Formula (Kajabi post 2186600443; workbook p.13):
 *
 *   Rate per session = (Annual income goal + Annual expenses) / Billable hours per year
 *   Billable hours per year = Weeks worked × Sessions per week
 *
 * Kajabi defaults 50,000 / 10 / 50 / 10,000 give 120.
 */
export function rampUpRate(input: {
  annualSalary: number;
  sessionsPerWeek: number;
  weeksPerYear: number;
  annualExpenses: number;
}): { billableHours: number; rate: number } | null {
  const billableHours = input.sessionsPerWeek * input.weeksPerYear;
  if (!(billableHours > 0)) return null;
  const rate = finite((input.annualSalary + input.annualExpenses) / billableHours);
  return rate === null ? null : { billableHours, rate };
}

/**
 * Ramp-Up Rate Comparison (Kajabi post 2186600444).
 *
 * The original page's script was not preserved in the export; the formula is
 * read off the figures Kajabi rendered for its own defaults (10 sessions at
 * 100 / 125 / 150 → 1,000 / 4,000 / 48,000, 1,250 / 5,000 / 60,000, …):
 *
 *   weekly  = sessions per week × rate
 *   monthly = weekly × 4
 *   annual  = monthly × 12   (i.e. a 48-week working year)
 *
 * Reproduced exactly, including the four-week month, so the numbers match what
 * members saw on Kajabi and in the workbook they filled in from it.
 */
export function rateComparison(sessionsPerWeek: number, rate: number): {
  weekly: number;
  monthly: number;
  annual: number;
} | null {
  if (!Number.isFinite(sessionsPerWeek) || !Number.isFinite(rate)) return null;
  const weekly = sessionsPerWeek * rate;
  const monthly = weekly * 4;
  return { weekly, monthly, annual: monthly * 12 };
}

/**
 * PTO income set-aside (Practice Elevation, Kajabi post 2199631527).
 *
 * The lesson: "divide your owner's salary by 52 weeks times your PTO weeks to
 * get your monthly set-aside amount"; the PTO Planning Tool doc: "(monthly
 * owner's salary × months off, converted from weeks) ÷ 12". Both are the same
 * calculation done exactly here:
 *
 *   weekly pay       = monthly salary × 12 / 52
 *   reserve needed   = weekly pay × PTO weeks
 *   monthly set-aside = reserve needed / 12
 *
 * (The doc's worked example rounds 4 weeks to "roughly one month": $6,000 →
 * $500/month. The exact figure is $461.54.)
 */
export function ptoSetAside(monthlySalary: number, ptoWeeks: number): {
  weeklyPay: number;
  reserve: number;
  monthly: number;
} | null {
  if (!Number.isFinite(monthlySalary) || !Number.isFinite(ptoWeeks)) return null;
  if (monthlySalary < 0 || ptoWeeks < 0) return null;
  const weeklyPay = (monthlySalary * 12) / 52;
  const reserve = weeklyPay * ptoWeeks;
  return { weeklyPay, reserve, monthly: reserve / 12 };
}

/** "1,000 USD" — the format the Kajabi calculators printed. */
export function usd(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} USD`;
}

/** An input's text as a number; blank or junk is NaN, which the formulas reject. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}
