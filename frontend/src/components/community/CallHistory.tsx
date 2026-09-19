import { useCallback, useEffect, useState } from "react";
import { communityApi, type MemberLiveVisit } from "@/lib/communityApi";
import { formatDateTime } from "@/lib/format";
import { formatCallDuration } from "./CallDuration";
export function CallHistory({
  slug,
  refreshKey,
}: {
  slug: string;
  refreshKey: string;
}) {
  const [items, setItems] = useState<MemberLiveVisit[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    communityApi
      .liveHistory(slug)
      .then((r) => setItems(r.items))
      .catch(() =>
        setError("We couldn't load your call history. Please try again."),
      );
  }, [slug]);
  useEffect(load, [load, refreshKey]);
  return (
    <section
      aria-label="Your call history"
      className="rounded-2xl border border-white/10 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl text-white">Your call history</h2>
        <button
          type="button"
          onClick={load}
          className="min-h-11 text-sm font-semibold text-gold"
        >
          Refresh history
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-300">
          {error}
        </p>
      ) : !items ? (
        <p className="mt-4 text-sm text-orchid-dim">Loading call history…</p>
      ) : !items.length ? (
        <p className="mt-4 text-sm text-orchid-dim">
          Your live room visits will appear here after you join a call.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/10">
          {items.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-sm text-white">
                  {formatDateTime(v.joinedAt)}
                </p>
                <p className="mt-1 text-xs text-orchid-dim">
                  {v.leftAt
                    ? `Ended ${formatDateTime(v.leftAt)}`
                    : v.inProgress
                      ? "Currently in the room"
                      : v.interrupted
                        ? "Connection ended"
                        : "Completed"}
                </p>
              </div>
              <span className="text-sm tabular-nums text-gold">
                {v.inProgress
                  ? "In progress"
                  : formatCallDuration(v.seconds ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
