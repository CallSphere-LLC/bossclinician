import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section } from "@/components/luxe/Section";
import { FREEBIE_FILES, LEAD_MAGNET_FORMS, marketingStepForm as c } from "@/content/leadMagnets";
import { LeadMagnetForm, SignupCard } from "./parts";

/**
 * /marketing-step-form — the sign-up for the 5-Step Marketing Plan, which the
 * /5-step-marketing page sends people to.
 *
 * Her Kajabi form's four boxes (first name, last name, email, years in
 * practice) and its button label. Her form had no thank-you page of its own,
 * so the confirmation appears in place with the PDF beside it; the form's
 * automation (migration 097) emails the same PDF.
 */
export default function MarketingStepForm() {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} />

      <LuxePageHero eyebrow={c.eyebrow} title={c.title} lede={c.body} tone="violet" align="center" />

      <Section surface="base" space="md" aria-label={c.eyebrow} containerClassName="max-w-xl">
        <SignupCard>
          <LeadMagnetForm
            slug={LEAD_MAGNET_FORMS.marketingPlan}
            submitLabel={c.submit}
            firstNameLabel={c.fields.firstName}
            lastNameLabel={c.fields.lastName}
            emailLabel={c.fields.email}
            practiceYears={c.fields.practiceYears}
            note={c.consent}
            success={{ ...c.success, download: FREEBIE_FILES.marketingPlan }}
          />
        </SignupCard>
      </Section>
    </>
  );
}
