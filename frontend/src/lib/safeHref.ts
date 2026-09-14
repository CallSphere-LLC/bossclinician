/** Schemes an href may carry. Everything else — `javascript:`, `data:`, `vbscript:` — is refused. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * An address that is safe to put in an href, or undefined when it is not.
 *
 * Buttons across the site take their address from rows an admin typed into — a
 * course's link, a coaching session's meeting URL, the footer's Instagram — and
 * `javascript:` in any of them would be a working script on a page every
 * visitor can open. React 18 renders such an href as given, and react-router's
 * `<Link to>` passes anything with a scheme straight through to its `<a>`.
 *
 * Paths, `#anchors` and `?queries` have no scheme of their own and pass
 * unchanged, as do http(s), mailto and tel. The URL parser is the browser's
 * own, so leading spaces, tabs inside the scheme and upper case are judged the
 * way a click would judge them. The fixed base keeps this working during SSR,
 * where there is no `window.location` to resolve against.
 */
export function safeHref(raw: string): string | undefined {
  try {
    return SAFE_PROTOCOLS.has(new URL(raw, "http://relative.invalid").protocol) ? raw : undefined;
  } catch {
    return undefined;
  }
}
