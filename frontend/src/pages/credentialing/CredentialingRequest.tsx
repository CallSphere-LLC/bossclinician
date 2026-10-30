import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { credentialingRequest as copy, REQUEST_SERVICES } from "@/content/credentialForYou";
import { KajabiForm } from "@/pages/kajabi/pages/shared";

/**
 * /credentialing-request — the `credential-for-you-request` form (migration 181).
 * Each button on the sales page says which service it came from in `?service=`,
 * which only ever preselects one of the form's own choices.
 */
export default function CredentialingRequest() {
  const [params] = useSearchParams();
  const asked = params.get("service");
  const initialValues = useMemo(
    () => (REQUEST_SERVICES.some((service) => service === asked) && asked ? { service: asked } : undefined),
    [asked],
  );

  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} />
      <Section surface="deep" space="xl" aurora="mixed" auroraIntensity={0.85} aria-label={copy.title} containerClassName="max-w-3xl">
        <SectionTitle eyebrow={copy.eyebrow} title={copy.title} titleClassName="text-[2rem] sm:text-[2.6rem]" />
        <GlassCard accent="gold" interactive={false} className="mt-10 p-6 sm:p-9">
          <KajabiForm
            // A new `?service=` is a new starting point for the form.
            key={asked ?? ""}
            formSlug="credential-for-you-request"
            fields={copy.fields}
            submitLabel={copy.submit}
            successMessage={copy.success}
            initialValues={initialValues}
          />
        </GlassCard>
      </Section>
    </>
  );
}
