import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Seo } from "@/components/Seo";
import { SubscribeForm } from "@/components/forms/SubscribeForm";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { resources as fallbackResources } from "@/content/resources";
import { useCollection } from "@/hooks/useCollection";
import { ssrKeys } from "@/ssr/keys";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Resource } from "@/types";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * Split a sentence at its natural turn so the second clause can be set in foil
 * italic on its own line. Splitting from the source string — rather than
 * retyping the halves — keeps the headline byte-identical to the copy it came
 * from: only the space at the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const [HERO_TITLE, HERO_ACCENT] = splitOnce(
  "Find where you are and start there.",
  " and ",
);

/**
 * Accent encodes the *kind* of resource, so colour carries information rather
 * than decorating at random: guides read plum, checklists green, tools and the
 * masterclass gold. Anything the CMS invents later falls back to neutral instead
 * of crashing the palette.
 */
const KIND_ACCENT: Record<string, Accent> = {
  masterclass: "gold",
  guide: "plum",
  checklist: "green",
  tool: "gold",
};

function accentFor(kind: string): Accent {
  return KIND_ACCENT[kind.trim().toLowerCase()] ?? "neutral";
}

/** RGB triplets for the one gradient Tailwind cannot express as a utility. */
const ACCENT_RGB: Record<Accent, string> = {
  gold: "201, 164, 106",
  plum: "167, 139, 196",
  green: "107, 168, 145",
  neutral: "185, 162, 214",
};

