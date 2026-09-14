/** Navigation boundaries; API calls remain relative to their own origin. */
export const ADMIN_ORIGIN = (import.meta.env.VITE_ADMIN_ORIGIN as string | undefined) ??
  (import.meta.env.PROD ? "https://admin.bossclinician.callsphere.site" : "");
export const PUBLIC_ORIGIN = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ??
  (import.meta.env.PROD ? "https://bossclinician.callsphere.site" : "");
export function publicSiteUrl(path = "/"): string {
  return `${PUBLIC_ORIGIN || (typeof window === "undefined" ? "" : window.location.origin)}${path}`;
}
