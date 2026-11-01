import { addInterval } from "./pricing";

/**
 * A membership with a minimum term (the Lounge: six months, owner brief 1 Nov 2026).
 * The rule lives on the Stripe subscription's metadata, written at checkout, so a
 * later edit to the offer never changes what an existing member agreed to.
 */
export function minimumMonthsFrom(metadata: Record<string, string> | null | undefined): number {
  const months = Number(metadata?.minimumMonths);
  return Number.isInteger(months) && months > 0 ? months : 0;
}

/** Six months from the billing anchor is the seventh charge's moment, so ending there leaves exactly six. */
export function minimumTermEnd(anchor: Date, months: number): Date {
  return addInterval(anchor, "month", months);
}

/** When a cancellation takes effect: never before the minimum or the time already paid for. */
export function cancellationDate(minimumEnd: Date, periodEnd: Date | null, now = new Date()): Date {
  return new Date(Math.max(minimumEnd.getTime(), periodEnd?.getTime() ?? 0, now.getTime()));
}
