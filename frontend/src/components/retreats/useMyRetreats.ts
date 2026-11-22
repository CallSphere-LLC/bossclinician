import { useEffect, useState } from "react";
import { useMember } from "@/hooks/useMember";
import { memberRetreatsApi, type MyRetreat } from "@/lib/retreatsApi";

/**
 * The published retreats this member is a guest of — what decides whether the
 * portal rail shows "FlourisHealer Retreats" at all.
 *
 * Fetched once per signed-in member per page load and shared by every shell
 * that mounts; any failure (or no session) reads as "none", so the rail never
 * advertises a dashboard the member cannot open.
 */
let cache: { memberId: number; promise: Promise<MyRetreat[]> } | null = null;

function load(memberId: number): Promise<MyRetreat[]> {
  if (cache?.memberId !== memberId) {
    cache = {
      memberId,
      promise: memberRetreatsApi
        .mine()
        .then((result) => (Array.isArray(result.retreats) ? result.retreats : []))
        .catch(() => []),
    };
  }
  return cache.promise;
}

export function useMyRetreats(enabled = true): MyRetreat[] {
  const { member } = useMember();
  const memberId = member?.id ?? null;
  const [retreats, setRetreats] = useState<MyRetreat[]>([]);

  useEffect(() => {
    if (!enabled || memberId === null) {
      setRetreats([]);
      return;
    }
    let cancelled = false;
    void load(memberId).then((list) => {
      if (!cancelled) setRetreats(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, memberId]);

  return retreats;
}
