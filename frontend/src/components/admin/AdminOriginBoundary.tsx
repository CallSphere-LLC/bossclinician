import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { UnavailableSite } from "@/components/UnavailableSite";
import { isUnavailableUi } from "@/lib/hostAccess";
import { useHeadContext } from "@/ssr/context";

/** Runs before member/admin auth and preview providers, including SPA navigation.
 * Retired hosts never redirect; the admin application has not been relocated. */
export function AdminOriginBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const context = useHeadContext();
  // A cached bootstrap cannot disguise the actual browser host.
  const origin = typeof window === "undefined" ? context.origin : window.location.origin;
  return isUnavailableUi(origin, location.pathname, import.meta.env.DEV)
    ? <UnavailableSite />
    : children;
}
