import type { ReactNode } from "react";
import { Seo } from "@/components/Seo";
import { Cta } from "@/components/home/luxe/ProgramSections";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { FramedImage, InboxAndDownload, Rise, type ImageSpec } from "./parts";

export interface GuideThankYouContent {
  readonly seo: { readonly title: string; readonly description: string };
  readonly shout: string;
  readonly title: string;
  readonly body: string;
  readonly inbox: string;
  readonly junk: string;
  readonly upsell: {
    readonly title: string;
    readonly subtitle: string;
    readonly body: string;
    readonly cta: string;
    readonly to: string;
  };
  readonly photo: ImageSpec;
}

/**
 * Her two free-guide thank-you pages (/business-plan-ty and
 * /step-by-step-guide-thank-you-page): the celebration, "check your inbox",
 * and the paid next step. The guide is linked here as well as emailed.
 * Noindex — a thank-you page is not a search result.
 */
export function GuideThankYou({
  content: c,
  download,
  children,
}: {
  content: GuideThankYouContent;
  download: string;
  /** Anything after the offer — the business-plan page adds its training sign-up. */
  children?: ReactNode;
}) {
  return (
    <>
      <Seo title={c.seo.title} description={c.seo.description} noindex />

      <LuxePageHero
        eyebrow={c.shout}
        title={c.title}
        lede={c.body}
        tone="mixed"
        aside={<FramedImage image={c.photo} priority className="mx-auto max-w-md" />}
      />

      <Section surface="base" space="md" aria-label={c.inbox} containerClassName="max-w-2xl">
        <Rise>
          <InboxAndDownload inbox={c.inbox} junk={c.junk} download={download} />
        </Rise>
      </Section>

      <Section surface="raised" space="lg" aurora="gold" auroraIntensity={0.55} aria-label={c.upsell.subtitle} containerClassName="max-w-3xl">
        <SectionTitle align="center" title={c.upsell.title} titleClassName="text-[1.6rem] sm:text-[2rem] lg:text-[2.3rem]" />
        <Rise delay={0.08} className="text-center">
          <h3 className="mt-8 text-balance font-display text-[1.3rem] italic leading-snug text-gold sm:text-[1.5rem]">
            {c.upsell.subtitle}
          </h3>
          <p className="copy-luxe mx-auto mt-5 max-w-[56ch] text-pretty">{c.upsell.body}</p>
        </Rise>
        <Cta label={c.upsell.cta} to={c.upsell.to} className="mt-10" />
      </Section>

      {children}
    </>
  );
}
