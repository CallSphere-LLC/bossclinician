/**
 * tour.ts — the first-run walkthrough, as an engine over an itinerary.
 *
 * A newcomer should not have to know what to ask. The concierge offers, once,
 * to show them around; on a yes it walks `policy.tour` — travel to a page, read
 * what is actually on it, then point at each beat in turn and say the line that
 * goes with it. The itinerary is DATA owned by each surface, because the thing
 * that dates fastest about a guided tour is the product it describes.
 *
 * Two decisions worth stating, because they are what makes this survive contact
 * with a real app:
 *
 *  • A beat whose target is no longer on the page is SKIPPED, never fatal. A
 *    renamed button must not strand a first-time visitor halfway round.
 *  • Where the tour got to is persisted server-side, so a dropped call or a
 *    refresh resumes at the same stop rather than starting again — and a tour
 *    that was finished, or declined, is never offered a second time. Anonymous
 *    visitors get a localStorage mirror, since there is no account to hang it
 *    on until they have one.
 *
 * The decision-making half is pure (`advanceTour`, `resumeCursor`) and the
 * DOM-touching half is a thin executor around it, which is why the itinerary
 * logic can be tested with no browser at all.
 */

import type {
  ConciergeTool,
  ToolFn,
  TourProgress,
  TourStop,
  VoiceContext,
  VoiceSurface,
  VoiceSurfacePolicy,
} from "../contract";
import { resolveDestination, travelTo, type GuidedHistory } from "./navigation";
import { snapshotToPrompt } from "./page-reader";
import { clearSpotlight, resolveElement, setSpotlight } from "./spotlight";

/* ------------------------------------------------------------------ */
/*  The itinerary, decided purely                                      */
/* ------------------------------------------------------------------ */

/**
 * Where the walkthrough is. `beatIndex === -1` means "has not arrived at this
 * stop yet", which is how travelling and narrating stay one sequence rather
 * than two pieces of state that can disagree.
 */
export type TourCursor = { stopIndex: number; beatIndex: number };

export type TourStep =
  | { kind: "travel"; stopIndex: number; stop: TourStop }
  | { kind: "beat"; stopIndex: number; beatIndex: number; stop: TourStop; beat: { focus: string; say: string } }
  | { kind: "done" };

/** The cursor a walkthrough starts (or resumes) from. */
export const TOUR_START: TourCursor = { stopIndex: 0, beatIndex: -1 };

/**
 * Work out the next thing to do, and where that leaves the cursor.
 *
 * `canFocus` is injected rather than called directly so the rule — skip a beat
 * that points at nothing, and move on to the next stop when a page's beats are
 * all gone — can be checked without a DOM.
 */
export function advanceTour(
  cursor: TourCursor,
  tour: readonly TourStop[],
  canFocus: (focus: string) => boolean,
): { step: TourStep; cursor: TourCursor } {
  let { stopIndex, beatIndex } = cursor;

  while (stopIndex < tour.length) {
    const stop = tour[stopIndex];
    if (beatIndex < 0) {
      return { step: { kind: "travel", stopIndex, stop }, cursor: { stopIndex, beatIndex: 0 } };
    }
    for (let i = beatIndex; i < stop.beats.length; i += 1) {
      if (!canFocus(stop.beats[i].focus)) continue;
      return {
        step: { kind: "beat", stopIndex, beatIndex: i, stop, beat: stop.beats[i] },
        cursor: { stopIndex, beatIndex: i + 1 },
      };
    }
    // Every remaining beat on this page has gone; the page itself was still
    // worth seeing, so carry on to the next stop rather than ending the tour.
    stopIndex += 1;
    beatIndex = -1;
  }

  return { step: { kind: "done" }, cursor: { stopIndex: tour.length, beatIndex: -1 } };
}

/**
 * Where a returning visitor picks up.
 *
 * A finished or declined tour is never re-offered: that is the whole promise of
 * "asked once". A stored index past the end of a shortened itinerary lands on
 * its last stop rather than off the end of it.
 */
