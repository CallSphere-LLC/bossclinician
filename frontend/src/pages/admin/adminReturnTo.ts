/**
 * Where to send someone after they sign in to the admin.
 *
 * The guard used to answer every signed-out admin URL with a bare
 * `/admin/login`, and the sign-in page always went to `/admin` afterwards. So a
 * link shared as "look at this coupon" — or any bookmark, after the session
 * expired — signed you in and dropped you on the dashboard, with the address
 * you actually wanted gone from both the bar and the history. The address now
 * rides along as `?next=`, which also survives a reload of the sign-in page.
 *
 * `next` is read from the URL, so anyone can write one. It is only ever
 * honoured as a path inside this site's admin — never another origin, never a
 * protocol-relative `//host`, never the sign-in page itself.
 */

export const RETURN_PARAM = "next";

const ADMIN_HOME = "/admin";
const LOGIN_PATH = "/admin/login";
/** Any stand-in origin: it only exists so a relative path can be parsed. */
const BASE = "https://admin.invalid";

interface LocationLike {
  pathname: string;
  search?: string;
  hash?: string;
}

/**
 * The sign-in URL for a signed-out visit to `location`.
 *
 * The dashboard itself carries no `next`: it is where sign-in lands anyway.
 */
export function loginPathFor(location: LocationLike): string {
  const target = `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
  const safe = safeReturnPath(target);
  if (safe.replace(/\/+$/, "") === ADMIN_HOME) return LOGIN_PATH;
  return `${LOGIN_PATH}?${RETURN_PARAM}=${encodeURIComponent(safe)}`;
}

/**
 * The admin path in `raw`, or `/admin` if it is missing or not one.
 *
 * Parsed with URL rather than prefix-checked, so the tricks a string check
 * misses — `/\evil.com`, `/admin/../../x`, `%2F%2Fevil.com`, a tab inside
 * `//` — all resolve to what a browser would do with them before the origin
 * and path are compared.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return ADMIN_HOME;
  }

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return ADMIN_HOME;
  }
  if (url.origin !== BASE) return ADMIN_HOME;

  const { pathname } = url;
  if (pathname !== ADMIN_HOME && !pathname.startsWith(`${ADMIN_HOME}/`)) return ADMIN_HOME;

  // Sending someone who has just signed in back to the sign-in page would look
  // like the sign-in failed; an invitation link is for someone with no account.
  const lower = pathname.toLowerCase().replace(/\/+$/, "");
  if (lower === LOGIN_PATH || lower.startsWith("/admin/invite/") || lower === "/admin/invite") {
    return ADMIN_HOME;
  }

  return `${pathname}${url.search}${url.hash}`;
}
