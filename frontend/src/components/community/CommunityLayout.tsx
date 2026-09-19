import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
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
import {
  communityApi,
  type CommunityOverview,
  type CommunitySummary,
} from "@/lib/communityApi";
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
  const [communities, setCommunities] = useState<CommunitySummary[]>([]);
  useEffect(() => {
    communityApi
      .list()
      .then((r) => setCommunities(r.communities.filter((c) => c.joined)))
      .catch(() => setCommunities([]));
  }, []);

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
      sidebar={
        overview ? (
          <CommunityNavigation
            slug={slug}
            overview={overview}
            communities={communities}
            activeChannel={
              activeChannel ??
              (noChannel ? undefined : overview.channels[0]?.slug)
            }
          />
        ) : undefined
      }
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
                ? {
                    ...prev,
                    guidelines: { ...prev.guidelines, pending: false },
                  }
                : prev,
            )
          }
        />
      )}

      {overview && (
        <div
          className={cn(
            "grid grid-cols-1 gap-8",
            showSidebar && "lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-10",
          )}
        >
          <div className="min-w-0">
            <details className="rounded-xl border border-white/10 p-4 lg:hidden">
              <summary className="cursor-pointer font-semibold text-gold">
                Community channels and access groups
              </summary>
              <div className="mt-4">
                <CommunityNavigation
                  slug={slug}
                  overview={overview}
                  communities={communities}
                  activeChannel={
                    activeChannel ??
                    (noChannel ? undefined : overview.channels[0]?.slug)
                  }
                />
              </div>
            </details>
            <div className="mt-6">{children(overview)}</div>
          </div>

          {showSidebar && (
            <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
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

function CommunityNavigation({
  slug,
  overview,
  communities,
  activeChannel,
}: {
  slug: string;
  overview: CommunityOverview;
  communities: CommunitySummary[];
  activeChannel?: string;
}) {
  const groups = Array.from(
    new Set(overview.channels.map((c) => c.accessGroupName || "All members")),
  );
  const linkClass =
    "flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold";
  return (
    <div className="space-y-5">
      <Link
        to="/community"
        className="inline-flex min-h-11 items-center text-xs font-semibold text-orchid-dim hover:text-white"
      >
        ← All communities
      </Link>
      <nav aria-label="Your communities" className="space-y-2">
        {(communities.length
          ? communities
          : [
              {
                slug: overview.community.slug,
                name: overview.community.name,
                href: `/community/${slug}`,
              },
            ]
        ).map((c) => (
          <Link
            key={c.slug}
            to={c.href}
            aria-current={c.slug === slug ? "page" : undefined}
            className={cn(
              "block rounded-xl border px-3 py-3 text-sm font-bold leading-snug",
              c.slug === slug
                ? "border-gold/40 bg-gold/[0.12] text-gold"
                : "border-white/10 text-white/75 hover:bg-white/[0.05]",
            )}
          >
            {c.name}
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 pt-4">
        <CommandPalette slug={slug} />
      </div>
      <nav aria-label="Channels and access groups" className="space-y-5">
        {groups.map((group) => (
          <div key={group}>
            <p className="mb-2 px-3 text-[0.65rem] font-bold uppercase tracking-[0.13em] text-orchid-dim">
              {group}
            </p>
            <ul className="space-y-1">
              {overview.channels
                .filter((c) => (c.accessGroupName || "All members") === group)
                .map((c) => (
                  <li key={c.id}>
                    <Link
                      to={c.href}
                      aria-current={
                        c.slug === activeChannel ? "page" : undefined
                      }
                      className={cn(
                        linkClass,
                        c.slug === activeChannel
                          ? "bg-white/[0.09] text-gold"
                          : "text-white/65 hover:bg-white/[0.04] hover:text-white",
                      )}
                    >
                      {c.visibility === "private" ? (
                        <Lock aria-hidden className="size-4 shrink-0" />
                      ) : (
                        <Hash aria-hidden className="size-4 shrink-0" />
                      )}
                      <span className="min-w-0 break-words">{c.name}</span>
                      {c.unreadCount > 0 && (
                        <span className="ml-auto rounded-full bg-gold px-2 text-xs text-night-deep">
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
      {!!overview.availableAccessGroups?.length && (
        <section
          aria-label="Available access groups"
          className="space-y-3 border-t border-white/10 pt-4"
        >
          <h2 className="px-3 text-xs font-bold uppercase tracking-wider text-orchid-dim">
            More access groups
          </h2>
          {overview.availableAccessGroups.map((group) => (
            <Link
              key={group.id}
              to={`/checkout/${group.checkoutSlug}`}
              className="block rounded-xl border border-gold/25 p-3 text-sm text-white"
            >
              <span className="block font-semibold">{group.name}</span>
              <span className="mt-1 block text-xs text-gold">
                {group.pricingType === "free"
                  ? "Free access"
                  : `${new Intl.NumberFormat("en-US", { style: "currency", currency: group.currency || "usd" }).format(group.amountCents / 100)}${group.pricingType === "subscription" ? ` / ${group.interval}` : ""}`}{" "}
                · View access
              </span>
            </Link>
          ))}
        </section>
      )}
      <nav
        aria-label="Community activity"
        className="space-y-1 border-t border-white/10 pt-3"
      >
        {overview.liveRoom && (
          <Link
            to={overview.liveRoom.href}
            className={cn(
              linkClass,
              activeChannel === "live"
                ? "bg-gold/[0.12] text-gold"
                : "text-white/75",
            )}
            aria-current={activeChannel === "live" ? "page" : undefined}
          >
            <Radio aria-hidden className="size-4 shrink-0" />
            {overview.liveRoom.label}
          </Link>
        )}
        <Link
          to={`/community/${slug}/messages`}
          className={cn(linkClass, "text-white/75")}
        >
          <MessageSquare aria-hidden className="size-4 shrink-0" />
          Messages
        </Link>
        <Link
          to={`/community/${slug}/members`}
          className={cn(linkClass, "text-white/75")}
        >
          <Users aria-hidden className="size-4 shrink-0" />
          {formatNumber(overview.community.memberCount)} members
        </Link>
        <Link to="/library" className={cn(linkClass, "text-orchid-dim")}>
          Back to library
        </Link>
      </nav>
    </div>
  );
}
