import type { ReactNode } from "react";
import { Seo } from "@/components/Seo";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { Section } from "@/components/luxe/Section";
import { cn } from "@/lib/cn";

/**
 * /accessibility — the site's accessibility statement (QA sheet row 96).
 *
 * States only what the site actually does. Keep the "What we have done" list
 * true: each item is something in the code (Layout's skip link and landmarks,
 * the global :focus-visible outline in index.css, useEntranceMotion and the
 * reduced-motion rules, captions on the free trainings).
 */

const UPDATED = "October 17, 2026";
const EMAIL = "yvette@bossclinician.com";

const LINK = cn(
  "text-gold underline decoration-gold/40 underline-offset-4",
  "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
);

const DONE = [
  "A “Skip to main content” link as the first thing on every page, and clear page regions (header, navigation, main content, footer) for screen readers.",
  "Every page can be used with a keyboard, with a visible gold outline showing where you are.",
  "Text alternatives for meaningful images; decorative images are hidden from screen readers.",
  "Buttons that show only an icon (cart, menu, theme) have a spoken name.",
  "Text sized and coloured for contrast against the background, in both the dark and light themes.",
  "If your device is set to reduce motion, page animations and moving backgrounds stop, and decorative background videos show a still image instead.",
  "Our free training videos play in the site's own player, with English captions.",
  "Our sign-up forms label every field and announce errors when they appear.",
  "Pages reflow for small screens and browser zoom.",
];

const KNOWN = [
  "Some older PDF downloads and worksheets are not fully tagged for screen readers. Ask us and we will send an accessible version.",
  "Recordings published before October 2026 may not have captions yet.",
  "Content embedded from other companies (such as the Instagram feed) is controlled by those companies.",
];

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-12 text-balance font-display text-[1.5rem] font-medium leading-snug text-white first:mt-0 sm:text-[1.75rem]">
      {children}
    </h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="copy-luxe mt-4 text-pretty">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3.5">
          <span aria-hidden className="mt-[0.55rem] h-1.5 w-1.5 shrink-0 rotate-45 bg-gold" />
          <span className="copy-luxe min-w-0 text-pretty">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AccessibilityStatement() {
  return (
    <>
      <Seo
        title="Accessibility Statement | Boss Clinician"
        description="Boss Clinician's commitment to an accessible website: what we have done, what we are still working on, and how to ask for help."
      />

      <LuxePageHero eyebrow="Legal" title="Accessibility Statement" lede={`Last updated ${UPDATED}`} tone="gold" />

      <Section surface="base" space="md" aria-label="Accessibility Statement">
        <article className="mx-auto max-w-[70ch]">
          <Heading>Our commitment</Heading>
          <P>
            Boss Clinician wants every clinician to be able to use this website, including people who
            use a screen reader, a keyboard, voice control, magnification or captions. We aim to meet
            the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, and we test the site
            with these needs in mind as we build it.
          </P>

          <Heading>What we have done</Heading>
          <List items={DONE} />

          <Heading>What we are still working on</Heading>
          <List items={KNOWN} />

          <Heading>No overlays</Heading>
          <P>
            We do not use an accessibility “overlay” widget. We build accessibility into the pages
            themselves, so they work with the assistive technology you already use.
          </P>

          <Heading>Tell us about a barrier</Heading>
          <P>
            If something on this site is hard to use, or you need information in a different format,
            email{" "}
            <a href={`mailto:${EMAIL}`} className={LINK}>
              {EMAIL}
            </a>{" "}
            with the page address and what happened. We aim to reply within 2 business days and will
            work with you to provide the information or service another way while we fix it.
          </P>
        </article>
      </Section>
    </>
  );
}