export function resumeCursor(
  progress: TourProgress | null,
  tour: readonly TourStop[],
): { completed: boolean; cursor: TourCursor } {
  if (tour.length === 0) return { completed: true, cursor: TOUR_START };
  if (!progress) return { completed: false, cursor: TOUR_START };
  if (progress.completed) return { completed: true, cursor: TOUR_START };
  const stopIndex = Math.min(Math.max(0, progress.index), tour.length - 1);
  return { completed: false, cursor: { stopIndex, beatIndex: -1 } };
}

/* ------------------------------------------------------------------ */
/*  Where the progress is kept                                         */
/* ------------------------------------------------------------------ */

const TOUR_PROGRESS_PATH = "/voice/tour-progress";

/** The local mirror, so an anonymous visitor's refresh still resumes. */
function mirrorKey(surface: VoiceSurface): string {
  return `voice.tour.${surface}`;
}

/**
 * What this device alone remembers, answered without waiting for anything.
 *
 * The opening line cannot hold a microphone shut while a slow network makes up
 * its mind, so it gives the server a couple of seconds and then decides. That
 * budget must not be able to lose a decline: an anonymous visitor's "no thank
 * you" lives only here, and being asked again because the train went into a
 * tunnel is exactly the discourtesy the once-only promise exists to prevent.
 * This is the floor that race can fall back to — the same key, read straight.
 */
export function readTourMirror(surface: VoiceSurface): TourProgress | null {
  return readMirror(surface);
}

function readMirror(surface: VoiceSurface): TourProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(mirrorKey(surface));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TourProgress;
    return typeof parsed?.index === "number" ? parsed : null;
  } catch {
    // Private browsing, a cleared store, a half-written value: none of it is
    // worth a broken tour, so an unreadable mirror simply means "no progress".
    return null;
  }
}

function writeMirror(progress: TourProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(mirrorKey(progress.surface), JSON.stringify(progress));
  } catch {
    // Storage being full or blocked must never stop the walkthrough itself.
  }
}

/**
 * Reconcile what the server remembers with what this device remembers.
 *
 * "Finished or declined" wins outright, from whichever side says it: the offer
 * is made once, and an anonymous visitor's "no thank you" only ever lands in
 * the mirror, because the server has no account to hang it on until they have
 * one. Otherwise the more recent of the two wins, which is also how a stop
 * whose save failed still resumes on the device it happened on.
 */
export function mergeTourProgress(
  remote: TourProgress | null,
  local: TourProgress | null,
): TourProgress | null {
  if (!remote) return local;
  if (!local) return remote;
  if (remote.completed !== local.completed) return remote.completed ? remote : local;
  return local.updatedAt > remote.updatedAt ? local : remote;
}

export async function loadTourProgress(
  ctx: VoiceContext,
  surface: VoiceSurface,
): Promise<TourProgress | null> {
  const local = readMirror(surface);
  try {
    const body = await ctx.call.get<TourProgress | { progress: TourProgress | null } | null>(
      `${TOUR_PROGRESS_PATH}?surface=${encodeURIComponent(surface)}`,
    );
    const remote =
      body && typeof body === "object"
        ? ("progress" in body ? body.progress : (body as TourProgress))
        : null;
    return mergeTourProgress(remote && typeof remote.index === "number" ? remote : null, local);
  } catch {
    return local;
  }
}

export async function saveTourProgress(ctx: VoiceContext, progress: TourProgress): Promise<void> {
  writeMirror(progress);
  try {
    await ctx.call.post(TOUR_PROGRESS_PATH, progress);
  } catch {
    // The mirror already has it. A walkthrough that stops because a write
    // failed would be a worse bug than one that resumes on this device only.
  }
}

/* ------------------------------------------------------------------ */
/*  The executor                                                       */
/* ------------------------------------------------------------------ */

/** Per-call state: the itinerary position, held in memory between tool calls. */
export type TourState = { cursor: TourCursor; running: boolean; paused: boolean; consumedTurn?: number };

