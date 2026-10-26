import { configuredAdminOrigin } from "./hostAccess";

/** Navigation boundaries; API calls remain relative to their own origin.
 * There is no production admin origin while the admin application is retired. */
export const ADMIN_ORIGIN = configuredAdminOrigin(import.meta.env.VITE_ADMIN_ORIGIN, import.meta.env.DEV);
export const PUBLIC_ORIGIN = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ??
  (import.meta.env.PROD ? "https://www.bossclinician.com" : "");
export function publicSiteUrl(path = "/"): string {
  return `${PUBLIC_ORIGIN || (typeof window === "undefined" ? "" : window.location.origin)}${path}`;
}
