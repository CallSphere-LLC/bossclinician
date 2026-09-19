import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  CaptionLine,
  ConciergeTool,
  ToolFn,
  VoiceSurface,
  VoiceSurfacePolicy,
} from "../contract";
import {
  attachVoiceAgentAudioTap,
  clearVoiceCaptions,
  detachVoiceAgentAudioTap,
  getServerVoiceCaptions,
  getVoiceCaptions,
  ingestRealtimeCaptionEvent,
  readVoiceAgentLevels,
  realtimeAgentSpeechState,
  subscribeVoiceCaptions,
} from "./audio-tap";
import { describeVoiceError, requestAdmission } from "./connect";
import { putVoiceRecording, voiceFetch } from "./api-client";
import type { RealtimeSession } from "./live-session.client";

/**
 * useVoiceSession — one call, from the microphone to the hangup.
 *
 * This is the only stateful thing in the kernel and the only place the parts
 * meet: it acquires the microphone, mints an admission, stands up the live
 * session, hands the agent the tools the surface built, counts the call down to
 * its cap, and tears everything down in an order that does not lose the last
 * few seconds of audio.
 *
 * It deliberately knows nothing about what the tools DO. A new capability is a
 * new entry in the policy's tool list; nothing in this file changes.
 */

export type VoiceStatus = "idle" | "requesting-mic" | "connecting" | "live" | "ending" | "error";

export type VoiceSessionHandle = {
  status: VoiceStatus;
  error: string | null;
  /** True while the agent is speaking — drives the orb and the cursor's caption. */
  isSpeaking: boolean;
  captions: CaptionLine[];
  sessionId: string | null;
  /**
   * The surface the SERVER admitted this call to, which can be lower than the
   * one the policy asked for — a signed-out visitor standing on an admin URL
   * gets the public concierge. Null until a call is running. The UI reads it to
   * explain that, instead of quietly offering less than the page implies.
   */
  activeSurface: VoiceSurface | null;
  /** Whether the SERVER is recording this call, which is what the disclosure
   * must be shown from — not what the browser's policy hoped for. */
  recording: boolean;
  secondsRemaining: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Poll once per animation frame. Never React state — 60fps of setState is a jank machine. */
  readLevels: () => { agent: number; mic: number };
  /** Inject a typed/spoken-for-them turn (used by the chat approval path). */
  say: (text: string) => void;
};

export type VoiceSessionInput = {
  policy: VoiceSurfacePolicy;
  /** The UI passes a closure that builds the tool list once the SDK shim is loaded. */
  buildTools: (toolFn: ToolFn) => readonly unknown[];
  /**
   * The opening line for THIS call, when the UI knows something the policy
   * cannot: on a person's first visit to a surface it offers the walkthrough
   * rather than the ordinary greeting. Whether this is a first visit is a
   * question about a person, not about a surface, so the UI owns it and the
   * kernel just speaks what it is given.
   *
   * A function is resolved AFTER the admission comes back, and is handed the
   * surface the SERVER granted rather than the one the policy asked for. That
   * ordering is the whole point of allowing a function: a first-time visitor
   * whose admin session has quietly expired must not be offered a tour of a
   * dashboard the server is in the middle of refusing them. A plain string is
   * a caller who has nothing to decide.
   */
  greetingOverride?: string | ((activeSurface: VoiceSurface) => string);
  onTranscriptLine?: (line: { role: "user" | "agent"; text: string; atMs: number }) => void;
};

/**
 * The shim loads on intent, not on page load.
 *
 * It is the whole live transport and it is useless until someone presses the
 * microphone, so it becomes its own chunk that the browser fetches during the
 * handshake instead of sitting in the bundle of every page. Memoised, so a
 * retry does not re-import it.
 */
let shimPromise: Promise<typeof import("./live-session.client")> | null = null;
function loadLiveSessionShim() {
  if (!shimPromise) shimPromise = import("./live-session.client");
  return shimPromise;
}

