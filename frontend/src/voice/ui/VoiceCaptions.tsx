/**
 * VoiceCaptions — what is being said, in writing.
 *
 * Captions are not decoration. They are how someone in a quiet office, someone
 * whose hearing does not cooperate, and someone who simply wants to check what
 * they just heard all stay in the conversation.
 *
 * Only settled lines live inside the live region. A line that is still being
 * transcribed rewrites itself several times a second, and a screen reader that
 * is told about each rewrite reads the same half-sentence over and over — so
 * the in-progress line is shown on screen and kept out of the announcement.
 */

import { useEffect, useRef } from "react";
import type { CaptionLine } from "@/voice/contract";
import { cn } from "@/lib/cn";

export function VoiceCaptions({
  lines,
  live,
  className,
}: {
  lines: readonly CaptionLine[];
  /** False while the call is still being set up, so the panel says so. */
  live?: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The newest line is the one worth reading, so the panel stays at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const settled = lines.filter((line) => line.final);
  const inProgress = lines.filter((line) => !line.final);

  return (
    <div
      ref={scrollRef}
      className={cn(
        "max-h-52 overflow-y-auto overscroll-contain pr-1 text-[0.82rem] leading-relaxed",
        className,
      )}
    >
      {lines.length === 0 && (
        <p className="text-ink-soft">
          {live === false
            ? "One moment — I am just getting ready."
            : "Say hello whenever you are ready — I am listening."}
        </p>
      )}

      <div aria-live="polite" aria-atomic="false" className="space-y-2">
        {settled.map((line) => (
          <CaptionRow key={line.id} line={line} />
        ))}
      </div>

      <div aria-hidden="true" className="space-y-2 [&:not(:empty)]:mt-2">
        {inProgress.map((line) => (
          <CaptionRow key={line.id} line={line} dim />
        ))}
      </div>
    </div>
  );
}

function CaptionRow({ line, dim }: { line: CaptionLine; dim?: boolean }) {
  const fromAgent = line.role === "agent";
  return (
    <p className={cn("break-words", dim && "opacity-60")}>
      <span
        className={cn(
          "mr-2 text-[0.6rem] font-semibold uppercase tracking-[0.16em]",
          fromAgent ? "text-gold" : "text-ink-soft",
        )}
      >
        {fromAgent ? "Boss Clinician AI" : "You"}
      </span>
      <span className={fromAgent ? "text-ink" : "text-ink-soft"}>{line.text}</span>
    </p>
  );
}
