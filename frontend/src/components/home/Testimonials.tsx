import { Container } from "@/components/ui/Container";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";
import type { Testimonial } from "@/types";

/**
 * Card accents cycle green → plum → gold. The same accent drives the 3px top
 * border and the initial-letter avatar placeholder, so a testimonial without a
 * headshot still reads as designed rather than broken.
 */
const accents = [
  { border: "border-t-green", placeholder: "bg-green" },
  { border: "border-t-plum", placeholder: "bg-plum" },
  { border: "border-t-gold", placeholder: "bg-gold" },
];

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

interface TestimonialsProps {
  testimonials: Testimonial[];
}

export function Testimonials({ testimonials }: TestimonialsProps) {
  const featured = testimonials.slice(0, 3);
  if (featured.length === 0) return null;

  return (
    <section className="bg-cream py-16 sm:py-24 lg:py-28" aria-label="Testimonials">
      <Container>
        <div className="mx-auto mb-14 max-w-md text-center">
          <span className="eyebrow">Real Clinicians. Real Results.</span>
          <h2 className="text-balance font-display text-3xl font-bold leading-[1.2] text-ink sm:text-4xl">
            Hear from Boss Clinicians who made the leap.
          </h2>
          <div className="mx-auto mt-8 h-[3px] w-14 bg-gold" aria-hidden />
        </div>

        <RevealGroup className="mx-auto grid max-w-lg gap-6 lg:max-w-none lg:grid-cols-3">
          {featured.map((t, i) => {
            const accent = accents[i % accents.length];
            return (
              <RevealItem key={t.id}>
                <figure
                  className={cn(
                    "flex h-full flex-col border-x border-b border-t-[3px] border-x-hairline border-b-hairline bg-white p-7",
                    accent.border,
                  )}
                >
                  {t.photo ? (
                    <img
                      src={t.photo}
                      alt={`${t.name}, ${t.credential}`}
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="mb-4 h-14 w-14 shrink-0 rounded-full border-2 border-hairline object-cover object-top"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        "mb-4 flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-display text-[1.2rem] font-bold text-white",
                        accent.placeholder,
                      )}
                    >
                      {initialOf(t.name)}
                    </span>
                  )}

                  <blockquote className="flex-1 font-display text-[1.05rem] italic leading-relaxed text-ink-soft">
                    "{t.quote}"
                  </blockquote>
                  <figcaption className="mt-6">
                    <p className="text-sm font-semibold text-ink">
                      {t.name}
                      {t.credential ? `, ${t.credential}` : ""}
                    </p>
                    {t.practice && <p className="mt-1 text-xs text-ink-soft">{t.practice}</p>}
                  </figcaption>
                </figure>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </Container>
    </section>
  );
}