/** Conservative recognition of the actual human utterance, shared by both channels. */
export function tourIntent(text: string): "start" | "next" | null {
  const words = text.toLowerCase().replace(/[’']/g, "'").trim();
  if (/\b(no|nope|stop|not|don't|later|wait|but)\b/.test(words)) return null;
  if (/\b(show me around|walk me through|start (?:the |a )?(?:guided )?(?:tour|walkthrough)|take me (?:on|through) (?:a |the )?(?:tour|site|portal|dashboard)|resume (?:the |my )?(?:tour|walkthrough))\b/.test(words)) return "start";
  if (/^(?:(?:yes|yeah|yep|sure|okay|ok|absolutely|please)[,.! ]*)?(?:next(?: (?:please|step|detail|page|section))?|continue|carry on|go on|go ahead|i'm ready|ready|keep going)[.! ]*(?:please[.! ]*)?$/.test(words)) return "next";
  if (/^(?:yes|yeah|yep|sure|okay|ok|absolutely|please)(?:[,.! ]+(?:please|let's (?:start|do it)|show me|i'd like that|that sounds (?:good|great)))?[.! ]*$/.test(words)) return "start";
  return null;
}

function consumeTourTurn(ctx: VoiceContext, state: TourState, starting: boolean): boolean {
  const turn = ctx.getUserTurn?.();
  if (!turn || turn.id === state.consumedTurn) return false;
  const intent = tourIntent(turn.text);
  if (!intent || (starting && intent !== "start")) return false;
  state.consumedTurn = turn.id;
  return true;
}

export function createTourState(): TourState {
  return { cursor: TOUR_START, running: false, paused: false };
}

/* ------------------------------------------------------------------ */
/*  The live store the walkthrough bar reads                           */
/* ------------------------------------------------------------------ */

/**
 * What a running walkthrough looks like from outside.
 *
 * `index` is the stop being narrated, counted from zero like `TourProgress`,
 * and the bar adds one when it writes "Stop 2 of 5". `null` means no
 * walkthrough is running, which is what makes the bar appear and disappear
 * without anything having to tell it to.
 */
export type TourRunState = {
  index: number;
  total: number;
  label: string | null;
  paused: boolean;
} | null;

/** The projection from engine state to what the bar shows. Pure. */
export function tourSnapshotFrom(policy: VoiceSurfacePolicy, state: TourState): TourRunState {
  const total = policy.tour.length;
  if (!state.running || total === 0) return null;
  const index = Math.min(Math.max(0, state.cursor.stopIndex), total - 1);
  const stop = policy.tour[index];
  const known = policy.destinations.find((destination) => destination.key === stop.destination);
  return { index, total, label: known?.label ?? stop.destination, paused: state.paused };
}

/**
 * The walkthrough a person can actually see, as one module-level store.
 *
 * The engine's state is per call, but the bar is a single component that has no
 * way to be handed a session; the registry registers the live one here when it
 * builds a session's tools, exactly as the spotlight publishes the one cursor.
 */
let active: { ctx: VoiceContext; policy: VoiceSurfacePolicy; state: TourState } | null = null;
let published: TourRunState = null;
const tourListeners = new Set<() => void>();

function sameRun(a: TourRunState, b: TourRunState): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.index === b.index && a.total === b.total && a.label === b.label && a.paused === b.paused;
}

/** Republish, and wake the bar only when something it shows has changed. */
function publishTour(): void {
  const next = active ? tourSnapshotFrom(active.policy, active.state) : null;
  if (sameRun(published, next)) return;
  published = next;
  for (const listener of tourListeners) listener();
}

/** Called by the registry as it builds a session's tools. */
export function registerTourSession(
  ctx: VoiceContext,
  policy: VoiceSurfacePolicy,
  state: TourState,
): () => void {
  active = { ctx, policy, state };
  publishTour();
  return () => {
    if (active?.state !== state) return;
    active = null;
    publishTour();
  };
}

export function subscribeTour(onChange: () => void): () => void {
  tourListeners.add(onChange);
  return () => {
    tourListeners.delete(onChange);
  };
}

export function getTourSnapshot(): TourRunState {
  return published;
}

/** A walkthrough is a live thing; the server renders none. */
export function getTourServerSnapshot(): TourRunState {
  return null;
}

/**
 * Pause and resume, from the bar.
 *
 * Pausing is deliberately lighter than stopping: the call stays live, the place
 * is kept and questions are still welcome — the agent simply stops moving on to
 * the next stop until they ask it to carry on. There is no new state beyond the
 * flag, because "do not auto-advance" is the whole of it.
 */
export function pauseTour(): void {
  if (!active?.state.running || active.state.paused) return;
  active.state.paused = true;
  publishTour();
}

export function resumeTour(): void {
  if (!active?.state.running || !active.state.paused) return;
  active.state.paused = false;
  publishTour();
}

/**
 * Stop the walkthrough from the bar.
 *
 * Reaching for the X is somebody saying they are done being shown around, so it
 * is remembered the same way a spoken "no thank you" is: through the same
 * progress record, marked finished, so tomorrow's visit does not open with the
 * offer again. The save is not awaited because a button must not wait on a
 * network round trip, and the local mirror is written first either way.
 */
export function endTour(): void {
  const current = active;
  if (!current || !current.state.running) return;
  current.state.running = false;
  current.state.paused = false;
  clearSpotlight();
  publishTour();
  void saveTourProgress(current.ctx, {
    surface: current.policy.surface,
    index: current.state.cursor.stopIndex,
    completed: true,
    updatedAt: Date.now(),
  });
}

export type TourDeps = {
  policy: VoiceSurfacePolicy;
  history: GuidedHistory;
  state: TourState;
};

function canFocus(focus: string): boolean {
  return resolveElement(focus) !== null;
}

/** Perform one step and hand the agent the line it should say next. */
async function performStep(
  ctx: VoiceContext,
  deps: TourDeps,
  step: TourStep,
): Promise<string> {
  const total = deps.policy.tour.length;

  if (step.kind === "done") {
    deps.state.running = false;
    deps.state.paused = false;
    clearSpotlight();
    publishTour();
    await saveTourProgress(ctx, {
      surface: deps.policy.surface,
      index: total,
      completed: true,
      updatedAt: Date.now(),
    });
    return "That is the whole walkthrough. Say so warmly, in one sentence, and ask what they would like to look at properly.";
  }

  if (step.kind === "travel") {
    const resolved = resolveDestination(deps.policy, { destination: step.stop.destination });
    if (!resolved.ok) {
      // A stop that cannot be reached on this surface is skipped like a missing
      // beat: the walkthrough carries on rather than dead-ending on one entry.
      const next = advanceTour({ stopIndex: step.stopIndex + 1, beatIndex: -1 }, deps.policy.tour, canFocus);
      deps.state.cursor = next.cursor;
      return performStep(ctx, deps, next.step);
    }

    clearSpotlight();
    publishTour();
    const arrival = await travelTo(ctx, deps.history, resolved);
    await saveTourProgress(ctx, {
      surface: deps.policy.surface,
      index: step.stopIndex,
      completed: false,
      updatedAt: Date.now(),
    });
    return [
      `Stop ${step.stopIndex + 1} of ${total} — you have taken them to ${arrival.label} (${arrival.path}).`,
      `What this page is for: ${step.stop.purpose}`,
      snapshotToPrompt(arrival.snapshot),
      "Introduce this page simply in one or two sentences. Invite questions or say they can say next when ready. STOP here: do not call another tour or navigation tool until a new user request.",
    ].join("\n\n");
  }

  const el = resolveElement(step.beat.focus);
  if (el) setSpotlight(el, { caption: step.beat.focus.slice(0, 40) });
  const pointing =
    el && ctx.mode === "voice"
      ? "The pointer is on it now."
      : el
        ? "The pointer is on it now, so they can see which part you mean."
        : "It could not be pointed at, so describe where it is in words.";
  return [
    `Stop ${step.stopIndex + 1} of ${total}, point ${step.beatIndex + 1}: "${step.beat.focus}". ${pointing}`,
    `Say this in your own warm words: ${step.beat.say}`,
    "Explain only this detail in simple language. Wait for their next or continue before another step; answer questions here without advancing. Do not call another tour or navigation tool in this turn.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Tools                                                              */
/* ------------------------------------------------------------------ */

export function buildStartTourTool(toolFn: ToolFn, ctx: VoiceContext, deps: TourDeps): ConciergeTool {
  return toolFn({
    name: "start_guided_tour",
    description:
      "Begin the walkthrough, after they have said yes to being shown around. It takes them to one page and tells you what to explain, then waits for their next request. An explicit request can restart a previously declined or completed tour.",
    strict: false,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    execute: async () => {
      if (deps.policy.tour.length === 0) {
        return "There is no walkthrough for this part of the app. Offer to answer questions instead.";
      }

      if (deps.state.running) return "The walkthrough is already running. Wait for a new next or continue from the person before next_tour_stop.";
      if (!consumeTourTurn(ctx, deps.state, true)) {
        return "No new explicit tour consent was received. Stay here, warmly offer to show them around, and wait for their yes. Do not navigate or call more tour tools.";
      }
      const progress = await loadTourProgress(ctx, deps.policy.surface);
      const resume = resumeCursor(progress, deps.policy.tour);
      // Prior decline suppresses unsolicited offers, not a new explicit request.
      if (resume.completed) resume.cursor = TOUR_START;

      deps.state.running = true;
      deps.state.paused = false;
      const resumed = resume.cursor.stopIndex > 0;
      const next = advanceTour(resume.cursor, deps.policy.tour, canFocus);
      deps.state.cursor = next.cursor;
      publishTour();
      const body = await performStep(ctx, deps, next.step);
      return resumed
        ? `They stopped partway through last time, so pick up where they left off — say so in half a sentence, do not start again.\n\n${body}`
        : body;
    },
  }) as ConciergeTool;
}

export function buildNextTourStopTool(toolFn: ToolFn, ctx: VoiceContext, deps: TourDeps): ConciergeTool {
  return toolFn({
    name: "next_tour_stop",
    description:
      "Move the walkthrough on: point at the next thing on this page, or travel to the next page when this one is finished. Call it only after a NEW user next or continue, at most once per user turn. Questions do not advance the walkthrough.",
    strict: false,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    execute: async () => {
      if (!deps.state.running) {
        return "No walkthrough is running. Offer to show them around, and call start_guided_tour only if they say yes.";
      }
      if (!consumeTourTurn(ctx, deps.state, false)) {
        return "Wait here for a new next or continue from the person. Answer questions without advancing; do not call more tour or navigation tools in this turn.";
      }
      deps.state.paused = false;
      const next = advanceTour(deps.state.cursor, deps.policy.tour, canFocus);
      deps.state.cursor = next.cursor;
      publishTour();
      return performStep(ctx, deps, next.step);
    },
  }) as ConciergeTool;
}

export function buildEndTourTool(toolFn: ToolFn, ctx: VoiceContext, deps: TourDeps): ConciergeTool {
  return toolFn({
    name: "end_guided_tour",
    description:
      "Stop the walkthrough. Use `declined: true` when they said no thank you to being shown around at all — that is remembered, and they are never asked again. Use it with no arguments when they want to stop partway; that place is kept so they can pick up later.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        declined: {
          type: "boolean",
          description: "True when they turned the walkthrough down rather than stopping partway.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (args: { declined?: boolean }) => {
      const declined = args?.declined === true;
      deps.state.running = false;
      deps.state.paused = false;
      clearSpotlight();
      publishTour();
      await saveTourProgress(ctx, {
        surface: deps.policy.surface,
        // Turning it down is recorded as finished, because the offer is made
        // once: "no thank you" and "seen it" both mean never ask again.
        index: declined ? 0 : deps.state.cursor.stopIndex,
        completed: declined,
        updatedAt: Date.now(),
      });
      return declined
        ? "That is remembered — they will not be offered the walkthrough again. Say one friendly line about being there whenever they need something."
        : "The walkthrough is paused here and their place is kept. Tell them they can pick it up whenever they like, and ask what they need now.";
    },
  }) as ConciergeTool;
}
