import type { MouseEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { cn } from "@/lib/cn";
import { sortPills } from "@/content/resourceHub";
import { scrollToSection } from "@/hooks/useHashScroll";
import { glassAccent, PILL } from "./accents";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * The page's wayfinding band.
 *
 * `base` (bg-night) is required rather than chosen: the page hero fades its
 * bottom edge into night, so any other elevation would show a visible step
 * under the handoff.
 */
export function SortPills() {
  const reduce = useReducedMotion();

  const handleJump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Let modified clicks (new tab, etc.) behave natively.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    scrollToSection(id);
  };

  return (
    <Section
      id="top"
      surface="base"
      space="md"
      aurora="violet"
      auroraIntensity={0.4}
      aria-label="Find your section"
      containerClassName="max-w-4xl"
    >
      <SectionTitle
        align="center"
        eyebrow="Find Your Section"
        title="Every clinician is at a different stage."
        titleClassName="text-[1.75rem] sm:text-[2.1rem] lg:text-[2.5rem]"
        body="These resources are organized by where you are — so you get exactly what you need right now, not everything at once."
      />

      <motion.nav
        aria-label="Jump to a section"
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
        transition={{ duration: 0.7, delay: reduce ? 0 : 0.12, ease: EASE }}
        className="mt-10"
      >
        <ul className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
          {sortPills.map((pill) => (
            <li key={pill.id} className="min-w-0">
              <a
                href={`#${pill.id}`}
                onClick={(event) => handleJump(event, pill.id)}
                className={cn(
                  "group inline-flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-full border px-6 py-3",
                  "text-[0.72rem] font-semibold uppercase tracking-[0.12em] sm:w-auto sm:text-[0.7rem] sm:tracking-[0.18em]",
                  "transition-all duration-300 ease-luxe hover:-translate-y-0.5",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
                  PILL[glassAccent[pill.accent]],
                )}
              >
                <svg
                  aria-hidden
                  viewBox="0 0 8 8"
                  fill="none"
                  className="h-[7px] w-[7px] shrink-0"
                >
                  <path d="M4 0.5 7.5 4 4 7.5 0.5 4Z" fill="currentColor" />
                </svg>
                <span className="min-w-0">{pill.label}</span>
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 shrink-0 transition-transform duration-500 ease-luxe group-hover:translate-y-0.5"
                >
                  <path d="M8 2.5v11M4 9.5l4 4 4-4" />
                </svg>
              </a>
            </li>
          ))}
        </ul>
      </motion.nav>
    </Section>
  );
}
