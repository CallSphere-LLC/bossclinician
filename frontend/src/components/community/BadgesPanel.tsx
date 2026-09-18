import { Award } from "lucide-react";
import { SidebarPanel } from "@/components/community/SidebarPanel";
import type { CommunityBadge, NextBadge } from "@/lib/communityApi";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The member's own standing: points, what they have earned, what is next.
 *
 * Takes its data from the overview the page already loaded rather than fetching
 * again — every field here arrived with the channel list, and a second request
 * for numbers already in memory is a spinner nobody needed to see.
 *
 * The "next badge" bar measures from the previous threshold, not from zero.
 * Anchoring it at zero makes the jump from 400 to 500 points look like a bar
 * that has barely moved, which is the opposite of what it is there to say.
 */

interface BadgesPanelProps {
  points: number;
  badges: CommunityBadge[];
  nextBadge: NextBadge | null;
}

export function BadgesPanel({ points, badges, nextBadge }: BadgesPanelProps) {
  const earnedTop = badges.length > 0 ? badges[badges.length - 1].threshold : 0;
  const span = nextBadge ? Math.max(1, nextBadge.threshold - earnedTop) : 1;
  const progress = nextBadge
    ? Math.min(100, Math.max(0, Math.round(((points - earnedTop) / span) * 100)))
    : 100;

  return (
    <SidebarPanel title="Your standing" icon={<Award aria-hidden className="size-4 text-gold" />}>
      <p className="font-display text-3xl leading-none text-white">
        {formatNumber(points)}
        <span className="ml-2 font-body text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-orchid-dim">
          points
        </span>
      </p>

      {badges.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <li key={badge.id}>
              <span
                title={`${badge.name} — earned ${formatDate(badge.awardedAt)}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-gold/25",
                  "bg-gold/[0.08] px-3 py-1.5 text-[0.65rem] font-semibold text-gold",
                )}
              >
                <span aria-hidden>{badge.emoji}</span>
                {badge.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      {nextBadge && (
        <div className="mt-5">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress to ${nextBadge.name}`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]"
          >
            <span
              style={{ width: `${progress}%` }}
              className="block h-full rounded-full bg-gold-foil transition-[width] duration-700 ease-luxe"
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-orchid-dim">
            <span aria-hidden className="mr-1">
              {nextBadge.emoji}
            </span>
            {nextBadge.pointsToGo} more {nextBadge.pointsToGo === 1 ? "point" : "points"} to{" "}
            <span className="font-semibold text-orchid">{nextBadge.name}</span>.
          </p>
        </div>
      )}

      {badges.length === 0 && !nextBadge && (
        <p className="mt-3 text-sm leading-relaxed text-orchid-dim">
          Posting, replying and entering challenges all earn points here.
        </p>
      )}
    </SidebarPanel>
  );
}
