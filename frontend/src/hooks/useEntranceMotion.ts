import { useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Whether this element should mount already in its final state.
 *
 * Entrance animations start at `opacity: 0`. On a server-rendered page that
 * would put the whole article in the HTML and then hide it: a crawler still
 * reads the words, but the browser paints nothing until the bundle has arrived
 * and run, which throws away the entire point of rendering on the server —
 * Largest Contentful Paint does not count an element nobody can see.
 *
 * So the first painted screen is static, and everything mounted after it
 * animates normally. The decision is captured with `useState` at mount, which
 * is what makes it safe: a component that hydrated against static markup keeps
 * that answer for its whole life, so nothing can flip to `opacity: 0` and
 * animate back in a frame after the page appeared. Only the user's own
 * reduced-motion setting is consulted from then on.
 *
 * Drop-in for `useReducedMotion()` wherever the result gates an *entrance*.
 * Interaction animations — a menu opening, a hover, a dialog — should keep
 * calling `useReducedMotion()` directly: those elements mount on demand, long
 * after the first paint, and have no server-rendered markup to agree with.
 */
export function useEntranceMotion(): boolean {
  const prefersReduced = useReducedMotion();
  const [staticFirstPaint] = useState(() => !entrancesEnabled);
  return staticFirstPaint || prefersReduced === true;
}

/**
 * False through the server render and the hydrating render, true from the first
 * committed effect onwards. A module-level flag rather than context because
 * `useEntranceMotion` must be readable from a `useState` initialiser, before any
 * provider value could be consulted for the mount that is happening right now.
 */
let entrancesEnabled = false;

/** Called once the first screen is on the glass — see ssr/context.tsx. */
export function enableEntrances(): void {
  entrancesEnabled = true;
}
