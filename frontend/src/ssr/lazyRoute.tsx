import { lazy, type ComponentType, type FunctionComponent } from "react";

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
  const Lazy = lazy(factory);

  const Route: FunctionComponent = () => {
    const Ready = resolved;
    return Ready ? <Ready /> : <Lazy />;
  };

  return Object.assign(Route, {
    preload: () =>
      factory().then((module) => {
        resolved = module.default;
        return module;
      }),
  });
}
