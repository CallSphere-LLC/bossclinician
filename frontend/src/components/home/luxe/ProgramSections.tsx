import { useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

/**
 * The shared vocabulary of the two programme sales pages (/club, /lounge).
 *
 * Both pages make the same kind of argument in the same kind of blocks — a run
 * of prose, a marked list, a founder's letter, a disclosure FAQ, a call to
 * action — so the blocks live here once and the pages stay a readable list of
 * sections. Everything is built from the luxe primitives the rest of the site
 * uses (Section, GlassCard, LuxeButton); nothing in this file introduces a new
 * surface, colour or type scale.
 */

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** Accents cycle so sibling cards read as a set, not as a ranking. */
const ACCENT_CYCLE: readonly Accent[] = ["green", "plum", "gold"];
export const accentAt = (i: number): Accent => ACCENT_CYCLE[i % ACCENT_CYCLE.length];

/**
 * One rise recipe for both pages; only the delay changes. Reduced-motion and
 * first-paint renders get `initial={false}` — the final state on mount, never a
 * blank element waiting on an observer.
 */
export function rise(reduce: boolean | null, delay = 0) {
  return {
    initial: reduce ? (false as const) : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE },
  };
}

/* ── List marks. Decoration only, so every one of them is aria-hidden. ──── */

function Diamond({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 8 8"
      fill="none"
      className={cn("mt-[0.55rem] h-[7px] w-[7px] shrink-0", className)}
    >
      <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
    </svg>
  );
}

function Mark({ variant, className }: { variant: "check" | "cross"; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("mt-[0.2rem] h-4 w-4 shrink-0", className)}
    >
      {variant === "check" ? (
        <path d="M3 8.4 6.3 11.7 13 4.7" />
      ) : (
        <path d="M4.6 4.6 11.4 11.4M11.4 4.6 4.6 11.4" />
      )}
    </svg>
  );
}

/* ── Prose ────────────────────────────────────────────────────────────── */

/** A run of paragraphs at the site's reading measure. */
export function Prose({
  paragraphs,
  className,
  align = "left",
}: {
  paragraphs: readonly string[];
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("space-y-5", align === "center" && "text-center", className)}>
      {paragraphs.map((text) => (
        <p key={text} className="copy-luxe text-pretty">
          {text}
        </p>
      ))}
    </div>
  );
}

/** The one sentence a section turns on, set in display italic with a foil rule. */
export function Pull({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center", className)}>
      <GoldRule className="mx-auto" />
      <p className="mt-7 text-balance font-display text-[1.35rem] italic leading-[1.4] text-white sm:text-[1.6rem]">
        {children}
      </p>
    </div>
  );
}

/* ── Lists ────────────────────────────────────────────────────────────── */

type MarkVariant = "diamond" | "check" | "cross";

const MARK_TONE: Record<MarkVariant, string> = {
  diamond: "text-gold",
  check: "text-green-bright",
  cross: "text-orchid",
};

