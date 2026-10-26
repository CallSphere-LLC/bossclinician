/** Only the former public host is retired. Admin hosts remain active. */
function hostname(origin: string): string {
  try { return new URL(origin).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return ""; }
}
export function isRetiredOrigin(origin: string): boolean {
  return hostname(origin) === "bossclinician.callsphere.site";
}
export function isUnavailableUi(origin: string): boolean {
  return isRetiredOrigin(origin);
}
export function isAdminUiPath(pathname: string): boolean {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* retain malformed path */ }
  const path = decoded.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
  return path === "/admin" || path.startsWith("/admin/");
}

/** Original public/admin origin boundary, with the legacy admin alias retained. */
export function adminNavigationOrigin(currentOrigin: string, pathname: string, adminOrigin: string, publicOrigin: string): string {
  if (isRetiredOrigin(currentOrigin)) return "";
  if (hostname(currentOrigin) === "admin.bossclinician.callsphere.site") return "https://admin.bossclinician.com";
  const adminPath = isAdminUiPath(pathname);
  return currentOrigin && adminOrigin && adminPath && currentOrigin !== adminOrigin
    ? adminOrigin
    : currentOrigin && publicOrigin && currentOrigin === adminOrigin && !adminPath ? publicOrigin : "";
}
