export function isRouteLoadError(error: unknown): boolean {
  return error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .+ failed|Unable to preload CSS/i.test(error.message);
}

/** One automatic document recovery per URL per minute; never a reload loop. */
export function claimRouteRecovery(error: unknown, url: string, storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()): boolean {
  if (!isRouteLoadError(error)) return false;
  try {
    const key = "bc-route-recovery";
    const last = JSON.parse(storage.getItem(key) ?? "null") as { url: string; at: number } | null;
    if (last?.url === url && now - last.at < 60_000) return false;
    storage.setItem(key, JSON.stringify({ url, at: now }));
    return true;
  } catch {
    // If storage is unavailable, a retry button is safer than an unbounded reload.
    return false;
  }
}
