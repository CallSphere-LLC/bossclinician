import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import {
  ArrowLeft,
  Award,
  Loader2,
  MessageCircle,
  MessageSquare,
  PenLine,
  Search,
  Users,
} from "lucide-react";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { luxeControlClass } from "@/components/luxe/LuxeField";
import { CommunityLayout } from "@/components/community/CommunityLayout";
import { MemberChip } from "@/components/community/MemberChip";
import { MemberAvatar } from "@/components/member/MemberShell";
import { MemberApiError } from "@/lib/memberApi";
import {
  communityApi,
  type CommunityMemberProfile,
  type DirectoryMember,
} from "@/lib/communityApi";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * `/community/:slug/members` and `/community/:slug/members/:memberId`.
 *
 * A directory of people, which is exactly as much as it is. There is no email
 * address on this page and no slot waiting for one — the API does not send it,
 * and the reason it does not is that everybody here handed over an address to
 * buy something and be told when their course opens, not so that the rest of
 * the room could have it. A "contact" field added later would quietly undo that,
 * so there is nowhere for it to go.
 */
export default function CommunityProfile() {
  const { slug, memberId } = useParams<{ slug: string; memberId: string }>();

  if (!slug) return <Navigate to="/community" replace />;

  const id = Number(memberId);
  const viewingProfile = memberId !== undefined;
  if (viewingProfile && (!Number.isInteger(id) || id <= 0)) {
    return <Navigate to={`/community/${slug}/members`} replace />;
  }

  return (
    <CommunityLayout
      slug={slug}
      noChannel
      showSidebar={false}
      title={viewingProfile ? "Profile" : "Members"}
      description={
        viewingProfile ? undefined : "Everybody in this room, with the busiest first."
      }
    >
      {() =>
        viewingProfile ? (
          <ProfileView communitySlug={slug} memberId={id} />
        ) : (
          <Directory communitySlug={slug} />
        )
      }
    </CommunityLayout>
  );
}

/* ------------------------------------------------------------- directory */

const PER_PAGE = 24;

