import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section } from "@/components/luxe/Section";
import { FREEBIE_FILES, LEAD_MAGNET_FORMS, insuranceGuide as c } from "@/content/leadMagnets";
import { FramedImage, LeadMagnetForm, Rise, SignupCard } from "./parts";

/**
 * /insurance-guide — the free Insurance vs Superbills guide.
 *
 * Her page is two identical sign-up blocks around the guide's cover; both are
 * kept. The Kajabi thank-you page this form pointed at has since been deleted,
 * so the confirmation appears in place with the guide beside it, and the
 * form's automation (migration 097) emails it.
 */
export default function InsuranceGuide() {
  const form = (
    <LeadMagnetForm
      slug={LEAD_MAGNET_FORMS.insurance}
      submitLabel={c.submit}
      note={c.consent}
      success={{ ...c.success, download: FREEBIE_FILES.insurance }}
    />
  );

  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} image={c.image.src} />

      <LuxePageHero
        eyebrow={c.eyebrow}
        title={c.title}
        lede={c.lede}
        tone="violet"
        aside={<SignupCard className="mx-auto w-full max-w-md">{form}</SignupCard>}
      />

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.55} aria-label={c.repeatTitle} containerClassName="max-w-5xl">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <Rise className="mx-auto w-full max-w-md">
            <FramedImage image={c.image} />
          </Rise>
          <Rise delay={0.1} className="min-w-0">
            <span className="eyebrow-luxe">{c.eyebrow}</span>
            <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">
              {c.repeatTitle}
            </h2>
            <GoldRule className="mt-6" />
            <p className="copy-luxe mt-6 text-pretty">{c.lede}</p>
            <SignupCard className="mt-8">
              <LeadMagnetForm
                slug={LEAD_MAGNET_FORMS.insurance}
                submitLabel={c.submit}
                note={c.consent}
                success={{ ...c.success, download: FREEBIE_FILES.insurance }}
              />
            </SignupCard>
          </Rise>
        </div>
      </Section>
    </>
  );
}
