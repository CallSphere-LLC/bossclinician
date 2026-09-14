import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { enableEntrances } from "@/hooks/useEntranceMotion";
import type { HeadDescriptor } from "@/seo/types";

/**
 * What a server-rendered document hands to the app that hydrates it.
 *
 * The data the page was rendered from travels in the HTML rather than being
 * fetched again on mount. That is not only a saved round trip: React compares
 * the markup it produces against the markup it was given, so a page that
 * rendered from a blog post on the server and from bundled fallback copy in the
 * browser is a hydration mismatch by construction.
 *
 * It travels as a JSON data block rather than an assignment because the site is
 * served under a `script-src 'self'` policy — nothing inline may execute — and
 * because a payload that cannot run cannot be made to run by whatever a blog
 * excerpt happens to contain.
 */
export const SSR_PAYLOAD_ID = "bc-ssr-payload";

export interface SsrPayload {
  /** Absolute origin the document was served from, no trailing slash. */
  origin: string;
  /** False on hosts that must stay out of the search index. */
  indexable: boolean;
  /** Loader results, keyed by `ssr/keys.ts`. A `null` value means "not found". */
  data: Record<string, unknown>;
}

export interface SsrRuntime {
  payload: SsrPayload;
  /**
   * Server only. Every `<Seo>` rendered during the pass lands here in render
   * order, and the last one wins — a page that renders a "not found" branch
   * describes itself, not the route it was asked for.
   */
  headSink: HeadDescriptor[] | null;
}

const SsrContext = createContext<SsrRuntime | null>(null);

/**
 * Whether the seeded data is still the truth on screen.
 *
 * Live through the server render and the hydrating render; retired from the
 * first committed effect. Anything mounted after that — a client-side
 * navigation, a component revealed by an interaction — fetches for itself
 * rather than replaying whatever the document was born with.
 */
let payloadLive = true;
const subscribeToPayload = () => () => {};

export function SsrProvider({
  runtime,
  children,
}: {
  runtime: SsrRuntime;
  children: ReactNode;
}) {
  useEffect(() => {
    payloadLive = false;
    enableEntrances();
  }, []);

  return <SsrContext.Provider value={runtime}>{children}</SsrContext.Provider>;
}

export interface SsrSeed<T> {
  /** True when the server rendered this key — `value` may still be `null`. */
  seeded: boolean;
  value: T | null | undefined;
}

/** Reads one loader result, once, for the mount that is happening now. */
export function useSsrSeed<T>(key: string): SsrSeed<T> {
  const runtime = useContext(SsrContext);
  // Suspense can hydrate this route after the provider's first effect.
  // Keep its server data for that hydration; later SPA mounts fetch afresh.
  const live = useSyncExternalStore(subscribeToPayload, () => payloadLive, () => true);
  const [seed] = useState<SsrSeed<T>>(() => {
    if (!live || !runtime || !(key in runtime.payload.data)) {
      return { seeded: false, value: undefined };
    }
    return { seeded: true, value: runtime.payload.data[key] as T | null };
  });
  return seed;
}

/**
 * Where this document lives and whether it may be indexed.
 *
 * Falls back to the browser's own location for a client-rendered boot (the
 * member app and the admin, which are never server-rendered).
 */
export function useHeadContext(): { origin: string; indexable: boolean } {
  const runtime = useContext(SsrContext);
  if (runtime) return { origin: runtime.payload.origin, indexable: runtime.payload.indexable };
  return {
    origin: typeof window === "undefined" ? "" : window.location.origin,
    indexable: true,
  };
}

/** The collector a server render reads its head tags out of; null in a browser. */
export function useHeadSink(): HeadDescriptor[] | null {
  return useContext(SsrContext)?.headSink ?? null;
}
