import type { CoachingPolicy } from "@/lib/coachingApi";

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
  if (!Number.isFinite(hours) || hours <= 0) return "any time";

  // The window is stored in minutes and divided by 60 on the way out, so a
  // 90-minute policy arrives here as 1.5 and must not be printed as "1.5 hours".
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (hours < 48) {
    const whole = Math.round(hours);
    return `${whole} ${whole === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} days`;
}

export function creditReturnSentence(policy: CoachingPolicy): string {
  if (policy.cancellationWindowHours <= 0) {
    return "Cancel whenever you need to and the session goes back on your package.";
  }
  const window = hoursInWords(policy.cancellationWindowHours);
  return (
    `Cancel more than ${window} before it starts and the session goes back on your package. ` +
    `Cancel inside ${window} and it counts as used.`
  );
}

/** The same window governs moving a call, so the two sentences share a number. */
export function rescheduleSentence(policy: CoachingPolicy): string {
  if (policy.cancellationWindowHours <= 0) {
    return "You can move this call to another time whenever you need to.";
  }
  return `You can move this call up to ${hoursInWords(policy.cancellationWindowHours)} before it starts.`;
}

/** Why today is missing from the calendar, said before anybody hunts for it. */
export function noticeSentence(policy: CoachingPolicy): string {
  if (policy.minimumNoticeHours <= 0) return "";
  return `Calls need ${hoursInWords(policy.minimumNoticeHours)} notice, so the next few hours are not on offer.`;
}
