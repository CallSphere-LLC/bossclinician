import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Seo } from "@/components/Seo";
import { BuyButton } from "@/components/BuyButton";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { useCollection } from "@/hooks/useCollection";
import { ssrKeys } from "@/ssr/keys";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  courses as fallbackCourses,
  courseMeta,
  defaultCourseMeta,
} from "@/content/courses";
import { isPurchasable, type Course } from "@/types";

/**
 * Courses — the Obsidian Luxe rebuild of the training library.
 *
 * Four bands, in the order the live page runs them: the promise, the manifesto
 * strip, the mission panel, then the catalogue. Nothing decorative is inserted
 * between the library heading and the grid — a fourteen-item catalogue should
 * put the first purchase decision as close to the fold as the copy allows.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Anchor target for the hero's "Explore the Library" action. */
const LIBRARY_ID = "training-library";

const HERO_HEADLINE = "Ready to Start, Grow, & Scale Your Private Practice With Confidence?";

const HERO_LEDE =
  "It's time to ditch the overwhelm and build the profitable, peaceful, fully aligned practice you’ve been dreaming of.";

const MANIFESTO =
  "IT'S TIME TO DITCH THE OVERWHELM AND BUILD THE PROFITABLE, PEACEFUL, FULLY ALIGNED PRACTICE YOU’VE BEEN DREAMING OF.";

const MISSION =
  "Helping therapists build profitable practices, embrace confidence, and create a lifestyle filled with freedom, fulfillment, and financial peace.";

const LIBRARY_BODY =
  "Created to help therapists step into their CEO identity, attract aligned clients, and run a practice that feels good and grows consistently.";

/**
 * Break the headline at its natural turn so the second clause can be set in
 * foil italic on its own line. Splitting from the source string rather than
 * retyping the halves keeps the headline byte-identical to the live page — only
 * the space at the seam becomes a line break.
 */
function splitOnce(text: string, marker: string): [string, string | undefined] {
  const at = text.indexOf(marker);
  if (at < 0) return [text, undefined];
  return [text.slice(0, at), text.slice(at + 1)];
}

const [HERO_TITLE, HERO_ACCENT] = splitOnce(HERO_HEADLINE, " Your Private Practice");

/**
 * The cover photo has to stop being a rectangle pasted onto the panel. Two
 * passes do that: a violet multiply that pulls bright stock whites into the
 * page's palette, then this scrim, whose bottom stop matches the composited
 * glass surface so the image dissolves into the card instead of ending at it.
 */
const COVER_SCRIM =
  "linear-gradient(to top, rgba(9,6,17,0.96) 0%, rgba(9,6,17,0.72) 18%, rgba(9,6,17,0.26) 46%, rgba(9,6,17,0) 76%)";

/** Shared grading recipe for the two editorial photographs on this page. */
const PLATE_GRADE = "brightness-[0.82] contrast-[1.06] saturate-[0.8]";

/**
 * Accent cycles across the grid so a fourteen-card catalogue does not read as
 * one undifferentiated wall of glass. Only the tint, hairline and hover glow
 * change — type colour, geometry and depth stay identical, so the cards read as
 * siblings in a library rather than as tiers in a price ladder.
 */
const CARD_ACCENTS: readonly Accent[] = ["green", "plum", "gold"];

/** One grid definition, shared by the real cards and the loading skeleton. */
const GRID =
  "mx-auto grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-none sm:grid-cols-2 sm:gap-7 lg:grid-cols-3";

/**
 * Card actions carry the live site's full sentence-length labels, so the button
 * has to be a wrapping block rather than a chip: full width, tightened tracking
 * and a comfortable line height, with the 44px floor kept.
 */
const CTA_CLASS = "min-h-[44px] w-full px-5 py-3.5 text-center leading-[1.45] tracking-[0.1em]";

export default function Courses() {
  const { data: courses, loading } = useCollection(api.courses, fallbackCourses, ssrKeys.courses());
  const published = courses.filter((c) => c.published).sort((a, b) => a.sort - b.sort);

  return (
    <>
      <Seo
        title="COURSES - Boss Clinician"
        description="Self-paced training for therapists and clinicians building private practices — credentialing, documentation, marketing, rates and systems."
      />

      <LuxePageHero
        eyebrow="Courses"
        title={HERO_TITLE}
        titleAccent={HERO_ACCENT}
        lede={HERO_LEDE}
        tone="violet"
        actions={
          <LuxeButton variant="foil" size="lg" href={`#${LIBRARY_ID}`}>
            Explore the Library
          </LuxeButton>
        }
        aside={<LibraryPlate />}
      />

      <MissionBand />

      <Section
        id={LIBRARY_ID}
        surface="base"
        space="md"
        aurora="mixed"
        auroraIntensity={0.45}
        aria-label="Course library"
        className="scroll-mt-24"
      >
        <SectionTitle
          title={
            <>
              Explore the{" "}
              <span className="text-foil font-display italic">
                Boss Clinician Training Library →
              </span>
            </>
          }
          body={LIBRARY_BODY}
        />

        <div className="mt-10">
          {loading && published.length === 0 ? (
            <CatalogueSkeleton />
          ) : published.length === 0 ? (
            <EmptyLibrary />
          ) : (
            <RevealGroup as="ul" className={GRID}>
              {published.map((course, i) => (
                <RevealItem key={course.id} as="li" className="h-full">
                  <CourseCard course={course} accent={CARD_ACCENTS[i % CARD_ACCENTS.length]} />
                </RevealItem>
              ))}
            </RevealGroup>
          )}
        </div>
      </Section>
    </>
  );
}

