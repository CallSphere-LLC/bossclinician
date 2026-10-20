import { useEffect, useState } from "react";

/**
 * `?product=<slug>` — "show me this one".
 *
 * A purchase notice links to the exact place a product lives: its card on the
 * library shelf, or its files on the Documents tab. Arriving there, the page
 * scrolls the item into the middle of the screen and rings it for a few seconds,
 * so nobody has to hunt through the shelf for the thing they just bought.
 */

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** The attribute each highlightable element carries. */
export const PRODUCT_SLUG_ATTRIBUTE = "data-product-slug";

/** How long the ring stays on. Long enough to find; short enough not to linger. */
export const HIGHLIGHT_MS = 6000;

/** The slug to highlight, or null for anything that is not a plausible slug. */
export function readHighlightSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SLUG.test(trimmed) ? trimmed : null;
}

/**
 * Scrolls to and highlights `[data-product-slug=<slug>]` once `ready` (the list
 * has rendered). Returns the slug that is currently highlighted, or null.
 */
export function useProductHighlight(slug: string | null, ready: boolean): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !ready || typeof document === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // After paint, so the element the list just rendered is in the document.
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[${PRODUCT_SLUG_ATTRIBUTE}="${slug}"]`,
      );
      if (!target) return;
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      setActive(slug);
      timer = setTimeout(() => setActive(null), HIGHLIGHT_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [slug, ready]);

  return active;
}

/** The ring a highlighted card or file group wears. */
export const HIGHLIGHT_CLASSES =
  "ring-2 ring-gold ring-offset-4 ring-offset-night-deep transition-shadow duration-500";
