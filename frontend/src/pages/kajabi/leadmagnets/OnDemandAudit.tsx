import { Seo } from "@/components/Seo";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { onDemandAudit as c } from "@/content/leadMagnetsDocumentation";
import { MeetYvetteSection, RecordingFooter } from "./RecordingPage";
import { RecordingPlayer, Rise } from "./parts";

/**
 * /on-demand-audit-your-private-practice — Audit Proof Your Practice on demand:
 * her three steps (note template, the recording, the post-exam), then Meet
 * Yvette and a client's words, as on her Kajabi page.
 */
export default function OnDemandAudit() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} noindex />

      <Section surface="base" space="lg" aurora="violet" auroraIntensity={0.7} aria-label="Watch the training" containerClassName="max-w-5xl" className="pt-28 sm:pt-32">
        <Rise className="text-center">
          <h1 className="text-balance font-display text-[1.7rem] font-medium leading-[1.2] text-white sm:text-[2.2rem]">{c.step1.title}</h1>
          <LuxeButton variant="foil" size="lg" href={c.step1.href} target="_blank" className="mt-7">
            {c.step1.cta}
          </LuxeButton>
        </Rise>

        <GoldRule className="mx-auto mt-14" />

        <Rise delay={0.06} className="mt-12 text-center">
          <h2 className="text-balance font-display text-[1.7rem] font-medium leading-[1.2] text-white sm:text-[2.2rem]">{c.step2.title}</h2>
        </Rise>
        <Rise delay={0.1} className="mt-8">
          <RecordingPlayer url={c.videoUrl} title={c.videoTitle} />
        </Rise>

        <Rise delay={0.12} className="mt-10 text-center">
          <LuxeButton variant="foil" size="lg" to={c.step3.to}>
            {c.step3.cta}
          </LuxeButton>
        </Rise>
      </Section>

      <MeetYvetteSection meet={c.meet} />
      <RecordingFooter testimonial={c.testimonial} copyright={c.copyright} />
    </>
  );
}
