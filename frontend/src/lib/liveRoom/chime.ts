/**
 * The two sounds a room makes: somebody came in, somebody left.
 *
 * Synthesised with Web Audio rather than shipped as files — two short sine
 * notes are smaller than any mp3, need no network, and sit inside the site's
 * CSP without a media-src exception. Rising pair for an arrival, falling pair
 * for a departure, which is the convention every calling app has taught people.
 *
 * Browsers only let a page make sound after the person has interacted with it.
 * Pressing "Join" is that interaction, so the context is created there
 * (`primeChime`) and merely resumed later.
 */

const STORAGE_KEY = "bc_room_sounds";

let context: AudioContext | null = null;
let lastPlayedAt = 0;

/** Off only if the member turned it off; on by default. */
export function roomSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setRoomSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* applies for this visit only */
  }
}

/** Call from a click handler (Join), so the browser allows sound afterwards. */
export function primeChime(): void {
  try {
    if (context === null) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
    }
    if (context.state === "suspended") void context.resume();
  } catch {
    /* no audio output, or blocked: the room works without it */
  }
}

export function releaseChime(): void {
  const closing = context;
  context = null;
  if (closing) void closing.close().catch(() => undefined);
}

function note(ctx: AudioContext, frequency: number, startAt: number, length: number): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  // A quick fade in and a longer fade out: a bare sine switched on and off clicks.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + length + 0.02);
}

/**
 * Plays the arrival or departure sound.
 *
 * Rate-limited: six people returning after a reconnect should be one sound, not
 * a fanfare. Silent when the member has turned sounds off.
 */
export function playChime(kind: "join" | "leave"): void {
  if (!roomSoundsEnabled()) return;
  const ctx = context;
  if (ctx === null) return;
  const nowMs = Date.now();
  if (nowMs - lastPlayedAt < 900) return;
  lastPlayedAt = nowMs;

  try {
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + 0.01;
    if (kind === "join") {
      note(ctx, 659.25, t, 0.16); // E5
      note(ctx, 880.0, t + 0.13, 0.26); // A5
    } else {
      note(ctx, 659.25, t, 0.16); // E5
      note(ctx, 493.88, t + 0.13, 0.28); // B4
    }
  } catch {
    /* a sound is never worth an error */
  }
}
