/**
 * VoiceConcierge — the whole widget, and the place everything is wired together.
 *
 * This is the composition root. The kernel knows how to hold a call open and
 * nothing about this app; the tools know how to move around this app and
 * nothing about a call. This component is the only thing that knows both, so it
 * is the only thing that builds the `VoiceContext` — the router's navigate, the
 * address of the page as it stands right now, the app's own API client, and the
 * owner's approval queue — and hands it to the tool registry.
 *
 * The voice button lives inside the shared chat panel. Pressing it shows the recording
 * notice, and only once that has been read does the microphone open. From there
 * the orb moves to the real voice, the captions write down what is said, the
 * cursor points at whatever is being talked about, and — on the admin only —
 * an approval card appears whenever the assistant wants to change something.
 *
 * Everything in here is client-only. The module is imported by a lazy route
 * chunk and every measurement of the window happens inside an effect, because
 * this app renders its public pages on the server and a stray `window` at
 * import time takes the whole site's server render down with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Mic, PhoneOff } from "lucide-react";
import type { ToolFn, VoiceContext, VoiceSurfacePolicy } from "@/voice/contract";
import { createVoiceApiClient, useVoiceSession } from "@/voice/kernel";
import { buildVoiceTools } from "@/voice/tools";
import { cn } from "@/lib/cn";
import { ApprovalHost } from "./ApprovalCard";
import { cancelPendingApprovals, requestApproval } from "./approval-store";
import { demotedNotice } from "./demotion";
import { decideGreeting, type GreetingDecision } from "./first-visit";
import {
  RecordingCorrection,
  RecordingDisclosure,
  disclosureUnderstated,
  hasSeenDisclosure,
  rememberDisclosure,
  rememberRecordingVerdict,
  willDiscloseRecording,
} from "./RecordingDisclosure";
import { VoiceCaptions } from "./VoiceCaptions";
import { VoiceOrb } from "./VoiceOrb";
import { VoiceSpotlight } from "./VoiceSpotlight";
import { VoiceTourBar } from "./VoiceTourBar";

/** Lines are sent up in batches; a written record is not worth a request each. */
const TRANSCRIPT_FLUSH_MS = 4_000;

type TranscriptLine = { role: "user" | "agent"; text: string; atMs: number };

function timeLeft(seconds: number): string {
  if (seconds >= 120) return `${Math.round(seconds / 60)} minutes left`;
  if (seconds >= 60) return "a minute left";
  return `${Math.max(0, seconds)} seconds left`;
}

function troubleWith(error: string | null): string {
  const lower = (error ?? "").toLowerCase();
  if (lower.includes("permission") || lower.includes("denied") || lower.includes("notallowed")) {
    return "I could not hear anything — your browser is holding the microphone back. Allow it for this page and try again.";
  }
  if (lower.includes("microphone") || lower.includes("audio") || lower.includes("device")) {
    return "I could not find a microphone to listen with. Check the one you want to use is plugged in and try again.";
  }
  return "Something went wrong before we got started. Give it another try in a moment.";
}

