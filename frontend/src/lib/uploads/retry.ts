/**
 * What to do about a chunk that did not land.
 *
 * Kept apart from the code that does it, and free of fetch, timers and the
 * DOM, because these are the decisions that are wrong at 3am on a hotel wifi
 * and the only way to be sure of them is to be able to test them. The engine
 * (manager.ts) reads a status code and asks this module the only question that
 * matters: send it again, ask where we are, sign in, start over, or stop.
 */

export type FailureAction =
  /** Transient. The same bytes, again, after a wait. */
  | "retry"
  /** The server and the client disagree about the offset. Ask, then continue. */
  | "resync"
  /** The token expired or was revoked. The bytes are safe; she must sign in. */
  | "reauth"
  /** The session is gone. Start a new one for the same file. */
  | "restart"
  /** Nothing about sending this again will help. */
  | "fatal";

/**
 * `status` 0 means the request never got an answer: offline, DNS, TLS, a proxy
 * that hung up, or the browser cancelling on a network change. All of them are
 * worth another go.
 */
export function classifyStatus(status: number): FailureAction {
  if (status === 0) return "retry";
  if (status === 401 || status === 403) return "reauth";
  if (status === 404 || status === 410) return "restart";
  if (status === 409) return "resync";
  if (status === 408 || status === 425 || status === 429) return "retry";
  // 501 and 505 are the server saying it will never do this. The rest of the
  // 5xx range is a bad minute: a restart, a full disk being cleared, a proxy
  // between us that lost its upstream.
  if (status >= 500 && status !== 501 && status !== 505 && status !== 507) return "retry";
  return "fatal";
}

/** Ceiling on the wait, so an upload left open overnight still picks itself up. */
export const MAX_BACKOFF_MS = 30_000;

/**
 * Exponential, jittered.
 *
 * The jitter is not decoration: a page with four files in flight retries all
 * four on the same failed network at the same instant without it, and the
 * fourth attempt is the one that keeps failing.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.7 + random() * 0.6));
}

/** How many consecutive failures before we stop trying and hand her the button. */
export const MAX_ATTEMPTS = 8;

/**
 * The chunk size to use next, given how the last one went.
 *
 * A connection that cannot carry 8MB may well carry 1MB, and on a line that
 * keeps dropping, a smaller chunk is less work to lose. Growing back is just as
 * important: a 400MB video in 256KB pieces is 1,600 round trips, which is its
 * own kind of failure.
 */
export const MIN_CHUNK_BYTES = 256 * 1024;
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

export function nextChunkSize(current: number, outcome: "ok" | "failed"): number {
  if (outcome === "failed") return Math.max(MIN_CHUNK_BYTES, Math.floor(current / 2));
  return Math.min(MAX_CHUNK_BYTES, current * 2);
}
