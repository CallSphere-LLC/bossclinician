import { Fragment } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Check, ShieldCheck } from "lucide-react";
import { rise } from "@/components/home/luxe/ProgramSections";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { Aurora } from "@/components/luxe/Aurora";
import { Container } from "@/components/ui/Container";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";
import { stripeTestMode } from "@/lib/paymentMode";
import { safeHref } from "@/lib/safeHref";
import type { CourseDetailResponse } from "@/components/course/CoursePriceLabel";
import {
  parseInline,
  salesButtons,
  type Inline,
  type SalesImage,
  type SalesOffer,
  type SalesPageData,
  type SalesSection,
} from "@/components/course/salesPage";

/**
 * A course's long-form sales page, drawn from `courses.sales_page`.
 *
 * CourseDetail hands over to this whenever a course carries one, so a course
 * gets a page like this by having its copy written into the database — no
 * route, no page file. First built for Audit Proof Your Practice (sheet row
 * 235), from the owner's "Audit Proof Sales Page" document and the photos of
 * the Kajabi page it replaces.
 *
 * The buy buttons appear twice, under the hero and in the closing band, and
 * both come from `salesButtons`: one per way to pay on the course's published
 * offers, each linking to checkout with that price preselected.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ── Inline copy ──────────────────────────────────────────────────────── */

const LINK =
  "text-gold underline decoration-gold/40 underline-offset-[5px] transition-colors duration-300 ease-luxe hover:decoration-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold";

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "text":
            return <Fragment key={i}>{node.text}</Fragment>;
          case "strong":
            // Body face, not the display serif: these carry figures ("1.5 CE
            // hours", "75% or higher") and figures are set as plain bold.
            return (
              <strong key={i} className="font-semibold tabular-nums text-white">
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case "email":
            return (
              <a key={i} href={`mailto:${node.address}`} className={LINK}>
                {node.address}
              </a>
            );
          case "link": {
            const href = safeHref(node.href);
            if (!href) return <Fragment key={i}>{node.text}</Fragment>;
            return href.startsWith("/") ? (
              <Link key={i} to={href} className={LINK}>
                {node.text}
              </Link>
            ) : (
              <a key={i} href={href} className={LINK} target="_blank" rel="noopener noreferrer">
                {node.text}
              </a>
            );
          }
        }
      })}
    </>
  );
}

function RichText({ text }: { text: string }) {
  return <InlineNodes nodes={parseInline(text)} />;
}

/* ── Buy buttons ──────────────────────────────────────────────────────── */

