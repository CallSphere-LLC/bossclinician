import { useEffect, useRef, useState } from "react";
import { useSsrSeed } from "@/ssr/context";

/**
 * Fetches a collection from the API, falling back to bundled static data
 * if the request fails (backend down, network error, etc). This guarantees
 * the site always renders a complete, populated view.
 *
 * `ssrKey` names the loader that filled this collection during a server
 * render. Where one exists the rows come out of the document and no request is
 * made — which is not only a saved round trip. Without it the browser's first
 * render would show the bundled fallback while the server's markup showed the
 * live rows, and React would find the two documents disagreeing.
 */
export function useCollection<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  ssrKey?: string,
): { data: T; loading: boolean; usingFallback: boolean } {
  const key = ssrKey ?? "";
  const seed = useSsrSeed<T>(key);
  const seeded = Boolean(ssrKey) && seed.seeded && seed.value !== null && seed.value !== undefined;

  const [data, setData] = useState<T>(() => (seeded ? (seed.value as T) : fallback));
  const [loading, setLoading] = useState(!seeded);
  const [usingFallback, setUsingFallback] = useState(false);

  // Both close over the caller's props and so change identity every render; the
  // key is what actually identifies which collection is being asked for.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  /**
   * Which key the rows on screen belong to.
   *
   * The seed only ever describes the key this mounted with. A key that changes
   * afterwards — the blog archive filtered to a tag — is a different collection
   * and has to be fetched, or the page keeps showing the unfiltered ten posts
   * the document was born with and quietly loses everything past them.
   */
  const settledKey = useRef<string | null>(seeded ? key : null);

  useEffect(() => {
    if (settledKey.current === key) return;

    let cancelled = false;
    setLoading(true);
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        settledKey.current = key;
        setData(result);
        setUsingFallback(false);
      })
      .catch(() => {
        if (cancelled) return;
        settledKey.current = key;
        setData(fallbackRef.current);
        setUsingFallback(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { data, loading, usingFallback };
}
