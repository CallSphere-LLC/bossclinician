/**
 * Where a host link may send the coach once it has signed her in.
 *
 * `next` rides in on the URL beside the one-time token, so anyone can write
 * one. It is only ever honoured as a path inside this site's community — never
 * another origin, never a protocol-relative `//host`, never the account area.
 * Anything else lands on the community home, which is still the right side of
 * the door.
 */

const COMMUNITY_HOME = "/community";
/** Any stand-in origin: it only exists so a relative path can be parsed. */
const BASE = "https://site.invalid";

/**
 * The community path in `next`, or `/community` if it is missing or not one.
 *
 * Parsed with URL rather than prefix-checked, so the tricks a string check
 * misses — `/community/../account`, a tab inside `//`, `%5C` — all resolve to
 * what a browser would do with them before the origin and path are compared.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return COMMUNITY_HOME;
  }

  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return COMMUNITY_HOME;
  }
  if (url.origin !== BASE) return COMMUNITY_HOME;

  const { pathname } = url;
  if (!pathname.startsWith(`${COMMUNITY_HOME}/`) || pathname.includes("//")) return COMMUNITY_HOME;
  // An encoded backslash or slash is a second way to write the tricks above.
  if (/%5c|%2f/i.test(pathname)) return COMMUNITY_HOME;

  return `${pathname}${url.search}${url.hash}`;
}
