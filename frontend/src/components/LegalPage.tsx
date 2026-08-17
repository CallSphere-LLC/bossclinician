import { Fragment, useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Seo } from "@/components/Seo";
import { GoldRule, Section } from "@/components/luxe/Section";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxePill } from "@/components/luxe/LuxeButton";
import { GlassCard } from "@/components/luxe/GlassCard";
import { cn } from "@/lib/cn";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-10% 0px -6% 0px" } as const;

/** Reuse the hero's tone union rather than restating it and letting it drift. */
type AuroraTone = React.ComponentProps<typeof LuxePageHero>["tone"];

interface LegalPageProps {
  title: string;
  description: string;
  updated?: string;
  paragraphs: string[];
  /** Ambient tone of the hero band, so each document reads as its own chapter. */
  tone?: AuroraTone;
}

/* ── Document structure ───────────────────────────────────────────────────
   The source copy is a flat string[]; the real document underneath it is a
   set of titled clauses ("Our Copyrights. The content on this site…"). We
   recover that structure at render time rather than restating the copy in a
   second shape, so the legal text stays byte-identical to `content/site.ts`
   and cannot drift out of sync with it. Nothing is added, removed or
   reordered — only re-tagged. */

interface Clause {
  id: string;
  /** Run-in heading, trailing period included. `null` for untitled preamble. */
  heading: string | null;
  paragraphs: string[];
}

/** Past this a leading sentence is prose, not a heading. */
const MAX_LEAD_IN = 60;

/**
 * A paragraph opens with a run-in heading when its first sentence is short,
 * title-cased and followed by more text.
 *
 * The title-case test is what keeps the heuristic honest: "Monetary and income
 * results are based on many factors." is short enough to pass a length check
 * but is plainly a sentence, and "…payments (e.g. PayPal)." would otherwise
 * break on the abbreviation. Digits and "@" are rejected so a line ending in
 * an address ("…at yvette@bossclinician.com.") is never promoted.
 */
function splitLeadIn(paragraph: string): { heading: string; body: string } | null {
  const stop = paragraph.indexOf(". ");
  if (stop < 0 || stop > MAX_LEAD_IN) return null;

  const heading = paragraph.slice(0, stop + 1);
  const body = paragraph.slice(stop + 2);
  if (!body || /[\d@]/.test(heading)) return null;

  // Every word carrying meaning (four letters or more, plus the opener) must
  // be capitalised. Short connectives — "and", "of", "at" — are exempt.
  const titleCased = heading
    .slice(0, -1)
    .split(/\s+/)
    .every((word, i) => (i > 0 && word.length < 4 ? true : /^[A-Z]/.test(word)));

  return titleCased ? { heading, body } : null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toClauses(paragraphs: string[]): Clause[] {
  const clauses: Clause[] = [];

  for (const paragraph of paragraphs) {
    const split = splitLeadIn(paragraph);

    if (split) {
      clauses.push({
        id: `${slugify(split.heading) || "clause"}-${clauses.length + 1}`,
        heading: split.heading,
        paragraphs: [split.body],
      });
      continue;
    }

    const current = clauses[clauses.length - 1];
    if (current) {
      current.paragraphs.push(paragraph);
      continue;
    }

    clauses.push({ id: "preamble", heading: null, paragraphs: [paragraph] });
  }

  return clauses;
}

/* ── Inline addresses ─────────────────────────────────────────────────────
   The capture group means `split` returns text and matches alternating, so
   odd indices are the addresses. The trailing `[A-Za-z]` stops the match
   short of the sentence's full stop. */
const EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z])/g;

function withEmailLinks(text: string): ReactNode {
  const parts = text.split(EMAIL);
  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={`mail-${i}`}
        href={`mailto:${part}`}
        className={cn(
          "text-gold underline decoration-gold/40 underline-offset-4",
          "transition-colors duration-300 hover:text-gold-bright hover:decoration-gold",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        {part}
      </a>
    ) : (
      <Fragment key={`text-${i}`}>{part}</Fragment>
    ),
  );
}

/**
 * The shared shell for the four legal documents.
 *
 * These are reading pages, so the treatment is deliberately quiet: aurora is
 * confined to the hero band, the body runs as a single 70ch measure on a flat
 * surface, and each clause gets one entrance rather than one per paragraph.
 * The only ornament is the foil tick above each run-in heading and — on wide
 * screens, for documents long enough to need it — a sticky index built from
 * the document's own headings.
 */
export function LegalPage({
  title,
  description,
  updated,
  paragraphs,
  tone = "violet",
}: LegalPageProps) {
  const reduce = useReducedMotion();
  const clauses = useMemo(() => toClauses(paragraphs), [paragraphs]);

  const index = clauses.filter((clause) => clause.heading !== null);
  // Below four entries an index is chrome, not navigation.
  const hasIndex = index.length >= 4;

  return (
    <>
      <Seo title={`${title} | Boss Clinician`} description={description} />

      <LuxePageHero
        eyebrow="Legal"
        title={title}
        tone={tone}
        actions={updated ? <LuxePill accent="gold">{updated}</LuxePill> : undefined}
      />

      <Section surface="base" space="md" aria-label={title}>
        <div
          className={cn(
            "mx-auto",
            hasIndex
              // No `items-start`: the index column has to stretch to the row's
              // full height, or its sticky child has nowhere to travel.
              ? "max-w-[62rem] xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:gap-8"
              : "max-w-[70ch]",
          )}
        >
          <article className={cn("space-y-10", hasIndex && "mx-auto max-w-[70ch] xl:mx-0")}>
            {clauses.map((clause) => (
              <motion.section
                key={clause.id}
                id={clause.id}
                aria-labelledby={clause.heading ? `${clause.id}-heading` : undefined}
                // Clears the sticky 5rem header when the index jumps here.
                className="scroll-mt-28"
                initial={reduce ? false : { opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={VIEWPORT}
                transition={{ duration: 0.7, ease: EASE }}
              >
                {clause.heading && (
                  <>
                    <GoldRule width="w-8" className="mb-5" />
                    <h2
                      id={`${clause.id}-heading`}
                      className="text-balance font-display text-[1.3rem] font-medium leading-[1.3] text-white sm:text-[1.55rem]"
                    >
                      {clause.heading}
                    </h2>
                  </>
                )}

                <div className={cn("space-y-5", clause.heading && "mt-6")}>
                  {clause.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="copy-luxe text-pretty break-words">
                      {withEmailLinks(paragraph)}
                    </p>
                  ))}
                </div>
              </motion.section>
            ))}
          </article>

          {hasIndex && (
            <nav aria-label={`${title} sections`} className="hidden xl:block">
              <div className="sticky top-28">
                <GlassCard accent="gold" interactive={false} className="p-5">
                  <ul className="max-h-[calc(100vh-11rem)] space-y-0.5 overflow-y-auto">
                    {index.map((clause) => (
                      <li key={clause.id}>
                        <a
                          href={`#${clause.id}`}
                          className={cn(
                            "group flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2.5",
                            "text-sm leading-snug text-orchid-dim transition-colors duration-300",
                            "hover:bg-white/[0.05] hover:text-white",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                          )}
                        >
                          <span
                            aria-hidden
                            className="h-px w-3 shrink-0 bg-gold/50 transition-all duration-300 group-hover:w-5 group-hover:bg-gold"
                          />
                          <span className="min-w-0">{clause.heading}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </GlassCard>
              </div>
            </nav>
          )}
        </div>
      </Section>
    </>
  );
}
