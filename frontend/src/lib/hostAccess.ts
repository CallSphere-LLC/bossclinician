/** Retired UI hosts mirror the server boundary, including the former admin alias.
 * Backend callback exceptions are not UI exceptions. */
const RETIRED_HOSTS = new Set([
  "bossclinician.callsphere.site",
  "admin.bossclinician.com",
  "admin.bossclinician.callsphere.site",
]);

function hostname(origin: string): string {
  try { return new URL(origin).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return ""; }
}

export function isRetiredOrigin(origin: string): boolean {
  return RETIRED_HOSTS.has(hostname(origin));
}

export function isAdminUiPath(pathname: string): boolean {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* malformed URL stays literal */ }
  const path = decoded.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  return path === "/admin" || path.startsWith("/admin/");
}

/** The admin application has not moved to the public site or another host.
 * Keep local development usable, but no production origin serves admin UI. */
export function isUnavailableUi(origin: string, pathname: string, development = false): boolean {
  if (isRetiredOrigin(origin)) return true;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname(origin));
  return isAdminUiPath(pathname) && !(development && local);
}

/** A stale build setting must not restore trust in a retired preview origin. */
export function configuredAdminOrigin(value: unknown, development: boolean): string {
  if (!development || typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !isRetiredOrigin(url.origin) ? url.origin : "";
  } catch { return ""; }
}
