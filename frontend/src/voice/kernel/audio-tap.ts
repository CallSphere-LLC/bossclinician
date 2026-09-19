import type { CaptionLine } from "../contract";

/**
 * audio-tap.ts — the two side channels a live call feeds, neither of which
 * belongs in React state.
 *
 * 1) AUDIO TAP — an AnalyserNode pair on the live RTCPeerConnection (the
 *    agent's voice is the remote receivers, the person's microphone is the
 *    local senders). The orb polls `readVoiceAgentLevels()` once per animation
 *    frame so its particles move to the REAL waveform instead of a canned
 *    envelope. Poll-based on purpose: sixty setStates a second is a jank
 *    machine, which is why the contract asks for a poll and not a value.
 *
 * 2) CAPTION STORE — transcript lines as they stream, exposed as
 *    subscribe/getSnapshot for `useSyncExternalStore`, emitting the contract's
 *    `CaptionLine`.
 *
 * Both are module singletons because there is only ever one call. Neither
 * touches the DOM at import time; the AudioContext is built when a call
 * attaches and torn down when it ends.
 */

/* ================================ audio tap ================================ */

export type LiveLevels = { agent: number; mic: number };

/**
 * A Web Audio analyser can exist and still report a permanently silent stream.
 * It happens intermittently when the remote WebRTC track was attached while
 * muted, or when a browser leaves the AudioContext suspended. Transcript events
 * still arrive in that case, so a dead meter must not be allowed to freeze the
 * captions — and with them the cursor that follows what is being said — for the
 * rest of the call. Short real pauses still pause the clock; past this grace
 * period it fails open.
 */
export const CAPTION_METER_SILENCE_FALLBACK_MS = 650;
export const CAPTION_METER_SPEECH_FLOOR = 0.006;

export function shouldAdvanceCaptionClock(
  agentLevel: number | null,
  continuousSilenceMs: number,
): boolean {
  return (
    agentLevel === null ||
    agentLevel > CAPTION_METER_SPEECH_FLOOR ||
    continuousSilenceMs >= CAPTION_METER_SILENCE_FALLBACK_MS
  );
}

/**
 * Whether an event means the agent has started or stopped speaking, or says
 * nothing about it at all.
 *
 * The WebRTC transport does not reliably surface a high-level "audio started"
 * callback, because the audio travels over the remote media track rather than
 * as audio deltas on the data channel. The transcript and audio lifecycle
 * events do arrive there, so they are the portable speaking-state source, and
 * `null` is a real answer: it means leave the current state alone.
 */
export function realtimeAgentSpeechState(eventType: string): boolean | null {
  if (
    eventType === "response.output_audio_transcript.delta" ||
    eventType === "response.audio_transcript.delta" ||
    eventType === "response.output_audio.delta" ||
    eventType === "response.audio.delta"
  ) {
    return true;
  }
  if (
    eventType === "response.output_audio.done" ||
    eventType === "response.audio.done" ||
    eventType === "response.done"
  ) {
    return false;
  }
  return null;
}

let audioCtx: AudioContext | null = null;
let agentAnalyser: AnalyserNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let agentBuf: Uint8Array<ArrayBuffer> | null = null;
let micBuf: Uint8Array<ArrayBuffer> | null = null;
let tappedPc: RTCPeerConnection | null = null;
let onTrackListener: ((e: RTCTrackEvent) => void) | null = null;
const tappedTracks = new WeakSet<MediaStreamTrack>();

function connectTrack(track: MediaStreamTrack | null | undefined, analyser: AnalyserNode) {
  if (!track || track.kind !== "audio" || !audioCtx || tappedTracks.has(track)) return;
  try {
    audioCtx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    tappedTracks.add(track);
  } catch {
    // Some tracks cannot be attached to a graph. Metering is a nicety; losing
    // one track's level must never be allowed to end a call.
  }
}

/** Tap a live peer connection's audio for level metering. Safe to call more
    than once per call; a repeat call with the same connection is a no-op. */
export function attachVoiceAgentAudioTap(pc: RTCPeerConnection): void {
  if (typeof window === "undefined" || tappedPc === pc) return;
  detachVoiceAgentAudioTap();
  const AC: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    audioCtx = new AC();
    void audioCtx.resume().catch(() => {});
    agentAnalyser = audioCtx.createAnalyser();
    micAnalyser = audioCtx.createAnalyser();
    agentAnalyser.fftSize = 512;
    micAnalyser.fftSize = 512;
    agentBuf = new Uint8Array(agentAnalyser.fftSize);
    micBuf = new Uint8Array(micAnalyser.fftSize);
  } catch {
    audioCtx = null;
    return;
  }
  tappedPc = pc;
  try {
    pc.getReceivers().forEach((r) => connectTrack(r.track, agentAnalyser!));
    pc.getSenders().forEach((s) => connectTrack(s.track, micAnalyser!));
  } catch {
    // An older browser may not enumerate either side; the late-track listener
    // below still catches the agent's voice when it arrives.
  }
  // The agent's remote track can arrive after the connection is established.
  onTrackListener = (e: RTCTrackEvent) => connectTrack(e.track, agentAnalyser!);
  try {
    pc.addEventListener("track", onTrackListener);
  } catch {
    // Nothing to do but run without late tracks.
  }
}

