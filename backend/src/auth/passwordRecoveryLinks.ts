export type RecoveryRealm = "admin" | "member";

/** Keep the intended page through login -> request -> email -> reset -> login.
 * URL parsing defeats dot-segment/encoded slash tricks. Authentication pages
 * and the other realm are excluded to avoid loops or crossing accounts. */
export function recoveryDestination(kind: RecoveryRealm, raw: unknown): string {
  const fallback = kind === "admin" ? "/admin" : "/library";
  if (typeof raw !== "string" || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, "https://recovery.invalid");
    if (url.origin !== "https://recovery.invalid" || /%2f|%5c/i.test(url.pathname)) return fallback;
    const path = url.pathname.toLowerCase();
    if (kind === "admin") {
      if (path !== "/admin" && !path.startsWith("/admin/")) return fallback;
      if (/^\/admin\/(login|invite|forgot-password|reset-password)(\/|$)/.test(path)) return fallback;
    } else if (/^\/(admin|api|login|signup|forgot-password|reset-password|verify-email)(\/|$)/.test(path)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function withRecoveryNext(path: string, kind: RecoveryRealm, raw: unknown): string {
  const next = recoveryDestination(kind, raw);
  const fallback = kind === "admin" ? "/admin" : "/library";
  return next === fallback ? path : `${path}?next=${encodeURIComponent(next)}`;
}
