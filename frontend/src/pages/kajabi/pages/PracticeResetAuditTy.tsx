import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { practiceResetAuditTy as copy } from "@/content/kajabiPages";
import { LinkCards, NumberedSteps, PolicyLinks } from "./shared";

/** /practice-reset-audit-ty — where the Reset Audit opt-in lands. */
export default function PracticeResetAuditTy() {
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} noindex />

      <LuxePageHero
        eyebrow={copy.eyebrow}
        title={copy.title}
        tone="green"
        align="center"
        lede={copy.lede}
        actions={<p className="w-full text-sm text-orchid-dim">{copy.inboxNote}</p>}
      />

      <Section surface="raised" space="md" aria-label={copy.stepsEyebrow} containerClassName="max-w-3xl">
        <SectionTitle title={copy.stepsEyebrow} titleClassName="text-[1.7rem] sm:text-[2.2rem]" />
        <NumberedSteps steps={copy.steps} className="mt-10" />
      </Section>

      <Section surface="base" space="md" aria-label={copy.keepEyebrow} containerClassName="max-w-3xl">
        <SectionTitle title={copy.keepEyebrow} titleClassName="text-[1.7rem] sm:text-[2.2rem]" />
        <LinkCards items={copy.links} className="mt-10" />
        <PolicyLinks />
      </Section>
    </>
  );
}
