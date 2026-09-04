import { Link } from "react-router-dom";
import { MessageSquare, Pin } from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import type { CommunityPost } from "@/lib/communityApi";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The two layouts that are not the feed.
 *
 * Kajabi offers three ways to read a channel and describes each by what it is
 * for: a feed is "social card layout for scrolling through text and media
 * posts", a forum is "compact table layout for scanning topics, replies, and
 * activity", and a gallery is a "responsive image grid". They are genuinely
 * different jobs — a channel where people post photographs is unreadable as a
 * table, and a busy Q&A is unreadable as a wall of cards — which is why the
 * choice is the channel's rather than a global preference.
 *
 * The feed itself stays in `ChannelFeed`, because it owns posting, reactions,
 * comments and infinite scroll. These two are read-only views of the same
 * posts: tapping through to a post is how you reply from either.
 */

/** Compact rows for scanning: title, who, replies, last activity. */
export function ForumView({
  posts,
  communitySlug,
  channelSlug,
}: {
  posts: CommunityPost[];
  communitySlug: string;
  channelSlug: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead>
          <tr className="text-[0.65rem] uppercase tracking-[0.14em] text-white/45">
            <th className="py-2.5 pr-4 font-semibold">Topic</th>
            <th className="py-2.5 pr-4 font-semibold">Started by</th>
            <th className="py-2.5 pr-4 font-semibold">Replies</th>
            <th className="py-2.5 font-semibold">Activity</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id} className="border-t border-white/[0.07] align-top">
              <td className="py-3 pr-4">
                <Link
                  to={`/community/${communitySlug}/${channelSlug}?post=${post.id}`}
                  className="flex min-h-11 items-start gap-2 font-semibold text-white hover:text-gold"
                >
                  {post.pinned && <Pin aria-label="Pinned" className="mt-0.5 size-3.5 shrink-0 text-gold" />}
                  <span className="line-clamp-2">
                    {post.title || post.body.slice(0, 90) || "(no words)"}
                  </span>
                </Link>
              </td>
              <td className="py-3 pr-4 text-white/70">{post.author.name}</td>
              <td className="py-3 pr-4 tabular-nums text-white/70">{post.commentCount}</td>
              <td className="whitespace-nowrap py-3 text-xs text-white/50">
                {formatRelative(post.lastActivityAt ?? post.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An image grid.
 *
 * Only posts that actually carry a picture. A gallery padded out with text
 * posts rendered as grey rectangles is a worse feed, not a gallery — so the
 * empty state says what the view is for instead of pretending.
 */
export function GalleryView({
  posts,
  communitySlug,
  channelSlug,
}: {
  posts: CommunityPost[];
  communitySlug: string;
  channelSlug: string;
}) {
  const withImages = posts.filter((post) => post.kind === "image" && post.mediaUrl);

  if (withImages.length === 0) {
    return (
      <GlassCard spotlight={false} interactive={false} className="p-8 text-center">
        <p className="font-display text-lg text-white">Nothing to show yet</p>
        <p className="copy-luxe mx-auto mt-2 max-w-sm text-sm">
          The gallery shows posts with a picture. Post an image and it will
          appear here.
        </p>
      </GlassCard>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {withImages.map((post) => (
        <li key={post.id}>
          <Link
            to={`/community/${communitySlug}/${channelSlug}?post=${post.id}`}
            className="group block overflow-hidden rounded-xl border border-white/10"
          >
            <span className="block aspect-square overflow-hidden bg-white/[0.04]">
              <img
                src={post.mediaUrl}
                alt={post.title || `Posted by ${post.author.name}`}
                loading="lazy"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </span>
            <span className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs">
              <span className="min-w-0 truncate text-white/75">{post.author.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-white/45">
                <MessageSquare aria-hidden className="size-3" />
                {post.commentCount}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const MODE_LABELS: Record<string, string> = {
  feed: "Feed",
  forum: "Forum",
  gallery: "Gallery",
};

/** The switcher. Hidden when a channel offers only one layout. */
export function ViewModeSwitch({
  modes,
  active,
  onChange,
}: {
  modes: string[];
  active: string;
  onChange: (mode: string) => void;
}) {
  if (modes.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="How to view this channel">
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === active}
          onClick={() => onChange(mode)}
          className={cn(
            "inline-flex min-h-10 items-center rounded-full px-4 text-xs font-semibold",
            "uppercase tracking-[0.12em] transition-colors",
            mode === active
              ? "bg-gold/[0.14] text-gold"
              : "border border-white/12 text-white/55 hover:text-white",
          )}
        >
          {MODE_LABELS[mode] ?? mode}
        </button>
      ))}
    </div>
  );
}
