import { matchPath } from "react-router";
import { PUBLIC_ROUTES } from "@/App";

/**
 * Resolves the page component for a URL so it can render without suspending.
 *
 * Called on both sides of the handoff — the server before `renderToString`, the
 * browser before `hydrateRoot` — because those two renders have to produce the
 * same markup, and a route that is ready on one side and still loading on the
 * other does not.
 *
 * A URL with no public route (the member app, the admin) resolves to nothing
 * and is client-rendered as before.
 */
export async function preloadPublicRoute(pathname: string): Promise<void> {
  for (const route of PUBLIC_ROUTES) {
    if (matchPath(route.path, pathname)) {
      await route.Component.preload();
      return;
    }
  }
}
