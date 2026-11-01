import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { credentialingNextSteps as copy, INTAKE_PATH } from "@/content/credentialForYou";

/**
 * /credentialing-next-steps — where every credentialing offer lands after
 * purchase (offers.redirect_url, migration 181). Noindex and out of the sitemap,
 * like the site's other pages after a purchase.
 */
export default function CredentialingNextSteps() {
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} noindex />
      <Section surface="deep" space="xl" aurora="mixed" auroraIntensity={0.85} aria-label="Next steps" containerClassName="max-w-3xl">
        <SectionTitle title={copy.title} titleClassName="text-[2rem] sm:text-[2.6rem]" className="max-w-none" />
        <GlassCard accent="gold" interactive={false} className="mt-10 p-6 text-center sm:p-10">
          <div className="copy-luxe space-y-4 text-pretty">
            {copy.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <p>
              {copy.watchFor}{" "}
              <a className="text-gold underline underline-offset-4" href={`mailto:${copy.watchForEmail}`}>{copy.watchForEmail}</a>
            </p>
            <p className="font-semibold text-white">Important: {copy.important}</p>
          </div>
          <LuxeButton variant="foil" size="lg" to={INTAKE_PATH} className="mt-8 w-full sm:w-auto">
            {copy.cta}
          </LuxeButton>
        </GlassCard>
      </Section>
    </>
  );
}
