import { useEffect, useState } from "react";

/**
 * Fetches a collection from the API, falling back to bundled static data
 * if the request fails (backend down, network error, etc). This guarantees
 * the site always renders a complete, populated view.
 */
export function useCollection<T>(
  fetcher: () => Promise<T>,
  fallback: T,
): { data: T; loading: boolean; usingFallback: boolean } {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setUsingFallback(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(fallback);
          setUsingFallback(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading, usingFallback };
}