export function MarkedList({
  items,
  variant = "diamond",
  className,
}: {
  items: readonly string[];
  variant?: MarkVariant;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3.5", className)}>
      {items.map((item) => (
        <li key={item} className="flex gap-3.5">
          {variant === "diamond" ? (
            <Diamond className={MARK_TONE.diamond} />
          ) : (
            <Mark variant={variant} className={MARK_TONE[variant]} />
          )}
          <span className="copy-luxe min-w-0 text-pretty text-[0.95rem]">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── Call to action ───────────────────────────────────────────────────── */

interface CtaProps {
  label: string;
  /** An internal route, or an in-page `#anchor`. */
  to: string;
  note?: string;
  variant?: "foil" | "glass";
  className?: string;
}

/**
 * A section's closing action.
 *
 * `#anchor` targets render as a plain anchor so the browser does the scroll;
 * anything else is a router link. Full width on phones: these labels are long
 * ("SAY LESS.. I'M READY TO JOIN THE CLUB") and a fixed-width pill clips them.
 */
export function Cta({ label, to, note, variant = "foil", className }: CtaProps) {
  const classes = "w-full max-w-full text-center leading-[1.4] tracking-[0.12em] sm:w-auto sm:tracking-[0.18em]";

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      {(to.startsWith("#") || /^https?:\/\//.test(to)) ? (
        <LuxeButton variant={variant} size="lg" href={to} className={classes}>
          {label}
        </LuxeButton>
      ) : (
        <LuxeButton variant={variant} size="lg" to={to} className={classes}>
          {label}
        </LuxeButton>
      )}
      {note && <p className="copy-luxe mt-5 max-w-md text-pretty text-sm">{note}</p>}
    </div>
  );
}

/* ── Testimonial ──────────────────────────────────────────────────────── */

export function QuoteCard({
  quote,
  name,
  accent = "gold",
  className,
}: {
  quote: string;
  name: string;
  accent?: Accent;
  className?: string;
}) {
  return (
    <GlassCard
      as="figure"
      accent={accent}
      interactive={false}
      className={cn("flex h-full flex-col p-7 sm:p-8", className)}
    >
      <span aria-hidden className="text-foil font-display text-[3rem] leading-none">
        &ldquo;
      </span>
      <blockquote className="copy-luxe mt-2 flex-1 text-pretty text-[0.95rem] italic">
        {quote}
      </blockquote>
      <GoldRule width="w-10" className="mt-6" />
      <figcaption className="mt-4 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gold">
        {name}
      </figcaption>
    </GlassCard>
  );
}

/* ── Founder's letter ─────────────────────────────────────────────────── */

interface FounderLetterProps {
  eyebrow?: string;
  title: string;
  paragraphs: readonly string[];
  signoff?: string;
  signature: string;
  image: string;
  imageAlt: string;
}

export function FounderLetter({
  eyebrow,
  title,
  paragraphs,
  signoff,
  signature,
  image,
  imageAlt,
}: FounderLetterProps) {
  const reduce = useEntranceMotion();

  return (
    <Section surface="raised" space="lg" aurora="plum" auroraIntensity={0.5} aria-label={title}>
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <motion.div {...rise(reduce)} className="mx-auto w-full max-w-sm lg:sticky lg:top-28">
          <GlassCard interactive={false} spotlight={false} className="overflow-hidden p-2">
            <img
              src={image}
              alt={imageAlt}
              width={720}
              height={900}
              loading="lazy"
              decoding="async"
              className="aspect-[4/5] h-auto w-full max-w-full rounded-xl object-cover object-top"
            />
          </GlassCard>
        </motion.div>

        <motion.div {...rise(reduce, 0.1)}>
          {eyebrow && <span className="eyebrow-luxe">{eyebrow}</span>}
          <h2 className="text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem]">
            {title}
          </h2>
          <GoldRule className="mt-8" />
          <Prose paragraphs={paragraphs} className="mt-8" />
          <p className="mt-8 font-display text-[1.2rem] italic text-white">
            {signoff && <span className="block text-base not-italic text-orchid">{signoff}</span>}
            {signature}
          </p>
        </motion.div>
      </div>
    </Section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

export interface ProgramFaqItem {
  q: string;
  a: string;
  /** An internal page the answer refers to, offered under the answer. */
  link?: { label: string; to: string };
}

interface ProgramFaqProps {
  eyebrow?: string;
  title: string;
  items: readonly ProgramFaqItem[];
  children?: ReactNode;
}

/**
 * Disclosure FAQ — the same APG pattern as the Work With Me page: a real
 * button per question carrying aria-expanded/aria-controls, the collapsed
 * answer taken out of the accessibility tree, and no per-answer landmark.
 */
export function ProgramFaq({ eyebrow, title, items, children }: ProgramFaqProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const reduce = useReducedMotion();
  const uid = useId();

  return (
    <Section
      id="faq"
      surface="base"
      space="md"
      aria-label="Frequently asked questions"
      containerClassName="max-w-3xl"
      className="scroll-mt-24"
    >
      <SectionTitle align="center" eyebrow={eyebrow} title={title} />

      <div className="mt-10 space-y-3.5">
        {items.map((faq, i) => {
          const isOpen = openIndex === i;
          const panelId = `${uid}-faq-panel-${i}`;
          const buttonId = `${uid}-faq-button-${i}`;

          return (
            <GlassCard
              key={faq.q}
              accent={accentAt(i)}
              interactive={false}
              spotlight={false}
              className="overflow-hidden"
            >
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-6 py-5 text-left",
                    "min-h-[56px] transition-colors duration-300 ease-luxe hover:bg-white/[0.03]",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                  )}
                >
                  <span className="min-w-0 text-pretty text-[0.95rem] font-medium text-white">
                    {faq.q}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0 font-display text-2xl leading-none text-gold transition-transform duration-500 ease-luxe",
                      isOpen && "rotate-45",
                    )}
                  >
                    +
                  </span>
                </button>
              </h3>

              <motion.div
                id={panelId}
                aria-hidden={!isOpen}
                initial={false}
                animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: reduce ? 0 : 0.35, ease: EASE }}
                className="overflow-hidden"
              >
                <div aria-hidden className="rule-faint mx-6 w-auto" />
                <div className="px-6 pb-6 pt-5">
                  <p className="copy-luxe text-pretty text-sm">{faq.a}</p>
                  {faq.link && (
                    // A collapsed panel is aria-hidden, so its link must leave
                    // the tab order with it or a keyboard user lands on a
                    // control they cannot see.
                    <p className="mt-4 text-sm">
                      <Link
                        to={faq.link.to}
                        tabIndex={isOpen ? undefined : -1}
                        className="text-orchid underline decoration-white/20 underline-offset-[6px] transition-colors duration-300 ease-luxe hover:text-gold hover:decoration-gold/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
                      >
                        {faq.link.label} &rarr;
                      </Link>
                    </p>
                  )}
                </div>
              </motion.div>
            </GlassCard>
          );
        })}
      </div>

      {children && <div className="mt-12">{children}</div>}
    </Section>
  );
}
