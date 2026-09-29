import { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, NotebookText } from "lucide-react";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

/**
 * An episode's show notes, as written in the admin (Markdown).
 *
 * Shared by the public show page and the member Podcasts page so an episode
 * reads the same in both. Links in show notes point off the site — a journal
 * download, an Instagram profile — so they open in a new tab rather than taking
 * the listener away from the audio that is playing.
 */
export function ShowNotes({ markdown, className }: { markdown: string; className?: string }) {
  if (!markdown.trim()) return null;
  return (
    <div className={cn("prose-boss break-words [&_table]:block [&_table]:overflow-x-auto", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The show notes behind a disclosure, for a list of episodes where each one
 * shows only its two-line summary until asked. Same shape as TranscriptPanel,
 * which sits under it.
 */
export function ShowNotesPanel({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  if (!markdown.trim()) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <h3>
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
            <NotebookText aria-hidden className="size-4 shrink-0 text-gold" />
            <span className="text-sm font-semibold text-white">Show notes</span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-orchid-dim transition-transform duration-300 ease-luxe",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>

      {open && (
        <div id={regionId} className="border-t border-white/[0.08] px-4 py-4 sm:px-5">
          <ShowNotes markdown={markdown} />
        </div>
      )}
    </section>
  );
}
