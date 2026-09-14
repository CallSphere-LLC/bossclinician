import { useEffect } from "react";
import { useLocation } from "react-router";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Scrolls an in-page section into view and keeps the URL shareable.
 *
 * Falls back to an instant jump when the visitor has asked for reduced motion.
 * Offset from the sticky header comes from `scroll-mt-*` on the target element,
 * which `scrollIntoView` honours natively.
 */
export function scrollToSection(id: string, updateHash = true): void {
  const target = document.getElementById(id);
  if (!target) return;

  target.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });

  if (updateHash) {
    // replaceState (rather than router navigation) keeps the URL shareable
    // without re-rendering the tree or re-triggering useHashScroll. The current
    // history state is preserved so react-router's own bookkeeping stays intact.
    window.history.replaceState(window.history.state, "", `#${id}`);
  }
}

/**
 * React Router does not scroll to hash fragments on navigation (its
 * `<ScrollRestoration>` needs a data router, and this app mounts a plain one), and
 * `Layout` resets scroll to the top on every pathname change. Child effects run
 * before parent effects, so we defer past that reset with a double rAF before
 * honouring an incoming `location.hash`.
 */
export function useHashScroll(): void {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;

    const id = decodeURIComponent(hash.slice(1));
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => scrollToSection(id, false));
    });

    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [hash]);
}
