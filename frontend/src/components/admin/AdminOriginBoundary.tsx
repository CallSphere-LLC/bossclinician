import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ADMIN_ORIGIN, PUBLIC_ORIGIN } from "@/lib/siteOrigins";

/** React navigation also crosses the boundary; an SPA Link does not hit nginx. */
export function AdminOriginBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const currentOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const adminPath = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const destination = currentOrigin && ADMIN_ORIGIN && adminPath && currentOrigin !== ADMIN_ORIGIN
    ? ADMIN_ORIGIN
    : currentOrigin && PUBLIC_ORIGIN && currentOrigin === ADMIN_ORIGIN && !adminPath ? PUBLIC_ORIGIN : "";
  useEffect(() => {
    if (destination) window.location.replace(`${destination}${location.pathname}${location.search}${location.hash}`);
  }, [destination, location.pathname, location.search, location.hash]);
  return destination ? <p role="status">Opening the site…</p> : children;
}
