import type { CancellationPolicy } from "@/lib/coachingApi";

/**
 * The cancellation policy in sentences.
 *
 * One place, because the same promise has to appear on the confirm step and in
 * the cancel dialog, and those two disagreeing is how a member ends up feeling
 * cheated of a session they were told they would get back.
 *
 * "24 hours" reads better than "1 day" for a booking window, but "3 days" reads
 * better than "72 hours" — so the units turn over at 48.
 */
export function hoursInWords(hours: number): string {
  if (hours <= 0) return "any time";
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

export function creditReturnSentence(policy: CancellationPolicy): string {
  if (policy.creditReturnHours <= 0) {
    return "Cancel whenever you need to and the session goes back on your package.";
  }
  return (
    `Cancel more than ${hoursInWords(policy.creditReturnHours)} before it starts and the ` +
    `session goes back on your package. Cancel inside ${hoursInWords(policy.creditReturnHours)} ` +
    `and it counts as used.`
  );
}

export function rescheduleSentence(policy: CancellationPolicy): string {
  if (policy.rescheduleHours <= 0) {
    return "You can move this call to another time whenever you need to.";
  }
  return `You can move this call up to ${hoursInWords(policy.rescheduleHours)} before it starts.`;
}