/** One rise recipe for the page; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.85, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

export default function Resources() {
  const { data: resources, loading } = useCollection(api.resources, fallbackResources, ssrKeys.resources());
  const published = resources.filter((r) => r.published).sort((a, b) => a.sort - b.sort);
  const [masterclass, ...rest] = published;

  return (
    <>
      <Seo
        title="Free Resources for Therapists and Clinicians | Boss Clinician"
        description="Free guides, planners, masterclasses, and tools for therapists and clinicians building profitable private practices. Find the resource that matches your season — and take the next step."
      />

      <LuxePageHero
        eyebrow="Freebies & Resources"
        title={HERO_TITLE}
        titleAccent={HERO_ACCENT}
        lede="Every resource below was created for one reason — to help therapists and clinicians stop surviving their practice and start running it like a Boss."
        tone="violet"
      />

      {/* ── The lead magnet ────────────────────────────────────────────────
          `base` (bg-night) is required here rather than chosen: the page hero
          fades its bottom edge into night, so any other elevation would show a
          visible step under the handoff. */}
      {masterclass && (
        <Section
          surface="base"
          space="md"
          aurora="plum"
          auroraIntensity={0.8}
          aria-label="Free masterclass"
        >
          <MasterclassFeature resource={masterclass} />
        </Section>
      )}

      {/* ── Everything else ─────────────────────────────────────────────── */}
      <Section surface="raised" space="md" aurora="violet" auroraIntensity={0.35}>
        {loading && rest.length === 0 ? (
          <p className="copy-luxe text-center" role="status">
            Loading resources…
          </p>
        ) : (
          <RevealGroup
            as="ul"
            className="grid list-none grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-7 lg:grid-cols-3"
          >
            {rest.map((resource) => (
              <RevealItem as="li" key={resource.id} className="h-full">
                <ResourceCard resource={resource} />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
      </Section>

      {/* ── Newsletter capture ──────────────────────────────────────────── */}
      <Section
        surface="deep"
        space="lg"
        aurora="gold"
        auroraIntensity={0.9}
        aria-label="Calculate your income potential"
      >
        <SubscribePanel />
      </Section>
    </>
  );
}

/* ── Lead magnet ──────────────────────────────────────────────────────── */

function MasterclassFeature({ resource }: { resource: Resource }) {
  const reduce = useEntranceMotion();

  return (
    <motion.div {...rise(reduce, 0)}>
      <GlassCard
        accent="gold"
        interactive={false}
        className="overflow-hidden p-6 sm:p-8 lg:p-10"
      >
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
          <div className="min-w-0">
            <LuxePill accent="gold">Free Masterclass</LuxePill>

            <h2 className="mt-5 text-balance font-display text-[1.65rem] font-medium leading-[1.15] text-white sm:text-[2.05rem] lg:text-[2.35rem]">
              {resource.title}
            </h2>

            <GoldRule className="mt-6" />

            <p className="copy-luxe mt-6 max-w-[52ch] text-pretty">{resource.description}</p>

            <LuxeButton
              variant="foil"
              size="lg"
              to={resource.ctaUrl}
              className="mt-8 min-h-[44px]"
            >
              {resource.ctaLabel}
            </LuxeButton>
          </div>

          {/* alt="" as in the source: the plate is a visual echo of the
              headline sitting inches away, so naming it twice only adds noise
              for a screen reader. */}
          <Plate
            src={resource.image}
            alt=""
            ratio="aspect-video"
            className="rounded-xl border border-gold/25 shadow-[0_34px_80px_-34px_rgba(0,0,0,0.95)]"
          />
        </div>
      </GlassCard>
    </motion.div>
  );
}

/* ── Resource card ────────────────────────────────────────────────────── */

function ResourceCard({ resource }: { resource: Resource }) {
  const accent = accentFor(resource.kind);

  return (
    <GlassCard
      as="article"
      accent={accent}
      className="group/card flex h-full flex-col overflow-hidden"
    >
      {/* Full-bleed to the card's clipped corners, so the card's own glass edge
          is the frame and the photograph never reads as a tile dropped on top
          of a panel. */}
      <Plate
        src={resource.image}
        alt={resource.title}
        ratio="aspect-[16/10]"
        imgClassName="transition-transform duration-700 ease-luxe group-hover/card:scale-[1.05]"
      />

      <div
        aria-hidden
        className="h-px w-full"
        style={{
          backgroundImage: `linear-gradient(90deg, rgba(${ACCENT_RGB[accent]},0.55), rgba(${ACCENT_RGB[accent]},0.16) 55%, transparent)`,
        }}
      />

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <LuxePill accent={accent} className="self-start">
          {resource.kind}
        </LuxePill>

        <h3 className="mt-4 text-balance font-display text-[1.3rem] font-medium leading-tight text-white">
          {resource.title}
        </h3>

        {/* flex-1 here — not on a wrapper — is what bottom-aligns every CTA
            across cards of unequal copy length. */}
        <p className="copy-luxe mt-3 flex-1 text-pretty text-sm">{resource.description}</p>

        <LuxeButton
          variant="glass"
          size="sm"
          to={resource.ctaUrl}
          className="mt-6 min-h-[44px] w-full"
        >
          {resource.ctaLabel}
        </LuxeButton>
      </div>
    </GlassCard>
  );
}

/* ── Newsletter capture ───────────────────────────────────────────────── */

function SubscribePanel() {
  const reduce = useEntranceMotion();

  return (
    <>
      <SectionTitle
        align="center"
        title="Calculate your income potential"
        titleClassName="text-[1.75rem] sm:text-[2.1rem] lg:text-[2.5rem]"
        body="What would your practice look like if you actually charged what you're worth? Join the newsletter for the calculator, worksheets, and new resources as they drop."
      />

      <motion.div {...rise(reduce, 0.15)} className="mx-auto mt-8 max-w-xl">
        <GlassCard
          accent="gold"
          interactive={false}
          className="flex justify-center p-6 sm:p-8"
        >
          <SubscribeForm source="resources" dark />
        </GlassCard>
      </motion.div>
    </>
  );
}

/* ── Image plate ──────────────────────────────────────────────────────── */

interface PlateProps {
  src: string;
  alt: string;
  /** Aspect utility applied to the image itself. */
  ratio: string;
  className?: string;
  imgClassName?: string;
}

/**
 * These are bright product shots — ebook covers on near-white backdrops. At
 * full brightness on near-black they read as lit rectangles pasted onto the
 * page, so every one is graded down, vignetted at the corners, and passed under
 * a violet soft-light so its whites carry the page's plum instead of fighting
 * it. The bottom scrim hands the image off to the copy below it.
 */
function Plate({ src, alt, ratio, className, imgClassName }: PlateProps) {
  return (
    <div className={cn("relative overflow-hidden bg-night-deep", className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          "w-full max-w-full object-cover brightness-[0.8] contrast-[1.06] saturate-[0.8]",
          ratio,
          imgClassName,
        )}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(115%_80%_at_50%_26%,transparent_26%,rgba(10,7,19,0.5)_66%,rgba(6,4,11,0.9)_100%)]"
      />
      <div aria-hidden className="absolute inset-0 bg-glow-violet/15 mix-blend-soft-light" />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-night/90"
      />
    </div>
  );
}
