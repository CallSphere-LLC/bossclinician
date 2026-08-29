import { useEffect, useRef, useState } from "react";
import { useSsrSeed } from "@/ssr/context";
import { hasMemberSessionHint } from "@/hooks/useMember";

export type PageDataState<T> =
  | { status: "loading"; data: undefined }
  | { status: "ready"; data: T }
  | { status: "missing"; data: undefined }
  | { status: "error"; data: undefined };

interface Options {
  /**
   * Re-fetch after mount when the visitor has a member session.
   *
   * A server render is anonymous — a browser navigating to a page sends no
   * access token — so any field that depends on who is asking ("you own this")
   * is rendered signed-out. For a crawler and for a stranger that is the whole
   * truth and nothing is fetched. Only a visitor who is actually signed in pays
   * for the correction.
   */
  revalidateForMembers?: boolean;
}

/**
 * One page's own resource: seeded by the server render where there was one,
 * fetched on mount where there wasn't.
 *
 * A seeded `null` is "the server looked and there is nothing there", which is a
 * finished answer — it becomes `missing` without a request. That is what keeps
 * a 404 from costing a round trip before the page can say so.
 */
export function usePageData<T>(
  key: string,
  load: () => Promise<T>,
  options: Options = {},
): PageDataState<T> {
  const seed = useSsrSeed<T>(key);
  const [state, setState] = useState<PageDataState<T>>(() => {
    if (!seed.seeded) return { status: "loading", data: undefined };
    if (seed.value === null || seed.value === undefined) {
      return { status: "missing", data: undefined };
    }
    return { status: "ready", data: seed.value };
  });

  // The loader closes over props and so changes identity every render; the key
  // is what actually identifies the request.
  const loadRef = useRef(load);
  loadRef.current = load;

  /** Which key the value currently on screen belongs to. */
  const settledKey = useRef<string | null>(seed.seeded ? key : null);
  const revalidate = options.revalidateForMembers ?? false;

  useEffect(() => {
    if (settledKey.current === key) {
      if (!revalidate || !hasMemberSessionHint()) return;
    } else {
      setState({ status: "loading", data: undefined });
    }

    let cancelled = false;
    loadRef
      .current()
      .then((data) => {
        if (cancelled) return;
        settledKey.current = key;
        setState({ status: "ready", data });
      })
      .catch((err: { status?: number }) => {
        if (cancelled) return;
        settledKey.current = key;
        setState(
          err?.status === 404
            ? { status: "missing", data: undefined }
            : { status: "error", data: undefined },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [key, revalidate]);

  return state;
}
