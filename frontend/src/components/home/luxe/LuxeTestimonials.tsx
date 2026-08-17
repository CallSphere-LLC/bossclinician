import type { Testimonial } from "@/types";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";

type CardAccent = "green" | "plum" | "gold";

/** Cycled by position so the trio reads as a set rather than a ranking. */
const ACCENT_CYCLE: readonly CardAccent[] = ["green", "plum", "gold"];

/**
 * Per-accent chrome the GlassCard recipe does not cover: the avatar ring, the
 * placeholder fill, and the `rgb` triplet feeding the quote-mark bloom (a
 * radial gradient Tailwind cannot express as a utility). Values match the
 * offer cards so the two sections share one accent vocabulary.
 */
const ACCENT: Record<CardAccent, { ring: string; fill: string; letter: string; rgb: string }> = {
  green: {
    ring: "ring-green-bright/40",
    fill: "bg-green-bright/[0.10]",
    letter: "text-green-bright",
    rgb: "107, 168, 145",
  },
  plum: {
    ring: "ring-plum-bright/45",
    fill: "bg-plum-bright/[0.14]",
    letter: "text-lilac",
    rgb: "167, 139, 196",
  },
  gold: {
    ring: "ring-gold/45",
    fill: "bg-gold/[0.10]",
    letter: "text-gold",
    rgb: "201, 164, 106",
  },
};

interface LuxeTestimonialsProps {
  testimonials: Testimonial[];
}

export function LuxeTestimonials({ testimonials }: LuxeTestimonialsProps) {
  const featured = testimonials.slice(0, 3);
  if (featured.length === 0) return null;

  return (
    <Section
      surface="base"
      space="lg"
      aurora="plum"
      auroraIntensity={0.5}
      aria-label="Testimonials"
    >
      <SectionTitle
        align="center"
        eyebrow="Real Clinicians. Real Results."
        title="Hear from the clinicians who chose to build differently."
      />

      {/*
        items-start, deliberately. One of the featured quotes runs roughly five
        times longer than the other two; stretching all three to a common height
        would leave the short cards with a canyon of dead space under the
        attribution. Ragged bottoms read as an editorial column set, which is
        the reference here anyway.
      */}
      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-start gap-6 sm:mt-10 sm:max-w-xl lg:mt-12 lg:max-w-none lg:grid-cols-3"
      >
        {featured.map((t, i) => {
          const tone = ACCENT[ACCENT_CYCLE[i % ACCENT_CYCLE.length]];
          const attribution = [t.name, t.credential].filter(Boolean).join(", ");

          return (
            <RevealItem key={t.id} as="li">
              {/* overflow-hidden clips the quote-mark bloom to the rounded
                  corner; the card's ambient shadow is unaffected. */}
              <GlassCard
                as="figure"
                accent={ACCENT_CYCLE[i % ACCENT_CYCLE.length]}
                className="overflow-hidden p-8"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-4 -top-8 h-32 w-32 rounded-full blur-2xl"
                  style={{
                    background: `radial-gradient(circle, rgba(${tone.rgb},0.16) 0%, transparent 70%)`,
                  }}
                />
                {/* Absolutely placed so the glyph acts as a printed drop-cap in
                    the card's top-left corner instead of pushing the quote down
                    by a full 4rem line box. */}
                <span
                  aria-hidden
                  className="text-foil pointer-events-none absolute left-8 top-5 select-none font-display text-[4rem] leading-none"
                >
                  &ldquo;
                </span>

                <blockquote className="relative pt-10 font-display text-[1.02rem] italic leading-[1.75] text-orchid">
                  <p className="text-pretty">&ldquo;{t.quote}&rdquo;</p>
                </blockquote>

                <div aria-hidden className="rule-faint mt-7 w-full" />

                <figcaption className="mt-6 flex items-center gap-4">
                  {t.photo ? (
                    <img
                      src={t.photo}
                      alt={attribution}
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className={cn(
                        "h-14 w-14 shrink-0 rounded-full object-cover ring-1",
                        tone.ring,
                      )}
                    />
                  ) : (
                    // No headshot on file: an accent-tinted monogram reads as a
                    // deliberate mark rather than a broken image slot.
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-1",
                        "font-display text-[1.35rem] leading-none",
                        tone.fill,
                        tone.ring,
                        tone.letter,
                      )}
                    >
                      {t.name.trim().charAt(0)}
                    </span>
                  )}

                  <div className="min-w-0">
                    <p className="text-pretty text-sm font-semibold text-white">{attribution}</p>
                    {t.practice && (
                      <p className="mt-1 text-pretty text-xs leading-snug text-orchid-faint">
                        {t.practice}
                      </p>
                    )}
                  </div>
                </figcaption>
              </GlassCard>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </Section>
  );
}