/* ── Manifesto + mission ──────────────────────────────────────────────────── */

/**
 * The live page runs its all-caps manifesto strip straight into the mission
 * panel, so they share one band here: two bands for two short statements would
 * have cost a full screen of scroll on a phone for no extra meaning.
 */
function MissionBand() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="raised"
      space="md"
      aurora="plum"
      auroraIntensity={0.35}
      aria-label="Boss Clinician mission"
    >
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
        transition={{ duration: 0.7, ease: EASE }}
        className={cn(
          "mx-auto max-w-4xl text-balance text-center font-display font-semibold uppercase",
          "text-[0.88rem] leading-[1.75] tracking-[0.12em] text-orchid",
          "sm:text-[1.02rem] sm:leading-[1.8] sm:tracking-[0.18em]",
        )}
      >
        {MANIFESTO}
      </motion.p>

      <GoldRule className="mx-auto mt-8" />

      <GlassCard
        accent="plum"
        interactive={false}
        spotlight={false}
        className={cn(
          "mt-10 grid items-center gap-8 px-6 py-8",
          "sm:px-9 sm:py-10 lg:grid-cols-[0.4fr_0.6fr] lg:px-12",
        )}
      >
        <MissionPortrait />

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
          transition={{ duration: 0.75, ease: EASE }}
          className="text-center lg:text-left"
        >
          <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.12] text-white sm:text-[2.4rem]">
            Boss Clinician
            <span className="text-foil mt-1 block font-display italic">Mission</span>
          </h2>

          <GoldRule className="mx-auto mt-7 lg:mx-0" />

          <p className="copy-luxe mt-7 text-pretty">{MISSION}</p>
        </motion.div>
      </GlassCard>
    </Section>
  );
}

/* ── Editorial plates ─────────────────────────────────────────────────────── */

/**
 * Graded to the same recipe as the rest of the site's photographs: a daylight
 * image dropped straight onto near-black reads as a lit rectangle pasted on the
 * page, so it is dimmed, desaturated, vignetted and tinted into the plum.
 */