function Directory({ communitySlug }: { communitySlug: string }) {
  const [term, setTerm] = useState("");
  const [members, setMembers] = useState<DirectoryMember[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // The search that is actually in flight, so a slow response for "sar" cannot
  // land after the one for "sarah" and repaint the list with the older answer.
  const latestQuery = useRef("");

  const search = useCallback(
    async (q: string, wanted: number) => {
      latestQuery.current = q;
      if (wanted === 1) setMembers(null);
      else setLoadingMore(true);

      try {
        const data = await communityApi.members(communitySlug, {
          q: q || undefined,
          page: wanted,
          perPage: PER_PAGE,
        });
        if (latestQuery.current !== q) return;
        setMembers((current) => (wanted === 1 ? data.members : [...(current ?? []), ...data.members]));
        setHasMore(data.hasMore);
        setTotal(data.total);
        setPage(data.page);
        setError("");
      } catch (err) {
        if (latestQuery.current !== q) return;
        setMembers([]);
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not load the directory just now. Please try again.",
        );
      } finally {
        setLoadingMore(false);
      }
    },
    [communitySlug],
  );

  // Debounced, because a directory of four hundred people is a query per
  // keystroke otherwise and the answer for a two-letter prefix is worthless.
  useEffect(() => {
    const timer = setTimeout(() => void search(term.trim(), 1), term ? 300 : 0);
    return () => clearTimeout(timer);
  }, [term, search]);

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <label className="sr-only" htmlFor="member-search">
          Search members by name
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-orchid-dim"
        />
        <input
          id="member-search"
          type="search"
          value={term}
          maxLength={100}
          placeholder="Search by name…"
          onChange={(e) => setTerm(e.target.value)}
          className={cn(luxeControlClass, "pl-11")}
        />
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && members === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading members…
          </p>
        )}
        {!error && members?.length === 0 && (
          <p className="text-sm text-orchid-dim">
            {term ? `Nobody here matches “${term}”.` : "Nobody has joined yet."}
          </p>
        )}
        {!error && members && members.length > 0 && (
          <p className="text-xs uppercase tracking-[0.14em] text-orchid-faint">
            {formatNumber(total)} {total === 1 ? "member" : "members"}
          </p>
        )}
      </div>

      {members && members.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {members.map((row) => (
            <li key={row.memberId}>
              <GlassCard
                spotlight={false}
                className={cn("p-4", row.mine && "ring-1 ring-inset ring-gold/30")}
              >
                <MemberChip
                  name={row.name}
                  avatarUrl={row.avatarUrl}
                  headline={row.headline}
                  to={row.href}
                  meta={
                    <span className="flex items-center gap-1.5">
                      {row.badge && <span aria-hidden>{row.badge}</span>}
                      <span className="tabular-nums">{formatNumber(row.points)}</span>
                    </span>
                  }
                />
              </GlassCard>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <LuxeButton
          variant="glass"
          size="sm"
          className="self-center"
          disabled={loadingMore}
          onClick={() => void search(term.trim(), page + 1)}
        >
          {loadingMore ? "Loading…" : "Show more"}
        </LuxeButton>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- profile */

function ProfileView({
  communitySlug,
  memberId,
}: {
  communitySlug: string;
  memberId: number;
}) {
  const [profile, setProfile] = useState<CommunityMemberProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    (async () => {
      try {
        const data = await communityApi.profile(communitySlug, memberId);
        if (!cancelled) {
          setProfile(data);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError
            ? err.message
            : "We could not open that profile just now. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communitySlug, memberId]);

  return (
    <div className="flex flex-col gap-5">
      <Link
        to={`/community/${communitySlug}/members`}
        className={cn(
          "inline-flex min-h-[2.75rem] items-center gap-2 self-start text-xs font-semibold",
          "uppercase tracking-[0.14em] text-orchid-dim transition-colors duration-300",
          "hover:text-gold focus-visible:outline focus-visible:outline-2",
          "focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        <ArrowLeft aria-hidden className="size-4" />
        All members
      </Link>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
        {!error && profile === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading profile…
          </p>
        )}
      </div>

      {profile && (
        <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <MemberAvatar
              src={profile.avatarUrl}
              name={profile.name}
              email=""
              className="size-20 text-lg sm:size-24"
            />

            <div className="min-w-0 flex-1">
              <h2 className="break-words font-display text-2xl leading-tight text-white">{profile.name}</h2>
              {profile.headline && (
                <p className="mt-1 text-sm text-orchid">{profile.headline}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {profile.role !== "member" && (
                  <span className="rounded-full bg-gold/[0.12] px-3 py-1 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-gold">
                    {profile.role}
                  </span>
                )}
                {profile.mine && (
                  <Link
                    to="/account/profile"
                    className={cn(
                      "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full",
                      "border border-white/12 px-3 text-[0.6rem] font-bold uppercase",
                      "tracking-[0.12em] text-orchid transition-colors duration-300",
                      "hover:border-gold/40 hover:text-gold",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    )}
                  >
                    <PenLine aria-hidden className="size-3" />
                    Edit your details
                  </Link>
                )}
                {/* Not on your own profile, where it would offer to message
                    yourself — which the server refuses anyway. */}
                {!profile.mine && (
                  <Link
                    to={`/community/${communitySlug}/messages/${memberId}`}
                    className={cn(
                      "inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full",
                      "border border-white/12 px-3 text-[0.6rem] font-bold uppercase",
                      "tracking-[0.12em] text-orchid transition-colors duration-300",
                      "hover:border-gold/40 hover:text-gold",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                    )}
                  >
                    <MessageSquare aria-hidden className="size-3" />
                    Message
                  </Link>
                )}
              </div>
            </div>
          </div>

          {profile.bio && (
            <p className="mt-6 whitespace-pre-line break-words leading-relaxed text-white/85">
              {profile.bio}
            </p>
          )}

          <div aria-hidden className="rule-faint my-6 w-full" />

          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat label="Points" value={formatNumber(profile.points)} icon={Award} />
            <Stat label="Posts" value={formatNumber(profile.postCount)} icon={PenLine} />
            <Stat
              label="Replies"
              value={formatNumber(profile.commentCount)}
              icon={MessageCircle}
            />
            <Stat label="Joined" value={formatDate(profile.joinedAt)} icon={Users} />
          </dl>

          {profile.badges.length > 0 && (
            <>
              <div aria-hidden className="rule-faint my-6 w-full" />
              <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-orchid">
                Badges
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {profile.badges.map((badge) => (
                  <li key={badge.id}>
                    <span
                      title={`Earned ${formatDate(badge.awardedAt)}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-gold/[0.08] px-3.5 py-1.5 text-[0.68rem] font-semibold text-gold"
                    >
                      <span aria-hidden>{badge.emoji}</span>
                      {badge.name}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </GlassCard>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Award;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-orchid-faint">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="mt-1.5 font-display text-lg text-white">{value}</dd>
    </div>
  );
}
