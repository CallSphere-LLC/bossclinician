import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Section, GoldRule } from "@/components/luxe/Section";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * The "Meet Your Strategist" copy from the bossclinician.com home page,
 * verbatim and in order. The long founder story lives on /about; the home page
 * carries this shorter version. Paragraph one stays a single unbroken string
 * (rather than being pre-split around its drop cap) so the source copy can be
 * diffed against the live site without reassembly.
 */
const STORY: readonly string[] = [
  "I started my private practice in 2018, went full-time in 2019, and eventually built a multi-six-figure group practice.",
  "Along the way, I learned that growth alone does not create freedom.",
  "I've experienced the full caseload, the platforms, the insurance decisions, the hiring, the leadership challenges, the systems, and the point where a business can look successful on paper while still asking too much of the owner.",
  "That's why I created Boss Clinician.",
  "Today, I help therapists build, sustain, and lead private practices that support their income, energy, life, and future, without requiring them to max themselves out to maintain them.",
];

const CLOSING =
  "When I'm not mentoring clinicians or leading my team, you'll find me sipping iced chai, dancing with my son in the kitchen, or planning my next retreat.";

const CREDENTIALS: readonly string[] = [
  "LCSW",
  "GROUP PRACTICE OWNER",
  "DOCTORAL CANDIDATE",
  "PRIVATE PRACTICE STRATEGIST",
];

/** One rise recipe for the whole block; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.85, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

/**
 * The page's editorial spread: a held portrait on the left, a long-form founder
 * story running past it on the right. The asymmetry (0.85 / 1.15) and the
 * sticky photo are the whole idea — the reader scrolls the story while the
 * person telling it stays in frame.
 */
export function LuxeMeetYvette() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="raised"
      space="lg"
      aurora="plum"
      auroraIntensity={0.5}
      aria-label="About Yvette Howard"
    >
      <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        {/* ── Portrait ─────────────────────────────────────────────────────
            `self-stretch` overrides the grid's `items-start` for this column
            only: a sticky child needs a containing block taller than itself,
            and a content-sized grid item gives it nowhere to travel. */}
        <div className="lg:self-stretch">
          <div className="lg:sticky lg:top-28">
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={VIEWPORT}
              transition={{ duration: 1.1, ease: EASE_LUXE }}
              className="relative isolate mx-auto max-w-sm lg:max-w-none"
            >
              {/* Plum bloom behind the frame. Without a light source of its own
                  the portrait reads as a rectangle cut out of the page. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
                style={{
                  background:
                    "radial-gradient(62% 55% at 42% 32%, rgba(123,94,167,0.45) 0%, transparent 72%)",
                }}
              />

              <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
                <img
                  src="/images/home/yvette-meet-business-coach-mug.jpg"
                  alt="Yvette Howard, LCSW, founder of Boss Clinician, smiling and holding a mug that reads business coach"
                  width={1647}
                  height={1365}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/5] w-full object-cover object-top"
                />
              </div>

              {/* Offset crop marks — a printer's registration frame, sitting a
                  few pixels outside the photograph so the eye registers it as
                  a mounted plate rather than an inline image. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -left-3 -top-3 h-14 w-14 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-[4.5rem] sm:w-[4.5rem]"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-3 -right-3 h-14 w-14 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-[4.5rem] sm:w-[4.5rem]"
              />
            </motion.div>
          </div>
        </div>

        {/* ── Story ──────────────────────────────────────────────────────── */}
        <div>
          <motion.span {...rise(reduce, 0.05)} className="eyebrow-luxe">
            MEET YOUR STRATEGIST
          </motion.span>

          <motion.h2
            {...rise(reduce, 0.14)}
            className="text-balance font-display text-[1.9rem] font-medium leading-[1.14] text-white sm:text-[2.4rem] lg:text-[2.9rem] lg:tracking-[-0.012em]"
          >
            I built this for the clinician who is holding everything together and still wondering
            why it does not feel like enough.{" "}
            {/* The turn in the sentence, set apart by Playfair's italic rather
                than by more gold. */}
            <em className="italic text-orchid">Especially her.</em>
          </motion.h2>

          <motion.div {...rise(reduce, 0.24)}>
            <GoldRule className="mt-8" />
          </motion.div>

          <motion.div
            {...rise(reduce, 0.3)}
            className="mt-9 max-w-[62ch] space-y-5 sm:mt-10"
          >
            {STORY.map((paragraph, i) => (
              <p key={paragraph} className="copy-luxe text-pretty">
                {i === 0 ? (
                  <>
                    {/* Float, not ::first-letter: the cap is its own one-glyph
                        box, so the rest of the word ("'m") stays in the normal
                        inline flow beside it and never wraps away from it.
                        The right margin has to stay near-zero because this
                        paragraph opens on a contraction — at any normal drop-cap
                        gutter the line reads "I 'm Yvette", which looks like a
                        typo rather than a drop cap. */}
                    <span className="text-foil float-left mr-[0.03em] mt-1 font-display text-[3.25rem] font-medium leading-[0.8] sm:text-[3.5rem]">
                      {paragraph.slice(0, 1)}
                    </span>
                    {paragraph.slice(1)}
                  </>
                ) : (
                  paragraph
                )}
              </p>
            ))}
          </motion.div>

          <motion.p
            {...rise(reduce, 0.36)}
            className="mt-10 max-w-[58ch] text-pretty font-display text-[1.05rem] italic leading-[1.7] text-orchid-faint sm:text-[1.15rem]"
          >
            {CLOSING}
          </motion.p>

          <motion.div
            {...rise(reduce, 0.42)}
            className="mt-10 flex flex-wrap items-center gap-2.5"
          >
            {CREDENTIALS.map((credential) => (
              <LuxePill key={credential} accent="gold">
                {credential}
              </LuxePill>
            ))}
          </motion.div>

          <motion.div {...rise(reduce, 0.48)} className="mt-10">
            <LuxeButton variant="outline" size="md" to="/about">
              Read My Full Story
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="h-3.5 w-3.5 transition-transform duration-500 ease-luxe group-hover:translate-x-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 8h11M9.5 4l4 4-4 4" />
              </svg>
            </LuxeButton>
          </motion.div>
        </div>
      </div>
    </Section>
  );
}