function LibraryPlate() {
  return (
    <div className="relative isolate mx-auto max-w-[19rem] sm:max-w-sm lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(62% 55% at 50% 34%, rgba(123,94,167,0.42) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src="/images/ea58a63aae60.png"
          alt="Boss Clinician private practice training resources for therapists"
          width={815}
          height={720}
          decoding="async"
          className={cn("aspect-[815/720] w-full max-w-full object-cover", PLATE_GRADE)}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(112%_78%_at_50%_28%,transparent_26%,rgba(10,7,19,0.46)_66%,rgba(6,4,11,0.88)_100%)]"
        />
        <div aria-hidden className="absolute inset-0 bg-glow-violet/20 mix-blend-soft-light" />
      </div>

      {/* Offset registration marks — the frame reads as a mounted plate. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-3 -right-3 h-12 w-12 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-16 sm:w-16"
      />
    </div>
  );
}

/**
 * The mission portrait is supplied as a circular cut-out on transparency, so it
 * is framed as a medallion rather than a plate — a rectangular frame would ring
 * empty corners.
 */
function MissionPortrait() {
  return (
    <div className="relative isolate mx-auto w-full max-w-[14rem] sm:max-w-[16rem] lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(58% 58% at 50% 42%, rgba(123,94,167,0.48) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-full border border-gold/30 shadow-[0_36px_84px_-34px_rgba(0,0,0,0.95)]">
        <img
          src="/images/faff351d997d.png"
          alt="Yvette Howard, private practice strategist for therapists and clinicians"
          width={867}
          height={867}
          loading="lazy"
          decoding="async"
          className={cn("aspect-square w-full max-w-full object-cover", PLATE_GRADE)}
        />
        <div
          aria-hidden
          className="absolute inset-0 rounded-full bg-[radial-gradient(78%_78%_at_50%_38%,transparent_42%,rgba(10,7,19,0.34)_82%,rgba(6,4,11,0.62)_100%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 rounded-full bg-glow-violet/20 mix-blend-soft-light"
        />
      </div>
    </div>
  );
}

/* ── Card ─────────────────────────────────────────────────────────────────── */

function CourseCard({ course, accent }: { course: Course; accent: Accent }) {
  const meta = courseMeta[course.slug] ?? defaultCourseMeta;

  return (
    <GlassCard as="article" accent={accent} className="group flex h-full flex-col overflow-hidden">
      {/* Cover. Graded down before it is composited so a daylight product shot
          sits *in* the near-black page instead of glowing on top of it. */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-night-deep">
        <img
          src={course.image}
          alt={meta.imageAlt ?? course.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full max-w-full object-cover brightness-[0.8] contrast-[1.06] saturate-[0.8] transition-transform duration-700 ease-luxe group-hover:scale-[1.06]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-glow-violet/40 mix-blend-multiply transition-opacity duration-700 ease-luxe group-hover:opacity-70"
        />
        <div aria-hidden className="absolute inset-0" style={{ background: COVER_SCRIM }} />
        {/* Foil hairline along the bottom of the frame — the join between plate
            and panel, which is what stops the cover reading as a pasted-in box. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/45 to-transparent"
        />
      </div>

      <div className="flex flex-1 flex-col px-6 pb-6 pt-5 sm:px-7 sm:pb-7">
        <h3 className="text-balance font-display text-[1.05rem] font-medium leading-[1.32] tracking-[0.04em] text-white sm:text-[1.12rem]">
          {course.title}
        </h3>

        <p className="mt-2.5 text-pretty text-[0.9rem] font-medium leading-snug text-lilac">
          {course.subtitle}
        </p>

        <p className="copy-luxe mt-4 text-pretty text-sm">{course.description}</p>

        {course.features.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold text-white/85">{meta.featuresLabel}</p>

            <ul className="mt-3 space-y-2">
              {course.features.map((f) => (
                <li key={f} className="flex gap-2.5 text-sm leading-[1.5] text-orchid-dim">
                  <svg
                    aria-hidden
                    viewBox="0 0 8 8"
                    fill="none"
                    className="mt-[0.42rem] h-[7px] w-[7px] shrink-0 text-gold"
                  >
                    <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
                  </svg>
                  <span className="min-w-0">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* mt-auto here — not flex-1 on the copy — is what bottom-aligns the
            action across cards whose bullet lists run to different lengths. */}
        <div className="mt-auto pt-6">
          <div aria-hidden className="rule-faint w-full" />

          {course.priceText && (
            <p className="mt-5 font-display text-[1.05rem] font-medium text-gold">
              {course.priceText}
            </p>
          )}

          <div className="mt-5">
            {isPurchasable(course) ? (
              <BuyButton slug={course.slug} label={meta.ctaLabel} />
            ) : course.url.startsWith("http") ? (
              <LuxeButton
                variant="glass"
                size="sm"
                href={course.url}
                target="_blank"
                rel="noopener noreferrer"
                className={CTA_CLASS}
              >
                {meta.ctaLabel}
              </LuxeButton>
            ) : (
              <LuxeButton variant="glass" size="sm" to={course.url} className={CTA_CLASS}>
                {meta.ctaLabel}
              </LuxeButton>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

/* ── Loading ──────────────────────────────────────────────────────────────── */

/**
 * Only rendered when there is nothing at all to show (the API is in flight and
 * the bundled fallback has not landed). Ghost cards in the real grid geometry
 * mean the layout does not jump when the collection resolves.
 */
function CatalogueSkeleton() {
  return (
    <div>
      <p role="status" className="copy-luxe text-center text-sm">
        Loading courses…
      </p>

      <ul aria-hidden className={cn(GRID, "mt-8")}>
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-full">
            <GlassCard
              interactive={false}
              spotlight={false}
              className="flex h-full flex-col overflow-hidden"
            >
              <div className="aspect-[16/10] w-full animate-pulse bg-white/[0.05] motion-reduce:animate-none" />
              <div className="flex flex-1 flex-col gap-3 px-6 pb-6 pt-5 sm:px-7 sm:pb-7">
                <div className="h-4 w-3/4 animate-pulse rounded bg-white/[0.07] motion-reduce:animate-none" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.05] motion-reduce:animate-none" />
                <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-white/[0.04] motion-reduce:animate-none" />
                <div className="h-2.5 w-5/6 animate-pulse rounded bg-white/[0.04] motion-reduce:animate-none" />
              </div>
            </GlassCard>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */

/** Nothing published (or an empty API response) must still land somewhere. */
function EmptyLibrary() {
  return (
    <GlassCard
      accent="gold"
      interactive={false}
      spotlight={false}
      className="mx-auto max-w-xl px-6 py-10 text-center sm:px-10"
    >
      <span
        aria-hidden
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gold/25 bg-gold/[0.07] text-gold"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
          <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
          <path d="M12 6.6 14.6 12 12 17.4 9.4 12Z" fill="currentColor" />
        </svg>
      </span>

      <p role="status" className="copy-luxe mt-5 text-pretty text-sm">
        The training library is being updated. Please check back soon.
      </p>

      <LuxeButton variant="glass" size="sm" to="/work-with-me" className="mt-6 min-h-[44px]">
        Work With Me
      </LuxeButton>
    </GlassCard>
  );
}
