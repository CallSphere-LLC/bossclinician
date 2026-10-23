import { runEngagementSweep } from "../services/engagementSweep";
import { deliverEngagementSend, tidyEngagementSends } from "../services/engagementSends";
import { registerHandler } from "./worker";

/**
 * Row 171's two job kinds.
 *
 * `engagement.sweep` is named by the `job_schedules` row 'engagement-sweep'
 * (migration 150), so the string is a contract. It raises the "lesson video
 * not watched" and "missed a live session" automation triggers — and does
 * nothing at all while no automation using them is turned on.
 *
 * `engagement.sendManual` delivers one press of "Send reminder" / "Email the
 * replay" on Analytics → Engagement.
 */
export function registerEngagementJobs(): void {
  registerHandler("engagement.sweep", async () => {
    const tidy = await tidyEngagementSends();
    const sweep = await runEngagementSweep();
    return { ...sweep, ...tidy };
  });
  registerHandler("engagement.sendManual", (payload) => deliverEngagementSend(payload));
}
