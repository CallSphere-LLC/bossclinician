import { useEffect, useRef } from "react";
import { applyHead, resolveHead } from "@/seo/head";
import type { HeadDescriptor } from "@/seo/types";
import { useHeadContext, useHeadSink } from "@/ssr/context";

/**
 * What a page says about itself.
 *
 * One component, two destinations. During a server render it files its props
 * with the request's collector, which `entry-server` resolves into the `<head>`
 * a crawler reads before any script has run. In a browser it writes the same
 * resolved tags into the live document, which is what keeps the tab title,
 * canonical and share cards correct after a client-side navigation.
 *
 * Deliberately not react-helmet: the only thing a helmet library adds over this
 * is merging tags contributed by several components at once, and nothing here
 * does that — a page describes itself in one place.
 */
export function Seo(props: HeadDescriptor) {
  const sink = useHeadSink();
  const context = useHeadContext();

  // Server only. Writing during render is what a collector is: there is one
  // pass, it is synchronous, and the array belongs to this request alone.
  if (sink) sink.push(props);

  const latest = useRef({ props, context });
  latest.current = { props, context };

  // Structural identity, not referential: every value here is a string, a
  // string array or plain JSON, and the props object is rebuilt every render.
  const fingerprint = JSON.stringify([props, context]);

  useEffect(() => {
    const { props: descriptor, context: headContext } = latest.current;
    applyHead(
      resolveHead(descriptor, {
        ...headContext,
        url: window.location.pathname + window.location.search,
      }),
    );
  }, [fingerprint]);

  return null;
}
