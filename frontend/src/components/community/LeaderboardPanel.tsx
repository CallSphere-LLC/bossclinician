import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { SidebarPanel } from "@/components/community/SidebarPanel";
import { MemberChip } from "@/components/community/MemberChip";
import { MemberApiError } from "@/lib/memberApi";
import { communityApi, type LeaderboardResponse } from "@/lib/communityApi";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * The top of the table, plus the member's own row wherever it happens to sit.
 *
 * The API sends both because a board that only shows the first twenty tells the
 * other four hundred people nothing about themselves. The own-row is repeated at
 * the bottom when it is not already in the list, which is the only arrangement
 * that works for somebody ranked 118th.
 */

const TOP_SHOWN = 8;

export function LeaderboardPanel({ communitySlug }: { communitySlug: string }) {
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await communityApi.leaderboard(communitySlug);
        if (!cancelled) {
          setBoard(data);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof MemberApiError ? err.message : "We could not load the leaderboard.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communitySlug]);

  const top = board?.leaderboard.slice(0, TOP_SHOWN) ?? [];
  const me = board?.me ?? null;
  const meIsListed = me !== null && top.some((row) => row.memberId === me.memberId);

  return (
    <SidebarPanel
      title="Leaderboard"
      icon={<Trophy aria-hidden className="size-4 text-gold" />}
      loading={board === null && !error}
      error={error}
      isEmpty={top.length === 0}
      empty="No points on the board yet."
    >
      <ol className="flex flex-col gap-1">
        {top.map((row) => (
          <li key={row.memberId}>
            <Row
              rank={row.rank}
              name={row.name}
              avatarUrl={row.avatarUrl}
              points={row.points}
              badge={row.badge}
              mine={row.mine}
              href={`/community/${communitySlug}/members/${row.memberId}`}
            />
          </li>
        ))}
      </ol>

      {me && !meIsListed && (
        <>
          <div aria-hidden className="rule-faint my-3 w-full" />
          <Row
            rank={me.rank}
            name={me.name}
            avatarUrl={me.avatarUrl}
            points={me.points}
            badge={me.badge}
            mine
            href={`/community/${communitySlug}/members/${me.memberId}`}
          />
        </>
      )}
    </SidebarPanel>
  );
}

function Row({
  rank,
  name,
  avatarUrl,
  points,
  badge,
  mine,
  href,
}: {
  rank: number;
  name: string;
  avatarUrl: string;
  points: number;
  badge: string | null;
  mine: boolean;
  href: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl", mine && "bg-gold/[0.07] px-2 py-1")}>
      <span
        className={cn(
          "w-6 shrink-0 text-right text-xs font-bold tabular-nums",
          rank <= 3 ? "text-gold" : "text-orchid-faint",
        )}
      >
        {rank}
      </span>
      <MemberChip
        name={name}
        avatarUrl={avatarUrl}
        size="sm"
        to={href}
        className="min-w-0 flex-1"
        meta={
          <span className="flex items-center gap-1.5">
            {badge && <span aria-hidden>{badge}</span>}
            <span className="tabular-nums">{formatNumber(points)}</span>
          </span>
        }
      />
    </div>
  );
}
