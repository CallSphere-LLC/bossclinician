import type { Accent as GlassAccent } from "@/components/luxe/GlassCard";
import type { Accent } from "@/content/resourceHub";

/**
 * Obsidian Luxe accent vocabulary for the Resource Hub.
 *
 * The content model still speaks in the light theme's three section colours
 * (green / plum / ink). On a near-black page "ink" is not an accent — a
 * near-black fill on a near-black field is invisible — so the third tier
 * inherits the gold it already carries everywhere else on the site (the
 * Boardroom card on the home page). The token keeps its *role*, not its hue.
 */
export const glassAccent: Record<Accent, GlassAccent> = {
  green: "green",
  plum: "plum",
  ink: "gold",
};

/**
 * Card tag ribbons. Paid offers opt out of the section accent exactly as they
 * did before — "dark" was the light theme's way of saying "this one is not a
 * freebie"; on glass that reads as the neutral, uncoloured band.
 */
export function ribbonAccent(
  override: Accent | "dark" | undefined,
  fallback: Accent,
): GlassAccent {
  if (override === "dark") return "neutral";
  return glassAccent[override ?? fallback];
}

/**
 * Per-accent chrome the GlassCard recipe does not cover: the ribbon fill, the
 * label colour, and the RGB triplet feeding the two gradients (ribbon bloom,
 * ribbon hairline) that Tailwind cannot express as utilities.
 */
export const TONE: Record<GlassAccent, { label: string; ribbon: string; rgb: string }> = {
  green: { label: "text-green-bright", ribbon: "bg-green-bright/[0.09]", rgb: "107, 168, 145" },
  plum: { label: "text-lilac", ribbon: "bg-plum-bright/[0.14]", rgb: "167, 139, 196" },
  gold: { label: "text-gold", ribbon: "bg-gold/[0.10]", rgb: "201, 164, 106" },
  neutral: { label: "text-orchid", ribbon: "bg-white/[0.05]", rgb: "185, 162, 214" },
};

/**
 * Anchor pills in the "find your section" nav. Tinted rather than filled: three
 * solid blocks of colour on near-black read as buttons cut out of the page,
 * where a tinted glass pill reads as lit from behind it.
 */
export const PILL: Record<GlassAccent, string> = {
  green:
    "border-green-bright/30 bg-green-bright/[0.10] text-green-bright hover:border-green-bright/65 hover:bg-green-bright/[0.16]",
  plum: "border-plum-bright/40 bg-plum-bright/[0.14] text-lilac hover:border-plum-bright/75 hover:bg-plum-bright/[0.2]",
  gold: "border-gold/30 bg-gold/[0.10] text-gold hover:border-gold/65 hover:bg-gold/[0.16]",
  neutral: "border-white/12 bg-white/[0.045] text-orchid hover:border-white/30",
};
