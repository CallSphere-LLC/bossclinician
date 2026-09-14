import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight, Loader2, MessagesSquare, Users } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { CommunityLayout } from "@/components/community/CommunityLayout";
import { ChannelFeed } from "@/components/community/ChannelFeed";
import { NotificationBell } from "@/components/community/NotificationBell";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type CommunitySummary } from "@/lib/communityApi";
import { formatNumber } from "@/lib/format";

/**
 * `/community` and `/community/:slug`.
 *
 * Bare `/community` is a doorway, not a destination. Almost everybody here has
 * exactly one room, and making them look at a list of one before they can read
 * anything is a click that exists only because the data model allows for more.
 * One community redirects straight into it; several show the picker; none shows
 * what to buy.
 *
 * `/community/:slug` opens on the first channel without putting its name in the
 * URL. Somebody who bookmarks the community gets the community, and it keeps
 * working after a channel is renamed or reordered — which a bookmark straight
 * to `/community/x/introductions` does not.
 */
export default function Community() {
  const { slug } = useParams<{ slug: string }>();
  return slug ? <CommunityHome slug={slug} /> : <CommunityPicker />;
}

function CommunityHome({ slug }: { slug: string }) {
  return (
    <CommunityLayout slug={slug}>
      {(overview) => {
        const first = overview.channels[0];
        if (!first) return <NoChannelsYet />;
        return (
          <ChannelFeed
            communitySlug={slug}
            channelSlug={first.slug}
            role={overview.membership.role}
          />
        );
      }}
    </CommunityLayout>
  );
}

function NoChannelsYet() {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-8 text-center">
      <MessagesSquare aria-hidden className="mx-auto size-7 text-gold" />
      <p className="mt-3 font-display text-lg text-white">This room is still being set up</p>
      <p className="copy-luxe mx-auto mt-2 max-w-sm text-sm">
        There are no channels here yet. Yvette is putting them together — check back shortly.
      </p>
    </GlassCard>
  );
}

function CommunityPicker() {
  const [communities, setCommunities] = useState<CommunitySummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await communityApi.list();
        if (!cancelled) {
          setCommunities(data.communities);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load your communities just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The redirect happens in render rather than an effect so there is no frame
  // where the list of one is visible before it disappears again.
  if (communities?.length === 1) {
    return <Navigate to={communities[0].href} replace />;
  }

  return (
    <MemberShell
      title="Community"
      description="The rooms you are part of."
      actions={<NotificationBell />}
    >
      <Seo title="Community | Boss Clinician" />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && communities === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading your communities…
          </p>
        )}
      </div>

      {communities?.length === 0 && <NoCommunitiesYet />}

      {communities && communities.length > 1 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {communities.map((community) => (
            <li key={community.id}>
              <CommunityCard community={community} />
            </li>
          ))}
        </ul>
      )}
    </MemberShell>
  );
}

function CommunityCard({ community }: { community: CommunitySummary }) {
  return (
    <GlassCard accent={community.unreadCount > 0 ? "gold" : "neutral"} className="h-full">
      <Link
        to={community.href}
        className="flex h-full flex-col p-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl leading-snug text-white">{community.name}</h2>
          {community.unreadCount > 0 && (
            <span className="shrink-0 rounded-full bg-gold px-2.5 py-1 text-[0.62rem] font-bold text-night-deep">
              {community.unreadCount > 99 ? "99+" : community.unreadCount} new
            </span>
          )}
        </div>

        {community.description && (
          <p className="copy-luxe mt-2 line-clamp-3 text-sm">{community.description}</p>
        )}

        <p className="mt-auto flex items-center gap-1.5 pt-5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-orchid-faint">
          <Users aria-hidden className="size-3.5" />
          {/* Same words, same case and same count as the community's own
              header. This card said "1 members" in sentence case while the
              header said "2 MEMBERS": two labels, two definitions of a member,
              and neither of them agreeing with the other. */}
          {formatNumber(community.memberCount)}{" "}
          {community.memberCount === 1 ? "member" : "members"}
          <ArrowRight aria-hidden className="ml-auto size-4 text-gold" />
        </p>
      </Link>
    </GlassCard>
  );
}

function NoCommunitiesYet() {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-8 text-center sm:p-10">
      <Users aria-hidden className="mx-auto size-7 text-gold" />
      <p className="mt-4 font-display text-xl text-white">You are not in a community yet</p>
      <p className="copy-luxe mx-auto mt-3 max-w-md text-sm">
        The community rooms come with the coaching programmes and memberships. If you have just
        bought one and it is not here, give it a minute and reload — and if it still is not, reply
        to any email from us.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LuxeButton to="/work-with-me" size="sm">
          See what is included
        </LuxeButton>
        <LuxeButton to="/library" variant="glass" size="sm">
          Your library
        </LuxeButton>
      </div>
    </GlassCard>
  );
}
