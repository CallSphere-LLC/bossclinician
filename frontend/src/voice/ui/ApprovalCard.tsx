/**
 * ApprovalCard — where the owner says yes or no.
 *
 * The assistant may propose a change to the business; it may not make one. This
 * card is the moment in between. It shows the change field by field in plain
 * words, it says out loud that silence will be taken as a no, and it takes an
 * answer four ways — spoken, typed, clicked, or run out of time.
 *
 * The heavier treatment is for a change that cannot be undone. Those never
 * accept a spoken yes (the store refuses it), the button waits a beat before it
 * arms so a stray second tap cannot carry through onto it, and the card says
 * plainly that it is permanent.
 *
 * Nothing here knows whether the conversation is spoken or typed. The card and
 * the rules behind it serve both, which is the only way a typed "yes, do it"
 * can mean exactly what a spoken one means.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import type { ApprovalRequest } from "@/voice/contract";
import {
  answerApprovalByChat,
  answerApprovalByClick,
  getApprovalServerSnapshot,
  getApprovalSnapshot,
  subscribeApprovals,
  type PendingApproval,
} from "./approval-store";
import { useOnlyOne } from "./only-one";

/** A value long enough to swamp the card is cut; the point is recognition. */
const MAX_VALUE_CHARS = 180;

function shorten(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  return trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS)}…` : trimmed;
}

function countdown(msLeft: number): string {
  const seconds = Math.max(0, Math.round(msLeft / 1000));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ${String(seconds % 60).padStart(2, "0")} sec`;
  }
  return `${seconds} sec`;
}

export function ApprovalCard({
  pending,
  onAnswered,
  onUndelivered,
}: {
  pending: PendingApproval;
  /** Fired once an answer has been taken, so the host can tidy up. */
  onAnswered?: (approved: boolean) => void;
  /** Words that the card could not deliver — see the host for why. */
  onUndelivered?: (text: string) => void;
}) {
  const { request } = pending;
  const permanent = request.risk === "destructive";
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(!permanent);
  const [msLeft, setMsLeft] = useState(() => pending.expiresAt - Date.now());

  // A permanent change waits a beat before its button will take a press. The
  // tap that sent the request must not be able to carry through onto this one.
  useEffect(() => {
    if (!permanent) return;
    setArmed(false);
    const timer = window.setTimeout(() => setArmed(true), 400);
    return () => window.clearTimeout(timer);
  }, [permanent, request.actionId]);

  // The card promises that quiet means no, so it has to show the clock.
  useEffect(() => {
    const tick = () => setMsLeft(pending.expiresAt - Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pending.expiresAt]);

  function answer(approved: boolean) {
    const typed = note.trim();
    // Typing is answering. A card she wrote on is recorded as a typed answer,
    // a bare press as a click, because the record of how she agreed matters as
    // much as the fact that she did.
    const result = typed
      ? answerApprovalByChat(request.actionId, approved, typed)
      : answerApprovalByClick(request.actionId, approved);

    // If the request had already settled — she was mid-sentence when the clock
    // ran out — her words would otherwise vanish. Hand them to the conversation
    // instead of dropping them.
    if (!result.accepted && typed) onUndelivered?.(typed);
    if (result.accepted) onAnswered?.(approved);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      role="group"
      aria-label={request.title}
      className="overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[0_30px_70px_-28px_rgba(0,0,0,0.85)]"
    >
      <div
        className={`flex items-start gap-3 border-b px-4 py-3 ${
          permanent
            ? "border-[color-mix(in_srgb,var(--danger)_38%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
            : "border-[var(--border-subtle)] bg-[var(--bg-surface-2)]"
        }`}
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            permanent
              ? "bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[color:var(--danger)]"
              : "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[color:var(--accent)]"
          }`}
        >
          {permanent ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.88rem] font-semibold text-[var(--text-primary)]">
            {request.title}
          </p>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--text-secondary)]">
            {request.summary}
          </p>
        </div>
        {permanent && (
          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] px-2.5 py-1 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-[color:var(--danger)]">
            Permanent
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        {request.details.length > 0 && (
          <dl className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)]">
            {request.details.map((detail, index) => (
              <div key={`${detail.label}-${index}`} className="flex gap-3 px-3 py-2 text-[0.76rem]">
                <dt className="w-[38%] shrink-0 break-words font-medium text-[var(--text-secondary)]">
                  {detail.label}
                </dt>
                <dd className="min-w-0 flex-1 break-words text-[var(--text-primary)]">
                  {shorten(detail.value)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {permanent && (
          <p className="text-[0.74rem] font-medium leading-relaxed text-[color:var(--danger)]">
            This one cannot be undone, so I will not act on a spoken yes — press the button or write
            your answer below.
          </p>
        )}

        <label className="block">
          <span className="sr-only">Anything to add before you answer</span>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything to add? e.g. yes, but keep it a draft"
            className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2 text-[0.78rem] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[color:var(--accent)] focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!armed}
            onClick={() => answer(true)}
            className={`inline-flex min-h-[2.5rem] flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-[0.76rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              permanent
                ? "bg-[color:var(--danger)] text-white outline-[color:var(--danger)] hover:brightness-110"
                : "bg-[var(--accent)] text-[var(--accent-ink)] outline-[color:var(--accent)] hover:bg-[var(--accent-hover)]"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {permanent ? "Yes, do it permanently" : "Yes, do it"}
          </button>
          <button
            type="button"
            onClick={() => answer(false)}
            className="inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-4 text-[0.76rem] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
          >
            <X className="h-3.5 w-3.5" />
            No
          </button>
        </div>

        {/* Not announced: a clock that re-reads itself every second is a
            screen reader talking over the question it is counting down. */}
        <p className="text-[0.68rem] text-[var(--text-muted)]" aria-hidden="true">
          If you say nothing, I will leave it alone in {countdown(msLeft)}.
        </p>
      </div>
    </motion.div>
  );
}

/**
 * ApprovalHost — the one place approval cards appear.
 *
 * It sits low and centre on a phone and bottom-right on a wide screen, in front
 * of the concierge's own panel: while the assistant is waiting on an answer,
 * the question is the thing that should be in front of her.
 */
export function ApprovalHost({
  onUndelivered,
}: {
  /** Given words the card could not deliver, so they reach the conversation. */
  onUndelivered?: (text: string) => void;
} = {}) {
  const mine = useOnlyOne("voice-approval");
  const pending = useSyncExternalStore(
    subscribeApprovals,
    getApprovalSnapshot,
    getApprovalServerSnapshot,
  );

  // One question at a time. A queue of cards is a wall of small print, and the
  // assistant has no business asking a second thing before the first is settled.
  const front: PendingApproval | undefined = pending[0];
  if (!mine || !front) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-[85] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[24rem]">
      <ApprovalCard
        key={front.request.actionId}
        pending={front}
        onUndelivered={onUndelivered}
      />
    </div>
  );
}

export type { ApprovalRequest };