export function VoiceConcierge({ policy, container, onActiveChange }: {
  policy: VoiceSurfacePolicy;
  container: HTMLElement | null;
  onActiveChange: (active: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Read through a ref, never captured: a tool asks where we are at the moment
  // it runs, and the answer has to include the query and the hash. Two entries
  // on one pathname are two different places, and a tour that cannot tell them
  // apart walks in circles.
  const locationRef = useRef(location);
  locationRef.current = location;

  // Set from the handle once the server opens the row (below). Tools read it
  // when they run, not when the context is built, so an audit entry lands on
  // the conversation it actually belongs to.
  const sessionIdRef = useRef<string | null>(null);
  const userTurnRef = useRef<{ id: number; text: string } | null>(null);

  const api = useMemo(() => createVoiceApiClient(policy.surface), [policy.surface]);

  const context = useMemo<VoiceContext>(
    () => ({
      navigate: (path: string) => navigate(path),
      getLocation: () => {
        const at = locationRef.current;
        return `${at.pathname}${at.search}${at.hash}`;
      },
      surface: policy.surface,
      mode: "voice",
      getSessionId: () => sessionIdRef.current,
      getUserTurn: () => userTurnRef.current,
      // Only the owner's console can change anything, so only the owner's
      // console is handed a way to ask.
      requestApproval: policy.surface === "admin" ? requestApproval : undefined,
      call: api,
    }),
    [api, navigate, policy.surface],
  );

  const buildTools = useCallback(
    (toolFn: ToolFn) => buildVoiceTools(policy, toolFn, context) as unknown[],
    [context, policy],
  );

  /* ------------------------- the written record ------------------------- */

  const bufferedLines = useRef<TranscriptLine[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stillHere = useRef(true);

  const flushTranscript = useCallback(function flush(): void {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const sessionId = sessionIdRef.current;
    if (bufferedLines.current.length === 0) return;
    if (!sessionId) {
      // The first words can be spoken before the call has a record to hang
      // them off. Wait for it rather than throw them away — but not past the
      // life of the widget, or the wait becomes a timer that never stops.
      if (stillHere.current) flushTimer.current = setTimeout(() => flush(), TRANSCRIPT_FLUSH_MS);
      return;
    }
    const lines = bufferedLines.current;
    bufferedLines.current = [];
    // Deliberately unawaited and deliberately silent. The transcript is a
    // record kept for afterwards; losing a line to a flaky network must never
    // interrupt the conversation that is happening right now.
    void api.post("/voice/transcript", { sessionId, lines }).catch(() => undefined);
  }, [api]);

  const onTranscriptLine = useCallback(
    (line: TranscriptLine) => {
      if (line.role === "user") userTurnRef.current = { id: (userTurnRef.current?.id ?? 0) + 1, text: line.text };
      bufferedLines.current.push(line);
      if (!flushTimer.current) {
        flushTimer.current = setTimeout(flushTranscript, TRANSCRIPT_FLUSH_MS);
      }
    },
    [flushTranscript],
  );

  /* --------------------------- the opening line -------------------------- */

  const [greetingOverride, setGreetingOverride] = useState<string | undefined>(undefined);
  const [armed, setArmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const greetingLookup = useRef<Promise<GreetingDecision> | null>(null);

  const lookUpGreeting = useCallback(() => {
    // Started the moment the button is pressed, so it runs while the recording
    // notice is being read rather than after it.
    if (!greetingLookup.current) greetingLookup.current = decideGreeting(policy, context);
    return greetingLookup.current;
  }, [context, policy]);

  /* ------------------------------ the call ------------------------------ */

  const handle = useVoiceSession({ policy, buildTools, onTranscriptLine, greetingOverride });
  // Held rather than mirrored: the kernel forgets the call the moment it hangs
  // up, and the last few lines still have to find their way to the record.
  if (handle.sessionId) sessionIdRef.current = handle.sessionId;

  const startRef = useRef(handle.start);
  startRef.current = handle.start;
  const stopRef = useRef(handle.stop);
  stopRef.current = handle.stop;
  const sayRef = useRef(handle.say);
  sayRef.current = handle.say;

  const [panelOpen, setPanelOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [toldRecorded, setToldRecorded] = useState(true);
  const [correcting, setCorrecting] = useState(false);

  const busy =
    handle.status === "requesting-mic" ||
    handle.status === "connecting" ||
    handle.status === "ending";
  const live = handle.status === "live";
  const talking = live || busy;

  useEffect(() => {
    onActiveChange(talking || preparing || gateOpen || correcting);
  }, [onActiveChange, talking, preparing, gateOpen, correcting]);

  const beginCall = useCallback(async () => {
    setGateOpen(false);
    userTurnRef.current = null;
    setPreparing(true);
    const decision = await lookUpGreeting();
    greetingLookup.current = null;
    // The greeting is an input to the hook, so it has to be in place for the
    // render before the one that starts talking. Setting it here and arming the
    // start in the same breath gets that order for free.
    setGreetingOverride(decision.greeting);
    setPreparing(false);
    setArmed(true);
  }, [lookUpGreeting]);

  useEffect(() => {
    if (!armed) return;
    // Disarming immediately re-runs this effect, so nothing here may live in a
    // cleanup function: the second run would tear down the start that the first
    // one only just asked for.
    setArmed(false);
    // Nothing is written down about the offer here. Being asked is not an
    // answer, and only an answer — taken or declined — is the walkthrough's to
    // remember; it records that itself, on the server and in this browser.
    void startRef.current().catch(() => undefined);
  }, [armed]);

  const endCall = useCallback(async () => {
    // Nothing the assistant asked for outlives the conversation it asked in.
    cancelPendingApprovals();
    await stopRef.current().catch(() => undefined);
    flushTranscript();
  }, [flushTranscript]);

  // A call can also end without anyone pressing anything — it has a hard
  // length limit — so the record is settled whenever the call comes to rest.
  useEffect(() => {
    if (handle.status !== "idle" && handle.status !== "error") return;
    // A call that never got as far as having a record has nothing to attach its
    // words to, so they are let go rather than waited on forever.
    if (!sessionIdRef.current) bufferedLines.current = [];
    flushTranscript();
  }, [handle.status, flushTranscript]);

  useEffect(
    () => () => {
      stillHere.current = false;
      cancelPendingApprovals();
      flushTranscript();
    },
    [flushTranscript],
  );

  const onButton = useCallback(() => {
    if (talking) {
      void endCall();
      setPanelOpen(false);
      return;
    }
    setPanelOpen(true);
    setCorrecting(false);
    void lookUpGreeting();
    if (hasSeenDisclosure(policy.surface)) void beginCall();
    else {
      setToldRecorded(willDiscloseRecording(policy.surface, policy.recordAudio));
      setGateOpen(true);
    }
  }, [beginCall, endCall, lookUpGreeting, policy.recordAudio, policy.surface, talking]);

  const acceptDisclosure = useCallback(() => {
    rememberDisclosure(policy.surface, toldRecorded);
    void beginCall();
  }, [beginCall, policy.surface, toldRecorded]);

  // The server's verdict arrives only once the call is open. Keep it, so the
  // next notice on this surface is exact rather than cautious — and if it
  // contradicts what this person was told, say so before another word is said.
  useEffect(() => {
    if (handle.status !== "live") return;
    rememberRecordingVerdict(policy.surface, handle.recording);
    if (disclosureUnderstated(policy.surface, handle.recording)) setCorrecting(true);
  }, [handle.status, handle.recording, policy.surface]);

  const dismiss = useCallback(() => {
    setGateOpen(false);
    setPanelOpen(false);
  }, []);

  const buttonLabel = live
    ? "End the call with Boss Clinician AI"
    : busy || preparing
      ? "Getting ready to talk"
      : "Talk to Boss Clinician AI";

  const demotion =
    handle.activeSurface === null ? null : demotedNotice(policy.surface, handle.activeSurface);

  const showPanel =
    panelOpen && (gateOpen || correcting || talking || preparing || handle.status === "error");

  return (
    <>
      <VoiceSpotlight speaking={live ? handle.isSpeaking : undefined} />
      <VoiceTourBar />
      {policy.surface === "admin" && talking && (
        <ApprovalHost onUndelivered={(text) => sayRef.current(text)} />
      )}

      {container && createPortal(
      <div className="flex min-w-0 flex-col gap-2" data-testid="chat-voice-controls">
        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
              className="w-full min-w-0 rounded-2xl border border-hairline bg-surface-raised/95 p-3"
            >
              {gateOpen ? (
                <RecordingDisclosure
                  recorded={toldRecorded}
                  busy={preparing}
                  onAccept={acceptDisclosure}
                  onCancel={dismiss}
                />
              ) : correcting ? (
                <RecordingCorrection
                  onAcknowledge={() => {
                    rememberDisclosure(policy.surface, true);
                    setCorrecting(false);
                  }}
                  onEnd={() => {
                    rememberDisclosure(policy.surface, true);
                    setCorrecting(false);
                    void endCall();
                    setPanelOpen(false);
                  }}
                />
              ) : handle.status === "error" ? (
                <div className="space-y-3">
                  <p className="text-[0.82rem] leading-relaxed text-ink">{troubleWith(handle.error)}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void beginCall()}
                      className="rounded-full bg-gold-foil px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-night-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={dismiss}
                      className="rounded-full px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink-soft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <VoiceOrb
                      speaking={handle.isSpeaking}
                      readLevels={live ? handle.readLevels : null}
                      surface={policy.surface}
                      size={28}
                    />
                    <p className="min-w-0 flex-1 truncate text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ink">
                      {live ? "Boss Clinician AI" : "Getting ready"}
                    </p>
                    {live && handle.secondsRemaining !== null && (
                      <span className="shrink-0 text-[0.62rem] tabular-nums text-ink-soft">
                        {timeLeft(handle.secondsRemaining)}
                      </span>
                    )}
                  </div>

                  {demotion && (
                    <p className="rounded-xl border border-gold/35 bg-gold/[0.08] px-3 py-2 text-[0.76rem] leading-relaxed text-ink">
                      {demotion}
                    </p>
                  )}

                  <VoiceCaptions lines={handle.captions} live={live} className="max-h-28" />

                  <button
                    type="button"
                    onClick={() => {
                      void endCall();
                      setPanelOpen(false);
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-hairline px-4 py-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-gold/50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                    End call
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {!showPanel && (
          <button
            type="button"
            onClick={onButton}
            aria-label={buttonLabel}
            aria-pressed={live}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
              "hover:opacity-90",
              live
                ? "border border-hairline bg-surface-raised/95 shadow-[0_18px_44px_-18px_rgba(0,0,0,0.75)] backdrop-blur"
                : "bg-gold-foil text-night-deep shadow-[0_18px_44px_-16px_rgba(201,164,106,0.65)]",
            )}
          >
            {live ? (
              <VoiceOrb
                speaking={handle.isSpeaking}
                readLevels={handle.readLevels}
                surface={policy.surface}
                size={34}
              />
            ) : busy || preparing ? (
              <Loader2 className="h-5 w-5 motion-safe:animate-spin" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            <span>{buttonLabel}</span>
          </button>
        )}
      </div>, container)}
    </>
  );
}
