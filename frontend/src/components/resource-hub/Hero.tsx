import { LuxePageHero } from "@/components/luxe/LuxePageHero";

/**
 * Split a sentence at its natural turn so the second clause can be set in foil
 * italic on its own line. Splitting from the source string — rather than
 * retyping the halves — keeps the headline byte-identical to the copy it came
 * from: only the space at the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

// Her headline as of 15 Oct 2026; the accent line starts at "of private".
const [TITLE, TITLE_ACCENT] = splitOnce(
  "Resources for every stage of private practice ownership.",
  " of ",
);

/** Display the original portrait colors independently of the page theme. */
function HeroPortrait() {
  return (
    <div className="relative isolate mx-auto max-w-[17rem] sm:max-w-xs lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 45% 30%, rgba(123,94,167,0.45) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src="/images/resource-hub/yvette-hero-standing.webp"
          alt="Yvette Howard, LCSW, Private Practice Strategist, standing in a Minding My Female Owned Business t-shirt"
          width={960}
          height={1440}
          decoding="async"
          className="aspect-[4/5] w-full max-w-full object-cover object-top"
        />
      </div>

      {/* Offset registration marks — the frame reads as a mounted plate rather
          than an inline image. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-3 -right-3 h-12 w-12 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-16 sm:w-16"
      />
    </div>
  );
}

/** The Resource Hub's entry band: the site-wide interior page header. */
export function Hero() {
  return (
    <LuxePageHero
      // Non-breaking spaces flank the separator exactly as the source markup's
      // `&nbsp;·&nbsp;` did, so the bullet never starts or ends a wrapped line.
      eyebrow={"Resource Hub  ·  Lead. Heal. Elevate."}
      title={TITLE}
      titleAccent={TITLE_ACCENT}
      lede="Whether you're building the foundation, making an established practice more sustainable, or learning to lead beyond yourself, start with the stage you're in right now. Build it. Sustain it. Lead it."
      tone="violet"
      aside={<HeroPortrait />}
    />
  );
}
