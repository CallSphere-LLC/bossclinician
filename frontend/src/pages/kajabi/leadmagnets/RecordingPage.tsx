import type { ReactNode } from "react";
import { Prose, QuoteCard } from "@/components/home/luxe/ProgramSections";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { EARNINGS_DISCLAIMER } from "@/content/leadMagnetsDocumentation";
import { FramedImage, Rise, type ImageSpec } from "./parts";

/**
 * The tail her two recording pages share (/replay-documentation and
 * /on-demand-audit-your-private-practice): "Meet Yvette Howard", an optional
 * testimonial, and the earnings disclaimer.
 */
export function MeetYvetteSection({
  meet,
}: {
  meet: {
    readonly title: string;
    readonly paragraphs: readonly string[];
    readonly cta: string;
    readonly to: string;
    readonly photo: ImageSpec;
  };
}) {
  return (
    <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={meet.title} containerClassName="max-w-6xl">
      <div className="grid items-start gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
        <Rise className="min-w-0">
          <h2 className="text-balance font-display text-[1.9rem] font-medium leading-[1.15] text-white sm:text-[2.4rem]">{meet.title}</h2>
          <GoldRule className="mt-7" />
          <Prose paragraphs={meet.paragraphs} className="mt-7" />
          <LuxeButton variant="foil" size="md" to={meet.to} className="mt-9">
            {meet.cta}
          </LuxeButton>
        </Rise>
        <Rise delay={0.1} className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
          <FramedImage image={meet.photo} imgClassName="aspect-[4/5] object-top" />
        </Rise>
      </div>
    </Section>
  );
}

export function RecordingFooter({
  testimonial,
  copyright,
  children,
}: {
  testimonial?: { readonly quote: string; readonly name: string };
  copyright: string;
  children?: ReactNode;
}) {
  return (
    <Section surface="deep" space="lg" aria-label="Disclaimer" containerClassName="max-w-4xl">
      {testimonial && (
        <Rise className="mx-auto mb-14 max-w-2xl">
          <QuoteCard quote={testimonial.quote} name={testimonial.name} accent="gold" />
        </Rise>
      )}
      {children}
      <p className="text-center text-xs text-orchid-faint">{copyright}</p>
      <p className="mx-auto mt-5 max-w-3xl text-pretty text-center text-[0.68rem] leading-relaxed tracking-[0.04em] text-orchid-faint">
        {EARNINGS_DISCLAIMER}
      </p>
    </Section>
  );
}