/** How long before the cap the agent is asked to start saying goodbye. */
const FAREWELL_LEAD_SECONDS = 20;

/* ============================== call recorder ============================== */

/**
 * The browser is the only place a recording can be made, and it streams.
 *
 * The audio exists solely on the peer connection between this tab and the
 * provider; nothing server-side ever hears it, and the provider keeps nothing
 * retrievable. So the two legs are mixed here — the person's microphone from
 * the senders, the agent's voice from the receivers — and slices are posted
 * throughout the call rather than assembled and uploaded at the end.
 *
 * That is the whole design, not an optimisation. Holding the call in memory and
 * uploading on hangup loses everything whenever the tab closes first, and a
 * `MediaRecorder.stop()` plus an upload is exactly the work a closing document
 * does not wait for. Streaming costs at most the final few seconds on a hard
 * crash instead of the entire conversation.
 *
 * Best-effort throughout: a browser without MediaRecorder, or without a codec
 * we can name, simply does not record. Recording must never be the reason a
 * call fails to start.
 */
type CallRecorder = {
  /** Flush the tail slice, upload it, and release the audio graph. */
  stop: () => Promise<void>;
  /** Best-effort flush for a page that is going away. */
  flushOnUnload: () => void;
};

/**
 * Three seconds a slice: small enough that an unflushed tail is trivial, large
 * enough to keep this to twenty requests a minute.
 */
const RECORDING_TIMESLICE_MS = 3000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
    } catch {
      // A browser that throws on the question has no opinion worth having.
    }
  }
  return "";
}

function startCallRecording(pc: RTCPeerConnection, sessionId: string, surface: VoiceSurface): CallRecorder | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  // A recording graph only runs while its context does.
  void ctx.resume().catch(() => {});

  const destination = ctx.createMediaStreamDestination();
  const mixed = new WeakSet<MediaStreamTrack>();
  const mix = (track: MediaStreamTrack | null | undefined) => {
    if (!track || track.kind !== "audio" || mixed.has(track)) return;
    try {
      ctx.createMediaStreamSource(new MediaStream([track])).connect(destination);
      mixed.add(track);
    } catch {
      // One unattachable leg is a worse recording, not a failed call.
    }
  };

  try {
    pc.getSenders().forEach((s) => mix(s.track));
    pc.getReceivers().forEach((r) => mix(r.track));
  } catch {
    // The late-track listener below still catches the agent's voice.
  }
  // The agent's remote track routinely arrives after the connection settles.
  const onTrack = (e: RTCTrackEvent) => mix(e.track);
  pc.addEventListener("track", onTrack);

  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(destination.stream, { mimeType, audioBitsPerSecond: 32000 })
      : new MediaRecorder(destination.stream);
  } catch {
    pc.removeEventListener("track", onTrack);
    void ctx.close().catch(() => {});
    return null;
  }

  let seq = 0;
  // Uploads are chained rather than fired in parallel so the sequence numbers
  // leave this tab in the order they were produced. The store tolerates a gap
  // or a repeat, but it should not have to.
  let uploads = Promise.resolve();
  const send = (slice: Blob, keepalive: boolean) => {
    const at = seq++;
    uploads = uploads.then(() =>
      putVoiceRecording(sessionId, at, slice, { keepalive, surface }).catch((uploadError) => {
        // A lost slice is a shorter recording. It is never a reason to disturb
        // a call that is still happening.
        console.warn(`The call recording lost slice ${at}:`, describeVoiceError(uploadError));
      }),
    );
  };

  let leaving = false;
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) send(event.data, leaving);
  };
  recorder.start(RECORDING_TIMESLICE_MS);

  const release = () => {
    pc.removeEventListener("track", onTrack);
    void ctx.close().catch(() => {});
  };

  return {
    stop: async () => {
      if (recorder.state !== "inactive") {
        // `stop()` produces one final slice asynchronously, so the upload of
        // that slice has to be awaited too — the last few seconds of a call
        // are the goodbye, and shipping the recording without them is the one
        // omission somebody would actually notice.
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          try {
            recorder.stop();
          } catch {
            resolve();
          }
        });
      }
      release();
      await uploads;
    },
    flushOnUnload: () => {
      // The document is going away and nothing here will be awaited. Ask for
      // the buffered slice and let it go out on a keepalive request, which is
      // allowed to outlive the page. Best-effort by definition: it saves the
      // tail more often than not, and the slices already sent are safe either
      // way, which is the entire reason this streams.
      leaving = true;
      try {
        if (recorder.state === "recording") recorder.requestData();
      } catch {
        // Nothing more to try; the earlier slices are already stored.
      }
    },
  };
}

