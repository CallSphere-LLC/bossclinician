/**
 * RecordingDisclosure — the notice that stands in front of the microphone.
 *
 * Telling someone their voice is being recorded after they have already spoken
 * is not consent, it is an apology. So this is a gate: the microphone does not
 * open until the person has read it and said go ahead, and the way out is as
 * easy as the way in.
 *
 * There is a genuine ordering problem here and it is resolved on the side of
 * caution. Only the server knows whether a call will really be recorded, and it
 * does not say so until the call is being opened — which is after this notice
 * has to be read. So the notice assumes the call IS recorded unless the server
 * has already told this browser, about this surface, that it is not. Saying
 * "recorded" about a call that turns out not to be is a small excess of
 * honesty; the reverse is the version of this bug that actually matters. And if
 * a remembered "not recorded" is ever contradicted once the call is live, the
 * concierge says so at once rather than carrying on quietly.
 *
 * The acknowledgement is remembered for the visit rather than forever. Someone
 * who talks to the concierge three times in an afternoon should not be lectured
 * three times, but someone coming back next week is a fresh arrival and the
 * notice is worth repeating.
 */

import { useEffect, useRef } from "react";
import type { VoiceSurface } from "@/voice/contract";
import { Button } from "@/components/ui/Button";

const STORE_KEY = "bc.voice.disclosure.v2";

type Entry = {
  /** They have read and accepted the notice on this surface, this visit. */
  accepted?: boolean;
  /** What the notice they accepted actually claimed about recording. */
  toldRecorded?: boolean;
  /** What the server turned out to decide, last time it said. */
  serverRecords?: boolean;
};

type Store = Record<string, Entry>;

/**
 * Browser storage is read behind a guard on purpose: it throws outright in a
 * locked-down browser, and a notice that cannot be remembered must degrade to
 * being shown again, never to a broken button.
 */
function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(surface: VoiceSurface, patch: Entry): void {
  if (typeof window === "undefined") return;
  try {
    const store = readStore();
    store[surface] = { ...store[surface], ...patch };
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Nothing to do: the notice will simply be shown again next time.
  }
}

export function hasSeenDisclosure(surface: VoiceSurface): boolean {
  return readStore()[surface]?.accepted === true;
}

/**
 * What the notice should claim before the microphone opens. Unknown counts as
 * recorded, because the only safe direction to be wrong in is towards telling
 * people more about what happens to their voice, not less.
 */
export function willDiscloseRecording(surface: VoiceSurface, policyRecordsAudio: boolean): boolean {
  if (policyRecordsAudio) return true;
  return readStore()[surface]?.serverRecords !== false;
}

export function rememberDisclosure(surface: VoiceSurface, toldRecorded: boolean): void {
  writeStore(surface, { accepted: true, toldRecorded });
}

/** Keep the server's verdict, so the next notice on this surface is exact. */
export function rememberRecordingVerdict(surface: VoiceSurface, recording: boolean): void {
  writeStore(surface, { serverRecords: recording });
}

/**
 * True when the call is being recorded and the notice they accepted said it
 * would not be. That is a promise broken, and it has to be said out loud.
 */
export function disclosureUnderstated(surface: VoiceSurface, recording: boolean): boolean {
  if (!recording) return false;
  const entry = readStore()[surface];
  return entry?.accepted === true && entry.toldRecorded === false;
}

export function RecordingDisclosure({
  recorded,
  busy,
  onAccept,
  onCancel,
}: {
  /** True when the notice must say the audio itself is kept, not just a copy. */
  recorded: boolean;
  busy?: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const acceptRef = useRef<HTMLDivElement | null>(null);

  // Open with the keyboard on the thing the gate is asking about, and let
  // Escape be the way out — the microphone has not opened yet, so backing out
  // costs nothing.
  useEffect(() => {
    acceptRef.current?.querySelector("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="voice-disclosure-title" className="space-y-3">
      <div>
        <p
          id="voice-disclosure-title"
          className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold"
        >
          Before we start
        </p>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-ink">
          {recorded
            ? "This call is recorded, and an AI assistant listens and answers. The recording and a written copy of what is said are kept so the team can check the answers were right."
            : "An AI assistant listens and answers. A written copy of what is said is kept so the team can check the answers were right."}
        </p>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-soft">
          It is an assistant, not a clinician, and nothing it says is medical advice. You can end the
          call at any moment.
        </p>
      </div>

      <div ref={acceptRef} className="flex flex-wrap items-center gap-2">
        <Button variant="gold" size="sm" onClick={onAccept} disabled={busy}>
          {busy ? "Starting…" : "I understand — start"}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-soft underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * The correction. Shown the instant a call turns out to be recorded after a
 * notice that said otherwise: the person is told plainly, and hanging up is
 * offered first, because they agreed to something else.
 */
export function RecordingCorrection({
  onAcknowledge,
  onEnd,
}: {
  onAcknowledge: () => void;
  onEnd: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => firstRef.current?.focus(), []);

  return (
    <div role="alert" className="space-y-3">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold">
        One correction
      </p>
      <p className="text-[0.82rem] leading-relaxed text-ink">
        This call is being recorded after all — I told you it would not be, and that was wrong. The
        recording is kept along with a written copy of what is said.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={firstRef}
          type="button"
          onClick={onEnd}
          className="rounded-full bg-gold-foil px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-night-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          End the call
        </button>
        <button
          type="button"
          onClick={onAcknowledge}
          className="rounded-full px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink-soft underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Carry on anyway
        </button>
      </div>
    </div>
  );
}
