import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { cn } from "@/lib/cn";
import type { Accent, ResourceCardData } from "@/content/resourceHub";
import { glassAccent, ribbonAccent, TONE } from "./accents";

interface ResourceCardProps {
  card: ResourceCardData;
  /** Section accent — used unless the card overrides it. */
  accent: Accent;
}

/**
 * One resource. Glass is the page's only card material, so a card differs from
 * its siblings by accent alone; the featured card adds a gold hairline outline
 * rather than a second material, and the ribbon keeps carrying the "free vs
 * paid" distinction the light theme drew with a darker fill.
 */
export function ResourceCard({ card, accent }: ResourceCardProps) {
  const cardAccent = glassAccent[accent];
  const ribbon = ribbonAccent(card.tagAccent, accent);
  const tone = TONE[ribbon];

  return (
    <GlassCard
      as="article"
      accent={cardAccent}
      className={cn(
        "flex h-full flex-col overflow-hidden",
        // `outline` rather than `ring`: Tailwind's ring utilities rewrite
        // box-shadow wholesale, which would strip the glass recipe's ambient
        // drop shadow and inner top highlight off the featured card only.
        card.featured && "outline outline-1 -outline-offset-1 outline-gold/35",
      )}
    >
      {/* Tag ribbon, bled to the card's clipped corners so it reads as a band
          printed on the panel rather than a chip sitting inside it. */}
      <div className={cn("relative px-6 py-3 sm:px-7", tone.ribbon)}>
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 left-0 h-28 w-2/3 blur-2xl"
          style={{
            background: `radial-gradient(ellipse at center, rgba(${tone.rgb},0.30) 0%, transparent 70%)`,
          }}
        />
        <p
          className={cn(
            "relative flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[0.7rem] font-bold uppercase leading-none tracking-[0.12em] sm:text-[0.64rem] sm:tracking-[0.18em]",
            tone.label,
          )}
        >
          <svg aria-hidden viewBox="0 0 8 8" fill="none" className="h-[7px] w-[7px] shrink-0">
            <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
          </svg>
          <span className="min-w-0">{card.tag}</span>
          {card.badge && (
            <span className="rounded-full border border-white/15 bg-white/[0.08] px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.08em] sm:text-[0.6rem] sm:tracking-[0.12em]">
              {card.badge}
            </span>
          )}
        </p>
      </div>
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(${tone.rgb},0.55), rgba(${tone.rgb},0.16) 55%, transparent)`,
        }}
      />

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <h3 className="text-balance font-display text-[1.25rem] font-medium leading-[1.25] text-white">
          {card.title}
        </h3>

        {/* flex-1 here — not on a wrapper — is what bottom-aligns every CTA
            across cards of unequal copy length. */}
        <p className="copy-luxe mt-3 flex-1 text-pretty text-sm">{card.description}</p>

        <LuxeButton
          variant="glass"
          size="sm"
          href={card.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 min-h-[44px] w-full tracking-[0.1em] sm:tracking-[0.14em]"
        >
          {card.ctaLabel}
        </LuxeButton>
      </div>
    </GlassCard>
  );
}
