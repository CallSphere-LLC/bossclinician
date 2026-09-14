import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Hash, Loader2, Lock, MessageSquare, Radio, Users } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { NotificationBell } from "@/components/community/NotificationBell";
import { GuidelinesGate } from "@/components/community/GuidelinesGate";
import { CommandPalette } from "@/components/community/CommandPalette";
import { BadgesPanel } from "@/components/community/BadgesPanel";
import { EventsPanel } from "@/components/community/EventsPanel";
import { ChallengesPanel } from "@/components/community/ChallengesPanel";
import { LeaderboardPanel } from "@/components/community/LeaderboardPanel";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type CommunityOverview } from "@/lib/communityApi";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The chrome every community page sits in: the shell, the channel strip, the
 * bell, and the rail of panels down the side.
 *
 * It loads the overview once and hands it to whatever is rendering inside,
 * because every page in here needs the same three things — which community this
 * is, which channels it has, and what role the reader holds in it — and three
 * pages each fetching that separately is three spinners for one answer.
 *
 * The channel list is a horizontal strip rather than a second vertical rail.
 * `MemberShell` already owns the left edge, and a phone has no room for a third
 * column; a strip that scrolls sideways is the same information without
 * borrowing width from the thing people came to read.
 */

interface CommunityLayoutProps {
  slug: string;
  /**
   * Highlights a channel in the strip. Left unset on `/community/:slug`, which
   * shows the first channel without putting its name in the URL, and on the
   * people pages, which are in no channel at all.
   */
  activeChannel?: string;
  /** Suppresses the fall-back highlight where no channel is being read. */
  noChannel?: boolean;
  /** Off for the directory and profile, which do not need the panels. */
  showSidebar?: boolean;
  /** Replaces the community name in the page heading. */
  title?: string;
  description?: string;
  children: (overview: CommunityOverview) => ReactNode;
}