/* =============================== one call's own ============================ */

/**
 * Everything a single call owns, taken out of the hook's refs in one breath.
 *
 * Letting go of a call politely takes time: the recorder's tail slice has to be
 * uploaded, and the provider's close waits up to fifteen seconds for the final
 * usage. A teardown that read the hook's refs on the far side of those waits
 * would be reading whatever is there NOW — and `start` is free again the moment
 * the teardown begins, so what is there now can easily be the next call's
 * microphone. Taking the resources first means a teardown can only ever release
 * the call it was asked to end.
 */
type OwnedCall = {
  sessionId: string | null;
  session: RealtimeSession | null;
  recorder: CallRecorder | null;
  micStream: MediaStream | null;
  audioElement: HTMLAudioElement | null;
};

type Held<T> = { current: T };

/** Empties the refs and hands back what was in them. Synchronous on purpose. */
export function takeOwnedCall(refs: {
  sessionId: Held<string | null>;
  session: Held<RealtimeSession | null>;
  recorder: Held<CallRecorder | null>;
  micStream: Held<MediaStream | null>;
  audioElement: Held<HTMLAudioElement | null>;
}): OwnedCall {
  const owned: OwnedCall = {
    sessionId: refs.sessionId.current,
    session: refs.session.current,
    recorder: refs.recorder.current,
    micStream: refs.micStream.current,
    audioElement: refs.audioElement.current,
  };
  refs.sessionId.current = null;
  refs.session.current = null;
  refs.recorder.current = null;
  refs.micStream.current = null;
  refs.audioElement.current = null;
  return owned;
}

/**
 * Release one call's resources, in the order that preserves the audio.
 *
 * `superseded` answers "has another call begun while this was draining?". Only
 * the audio tap has to ask: it is the page's, not the call's, so detaching it
 * late would blind the orb and the captions of whoever is talking now. The
 * microphone and the audio element belong to this call whatever else has
 * happened, and are released either way.
 */
export async function releaseOwnedCall(
  owned: OwnedCall,
  surface: VoiceSurface,
  superseded: () => boolean,
): Promise<void> {
  // The recorder first, while the peer connection is still up: stopping the
  // connection first silences the mix before the tail slice is flushed, and
  // that tail is the goodbye.
  if (owned.recorder) await owned.recorder.stop().catch(() => {});

  // `close` waits for the provider's own `session.closed`, which is what
  // carries the final usage, so the call is billed for what it used.
  if (owned.session) await owned.session.close().catch(() => {});

  if (owned.sessionId) {
    await voiceFetch("/voice/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: owned.sessionId, reason: "hung up" }),
      keepalive: true,
    }, surface).catch((failure) => {
      console.warn("Voice conversation end could not be saved", failure);
    });
  }

  if (!superseded()) detachVoiceAgentAudioTap();

  owned.micStream?.getTracks().forEach((track) => track.stop());
  const element = owned.audioElement;
  if (element) {
    element.pause();
    element.srcObject = null;
  }
}

/* ================================= the hook ================================ */

