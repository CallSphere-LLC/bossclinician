import { lazy, useState, type ComponentType, type FunctionComponent } from "react";

export type RouteComponent = FunctionComponent & {
  /** Resolves the page's chunk and makes this component render synchronously. */
  preload: () => Promise<unknown>;
};

/**
 * A route component that can be made ready before anything renders.
 *
 * `React.lazy` alone cannot be server-rendered by `renderToString`: it suspends
 * on first render, and the string that comes back is the Suspense fallback.
 * Awaiting `preload()` first resolves the module, after which this component
 * renders it directly and no boundary is involved at all.
 *
 * The browser preloads the same route before hydrating, so both sides render
 * the page component rather than one of them rendering a spinner. Any route
 * reached later — a link click — still goes through `React.lazy` and its
 * Suspense fallback, which is what keeps the marketing bundle split.
 */
export function lazyRoute(factory: () => Promise<{ default: ComponentType }>): RouteComponent {
  let resolved: ComponentType | null = null;
  let pending: Promise<{ default: ComponentType }> | null = null;
  const load = () => {
    pending ??= factory().then((module) => {
      resolved = module.default;
      return module;
    }).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
  const Lazy = lazy(load);

  const Route: FunctionComponent = () => {
    // Preloading must not change an already-mounted component's identity and
    // discard form state when a visitor opens the menu for the current page.
    const [Page] = useState(() => resolved ?? Lazy);
    return <Page />;
  };

  return Object.assign(Route, {
    preload: load,
  });
}
