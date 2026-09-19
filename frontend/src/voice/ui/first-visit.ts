/**
 * first-visit.ts — which of the two openings the concierge uses.
 *
 * A newcomer does not know what to ask, so the first time someone opens a
 * surface the assistant introduces itself and offers, in one breath, to show
 * them around. Every time after that it simply says hello. The whole point of
 * the offer is that it is an offer: it is made once, a no is remembered, and
 * nobody is walked through anything they did not agree to.
 *
 * "Have we met?" is a question about the walkthrough, and the walkthrough's
 * memory belongs to the tour engine — server-side so it follows a signed-in
 * person to their phone, mirrored locally so an anonymous visitor's "no thank
 * you" survives them closing the tab. This module only asks. It deliberately
 * keeps no copy of its own: two records of one fact are two records that
 * disagree, and the one that disagreed here was the one deciding whether to
 * offer someone a tour they had already declined.
 *
 * Knowing nothing is treated as "we have not met". An extra offer is a small
 * discourtesy; skipping the only one a newcomer will ever get is a real loss.
 * Knowing nothing is not the same as not having asked, though: when the lookup
 * runs out of time, what this browser remembers is used rather than nothing at
 * all, so a slow network can never talk someone into being offered a
 * walkthrough they have already turned down.
 */

import type { TourProgress, VoiceContext, VoiceSurfacePolicy } from "@/voice/contract";
import { loadTourProgress, readTourMirror, resumeCursor } from "@/voice/tools";

/**
 * How long the opening line waits on the walkthrough's memory before deciding
 * for itself. The lookup is started the moment the button is pressed, so in
 * practice it has the whole time the recording notice is being read; this is
 * the ceiling for the case where someone has already read it and the answer is
 * genuinely slow.
 */
const LOOKUP_BUDGET_MS = 2_000;

/**
 * Distinguished from a genuine "no progress" on purpose: an answer of null is a
 * fact about this person, running out of time is a fact about the network, and
 * only the second of the two should send us to the local record.
 */
const TIMED_OUT = Symbol("tour-progress-timeout");

export type GreetingDecision = {
  /** The line the agent opens with. */
  greeting: string;
  /** True when this is the offer, so a caller can note that it was made. */
  firstVisit: boolean;
  /** Where an unfinished walkthrough left off, if there is one. */
  resumeIndex: number | null;
};

/**
 * Decide the opening line. Safe to call on any surface: a surface with no
 * walkthrough has nothing to offer and simply says hello.
 */
export async function decideGreeting(
  policy: VoiceSurfacePolicy,
  ctx: VoiceContext,
  options?: { timeoutMs?: number },
): Promise<GreetingDecision> {
  const plain: GreetingDecision = {
    greeting: policy.greeting,
    firstVisit: false,
    resumeIndex: null,
  };
  if (policy.tour.length === 0) return plain;

  const answer = await Promise.race([
    loadTourProgress(ctx, policy.surface).catch(() => null),
    new Promise<typeof TIMED_OUT>((resolve) =>
      setTimeout(() => resolve(TIMED_OUT), options?.timeoutMs ?? LOOKUP_BUDGET_MS),
    ),
  ]);
  const progress: TourProgress | null =
    answer === TIMED_OUT ? readTourMirror(policy.surface) : answer;

  const { completed, cursor } = resumeCursor(progress, policy.tour);
  if (completed) return plain;
  if (cursor.stopIndex > 0) {
    // Someone who was already part-way round is neither a newcomer nor a
    // stranger. They get the ordinary hello with the door left open, and the
    // walkthrough picks up where it stopped rather than starting again.
    return {
      greeting:
        `${policy.greeting} We were part-way through showing you around last time — ` +
        `say the word and I will pick up right where we stopped.`,
      firstVisit: false,
      resumeIndex: cursor.stopIndex,
    };
  }
  return { greeting: policy.firstVisitGreeting, firstVisit: true, resumeIndex: null };
}
