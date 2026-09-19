/**
 * contract.ts — the server half of the voice concierge's seam.
 *
 * The browser's policy (frontend/src/voice/contract.ts) decides what the model
 * is TOLD it can do. This file decides what it is ALLOWED to do, and the two are
 * intentionally separate programs: a tampered bundle can ask for the admin
 * surface, and the only thing that answers is `resolveSurface`, which reads the
 * request's own cookies.
 *
 * Everything below is types + pure functions so it can be unit-tested without a
 * database, a socket or an OpenAI key.
 */

export type VoiceSurface = "public" | "member" | "admin";

/** Who the request proved itself to be, from cookies alone. */
/**
 * How a caller proves who they are on this app — and it is NOT one mechanism.
 *
 * An administrator carries a cookie session. A MEMBER carries a bearer token in
 * the `Authorization` header, and their refresh cookie is scoped to
 * `path=/api/auth`, so it is never even sent to `/api/voice/*`. A voice route
 * that reads cookies alone therefore degrades every signed-in member to the
 * public concierge — silently, and only in production, where it looks like the
 * agent has simply forgotten who they are.
 */
export type VoiceIdentity =
  | { audience: "anonymous" }
  | { audience: "member"; memberId: number }
  | { audience: "admin"; adminUserId: number; role: string };

/**
 * The surface a request may actually have. Asking for more than you are is not
 * an error — it quietly degrades — because a signed-out visitor on an admin URL
 * is a normal thing, and a 403 there would just be a worse public experience.
 */
export function resolveSurface(
  requested: VoiceSurface,
  identity: VoiceIdentity,
): VoiceSurface {
  if (requested === "admin" && identity.audience === "admin") return "admin";
  if (requested === "member" && identity.audience !== "anonymous") return "member";
  return "public";
}

/** Server-side ceiling per surface. The browser's copy is UX; this is the law. */
export type SurfaceLimits = {
  maxSessionSeconds: number;
  /** Sessions one caller may open per hour. */
  sessionsPerHour: number;
  /** Whether audio for this surface is captured at all. */
  recordAudio: boolean;
};

export const SURFACE_LIMITS: Record<VoiceSurface, SurfaceLimits> = {
  public: { maxSessionSeconds: 300, sessionsPerHour: 6, recordAudio: true },
  member: { maxSessionSeconds: 900, sessionsPerHour: 20, recordAudio: true },
  admin: { maxSessionSeconds: 1800, sessionsPerHour: 60, recordAudio: true },
};

/* ================================ models ================================ */

/**
 * Verified against this deployment's own key on 2026-09-19: both are reachable.
 * `gpt-live-1` carries the conversation; `gpt-6-astra` is the brain it delegates
 * facts and tool calls to. The server owns these names and hands them to the
 * browser in `VoiceSessionResponse`, so the two halves cannot drift apart.
 */
export const LIVE_MODEL = "gpt-live-1" as const;
export const LIVE_BACKEND_MODEL = "gpt-6-astra" as const;

/* ============================ admission token =========================== */

/**
 * A one-use bearer the browser trades for an SDP answer. It carries no OpenAI
 * material: it names a row in `voice_sessions`, and the broker consumes it.
 */
export type VoiceAdmission = {
  sessionId: string;
  surface: VoiceSurface;
  identity: VoiceIdentity;
  /** Unix ms. Short — it exists only to cross one round trip. */
  expiresAt: number;
};

/* ============================ recording store =========================== */

/**
 * Where a call's audio ends up.
 *
 * An interface rather than an S3 call at the call site, because this app has no
 * AWS credentials today and does have a Docker volume. The local store is what
 * runs until a bucket exists; switching is one env var, not a rewrite, and the
 * admin page asks the store for a URL either way.
 */
export type StoredRecording = {
  /** Opaque key the admin page later resolves to a playable URL. */
  key: string;
  bytes: number;
  contentType: string;
};

export interface RecordingStore {
  /**
   * Persist one slice of a call that is still in progress.
   *
   * Audio arrives in ~3-second chunks rather than as one upload at the end,
   * because `MediaRecorder.stop()` followed by a single request does not
   * survive a closed tab — which is exactly how a recording feature ends up
   * holding nothing. `seq` is monotonic from 0 within a session.
   *
   * Two failure modes are normal and neither may corrupt the recording: a
   * RETRIED slice arrives with a `seq` already stored (ignore it), and a
   * DROPPED slice never arrives at all (a three-second hole — write what comes
   * next rather than refusing it). Losing three seconds is a scratch; refusing
   * the rest of the call is the whole recording.
   */
  putChunk(input: {
    sessionId: string;
    seq: number;
    body: Buffer;
    contentType: string;
  }): Promise<void>;

  /**
   * Close a finished call's recording and return what the session row points
   * at. A call whose tab was closed never reaches this, so `finalize` must be
   * safe to run late — lazily, when the owner first opens the conversation —
   * and everything received must already be playable before it runs.
   */
  finalize(sessionId: string): Promise<StoredRecording>;

  /** A URL the owner's browser can play, valid for at least a few minutes. */
  url(key: string): Promise<string>;
  remove(key: string): Promise<void>;
}