export function detachVoiceAgentAudioTap(): void {
  if (tappedPc && onTrackListener) {
    try {
      tappedPc.removeEventListener("track", onTrackListener);
    } catch {
      // The connection may already be closed, which is the outcome we wanted.
    }
  }
  tappedPc = null;
  onTrackListener = null;
  agentAnalyser = null;
  micAnalyser = null;
  agentBuf = null;
  micBuf = null;
  if (audioCtx) {
    try {
      void audioCtx.close().catch(() => {});
    } catch {
      // Already closed.
    }
    audioCtx = null;
  }
}

function rms(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

/** Per-frame RMS levels (0..~1). Null when no tap is active, so the orb knows
    to fall back to its synthetic speaking envelope rather than freeze. */
export function readVoiceAgentLevels(): LiveLevels | null {
  if (!agentAnalyser || !micAnalyser || !agentBuf || !micBuf) return null;
  try {
    return { agent: rms(agentAnalyser, agentBuf), mic: rms(micAnalyser, micBuf) };
  } catch {
    return null;
  }
}

/* ============================== caption store ============================== */

const CAPTION_LIMIT = 8;
let captions: CaptionLine[] = [];
const captionListeners = new Set<() => void>();

function emitCaptions() {
  captionListeners.forEach((l) => l());
}

/**
 * The snapshot is the same array object until something actually changes, which
 * is what `useSyncExternalStore` needs: returning a fresh array every call would
 * put React into an infinite re-render.
 */
export function getVoiceCaptions(): CaptionLine[] {
  return captions;
}

/** A server render has no call in progress, so it has no captions either. */
const NO_CAPTIONS: CaptionLine[] = [];

export function getServerVoiceCaptions(): CaptionLine[] {
  return NO_CAPTIONS;
}

export function subscribeVoiceCaptions(listener: () => void): () => void {
  captionListeners.add(listener);
  return () => {
    captionListeners.delete(listener);
  };
}

export function clearVoiceCaptions(): void {
  if (captions.length === 0) return;
  captions = [];
  emitCaptions();
}

function upsertCaption(
  id: string,
  role: CaptionLine["role"],
  update: (prev: string) => string,
  final: boolean,
) {
  const idx = captions.findIndex((c) => c.id === id);
  if (idx === -1) {
    captions = [...captions, { id, role, text: update(""), final }].slice(-CAPTION_LIMIT);
  } else {
    const next = [...captions];
    next[idx] = { ...next[idx], text: update(next[idx].text), final };
    captions = next;
  }
  emitCaptions();
}

/**
 * Feed one raw transport event into the caption store.
 *
 * Both sides of the conversation stream, in two shapes each — a growing delta
 * and a settled final — and the provider has used two names for the agent's
 * over time. All four are handled; everything else is ignored, because this is
 * the display feed and it must never be the thing that throws mid-call.
 */
export function ingestRealtimeCaptionEvent(event: unknown): void {
  const ev = (event ?? {}) as {
    type?: string;
    item_id?: string;
    response_id?: string;
    delta?: string;
    transcript?: string;
  };
  const type = ev.type ?? "";
  const id = ev.item_id ?? ev.response_id ?? "";

  // The agent's own speech, transcribed while it talks.
  if (type === "response.output_audio_transcript.delta" || type === "response.audio_transcript.delta") {
    if (ev.delta) upsertCaption(id || "agent-live", "agent", (p) => p + ev.delta, false);
    return;
  }
  if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
    const full = ev.transcript?.trim();
    if (full) upsertCaption(id || "agent-live", "agent", () => full, true);
    return;
  }

  // The person's speech, through the input transcription model.
  if (type === "conversation.item.input_audio_transcription.delta") {
    if (ev.delta) upsertCaption(id || "user-live", "user", (p) => p + ev.delta, false);
    return;
  }
  if (type === "conversation.item.input_audio_transcription.completed") {
    const full = ev.transcript?.trim();
    if (full) upsertCaption(id || "user-live", "user", () => full, true);
  }
}

/**
 * Weighted timing for the karaoke caption fallback.
 *
 * Transcript deltas carry no word timestamps, so these weights only decide how
 * the speaking time already measured by the analyser is divided between words —
 * longer words and sentence endings hold the pill a little longer, which is
 * what makes the caption look like it is following the voice rather than
 * racing it.
 */
export function captionWordDurationMs(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  const punctuationPause = /[.!?][\]}'"”’]*$/.test(word)
    ? 145
    : /[,;:][\]}'"”’]*$/.test(word)
      ? 75
      : 0;
  return Math.min(470, Math.max(180, 185 + letters * 9 + punctuationPause));
}

/** The last clause around the word being spoken, for the cursor that follows
 * along with what the agent is saying. */
export function captionFocusContext(words: string[], activeIndex: number): string {
  if (activeIndex < 0 || words.length === 0) return "";
  const end = Math.min(activeIndex, words.length - 1);
  let start = Math.max(0, end - 11);
  for (let i = end - 1; i >= start; i -= 1) {
    if (/[.!?][\]}'"”’]*$/.test(words[i])) {
      start = i + 1;
      break;
    }
  }
  return words.slice(start, end + 1).join(" ");
}
