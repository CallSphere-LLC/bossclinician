import { useState } from "react";
import { ExternalLink, Film } from "lucide-react";
import { safeLink, type PostKind } from "@/lib/communityApi";
import { cn } from "@/lib/cn";

/**
 * The image, clip or link hanging off a post.
 *
 * Every URL goes through `safeLink` before it reaches a `src` or an `href`,
 * even though the server already refused anything that was not http(s). A row
 * written by an older build, or restored from a backup taken before that check
 * existed, is exactly the row that would slip through — and a `javascript:` URL
 * in an href is the whole attack, not a corner of it.
 *
 * Nothing here renders an iframe. An embed is somebody else's script running on
 * a page where members are signed in, and a member pasting a link is not a
 * decision to let that host read this session.
 */

const VIDEO_FILE = /\.(mp4|webm|ogv|ogg|mov|m4v)$/i;

/** Whether the link is a file a `<video>` element can actually play. */
function isPlayableVideo(href: string): boolean {
  try {
    return VIDEO_FILE.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

const FRAME = "overflow-hidden rounded-xl border border-white/10 bg-black/40";

export function PostMedia({ kind, mediaUrl }: { kind: PostKind; mediaUrl: string }) {
  const [broken, setBroken] = useState(false);
  const href = safeLink(mediaUrl);

  if (!href || kind === "text" || kind === "poll") return null;

  if (kind === "image") {
    if (broken) return <LinkCard href={href} label="Image" />;
    return (
      <div className={cn(FRAME, "mt-3.5")}>
        <img
          src={href}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="max-h-[32rem] w-full object-contain"
        />
      </div>
    );
  }

  if (kind === "video") {
    if (!isPlayableVideo(href)) return <LinkCard href={href} label="Watch" icon="video" />;
    return (
      <div className={cn(FRAME, "mt-3.5")}>
        {/* `preload="metadata"` so a feed of ten clips does not pull ten videos
            down a phone connection before anyone has pressed play. */}
        <video src={href} controls preload="metadata" className="max-h-[32rem] w-full" />
      </div>
    );
  }

  return <LinkCard href={href} />;
}

function LinkCard({
  href,
  label,
  icon = "link",
}: {
  href: string;
  label?: string;
  icon?: "link" | "video";
}) {
  const Icon = icon === "video" ? Film : ExternalLink;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className={cn(
        "mt-3.5 flex min-h-[2.75rem] items-center gap-3 rounded-xl border border-white/10",
        "bg-white/[0.03] px-4 py-3 transition-colors duration-300",
        "hover:border-gold/40 hover:bg-white/[0.06]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-gold" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white/90">{hostOf(href)}</span>
        <span className="block truncate text-xs text-orchid-dim">{label ?? href}</span>
      </span>
    </a>
  );
}