function BuyButtons({ course, align = "left" }: { course: CourseDetailResponse; align?: "left" | "center" }) {
  const buttons = salesButtons(course.offers as SalesOffer[]);
  const unavailable = course.offers.find((offer) => !offer.available);
  const justify = align === "center" ? "items-center text-center" : "items-start";

  return (
    <div className={cn("flex w-full flex-col gap-4", justify)}>
      {stripeTestMode() && !course.owned && (
        <p role="status" className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          Test mode — no real payments.
        </p>
      )}

      {course.owned ? (
        <>
          <p className="copy-luxe text-sm">This training is already in your library.</p>
          <LuxeButton to="/library" variant="foil" size="lg" className="w-full sm:w-auto">
            Open it
          </LuxeButton>
        </>
      ) : buttons.length > 0 ? (
        // Stacked, one width: the labels name what each price includes and run
        // long ("Educational Access — $57 | No CE Credit"), so side by side
        // they wrap unevenly at most widths. A grid sized to the widest label
        // keeps the pair reading as a matched choice.
        <div className="grid w-full gap-3 sm:w-max sm:max-w-full">
          {buttons.map((button) => (
            <LuxeButton
              key={button.key}
              to={button.to}
              variant={button.primary ? "foil" : "glass"}
              size="lg"
              className="w-full tabular-nums tracking-[0.12em] sm:tracking-[0.16em]"
            >
              {button.label}
            </LuxeButton>
          ))}
        </div>
      ) : unavailable ? (
        <p className="copy-luxe max-w-md text-pretty text-sm">{unavailable.unavailableReason}</p>
      ) : (
        <>
          {course.priceText ? (
            <p className="text-xl font-bold tabular-nums text-white">{course.priceText}</p>
          ) : (
            <p className="copy-luxe max-w-md text-pretty text-sm">
              Enrollment will open when this course’s price and materials are ready.
            </p>
          )}
          <LuxeButton to="/contact" variant="outline" size="lg" className="w-full sm:w-auto">
            Ask about this course
          </LuxeButton>
        </>
      )}

      {!course.owned && buttons.length > 0 && (
        <p
          className={cn(
            "flex items-start gap-2 text-xs leading-relaxed text-orchid-faint",
            align === "center" && "justify-center text-center",
          )}
        >
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold/70" aria-hidden />
          Secure checkout. Your card details never touch our servers.
        </p>
      )}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

/** Short facts as a row of chips; figures in plain bold body type. */
function Highlights({ items, align = "left" }: { items: string[]; align?: "left" | "center" }) {
  return (
    <ul className={cn("flex flex-wrap gap-2.5", align === "center" && "justify-center")}>
      {items.map((item) => (
        <li
          key={item}
          className="rounded-full border border-gold/35 bg-gold/[0.07] px-4 py-2 text-[0.82rem] font-bold tabular-nums tracking-wide text-white"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

function Photo({ image, className, priority = false }: { image: SalesImage; className?: string; priority?: boolean }) {
  return (
    <img
      src={image.src}
      alt={image.alt}
      width={image.width}
      height={image.height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cn(
        "h-auto w-full rounded-[1.6rem] border border-white/10 object-cover shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)]",
        className,
      )}
    />
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({ course, page }: { course: CourseDetailResponse; page: SalesPageData }) {
  const reduce = useEntranceMotion();
  const { hero } = page;

  return (
    <section className="relative overflow-hidden bg-night-deep" aria-label="Page header">
      <Aurora tone="mixed" intensity={0.85} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-night"
      />
      <Container className="relative z-[1] py-10 sm:py-12 lg:py-16 2xl:py-20 short:py-10">
        <div
          className={cn(
            "grid grid-cols-1 gap-10",
            hero.image && "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16",
          )}
        >
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
            className="min-w-0"
          >
            <Link
              to="/courses"
              className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-orchid-dim transition-colors hover:text-gold"
            >
              ← The training library
            </Link>

            <h1 className="mt-5 text-balance font-display text-[2.3rem] font-normal leading-[1.08] tracking-[-0.015em] text-white sm:text-[3rem] lg:text-[3.5rem]">
              {hero.title}
              {hero.titleAccent && (
                <span className="text-foil mt-1 block italic">{hero.titleAccent}</span>
              )}
            </h1>

            {hero.subtitle && (
              <p className="mt-5 text-pretty text-[1.12rem] font-medium leading-snug text-white/90 sm:text-[1.25rem]">
                {hero.subtitle}
              </p>
            )}

            <GoldRule className="mt-6" />

            {hero.paragraphs && (
              <div className="mt-6 max-w-[42rem] space-y-4">
                {hero.paragraphs.map((p) => (
                  <p key={p} className="copy-luxe text-pretty sm:text-[1.05rem]">
                    <RichText text={p} />
                  </p>
                ))}
              </div>
            )}

            {(hero.highlights || course.owned) && (
              <div className="mt-7 flex flex-wrap items-center gap-2.5">
                {hero.highlights && <Highlights items={hero.highlights} />}
                {course.owned && <LuxePill accent="green">You own this</LuxePill>}
              </div>
            )}

            <div className="mt-8">
              <BuyButtons course={course} />
            </div>
          </motion.div>

          {hero.image && (
            <motion.div
              initial={reduce ? false : { opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.9, delay: reduce ? 0 : 0.15, ease: EASE }}
              className="mx-auto w-full max-w-md lg:max-w-none"
            >
              <Photo image={hero.image} priority className="max-h-[34rem] object-[center_30%] lg:max-h-[40rem]" />
            </motion.div>
          )}
        </div>
      </Container>
    </section>
  );
}

/* ── Attendee screenshots ─────────────────────────────────────────────── */

function Proof({ proof }: { proof: NonNullable<SalesPageData["proof"]> }) {
  const reduce = useEntranceMotion();
  return (
    <Section surface="raised" space="md" aria-label={proof.label} containerClassName="max-w-5xl">
      <h2 className="sr-only">{proof.label}</h2>
      <motion.ul
        {...rise(reduce)}
        className="flex list-none flex-col items-center justify-center gap-5 sm:flex-row sm:items-center"
      >
        {proof.images.map((img) => {
          // A small square screenshot is shown near its own size; a wide one
          // takes the remaining width.
          const narrow = (img.width ?? 0) > 0 && (img.width ?? 0) <= 400;
          return (
            <li key={img.src} className={narrow ? "w-full max-w-[15rem] shrink-0" : "w-full min-w-0 sm:flex-1"}>
              <Photo image={img} className="rounded-2xl" />
            </li>
          );
        })}
      </motion.ul>
    </Section>
  );
}

/* ── One titled band ──────────────────────────────────────────────────── */

function Band({ section, index }: { section: SalesSection; index: number }) {
  const reduce = useEntranceMotion();
  const surface = index % 2 === 0 ? "base" : "raised";

  const body = (
    <>
      <SectionTitle
        align="left"
        title={section.title}
        titleClassName="text-[1.85rem] sm:text-[2.3rem] lg:text-[2.6rem]"
      />

      {section.intro && (
        <p className="copy-luxe mt-6 text-pretty">
          <RichText text={section.intro} />
        </p>
      )}

      {section.list && (
        <motion.div {...rise(reduce, 0.05)}>
          <GlassCard accent="gold" interactive={false} spotlight={false} className="mt-6 p-6 sm:p-8">
            <ul className="space-y-4">
              {section.list.map((item) => (
                <li key={item} className="flex gap-3.5">
                  <Check className="mt-[0.3rem] size-4 shrink-0 text-gold" aria-hidden />
                  <span className="copy-luxe min-w-0 text-pretty text-[0.98rem]">
                    <RichText text={item} />
                  </span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </motion.div>
      )}

      {(section.paragraphs || section.badge) && (
        <div className={cn("mt-6 flex flex-col gap-6", section.badge && "sm:flex-row sm:items-start")}>
          {section.paragraphs && (
            <div className="min-w-0 flex-1 space-y-5">
              {section.paragraphs.map((p) => (
                <p key={p} className="copy-luxe text-pretty">
                  <RichText text={p} />
                </p>
              ))}
            </div>
          )}
          {section.badge && (
            <img
              src={section.badge.src}
              alt={section.badge.alt}
              width={section.badge.width}
              height={section.badge.height}
              loading="lazy"
              decoding="async"
              // The seal is a transparent cut-out; a light chip behind it keeps
              // its navy lettering legible on the night surface.
              className="h-auto w-[104px] shrink-0 self-start rounded-2xl bg-white p-3 sm:w-[120px]"
            />
          )}
        </div>
      )}

      {section.notes && (
        <div className="mt-6 space-y-3 border-l-2 border-gold/30 pl-4">
          {section.notes.map((n) => (
            <p key={n} className="text-pretty text-sm leading-relaxed text-orchid-dim">
              <RichText text={n} />
            </p>
          ))}
        </div>
      )}
    </>
  );

  return (
    <Section
      id={section.id}
      surface={surface}
      space="lg"
      aria-label={section.title}
      className="scroll-mt-24"
      containerClassName={section.image ? "max-w-5xl" : "max-w-3xl"}
    >
      {section.image ? (
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
          <motion.div {...rise(reduce)} className="mx-auto w-full max-w-[18rem] lg:max-w-sm">
            <Photo image={section.image} />
          </motion.div>
          <div className="min-w-0">{body}</div>
        </div>
      ) : (
        body
      )}
    </Section>
  );
}

/* ── Closing band and footer ──────────────────────────────────────────── */

function Closing({ course, page }: { course: CourseDetailResponse; page: SalesPageData }) {
  const reduce = useEntranceMotion();
  const photo = page.closing?.image;

  return (
    <Section
      surface="deep"
      space="xl"
      aria-label="Register"
      containerClassName="max-w-3xl"
      data-media-surface={photo ? true : undefined}
      backdrop={
        photo ? (
          <>
            <img
              src={photo.src}
              alt=""
              aria-hidden
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute inset-0 size-full object-cover object-center"
            />
            <div aria-hidden className="absolute inset-0 bg-night/60" />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-b from-night-deep via-night-deep/50 to-night-deep"
            />
          </>
        ) : (
          <Aurora tone="gold" intensity={0.5} />
        )
      }
    >
      <motion.div {...rise(reduce)} className="flex flex-col items-center gap-7 py-6 text-center sm:py-10">
        <p className="text-balance font-display text-[1.7rem] leading-tight text-white sm:text-[2.2rem]">
          {page.hero.title}
          {page.hero.titleAccent && <span className="text-foil block italic">{page.hero.titleAccent}</span>}
        </p>
        {page.hero.highlights && <Highlights items={page.hero.highlights} align="center" />}
        <BuyButtons course={course} align="center" />
      </motion.div>
    </Section>
  );
}

export default function CourseSalesPage({
  course,
  page,
}: {
  course: CourseDetailResponse;
  page: SalesPageData;
}) {
  return (
    <>
      <Hero course={course} page={page} />
      {page.proof && <Proof proof={page.proof} />}
      {page.sections.map((section, i) => (
        <Band key={section.id ?? section.title} section={section} index={i} />
      ))}
      <Closing course={course} page={page} />
      {page.footer && (
        <Section surface="deep" space="sm" aria-label="Contact details">
          <p className="mx-auto max-w-3xl text-pretty text-center text-xs leading-[1.8] text-orchid">
            <RichText text={page.footer} />
          </p>
        </Section>
      )}
    </>
  );
}
