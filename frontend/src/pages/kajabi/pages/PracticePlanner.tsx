import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { practicePlanner as copy } from "@/content/kajabiPages";
import { INLINE_LINK, KajabiForm, PhotoPlate, rise, type KajabiFieldSpec } from "./shared";

/** Kajabi form 2148625687 asked for first name and email only. */
const FIELDS: readonly KajabiFieldSpec[] = [
  { key: "name", label: "First Name", type: "text", required: true, autoComplete: "given-name" },
  { key: "email", label: "Email", type: "email", required: true },
];

/**
 * /practice-planner — the Profitable Practice Planner opt-in.
 *
 * Kajabi served two copies of this section, one per breakpoint; this is the
 * desktop one ("Profitable Practice Planner Guide", "GRAB MY PLANNER NOW!"),
 * which is the fuller of the two. The form goes to /practice-planner-thank-you,
 * as Kajabi's did.
 */
export default function PracticePlanner() {
  const reduce = useEntranceMotion();

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} />

      <Section surface="deep" space="xl" aurora="violet" auroraIntensity={0.85} aria-label={copy.title}>
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <motion.div {...rise(reduce)}>
            <span className="eyebrow-luxe">{copy.eyebrow}</span>
            <h1 className="text-balance font-display text-[2.4rem] font-normal leading-[1.08] text-white sm:text-[3.1rem]">
              {copy.title}
            </h1>
            <p className="copy-luxe mt-5 max-w-[52ch] text-pretty">{copy.body}</p>

            <GlassCard accent="gold" interactive={false} className="mt-8 max-w-xl p-6 sm:p-8">
              <KajabiForm
                formSlug={copy.formSlug}
                fields={FIELDS}
                submitLabel={copy.submit}
                redirectTo={copy.redirectTo}
                consent={copy.consent}
              />
            </GlassCard>

            <ul className="mt-6 flex gap-4 text-sm">
              {copy.socials.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>

          <div className="relative">
            <PhotoPlate src={copy.image} alt="A therapist working through her practice budget with a calculator" ratio="aspect-square" className="max-w-lg" />
            <div className="absolute -bottom-8 -left-2 w-32 sm:-left-8 sm:w-40">
              <PhotoPlate src={copy.portrait} alt="Yvette Howard, LCSW" ratio="aspect-square" />
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
