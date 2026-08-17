import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { LeadForm } from "@/components/forms/LeadForm";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { applyPage } from "@/content/site";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * Break the headline at its natural turn so the second clause can be set in
 * foil italic on its own line. Splitting the source string rather than
 * retyping the halves keeps the headline byte-identical to the content file —
 * only the space at the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const [HERO_TITLE, HERO_ACCENT] = splitOnce(applyPage.heading, " and start building");

/**
 * Apply — the Obsidian Luxe rebuild.
 *
 * Two bands under the page hero and no more: the letter, then the form. This
 * page exists to be completed, so every band between the promise and the first
 * input is scroll the applicant has to pay for. The letter keeps its original
 * card framing (it reads as personal stationery, not as page copy), and the
 * form gets the raised surface and the page's single foil action.
 */
export default function Apply() {
  const reduce = useReducedMotion();

  return (
    <>
      <Seo
        title="Boss Clinician Consulting - Apply"
        description="Apply to work 1:1 with Yvette Howard, LCSW, and build the private practice that pays you well, fits your life, and lets you lead with purpose."
      />

      <LuxePageHero
        eyebrow="Work With Me"
        title={HERO_TITLE}
        titleAccent={HERO_ACCENT}
        lede={applyPage.intro}
        tone="violet"
      />

      {/* ── The letter ──────────────────────────────────────────────────────
          Aurora is kept low here: this band is a single column of long-form
          reading, and a drifting light field directly under body text is the
          one place the effect turns into a distraction. */}
      <Section
        surface="base"
        space="md"
        aurora="plum"
        auroraIntensity={0.4}
        aria-label="A note from Yvette"
      >
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.85, ease: EASE }}
          className="mx-auto max-w-4xl"
        >
          <GlassCard
            accent="plum"
            interactive={false}
            spotlight={false}
            className="overflow-hidden p-6 sm:p-10 lg:p-12"
          >
            {/* Letterhead edge: a foil hairline across the top of the sheet. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold-foil opacity-75"
            />

            <h2 className="text-balance font-display text-[1.5rem] font-medium leading-[1.2] tracking-[0.01em] text-white sm:text-[1.9rem]">
              {applyPage.greeting}
            </h2>

            <GoldRule className="mt-6" />

            {/* 62ch keeps the measure readable even when the card is at its
                full width on a 1920px display. */}
            <div className="mt-8 max-w-[62ch] space-y-5">
              {applyPage.body.map((paragraph) => (
                <p key={paragraph} className="copy-luxe text-pretty">
                  {paragraph}
                </p>
              ))}
            </div>

            <div aria-hidden className="rule-faint mt-8 w-full" />

            {/* The section's one foil accent — the sign-off. */}
            <p className="text-foil mt-6 text-pretty font-display text-[1.2rem] italic leading-[1.3] sm:text-[1.5rem]">
              {applyPage.cta}
            </p>
          </GlassCard>
        </motion.div>
      </Section>

      {/* ── The form ───────────────────────────────────────────────────────── */}
      <Section
        id="apply-form"
        surface="raised"
        space="lg"
        aurora="gold"
        auroraIntensity={0.6}
        aria-label="Application form"
      >
        <SectionTitle
          align="center"
          title="Fill out the form below"
          body="I review every application myself and you'll hear back from me within 24 hours."
        />

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={VIEWPORT}
          transition={{ duration: 0.8, delay: reduce ? 0 : 0.12, ease: EASE }}
          className="mx-auto mt-10 max-w-3xl"
        >
          <LeadForm source="apply" submitLabel="Done! Let's Do This!" />
        </motion.div>
      </Section>
    </>
  );
}
