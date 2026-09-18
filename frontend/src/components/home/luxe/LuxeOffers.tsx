import { motion } from "motion/react";
import { Link } from "react-router";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { cn } from "@/lib/cn";

type OfferAccent = "green" | "plum" | "gold";

interface Offer {
  ribbon: string;
  name: string;
  desc: string;
  audience: string;
  cta: string;
  /** Internal route of the offer's own sales page. */
  to: string;
  accent: OfferAccent;
}

/**
 * Internal on purpose: an absolute bossclinician.com link is a link to this app
 * after cutover, and the redirect map already sends /offer-quiz here.
 */
const QUIZ_HREF = "/practice-quiz";

/**
 * The Club and the Lounge have their own sales pages (/club, /lounge), as they
 * do on the source site. The Boardroom has none yet — /boardroom redirects to
 * /work-with-me — so its card goes there directly.
 */
const OFFERS: readonly Offer[] = [
  {
    ribbon: "6-MONTH COACHING PROGRAM",
    name: "Boss Clinician Club",
    desc: "A 6-month coaching program for clinicians building from the ground up. Get the structure, tools, and guided strategy to do it right, without guessing at every step. This is your foundation, your roadmap, and your support system for the first six months.",
    audience: "For: The Depleted Clinician, just starting or rebuilding",
    cta: "Learn About the Club",
    to: "/club",
    accent: "green",
  },
  {
    ribbon: "MEMBERSHIP",
    name: "Boss Clinician Lounge",
    desc: "For the fully booked clinician who has hit the income ceiling, is exhausted from splitting rates with platforms, and needs a real strategy, not more content, to scale sustainably without working more hours.",
    audience: "For: The Maxed Out Clinician, established but capped",
    cta: "Join the Lounge",
    to: "/lounge",
    accent: "plum",
  },
  {
    ribbon: "MASTERMIND",
    name: "Boss Clinician Boardroom",
    desc: "An exclusive mastermind for group practice owners and scaling clinicians ready for peer-level strategy, CEO leadership development, and a room full of people building at the same level, with Yvette guiding the room.",
    audience: "For: The Stretched Thin Clinician, leading a team or scaling",
    cta: "Apply for the Boardroom",
    to: "/work-with-me",
    accent: "gold",
  },
];

/**
 * Accent is the ONLY thing that differs between the three cards — geometry,
 * type scale and depth stay identical so the tiers read as siblings rather
 * than as a good/better/best upsell ladder. `rgb` feeds the two gradients
 * (ribbon bloom, ribbon hairline) that Tailwind cannot express as utilities.
 */
const ACCENT: Record<OfferAccent, { ribbon: string; label: string; rgb: string }> = {
  green: { ribbon: "bg-green-bright/[0.09]", label: "text-green-bright", rgb: "107, 168, 145" },
  plum: { ribbon: "bg-plum-bright/[0.14]", label: "text-lilac", rgb: "167, 139, 196" },
  gold: { ribbon: "bg-gold/[0.10]", label: "text-gold", rgb: "201, 164, 106" },
};

export function LuxeOffers() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="lg"
      aurora="mixed"
      auroraIntensity={0.7}
      aria-label="Coaching programs and mastermind"
    >
      <SectionTitle
        align="center"
        eyebrow="Find Your Place in the Community"
        title="Wherever you are in your practice, there's a seat at this table."
      />

      {/* Three parallel offers = a list. Capped below lg because the stacked
          single column otherwise runs a ~100-character measure on tablet. */}
      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-7 sm:mt-10 sm:max-w-xl lg:mt-12 lg:max-w-none lg:grid-cols-3"
      >
        {OFFERS.map((offer) => {
          const tone = ACCENT[offer.accent];

          return (
            <RevealItem key={offer.name} as="li" className="h-full">
              <GlassCard
                accent={offer.accent}
                className="flex h-full flex-col overflow-hidden"
              >
                {/* Tier ribbon. Full-bleed to the card's clipped corners so it
                    reads as a band printed on the panel, not a chip inside it. */}
                <div className={cn("relative px-7 py-3.5 sm:px-8", tone.ribbon)}>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-16 left-0 h-28 w-2/3 blur-2xl"
                    style={{
                      background: `radial-gradient(ellipse at center, rgba(${tone.rgb},0.30) 0%, transparent 70%)`,
                    }}
                  />
                  <p
                    className={cn(
                      "relative flex items-center gap-2.5 text-[0.62rem] font-bold uppercase leading-none tracking-[0.2em]",
                      tone.label,
                    )}
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 8 8"
                      fill="none"
                      className="h-[7px] w-[7px] shrink-0"
                    >
                      <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
                    </svg>
                    <span className="min-w-0">{offer.ribbon}</span>
                  </p>
                </div>
                <div
                  aria-hidden
                  className="h-px w-full"
                  style={{
                    backgroundImage: `linear-gradient(90deg, rgba(${tone.rgb},0.55), rgba(${tone.rgb},0.16) 55%, transparent)`,
                  }}
                />

                <div className="flex flex-1 flex-col p-7 sm:p-8">
                  <h3 className="text-balance font-display text-[1.6rem] font-medium leading-tight text-white">
                    {offer.name}
                  </h3>

                  {/* flex-1 here — not on a wrapper — is what bottom-aligns all
                      three CTAs across cards of unequal copy length. */}
                  <p className="copy-luxe mt-5 flex-1 text-pretty text-sm">{offer.desc}</p>

                  <div aria-hidden className="rule-faint mt-8 w-full" />

                  <p className={cn("mt-5 text-pretty text-xs font-semibold", tone.label)}>
                    {offer.audience}
                  </p>

                  <LuxeButton
                    variant="glass"
                    size="sm"
                    to={offer.to}
                    className="mt-6 min-h-[44px] w-full"
                  >
                    {offer.cta}
                  </LuxeButton>
                </div>
              </GlassCard>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
        transition={{ duration: 0.7, delay: reduce ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto mt-10 max-w-md sm:max-w-xl lg:max-w-none"
      >
        <GlassCard
          accent="plum"
          interactive={false}
          spotlight={false}
          className="flex items-start gap-4 overflow-hidden px-7 py-5 sm:items-center sm:gap-5"
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-gold-bright via-gold to-gold/20"
          />
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/[0.07] text-gold"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
              <path d="M12 6.6 14.6 12 12 17.4 9.4 12Z" fill="currentColor" />
            </svg>
          </span>

          <p className="copy-luxe min-w-0 text-pretty text-sm">
            <span className="font-semibold text-white">Not sure which is right for you?</span>{" "}
            Take the 2-minute quiz:{" "}
            <Link
              to={QUIZ_HREF}
              className="font-normal text-gold underline decoration-gold/35 underline-offset-4 transition-colors duration-300 ease-luxe hover:text-gold-bright hover:decoration-gold-bright/70"
            >
              Which Boss Clinician Offer Is Right for You?
            </Link>
          </p>
        </GlassCard>
      </motion.div>
    </Section>
  );
}
