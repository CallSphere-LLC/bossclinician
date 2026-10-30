import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { credentialingIntake as copy, START_DATE_LINES } from "@/content/credentialForYou";
import { KajabiForm } from "@/pages/kajabi/pages/shared";

/**
 * /credentialing-intake — the `credential-for-you-intake` form (migration 181),
 * reached from the page after purchase. Noindex. Its confirmation carries her
 * start-date language. It deliberately has no field for banking details, a
 * Social Security number or a date of birth.
 */
export default function CredentialingIntake() {
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} noindex />
      <Section surface="deep" space="xl" aurora="mixed" auroraIntensity={0.85} aria-label={copy.title} containerClassName="max-w-3xl">
        <SectionTitle eyebrow={copy.eyebrow} title={copy.title} body={copy.notice} titleClassName="text-[2rem] sm:text-[2.6rem]" />
        <GlassCard accent="gold" interactive={false} className="mt-10 p-6 sm:p-9">
          <KajabiForm
            formSlug="credential-for-you-intake"
            fields={copy.fields}
            submitLabel={copy.submit}
            successMessage={
              <>
                <p>{copy.success}</p>
                {START_DATE_LINES.map((line) => (
                  <p key={line} className="mt-3 font-semibold text-white">
                    {line}
                  </p>
                ))}
              </>
            }
          />
        </GlassCard>
      </Section>
    </>
  );
}
