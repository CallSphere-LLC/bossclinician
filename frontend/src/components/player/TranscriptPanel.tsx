import { useId, useState } from "react";
import { ChevronDown, Captions } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The transcript, behind a disclosure.
 *
 * Collapsed by default because a 40-minute lesson's transcript is several
 * thousand words and would bury the notes and the discussion beneath it. Open,
 * it is a scrolling region rather than a page-length dump, so the page's own
 * scrollbar still means "the rest of the lesson".
 *
 * `whitespace-pre-wrap`, not markdown: a transcript is a verbatim record, and
 * anything that reformats it is editing evidence.
 */
export function TranscriptPanel({ transcript }: { transcript: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  if (!transcript.trim()) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={regionId}
          className={cn(
            "flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-2xl px-4 py-3.5 sm:px-5",
            "transition-colors duration-300 hover:bg-white/[0.03]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          <span className="flex items-center gap-2.5">
            <Captions aria-hidden className="size-4 shrink-0 text-gold" />
            <span className="text-sm font-semibold text-white">Transcript</span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-orchid-dim transition-transform duration-300 ease-luxe",
              open && "rotate-180",
            )}
          />
        </button>
      </h2>

      {open && (
        <div
          id={regionId}
          className="max-h-[26rem] overflow-y-auto border-t border-white/[0.08] px-4 py-4 sm:px-5"
        >
          <p className="whitespace-pre-wrap break-words text-[0.92rem] leading-[1.85] text-orchid-dim">
            {transcript}
          </p>
        </div>
      )}
    </section>
  );
}
