import { motion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import {
  credentialKitConfirmed,
  genericThankYou,
  thankYouAuditProof,
  thankYouFullyBooked,
  thankYouRateRenegotiate,
  type SimpleThankYou,
} from "@/content/kajabiPages";
import { CtaButton, PhotoPlate, rise } from "./shared";

/**
 * The short Kajabi purchase confirmations: "Thank You!", two or three lines, a
 * sign-off and sometimes a download button. One centred card each — the Kajabi
 * originals were one centred block on a theme background.
 */
function SimpleThankYouPage({ copy }: { copy: SimpleThankYou }) {
  const reduce = useEntranceMotion();
  return (
    <>
      <Seo title={copy.seo.title} description={copy.seo.description} image={copy.seo.image} noindex />
      <Section surface="deep" space="xl" aurora="mixed" auroraIntensity={0.9} aria-label={copy.title} containerClassName="max-w-3xl">
        <motion.div {...rise(reduce)}>
          <GlassCard accent="gold" interactive={false} className="px-6 py-10 text-center sm:px-12 sm:py-14">
            <h1 className="font-display text-[2.6rem] font-normal leading-tight text-white sm:text-[3.4rem]">
              {copy.title}
            </h1>
            <GoldRule className="mx-auto mt-6" />
            {copy.paragraphs.length > 0 && (
              <div className="copy-luxe mx-auto mt-8 max-w-[52ch] space-y-4 text-pretty">
                {copy.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            )}
            {copy.signoff && (
              <p className="mt-8 font-display text-[1.5rem] italic text-foil">{copy.signoff}</p>
            )}
            {copy.cta && (
              <div className="mt-9">
                <CtaButton href={copy.cta.href}>{copy.cta.label}</CtaButton>
              </div>
            )}
          </GlassCard>
        </motion.div>
        {copy.image && (
          <motion.div {...rise(reduce, 0.12)} className="mt-12">
            <PhotoPlate src={copy.image.src} alt={copy.image.alt} className="max-w-2xl" />
          </motion.div>
        )}
      </Section>
    </>
  );
}

/** /credential-with-confidencekit-Confirmed */
export function CredentialKitConfirmed() {
  return <SimpleThankYouPage copy={credentialKitConfirmed} />;
}

/** /thank-you-audit-proof — registration for the live Audit Proof CEU training. */
export function ThankYouAuditProof() {
  return <SimpleThankYouPage copy={thankYouAuditProof} />;
}

/** /thank-you-fullybooked */
export function ThankYouFullyBooked() {
  return <SimpleThankYouPage copy={thankYouFullyBooked} />;
}

/** /thank-you-rate-renegotiate */
export function ThankYouRateRenegotiate() {
  return <SimpleThankYouPage copy={thankYouRateRenegotiate} />;
}

/** /thank-you — Kajabi's unedited template page. */
export function GenericThankYou() {
  return <SimpleThankYouPage copy={genericThankYou} />;
}
