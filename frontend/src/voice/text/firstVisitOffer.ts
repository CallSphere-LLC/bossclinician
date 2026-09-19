/**
 * firstVisitOffer.ts — the first-run walkthrough offer, for someone typing.
 *
 * Addendum 1 calls the walkthrough an offer and not an ambush, and Addendum 2
 * says the typed concierge runs the same one. So the decision itself is not
 * made here: it is `decideGreeting` from the ui slice, the very function the
 * spoken concierge uses, reading the same server record and the same local
 * mirror. All this hook adds is WHEN to ask — when somebody opens the chat
 * panel — and how a typed yes or no is remembered.
 *
 * Sharing that one decision is the whole point. Two implementations of "have we
 * met?" would eventually disagree, and the way a visitor experiences that
 * disagreement is being offered a tour they already sat through. For the same
 * reason nothing here keeps a record of its own: the walkthrough's memory lives
 * with the tour engine, server-side so it follows someone to their phone and
 * mirrored locally so an anonymous "no thank you" survives a closed tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { saveTourProgress } from "@/voice/tools";
// Imported from the leaf rather than the ui barrel: the barrel also re-exports
// `VoiceConcierge`, and pulling that in would drag the whole spoken widget —
// the session kernel, the audio tap and all — into the marketing shell's server
// render and its first paint, which is exactly what the lazy imports in the
// chat widget exist to avoid.
import { decideGreeting } from "@/voice/ui/first-visit";
import type {
  TourProgress,
  VoiceApiClient,
  VoiceContext,
  VoiceSurfacePolicy,
} from "@/voice/contract";
import { currentLocation } from "./useConciergeChat";

export type FirstVisitOffer = {
  /** What the assistant should say unprompted, if anything: the offer, or the
   *  standing invitation to pick up an unfinished walkthrough. */
  openingLine: string | null;
  /** True when that line is the offer itself, so a yes or a no is expected. */
  offering: boolean;
  /** They said no. Remembered for both channels, so neither asks again. */
  decline: () => void;
  /** The offer is spent without a no — nothing is written. See below. */
  close: () => void;
};

/**
 * The first-run question, decided before it is asked.
 *
 * `active` is what keeps this off the marketing site's critical path: the
 * lookup runs when the panel opens, not when a page loads, so a visitor who
 * never opens the chat costs no requests at all.
 */
export function useFirstVisitOffer(input: {
  policy: VoiceSurfacePolicy;
  call: () => VoiceApiClient;
  active: boolean;
}): FirstVisitOffer {
  const { policy, active } = input;
  const navigate = useNavigate();
  const [openingLine, setOpeningLine] = useState<string | null>(null);
  const [offering, setOffering] = useState(false);
  // One decision per surface per page: re-opening the panel must not re-ask,
  // and the effect must not race itself on a fast open, close and open.
  const decidedRef = useRef<string | null>(null);
  const callRef = useRef(input.call);
  callRef.current = input.call;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  /**
   * Both asking the walkthrough what it remembers and telling it about a
   * decline take a `VoiceContext`, and it gets a real one rather than a
   * hollowed-out one: a context full of stubs is a lie waiting to be believed
   * by whoever passes it somewhere else next.
   */
  const context = useCallback(
    (): VoiceContext => ({
      navigate: (path) => navigateRef.current(path),
      getLocation: currentLocation,
      surface: policy.surface,
      mode: "text",
      // Deciding how to greet someone happens before any conversation has been
      // opened, so there is genuinely no row to name here — and saying so is
      // better than borrowing an id that belongs to something else.
      getSessionId: () => null,
      call: callRef.current(),
    }),
    [policy.surface],
  );

  useEffect(() => {
    if (!active || decidedRef.current === policy.surface) return;
    let live = true;

    void (async () => {
      const decision = await decideGreeting(policy, context());
      if (!live) return;
      decidedRef.current = policy.surface;
      setOpeningLine(decision.greeting);
      setOffering(decision.firstVisit || decision.resumeIndex !== null);
    })();

    return () => {
      live = false;
    };
  }, [active, policy]);

  const decline = useCallback(() => {
    setOffering(false);
    /**
     * Declining is a finished walkthrough as far as both channels are
     * concerned: the contract sets `completed` once someone has finished OR
     * declined, and that flag is what stops the spoken concierge offering the
     * same tour tomorrow.
     *
     * One write, to the one place that owns this: `saveTourProgress` keeps the
     * local mirror and posts to the server, and the opening line on either
     * transport reads back from exactly that.
     */
    const progress: TourProgress = {
      surface: policy.surface,
      index: 0,
      completed: true,
      updatedAt: Date.now(),
    };
    void saveTourProgress(context(), progress);
  }, [context, policy.surface]);

  /**
   * The offer has been answered by something other than a no: the walkthrough
   * started, or they simply asked about something else.
   *
   * Nothing is written either way, and that is deliberate. A started tour keeps
   * its own progress stop by stop, and a row written from out here would fight
   * it; an unclear answer is not a refusal, and recording one as `completed`
   * would leave `start_guided_tour` telling them they have already been shown
   * around the next time they ask for the tour they never got. The offer simply
   * stops being live in this panel, which is as much as an unanswered question
   * earns.
   */
  const close = useCallback(() => setOffering(false), []);

  return { openingLine, offering, decline, close };
}
