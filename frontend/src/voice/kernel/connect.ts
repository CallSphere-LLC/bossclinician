import type { VoiceSessionRequest, VoiceSessionResponse } from "../contract";
import { createVoiceApiClient, readServerMessage } from "./api-client";

/**
 * connect.ts — the browser's half of the handshake.
 *
 * Two round trips and nothing else. First `/api/voice/session`, where the
 * server reads the request's own credentials, decides which surface this really
 * is and hands back a one-use admission. Then the SDP exchange: the browser
 * builds the peer connection and the `oai-events` data channel, and posts its
 * offer to `/api/voice/connect` as `application/sdp` with the admission as a
 * bearer. The OpenAI key never comes near this file — the server holds it, and
 * what comes back is only an answer SDP.
 *
 * The admission is short-lived and single-use, which dictates the order the
 * hook calls these in: get the microphone FIRST, then mint the admission. A
 * permission prompt the visitor leaves sitting on screen for half a minute
 * would otherwise expire the admission and produce a connect failure with no
 * visible cause.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

const DEFAULT_ERROR_MESSAGE = "The voice concierge is unavailable right now. Please try again shortly.";

/**
 * Pull a diagnosable string out of ANY thrown or emitted value.
 *
 * The live transport emits its `error` event with a plain object, not an Error,
 * so an `instanceof Error` check alone collapses every transport drop into one
 * generic sentence — which is exactly why an errored call becomes impossible to
 * triage after the fact. This digs out the real message, code or type, and only
 * falls back to a truncated dump, never to something meaningless.
 */
export function describeVoiceError(candidate: unknown): string {
  if (candidate instanceof Error) {
    return candidate.name && candidate.name !== "Error"
      ? `${candidate.name}: ${candidate.message}`
      : candidate.message;
  }
  if (typeof candidate === "string") return candidate || DEFAULT_ERROR_MESSAGE;
  if (candidate && typeof candidate === "object") {
    const obj = candidate as Record<string, unknown>;
    // Live error events nest the cause under `.error`.
    const inner = (obj.error ?? obj) as Record<string, unknown>;
    const message =
      (typeof inner.message === "string" && inner.message) ||
      (typeof obj.message === "string" && obj.message) ||
      "";
    const code =
      (typeof inner.code === "string" && inner.code) ||
      (typeof inner.type === "string" && inner.type) ||
      (typeof obj.type === "string" && obj.type) ||
      "";
    if (message || code) return [code, message].filter(Boolean).join(": ");
    try {
      const json = JSON.stringify(candidate);
      if (json && json !== "{}") return json.slice(0, 500);
    } catch {
      // Circular — fall through to the default rather than throw while
      // reporting somebody else's failure.
    }
  }
  return DEFAULT_ERROR_MESSAGE;
}

/**
 * Ask the server to open a session row and mint the admission for it.
 *
 * What comes back is authoritative and may be smaller than the policy asked
 * for: the surface can be lower than the one requested (a signed-out visitor
 * standing on an admin URL), the cap can be shorter, and recording is the
 * server's decision, not ours.
 */
export async function requestAdmission(input: VoiceSessionRequest): Promise<VoiceSessionResponse> {
  return createVoiceApiClient().post<VoiceSessionResponse>("/voice/session", input);
}

/**
 * The peer connection and the one data channel every Live event travels on.
 *
 * The channel is created here, before the offer, because a data channel added
 * after the local description is set does not appear in it and the provider
 * then has nothing to answer with.
 */
export function createLivePeer(mediaStream: MediaStream): {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
} {
  const pc = new RTCPeerConnection();
  mediaStream.getTracks().forEach((track) => pc.addTrack(track, mediaStream));
  const dc = pc.createDataChannel("oai-events");
  return { pc, dc };
}

/**
 * Trade the local offer for the provider's answer, through our own broker.
 *
 * Every failure here is reported with the server's actual words. A handshake
 * that fails because OpenAI rejected the model, because the admission had
 * already been spent, or because nginx returned a 502 are three different
 * problems, and flattening them into one sentence is how an errored session
 * becomes undiagnosable.
 */
export async function exchangeLiveOffer(input: {
  pc: RTCPeerConnection;
  admission: string;
  /**
   * The output voice the SERVER chose for this surface. The session request has
   * nowhere to carry it, so it rides the connect URL, where the broker
   * re-validates it against the allowlist and falls back to `coral`.
   */
  voice: string;
}): Promise<void> {
  const { pc, admission, voice } = input;
  await pc.setLocalDescription(await pc.createOffer());
  const offer = pc.localDescription?.sdp;
  if (!offer) throw new Error("The browser produced no session description to connect with.");

  const url = new URL(`${API_BASE}/voice/connect`, window.location.origin);
  if (voice) url.searchParams.set("voice", voice);

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${admission}`, "Content-Type": "application/sdp" },
    credentials: "include",
    body: offer,
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    throw new Error(`Live handshake failed (HTTP ${response.status}): ${await readServerMessage(response)}`);
  }

  const answer = await response.text();
  if (!answer.trim()) throw new Error("The voice service answered the handshake with nothing.");
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
}