export function useVoiceSession(input: VoiceSessionInput): VoiceSessionHandle {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeSurface, setActiveSurface] = useState<VoiceSurface | null>(null);
  const [recording, setRecording] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const captions = useSyncExternalStore(subscribeVoiceCaptions, getVoiceCaptions, getServerVoiceCaptions);

  // The caller re-renders constantly; the callbacks below must not. Everything
  // the hook needs from its input is read through this ref at call time.
  const inputRef = useRef(input);
  inputRef.current = input;

  const sessionRef = useRef<RealtimeSession | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<CallRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const capTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const farewellSentRef = useRef(false);
  const startingRef = useRef(false);
  const startGeneration = useRef(0);
  const liveRef = useRef(false);
  const hangingUpRef = useRef(false);
  const loggedTurnsRef = useRef<Set<string>>(new Set());

  /** Everything the hook owns, released in the order that preserves the audio. */
  const teardown = useCallback(async (): Promise<void> => {
    const generation = ++startGeneration.current;
    startingRef.current = false;
    const owned = takeOwnedCall({
      sessionId: sessionIdRef,
      session: sessionRef,
      recorder: recorderRef,
      micStream: micStreamRef,
      audioElement: audioElementRef,
    });
    // Freeze queued actions immediately; flushing the recorder may take time.
    owned.session?.beginClose();
    if (capTimerRef.current) {
      clearInterval(capTimerRef.current);
      capTimerRef.current = null;
    }

    // Everything below this line is bookkeeping about a call that is already
    // over, so it is settled now rather than after the waits — a hangup that
    // left the countdown and the recording notice on screen for the fifteen
    // seconds a provider close may take would read as a call still running.
    liveRef.current = false;
    recordingRef.current = false;
    loggedTurnsRef.current.clear();
    farewellSentRef.current = false;
    setIsSpeaking(false);
    setSecondsRemaining(null);
    setSessionId(null);
    setActiveSurface(null);
    setRecording(false);

    await releaseOwnedCall(
      owned,
      inputRef.current.policy.surface,
      () => generation !== startGeneration.current,
    );
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    if (hangingUpRef.current) return;
    hangingUpRef.current = true;
    setStatus((current) => (current === "error" ? current : "ending"));
    try {
      await teardown();
    } finally {
      hangingUpRef.current = false;
      setStatus((current) => (current === "error" ? current : "idle"));
    }
  }, [teardown]);

  /** Ends the call from inside an event handler, where awaiting is not an option. */
  const hangUp = useCallback(() => {
    void stop();
  }, [stop]);

  const fail = useCallback(
    (cause: unknown) => {
      setError(describeVoiceError(cause));
      setStatus("error");
      void teardown();
    },
    [teardown],
  );

  const start = useCallback(async (): Promise<void> => {
    // One call at a time. A double-press, or a press while the previous call is
    // still hanging up, must not mint a second admission — they are one-use, so
    // the loser of that race fails the handshake for no visible reason.
    if (startingRef.current || sessionRef.current || hangingUpRef.current) return;
    startingRef.current = true;
    const generation = ++startGeneration.current;
    const { policy, buildTools } = inputRef.current;

    setError(null);
    clearVoiceCaptions();
    loggedTurnsRef.current.clear();
    farewellSentRef.current = false;

    const recordLine = (role: "user" | "agent", text: string | undefined, itemId?: string) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      // The same line arrives as both a provider event and a locally flushed
      // caption fragment. Persisting both would double every turn.
      const key = itemId ? `${role}:${itemId}` : null;
      if (key && loggedTurnsRef.current.has(key)) return;
      if (key) loggedTurnsRef.current.add(key);
      inputRef.current.onTranscriptLine?.({
        role,
        text: trimmed,
        atMs: Date.now() - startedAtRef.current,
      });
    };

    // Held outside the try so the catch can tell a handshake that FAILED from
    // one that was cancelled out from under it.
    let startedSession: RealtimeSession | null = null;

    try {
      // The microphone comes before the admission, not after. The admission is
      // deliberately short-lived, and a permission prompt left sitting on
      // screen would expire it — producing a handshake failure whose real cause
      // was a person deciding whether to say yes.
      setStatus("requesting-mic");
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (generation !== startGeneration.current) {
        micStream.getTracks().forEach((track) => track.stop());
        return;
      }
      micStreamRef.current = micStream;

      setStatus("connecting");
      const admission = await requestAdmission({
        surface: policy.surface,
        path: `${window.location.pathname}${window.location.search}`,
      });
      if (generation !== startGeneration.current) {
        await voiceFetch("/voice/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: admission.sessionId, reason: "hung up" }),
          keepalive: true,
        }, policy.surface).catch(() => undefined);
        return;
      }
      sessionIdRef.current = admission.sessionId;
      setSessionId(admission.sessionId);
      // The clock transcript lines are stamped against starts here, with the
      // session row, rather than after the handshake — so a line's offset means
      // "this far into the call" on the same timeline the server filed.
      startedAtRef.current = Date.now();
      // The server's answer wins on all three counts. It re-decided the surface
      // from the request's own credentials, and its cap and recording decision
      // are the law; the policy's copies are the browser's expectation.
      recordingRef.current = policy.recordAudio && admission.recording;
      setActiveSurface(admission.surface);
      setRecording(recordingRef.current);
      // Resolved here, against what the server granted, and not a moment
      // earlier — see `greetingOverride` for why the order is the point.
      const { greetingOverride } = inputRef.current;
      const greeting =
        (typeof greetingOverride === "function"
          ? greetingOverride(admission.surface)
          : greetingOverride) || policy.greeting;
      const capSeconds = Math.min(policy.maxSessionSeconds, admission.maxSessionSeconds);

      const shim = await loadLiveSessionShim();
      if (generation !== startGeneration.current) return;
      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.setAttribute("playsinline", "");
      audioElementRef.current = audioElement;

      const agent = new shim.RealtimeAgent({
        name: policy.agentName,
        instructions: policy.instructions,
        tools: buildTools(shim.tool) as ConciergeTool[],
        // The server chose the voice, so the agent is told the same one the
        // connect URL will carry. The policy's copy is the browser's wish.
        voice: admission.voice,
      });
      const transport = new shim.OpenAIRealtimeWebRTC({ mediaStream: micStream, audioElement });
      const session = new shim.RealtimeSession(agent, { transport });
      startedSession = session;

      session.on("audio_start", () => setIsSpeaking(true));
      session.on("audio_stopped", () => setIsSpeaking(false));

      session.on("transport_event", (event: { type?: string; live?: boolean; transcript?: string; item_id?: string }) => {
        ingestRealtimeCaptionEvent(event);
        // Locally projected caption events carry `live: true`. They describe a
        // transcript fragment, not the media, so letting them drive the
        // speaking state would make the orb pulse to text rather than to voice.
        const speaking = event.live ? null : realtimeAgentSpeechState(event.type ?? "");
        if (speaking !== null) setIsSpeaking(speaking);

        if (event.type === "conversation.item.input_audio_transcription.completed") {
          recordLine("user", event.transcript, event.item_id);
        }
        if (
          event.type === "response.output_audio_transcript.done" ||
          event.type === "response.audio_transcript.done"
        ) {
          recordLine("agent", event.transcript, event.item_id);
        }
      });

      session.on("error", (sessionError: unknown) => {
        // Nothing this call says still counts once it has been let go of. Its
        // audio element's `play()` rejects as that element is released, which
        // is precisely when a call that replaced it is standing up — and
        // failing THAT one on this one's last words is how a retry that worked
        // ends up showing an error nobody caused.
        if (sessionRef.current !== session) return;
        // The provider emits recoverable errors mid-call — cancellation races,
        // an empty audio commit, a transcription hiccup. While the transport is
        // still connected the conversation is still happening, and tearing down
        // here is what used to mark perfectly good calls as failures.
        if (transport.status === "connected") {
          console.warn("Voice concierge: recoverable error ignored:", describeVoiceError(sessionError));
          return;
        }
        fail(sessionError);
      });

      transport.on("connection_change", (next: string) => {
        // Both halves of this belong to one call, and a call that has been let
        // go of has no say in either. Its `session.started` can still land —
        // the provider's close waits up to fifteen seconds on the same data
        // channel the start arrives on — and its final `disconnected` always
        // does, as the close completes. By then the refs below are a REPLACEMENT
        // call's: attaching here would build a tap and a recorder nothing can
        // stop, and hanging up here would drop the call somebody is on.
        if (sessionRef.current !== session) return;
        if (next === "connected") {
          const pc = transport.connectionState.peerConnection;
          if (pc) {
            attachVoiceAgentAudioTap(pc);
            if (recordingRef.current && !recorderRef.current) {
              recorderRef.current = startCallRecording(pc, admission.sessionId, admission.surface);
            }
          }
          return;
        }
        if (next === "disconnected" && liveRef.current && !hangingUpRef.current) {
          // The far end went away on its own, mid-conversation. Close out
          // exactly as a hangup would, so the recording and the session row
          // still land. A drop DURING the handshake is deliberately not this:
          // the failed connect below already reports it, and running both
          // would tear the same call down twice.
          hangUp();
        }
      });

      // Published BEFORE the handshake on purpose. Someone who changes their
      // mind while the call is still connecting — or navigates away — must be
      // able to close a session that does not exist yet from `stop`'s point of
      // view; otherwise the handshake completes into a call nobody is holding,
      // with a microphone that has already been released.
      sessionRef.current = session;
      await session.connect({
        admission: admission.admission,
        backendModel: admission.backendModel,
        voice: admission.voice,
      });
      if (generation !== startGeneration.current) return;
      liveRef.current = true;
      setStatus("live");

      // The hard cap. The server hangs up at the same mark, so this is not the
      // security boundary — it is what lets the agent say goodbye instead of
      // being cut off mid-sentence.
      const deadline = Date.now() + capSeconds * 1000;
      setSecondsRemaining(capSeconds);
      capTimerRef.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setSecondsRemaining(left);
        if (left <= FAREWELL_LEAD_SECONDS && !farewellSentRef.current && sessionRef.current) {
          farewellSentRef.current = true;
          sessionRef.current.sendMessage(
            "[System: this call is about to reach its time limit. Say one warm, short goodbye in the language the person has been speaking, and then stop.]",
          );
        }
        if (left <= 0) hangUp();
      }, 1000);

      // A short settle before the first word. The data channel is open but the
      // media path is still finishing, and a greeting sent on the same tick is
      // simply not heard.
      setTimeout(() => {
        if (sessionRef.current !== session) return;
        session.sendMessage(
          `[System: the person has just opened the microphone. Open the conversation by saying this, in your own warm voice and without adding anything before it: "${greeting}" Then stop and listen.]`,
        );
      }, 150);
    } catch (startError) {
      // If teardown has already let go of this session, the handshake did not
      // fail — it was cancelled, by a hangup or by the page going away. Saying
      // "error" to someone who pressed stop is a lie about their own action.
      if (generation === startGeneration.current && (!startedSession || sessionRef.current === startedSession)) fail(startError);
    } finally {
      if (generation === startGeneration.current) startingRef.current = false;
    }
  }, [fail, hangUp]);

  const readLevels = useCallback(() => readVoiceAgentLevels() ?? { agent: 0, mic: 0 }, []);

  const say = useCallback((text: string) => {
    sessionRef.current?.sendMessage(text);
  }, []);

  // A person who navigates away from the page mid-call has ended the call, and
  // an orphaned microphone is the one bug they would never forgive.
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  // A closing tab will not wait for a teardown, so the only thing worth doing
  // is asking the recorder for its buffered slice on the way out. Everything
  // recorded before this moment is already stored, which is what streaming
  // bought; this just narrows the loss from a few seconds to almost none.
  useEffect(() => {
    const flush = () => recorderRef.current?.flushOnUnload();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return {
    status,
    error,
    isSpeaking,
    captions,
    sessionId,
    activeSurface,
    recording,
    secondsRemaining,
    start,
    stop,
    readLevels,
    say,
  };
}