export function CommunityLayout({
  slug,
  activeChannel,
  noChannel = false,
  showSidebar = true,
  title,
  description,
  children,
}: CommunityLayoutProps) {
  const [overview, setOverview] = useState<CommunityOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    (async () => {
      try {
        const data = await communityApi.overview(slug);
        if (!cancelled) {
          setOverview(data);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not open this community just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const heading = title ?? overview?.community.name ?? "Community";

  return (
    <MemberShell
      title={heading}
      description={description ?? overview?.community.description}
      actions={<NotificationBell />}
    >
      <Seo title={`${heading} | Boss Clinician`} />

      <div aria-live="polite">
        {error && (
          <div role="alert" className="flex flex-col items-start gap-4">
            <p className="text-sm font-medium text-red-400">{error}</p>
            <LuxeButton to="/community" variant="glass" size="sm">
              Back to your communities
            </LuxeButton>
          </div>
        )}
        {!error && overview === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Opening the community…
          </p>
        )}
      </div>

      {/* Over the page, not instead of it: reading stays available while the
          member decides, and the gate itself is enforced server-side on every
          write regardless of whether this ever rendered. */}
      {overview?.guidelines?.pending && (
        <GuidelinesGate
          slug={slug}
          text={overview.guidelines.text}
          onAccepted={() =>
            setOverview((prev) =>
              prev && prev.guidelines
                ? { ...prev, guidelines: { ...prev.guidelines, pending: false } }
                : prev,
            )
          }
        />
      )}

      {overview && (
        <div
          className={cn(
            "grid gap-8",
            showSidebar && "lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10",
          )}
        >
          <div className="min-w-0">
            <ChannelStrip
              slug={slug}
              overview={overview}
              activeChannel={
                activeChannel ?? (noChannel ? undefined : overview.channels[0]?.slug)
              }
            />
            <div className="mt-6">{children(overview)}</div>
          </div>

          {showSidebar && (
            <aside className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
              <BadgesPanel
                points={overview.membership.points}
                badges={overview.membership.badges}
                nextBadge={overview.membership.nextBadge}
              />
              <EventsPanel communitySlug={slug} />
              <ChallengesPanel communitySlug={slug} />
              <LeaderboardPanel communitySlug={slug} />
            </aside>
          )}
        </div>
      )}
    </MemberShell>
  );
}

function ChannelStrip({
  slug,
  overview,
  activeChannel,
}: {
  slug: string;
  overview: CommunityOverview;
  activeChannel?: string;
}) {
  return (
    <nav aria-label="Channels" className="flex flex-col gap-3">
      <ul className="flex snap-x gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {overview.channels.map((channel) => (
          <li key={channel.id} className="snap-start">
            {/* A plain Link, not a NavLink: the active channel is the one the
                page resolved, which is not always the one in the URL — a bare
                `/community/:slug` lands on the first channel without naming it. */}
            <Link
              to={channel.href}
              aria-current={channel.slug === activeChannel ? "page" : undefined}
              className={cn(
                "inline-flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-full px-4",
                "text-[0.7rem] font-semibold uppercase tracking-[0.12em] transition-colors duration-300",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                channel.slug === activeChannel
                  ? "bg-gold/[0.12] text-gold"
                  : "text-white/55 hover:bg-white/[0.05] hover:text-white",
              )}
            >
              {channel.visibility === "private" ? (
                <Lock aria-hidden className="size-3.5" />
              ) : (
                <Hash aria-hidden className="size-3.5" />
              )}
              {channel.name}
              {channel.unreadCount > 0 && (
                <span className="grid min-w-[1.15rem] place-items-center rounded-full bg-gold px-1 text-[0.6rem] font-bold leading-[1.15rem] text-night-deep">
                  {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                </span>
              )}
            </Link>
          </li>
        ))}

        {/* The live room sits in the channel strip rather than the links below,
            because that is where members look for "places to be" — and it
            carries the host's own name for it, not ours. */}
        {overview.liveRoom && (
          <li className="snap-start">
            <Link
              to={overview.liveRoom.href}
              aria-current={activeChannel === "live" ? "page" : undefined}
              className={cn(
                "inline-flex min-h-[2.75rem] items-center gap-2 whitespace-nowrap rounded-full px-4",
                "text-[0.7rem] font-semibold uppercase tracking-[0.12em] transition-colors duration-300",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                activeChannel === "live"
                  ? "bg-gold/[0.12] text-gold"
                  : "text-white/55 hover:bg-white/[0.05] hover:text-white",
              )}
            >
              <Radio aria-hidden className="size-3.5" />
              {overview.liveRoom.label}
            </Link>
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* Cmd-K, with the shortcut printed on it — nobody discovers a
            keyboard shortcut that is written down nowhere. */}
        <CommandPalette slug={slug} />

        <Link
          to={`/community/${slug}/messages`}
          className={cn(
            "inline-flex min-h-[2.75rem] items-center gap-2 text-xs font-semibold",
            "uppercase tracking-[0.14em] text-orchid-dim transition-colors duration-300",
            "hover:text-gold focus-visible:outline focus-visible:outline-2",
            "focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          <MessageSquare aria-hidden className="size-3.5" />
          Messages
        </Link>

        <Link
          to={`/community/${slug}/members`}
          className={cn(
            "inline-flex min-h-[2.75rem] items-center gap-2 text-xs font-semibold",
            "uppercase tracking-[0.14em] text-orchid-dim transition-colors duration-300",
            "hover:text-gold focus-visible:outline focus-visible:outline-2",
            "focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          <Users aria-hidden className="size-4" />
          {/* Pluralised, because the chrome renders this uppercase and "1
              MEMBERS" is the first thing a member of a new community reads.
              The number itself now comes from one definition shared with the
              directory and the admin, so the two cannot disagree. */}
          {formatNumber(overview.community.memberCount)}{" "}
          {overview.community.memberCount === 1 ? "member" : "members"}
        </Link>
      </div>
    </nav>
  );
}
