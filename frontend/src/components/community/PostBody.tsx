import { Fragment, type ReactNode } from "react";
import { safeLink } from "@/lib/communityApi";
import { cn } from "@/lib/cn";

/**
 * Member-written text, rendered to other members.
 *
 * Plain text with its line breaks kept, not markdown. The server stores these
 * rows stripped of markup rather than escaped, so there is nothing to interpret
 * — and nobody writing in a feed box expects a leading `#` to silently become a
 * heading or an asterisked aside to vanish into italics. `whitespace-pre-line`
 * gives back the paragraph breaks the author actually typed, which is the only
 * formatting a post like this has ever had.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one. The
 * links below are built as React elements from matched substrings, so the worst
 * a hostile body can do is fail to match the pattern and stay text.
 */

/**
 * Bare URLs, stopping before trailing punctuation.
 *
 * The negative set at the end is what keeps "see https://example.com." from
 * swallowing the full stop into the href, which is how a perfectly good link
 * turns into a 404.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi;

/** Long naked URLs must wrap rather than push the whole card sideways. */
const LINK_CLASS = cn(
  "break-words text-gold underline decoration-gold/40 underline-offset-[3px]",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
);

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;

  // `matchAll` on a /g regex, so `lastIndex` bookkeeping is not this function's
  // problem — a stale one is the classic way this silently drops every other link.
  for (const match of text.matchAll(URL_PATTERN)) {
    // `index` is optional in the ES2022 lib's match type even though `matchAll`
    // always sets it; falling back to the cursor keeps the slices in order.
    const start = match.index ?? cursor;
    const href = safeLink(match[0]);
    if (start > cursor) out.push(text.slice(cursor, start));
    if (href) {
      out.push(
        <a
          key={`${start}-${href}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          className={LINK_CLASS}
        >
          {match[0]}
        </a>,
      );
    } else {
      out.push(match[0]);
    }
    cursor = start + match[0].length;
  }

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function PostBody({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <p className={cn("whitespace-pre-line break-words leading-relaxed text-white/85", className)}>
      {linkify(text).map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </p>
  );
}
