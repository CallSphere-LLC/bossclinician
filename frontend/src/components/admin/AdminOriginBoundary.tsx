import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { ADMIN_ORIGIN, PUBLIC_ORIGIN } from "@/lib/siteOrigins";
import { adminNavigationOrigin, isUnavailableUi } from "@/lib/hostAccess";
import { UnavailableSite } from "@/components/UnavailableSite";
import { useHeadContext } from "@/ssr/context";

/** Preserve the original admin redirects; only the old public host is retired. */
export function AdminOriginBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const context = useHeadContext();
  const currentOrigin = typeof window === "undefined" ? context.origin : window.location.origin;
  const unavailable = isUnavailableUi(currentOrigin);
  const destination = adminNavigationOrigin(currentOrigin, location.pathname, ADMIN_ORIGIN, PUBLIC_ORIGIN);
  useEffect(() => {
    if (destination) window.location.replace(`${destination}${location.pathname}${location.search}${location.hash}`);
  }, [destination, location.pathname, location.search, location.hash]);
  if (unavailable) return <UnavailableSite />;
  return destination ? <p role="status">Opening the site…</p> : children;
}
