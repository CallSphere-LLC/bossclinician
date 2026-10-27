import { env } from "../config/env";

const RETIRED_PUBLIC_HOST = "bossclinician.callsphere.site";
const CANONICAL_PUBLIC_ORIGIN = "https://www.bossclinician.com";

/** Email links must not revive the retired public site, even with stale config. */
export function publicEmailOrigin(configured = env.publicSiteUrl): string {
  try {
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      return CANONICAL_PUBLIC_ORIGIN;
    }
    if ([RETIRED_PUBLIC_HOST, "bossclinician.com", "www.bossclinician.com"].includes(url.hostname)) {
      return CANONICAL_PUBLIC_ORIGIN;
    }
    return url.origin; // Preserve explicit development/preview origins.
  } catch {
    return CANONICAL_PUBLIC_ORIGIN;
  }
}

export function publicEmailUrl(path: string, configured = env.publicSiteUrl): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) {
    throw new Error("Email link requires an internal absolute path");
  }
  return publicEmailOrigin(configured) + path;
}

/**
 * Rewrite whole absolute URL tokens, not substrings in hosts, email addresses,
 * third-party redirect query strings, or arbitrary prose. Retain path/query/hash
 * bytes (including signed/encoded parameters) and leave non-default ports alone.
 * SQL migration 162 mirrors this contract for stored automation/template bodies.
 */
export function canonicalizeEmailLinks(body: string, configured = env.publicSiteUrl): string {
  const origin = publicEmailOrigin(configured);
  return body.replace(/https?:\/\/[^\s<>"'`]+/gi, (token) => {
    try {
      const url = new URL(token);
      if (url.hostname !== RETIRED_PUBLIC_HOST || url.username || url.password || url.port) return token;
      return token.replace(/^https?:\/\/bossclinician\.callsphere\.site(?::(?:80|443))?(?=[/?#]|$)/i, origin);
    } catch {
      return token;
    }
  });
}
