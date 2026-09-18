import { sendScheduledIssues } from "../services/newsletters";
import { registerHandler } from "./worker";

/**
 * Sends newsletter issues at the time they were scheduled for.
 *
 * `newsletter.sendScheduled` is named by a row in `job_schedules` (every 5
 * minutes, migration 059), so the kind is not free to change: a rename shows up
 * as a job failing rather than as issues quietly never going out again. Which
 * is what happened before this existed — an issue could be saved as
 * "scheduled" with a date on it, and nothing ever read either.
 *
 * The claim and the send live in services/newsletters.ts, beside the manual
 * "Send now" they share a body with.
 */
export function registerNewsletterJobs(): void {
  registerHandler("newsletter.sendScheduled", () => sendScheduledIssues());
}
