/**
 * liveSession.ts — everything this server says to OpenAI on the concierge's
 * behalf, and the one place the API key is read.
 *
 * Two transports, one file, because they are the same conversation held two
 * ways (docs/VOICE-AGENT.md, addendum 2):
 *
 *  - `exchangeOffer` trades the browser's SDP offer for an answer. The media
 *    then flows browser ⇄ OpenAI directly, which is why this is worth doing at
 *    all — the key never crosses the wire to the page, and the browser is given
 *    an answer rather than a credential it could reuse.
 *  - `conciergeTurn` runs one turn of the text concierge and hands back the
 *    tool calls for the BROWSER to execute, because the DOM and the router are
 *    there and not here.
 *
 * Errors keep their cause. A voice session that fails is nearly always failing
 * for a specific, boring reason — a key without GPT-Live access, an unknown
 * model id, a 429 — and every one of those is invisible if the server answers
 * "voice is unavailable" and throws the provider's sentence away. So each
 * failure carries `detail`, and OpenAI's `x-request-id` is logged beside it.
 */

import { env, voiceEnabled } from "../../config/env";
import { backendModel, liveSessionConfig, type LiveVoice } from "./liveConfig";
import type { VoiceSurface } from "./contract";
import type { SubmittedTool } from "./policy";
import { endSession } from "./sessionStore";

const LOG = "[voice]";

/**
 * An SDP offer for one audio track is a couple of kilobytes. 64KB is the same
 * ceiling the route this was ported from used: far above any honest offer, far
 * below anything worth buffering from an anonymous caller.
 */
export const MAX_SDP_BYTES = 64 * 1024;

/** Twenty seconds: ICE has already been gathered, so this is one HTTP round trip. */
const CONNECT_TIMEOUT_MS = 20_000;

/** The text concierge answers between spoken turns, so it may not think for long. */
const CHAT_TIMEOUT_MS = 30_000;

/**
 * Whether a blob is plausibly an SDP offer, used on the way in and on the way
 * back out.
 *
 * Checked on the answer too, not out of distrust of OpenAI, but because the
 * browser feeds whatever comes back straight into `setRemoteDescription`, and a
 * proxy or an error page that arrived with a 200 fails far more legibly here
 * than it does inside WebRTC.
 */
export function invalidSdp(sdp: unknown): boolean {
  return (
    typeof sdp !== "string" ||
    Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES ||
    // An SDP document begins with its version line, and nothing else does.
    !/^v=0(?:\r?\n)/.test(sdp) ||
    // At least one audio media section — this is a phone call, not a data pipe.
    !/(?:^|\r?\n)m=audio[ \t]/.test(sdp) ||
    // A NUL byte cannot occur in SDP and is how a header injection starts.
    sdp.includes("\0")
  );
}

export type LiveExchange =
  | { ok: true; answer: string; sessionId: string; location: string }
  | { ok: false; status: number; error: string };

/**
 * Trades one offer for one answer.
 *
 * `redirect: "error"` is not decoration: this request carries the
 * organisation's API key, and following a redirect would hand that key to
 * whatever the redirect named.
 */
