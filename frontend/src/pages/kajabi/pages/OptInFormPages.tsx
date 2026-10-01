import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { resetAuditForm, resetPlannerForm } from "@/content/kajabiPages";
import { KajabiForm, OPT_IN_FIELDS, OptInConsent, rise } from "./shared";

/**
 * The two 2026 Kajabi opt-in pages: a heading, one line, and the form. Same
 * four questions on both (first name, last name, email, years in practice),
 * now posting to this site's forms (`reset-audit`, `reset-planner` — migration
 * 100) instead of Kajabi's.
 */
function OptInFormPage({
  seo,
  eyebrow,
  title,
  body,
  formSlug,
  submit,
  redirectTo,
  success,
}: {
  seo: { title: string; description: string };
  eyebrow: string;
  title: string;
  body: string;
  formSlug: string;
  submit: string;
  redirectTo?: string;
  success?: string;
}) {
  const reduce = useEntranceMotion();
  return (
    <>
      <Seo title={seo.title} description={seo.description} />
      <Section surface="deep" space="xl" aurora="mixed" auroraIntensity={0.85} aria-label={eyebrow} containerClassName="max-w-3xl">
        <SectionTitle eyebrow={eyebrow} title={title} body={body} />
        <motion.div {...rise(reduce, 0.12)} className="mx-auto mt-10 max-w-xl">
          <GlassCard accent="gold" interactive={false} className="p-6 sm:p-9">
            <KajabiForm
              formSlug={formSlug}
              fields={OPT_IN_FIELDS}
              submitLabel={submit}
              redirectTo={redirectTo}
              successMessage={success}
              consent={<OptInConsent />}
            />
          </GlassCard>
        </motion.div>
      </Section>
    </>
  );
}

/** /reset-audit-form → /practice-reset-audit-ty on success, as on Kajabi. */
export function ResetAuditForm() {
  return <OptInFormPage {...resetAuditForm} />;
}

/** /reset-planner-form — Kajabi set no thank-you page, so the form confirms in place. */
export function ResetPlannerForm() {
  return <OptInFormPage {...resetPlannerForm} success={resetPlannerForm.success} />;
}