export async function exchangeOffer(input: {
  sdp: string;
  surface: VoiceSurface;
  voice?: LiveVoice;
  signal?: AbortSignal;
}): Promise<LiveExchange> {
  if (invalidSdp(input.sdp)) {
    return { ok: false, status: 400, error: "That is not a valid audio offer." };
  }
  if (!voiceEnabled()) {
    return {
      ok: false,
      status: 503,
      error: "The voice assistant is not configured on this server.",
    };
  }

  const timeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(openaiUrl("/live/sessions"), {
      method: "POST",
      headers: openaiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        session: liveSessionConfig({ surface: input.surface, voice: input.voice }),
        transport: { type: "webrtc", sdp: input.sdp },
      }),
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      return { ok: false, status: 499, error: "The call was cancelled before it opened." };
    }
    if (timeout.aborted) {
      return { ok: false, status: 504, error: "OpenAI took too long to answer the offer." };
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${LOG} live session request failed: ${detail}`);
    return { ok: false, status: 502, error: `Could not reach OpenAI: ${detail}` };
  }

  const requestId = response.headers.get("x-request-id") ?? "none";
  const body = (await response.json().catch(() => null)) as
    | { session?: { id?: string }; transport?: { sdp?: string }; error?: { message?: string } }
    | null;

  if (!response.ok) {
    const detail = body?.error?.message ?? `HTTP ${response.status}`;
    console.error(
      `${LOG} GPT-Live refused the session status=${response.status} request_id=${requestId}: ${detail}`,
    );
    // The provider's status is repeated rather than flattened, because the
    // difference between 401 (the key), 404 (the model id) and 429 (volume) is
    // the difference between three completely different repairs.
    return {
      ok: false,
      status: 502,
      error: `OpenAI refused the voice session (${response.status}): ${detail}`,
    };
  }

  const sessionId = body?.session?.id ?? "";
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionId) || invalidSdp(body?.transport?.sdp)) {
    console.error(
      `${LOG} GPT-Live answered 200 with an unusable body request_id=${requestId}`,
    );
    return {
      ok: false,
      status: 502,
      error: "OpenAI accepted the offer but returned no usable answer.",
    };
  }

  return {
    ok: true,
    answer: body!.transport!.sdp!,
    sessionId,
    location: openaiUrl(`/live/sessions/${encodeURIComponent(sessionId)}`),
  };
}

/* ============================== the hard cap ============================ */

/**
 * Pending hangups, so a repeated arm for one session replaces its timer rather
 * than stacking a second one.
 */
const hangups = new Map<string, NodeJS.Timeout>();

/** A flood of sessions must not be able to grow this map without bound. */
const MAX_TRACKED_SESSIONS = 200;

/**
 * Makes `SURFACE_LIMITS[surface].maxSessionSeconds` real rather than a courtesy.
 *
 * GPT-Live has no session-duration field, so the only lever is to hang the
 * session up: one authenticated POST, which this server can make because the
 * SDP exchange happened here and it therefore knows the session id. The browser
 * runs its own countdown so the agent can say goodbye first; this is what
 * happens to a browser that has had its countdown patched out.
 *
 * The timer lives in process memory, so a restart mid-call loses it and the
 * call falls back to the browser's timer and OpenAI's own ceiling. That is an
 * accepted degradation for a cost control: making it durable means a table and
 * a sweeper for a window measured in minutes.
 */
export function scheduleHangup(input: {
  /** OpenAI's id for the live session — what the provider is asked to drop. */
  liveSessionId: string;
  /** Our own `voice_sessions` row, which is what the owner's page reads. */
  voiceSessionId: string;
  afterSeconds: number;
}): void {
  const existing = hangups.get(input.liveSessionId);
  if (existing) clearTimeout(existing);
  if (!existing && hangups.size >= MAX_TRACKED_SESSIONS) {
    console.error(
      `${LOG} tracking ${hangups.size} live sessions — refusing to arm another. ` +
        `Something is opening sessions far beyond normal volume.`,
    );
    return;
  }

  const timer = setTimeout(
    () => void hangup(input.liveSessionId, input.voiceSessionId),
    Math.max(0, input.afterSeconds * 1000),
  );
  // A pending hangup must never hold the event loop open at shutdown.
  timer.unref?.();
  hangups.set(input.liveSessionId, timer);
}

async function hangup(liveSessionId: string, voiceSessionId: string): Promise<void> {
  hangups.delete(liveSessionId);
  try {
    const res = await fetch(
      openaiUrl(`/live/sessions/${encodeURIComponent(liveSessionId)}/hangup`),
      {
        method: "POST",
        headers: openaiHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    // 404 is the normal case: the caller hung up before the cap was reached.
    if (!res.ok && res.status !== 404) {
      console.error(
        `${LOG} hangup failed live=${liveSessionId} status=${res.status} ` +
          `request_id=${res.headers.get("x-request-id") ?? "none"}`,
      );
    }
  } catch (error) {
    console.error(
      `${LOG} hangup threw live=${liveSessionId}:`,
      error instanceof Error ? error.message : error,
    );
  }

  // Closed whether or not the provider answered, and closed LAST so that a
  // browser which said goodbye first has already won: `endSession` only writes
  // a row that is still open. Without this the owner's page shows a call that
  // the server itself hung up as permanently in progress.
  //
  // Deliberately not joining the audio here. recordingStore's slices are joined
  // on the first read of the conversation, precisely because the last slice of
  // a closing tab can arrive after everything else — finalising at this instant
  // would race that flush and refuse it.
  try {
    await endSession(voiceSessionId, "time-limit");
  } catch (error) {
    console.error(
      `${LOG} could not close session=${voiceSessionId} after the cap:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/* ============================= text transport =========================== */

export type ConciergeTurn =
  | {
      ok: true;
      reply: string | null;
      toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
    }
  | { ok: false; status: number; error: string };

/** One entry of the conversation, in the shape the Responses API wants. */
type ResponseInput = Record<string, unknown>;

/**
 * Runs one turn of the typed concierge.
 *
 * The Responses API rather than the Python service at AI_BASE_URL: that service
 * answers a single question with a single string and has no tool loop, and the
 * concierge's whole behaviour IS the tool loop. Teaching it one would mean a
 * second implementation of the tool policy in a second language, in a service
 * this slice does not own — while the backend has to hold the OpenAI key
 * anyway, for `/api/voice/connect`.
 *
 * Deliberately one turn and no more. The loop belongs to the browser because
 * the tools touch the DOM and the router, so this returns the model's tool
 * calls and stops; the browser executes them and calls again with the results.
 */
export async function conciergeTurn(input: {
  surface: VoiceSurface;
  instructions: string;
  messages: ResponseInput[];
  tools: SubmittedTool[];
  signal?: AbortSignal;
}): Promise<ConciergeTurn> {
  if (!voiceEnabled()) {
    return {
      ok: false,
      status: 503,
      error: "The assistant is not configured on this server.",
    };
  }

  const timeout = AbortSignal.timeout(CHAT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(openaiUrl("/responses"), {
      method: "POST",
      headers: openaiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: backendModel(),
        instructions: input.instructions,
        input: input.messages,
        tools: input.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: false,
        })),
        tool_choice: "auto",
        // One tool call per turn, for the same reason the voice config says so:
        // two of these move the same screen at the same time.
        parallel_tool_calls: false,
        // The same brain on the same settings as the delegated half of a spoken
        // call (liveConfig.ts). It is a reasoning model, and reasoning tokens
        // are spent out of this budget before a single visible one is: a tight
        // ceiling here does not produce a short answer, it produces an empty
        // turn that looks like the assistant ignoring somebody.
        reasoning: { effort: "low" },
        max_output_tokens: 4096,
      }),
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      return { ok: false, status: 499, error: "The message was cancelled." };
    }
    if (timeout.aborted) {
      return { ok: false, status: 504, error: "OpenAI took too long to reply." };
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${LOG} concierge turn failed: ${detail}`);
    return { ok: false, status: 502, error: `Could not reach OpenAI: ${detail}` };
  }

  const requestId = response.headers.get("x-request-id") ?? "none";
  const body = (await response.json().catch(() => null)) as {
    output?: {
      type?: string;
      call_id?: string;
      id?: string;
      name?: string;
      arguments?: string;
      content?: { type?: string; text?: string }[];
    }[];
    error?: { message?: string };
    status?: string;
    incomplete_details?: { reason?: string };
  } | null;

  if (!response.ok) {
    const detail = body?.error?.message ?? `HTTP ${response.status}`;
    console.error(
      `${LOG} the text model refused the turn status=${response.status} ` +
        `request_id=${requestId}: ${detail}`,
    );
    return {
      ok: false,
      status: 502,
      error: `OpenAI refused the message (${response.status}): ${detail}`,
    };
  }

  // A 200 that stopped early. Almost always the token budget, and the parse
  // below would turn it into a reply of nothing with no tool calls — an
  // assistant that silently ignored somebody. Say what happened instead.
  if (body?.status === "incomplete") {
    const reason = body.incomplete_details?.reason ?? "unknown";
    console.error(`${LOG} the text model stopped early (${reason}) request_id=${requestId}`);
    return { ok: false, status: 502, error: `The reply was cut short (${reason}).` };
  }

  const reply: string[] = [];
  const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

  for (const item of body?.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (typeof part.text === "string" && part.text.length > 0) reply.push(part.text);
      }
    } else if (item.type === "function_call" && typeof item.name === "string") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? "",
        name: item.name,
        // A model that emits unparseable arguments has asked for the tool with
        // nothing in its hands; the browser's tool can refuse that far more
        // helpfully than a 502 from here can.
        arguments: parseArguments(item.arguments),
      });
    }
  }

  return { ok: true, reply: reply.length > 0 ? reply.join("\n\n") : null, toolCalls };
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/* ============================== the key ================================ */

/** Absolute URL for an OpenAI-compatible path; the base already carries /v1. */
function openaiUrl(path: string): string {
  return `${env.openai.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The only place the key is put into a header. Nothing here is ever returned to
 * a caller, and no function in this file puts a header into a response body.
 */
function openaiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${env.openai.apiKey}`, ...extra };
}
