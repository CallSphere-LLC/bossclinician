import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Section, SectionTitle } from "@/components/luxe/Section";
import { GlassCard, type Accent } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { findBlogPostBySlug } from "@/content/blog";

/**
 * The cover photo has to stop being a rectangle pasted onto the panel. Two
 * passes do that: a plum multiply that pulls bright stock whites into the
 * page's palette, then this scrim, whose bottom stop matches the composited
 * glass surface so the image dissolves into the card instead of ending at it.
 * The same scrim runs over the typographic plate below, so a card with a photo
 * and a card without one meet the copy block on exactly the same gradient.
 */
const COVER_SCRIM =
  "linear-gradient(to top, rgba(9,6,17,0.96) 0%, rgba(9,6,17,0.74) 16%, rgba(9,6,17,0.28) 44%, rgba(9,6,17,0) 74%)";

type CardAccent = Extract<Accent, "green" | "plum" | "gold">;

/** Feeds the plate gradients that Tailwind cannot express as utilities. */
const ACCENT_RGB: Record<CardAccent, string> = {
  green: "107, 168, 145",
  plum: "141, 110, 190",
  gold: "201, 164, 106",
};

interface Teaser {
  category: string;
  title: string;
  excerpt: string;
  /** Slug of the same post on THIS site, once it has been migrated across. */
  localSlug?: string;
  /** Live permalink, used until the post exists here. */
  externalHref: string;
  accent: CardAccent;
}

/**
 * The three posts the live site features, in its order. This is an editorial
 * selection rather than "the newest three", which is why it is spelled out
 * here instead of sliced off `blogCards()` — the running order on the home
 * page is a decision, not a byproduct of publish dates.
 */
const TEASERS: readonly Teaser[] = [
  {
    category: "Private Practice Strategy",
    title: "Is Talkspace Right for Your Long-Term Practice Goals? A Therapist's Honest Take",
    excerpt:
      "After a year seeing 80–100 clients on the platform, here's what I learned, and why I built my own practice instead.",
    externalHref: "https://www.bossclinician.com/blog/is-talkspace-right-for-your-practice-goals",
    accent: "green",
  },
  {
    category: "Group Practice",
    title: "Alma vs Private Pay: What the Numbers Actually Look Like for Group Practices",
    excerpt:
      "I joined Alma expecting higher rates and cash pay referrals. Here's what I actually got, and what group practice owners need to know first.",
    externalHref:
      "https://www.bossclinician.com/blog/alma-vs-private-pay-group-practice-numbers",
    accent: "plum",
  },
  {
    category: "Income Strategy",
    title: "How to Stop Seeing 25+ Clients a Week and Still Hit Your Income Goals",
    excerpt:
      "The math most therapists have never done, and how changing your rates changes everything.",
    localSlug: "how-to-stop-seeing-25-clients-a-week-and-still-hit-your-income-goals",
    externalHref: "https://www.bossclinician.com/blog/how-to-stop-seeing-25-clients-a-week",
    accent: "gold",
  },
];

const LINK_CLASSES = [
  "group block h-full rounded-2xl",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
].join(" ");

/**
 * Cover plate for a post that has no featured image yet.
 *
 * Same box, same scrim, same hover travel as a photographed card — only the
 * fill changes — so a mixed row still reads as one grid rather than as a
 * broken image. Inventing a stock photo for a post would say something about
 * the post; a graded field says nothing, which is the honest option here.
 */
function CoverPlate({ accent }: { accent: CardAccent }) {
  const rgb = ACCENT_RGB[accent];

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 transition-transform duration-700 ease-luxe group-hover:scale-[1.06]"
        style={{
          backgroundImage: [
            `radial-gradient(115% 92% at 24% 10%, rgba(${rgb},0.30) 0%, rgba(${rgb},0.09) 45%, transparent 76%)`,
            "linear-gradient(155deg, rgba(23,14,40,0.96) 0%, rgba(9,6,17,0.98) 100%)",
          ].join(", "),
        }}
      />
      <svg
        aria-hidden
        viewBox="0 0 40 40"
        fill="none"
        className="absolute left-1/2 top-[42%] h-10 w-10 -translate-x-1/2 -translate-y-1/2"
        style={{ color: `rgb(${rgb})` }}
      >
        <circle cx="20" cy="20" r="18.4" stroke="currentColor" strokeWidth="0.9" opacity="0.3" />
        <path d="M20 9 L31 20 L20 31 L9 20 Z" fill="currentColor" opacity="0.5" />
      </svg>
    </>
  );
}

export function LuxeBlogTeaser() {
  const reduce = useReducedMotion();

  return (
    <Section
      surface="deep"
      space="lg"
      aurora="violet"
      auroraIntensity={0.45}
      aria-label="From the blog"
    >
      <SectionTitle
        align="center"
        eyebrow="From the Blog"
        title="Real talk about building your private practice."
      />

      {/* Capped to a single readable column below md so the 16:10 covers don't
          balloon to half the viewport height on tablets. */}
      <RevealGroup
        as="ul"
        className="mx-auto mt-10 grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:mt-10 md:max-w-none md:grid-cols-2 lg:mt-12 lg:grid-cols-3"
      >
        {TEASERS.map((post) => {
          // Resolved at render, not hardcoded: the moment the post lands in
          // the local content file the card starts pointing at it instead of
          // sending the reader off-site.
          const local = post.localSlug ? findBlogPostBySlug(post.localSlug) : undefined;

          const card: ReactNode = (
            <GlassCard accent={post.accent} className="flex h-full flex-col overflow-hidden">
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                {local?.coverImage ? (
                  <>
                    <img
                      src={local.coverImage}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-700 ease-luxe group-hover:scale-[1.06]"
                    />
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-glow-violet/45 mix-blend-multiply transition-opacity duration-700 ease-luxe group-hover:opacity-60"
                    />
                  </>
                ) : (
                  <CoverPlate accent={post.accent} />
                )}
                <div aria-hidden className="absolute inset-0" style={{ background: COVER_SCRIM }} />
              </div>

              <div className="flex flex-1 flex-col px-6 pb-6 pt-5 sm:px-7 sm:pb-7">
                <p className="flex items-center gap-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold sm:tracking-[0.18em]">
                  <span aria-hidden className="h-px w-4 shrink-0 bg-gold/45" />
                  <span className="min-w-0">{post.category}</span>
                </p>

                {/* No line clamp on either block: the headline and the standfirst
                    are the copy the page is here to deliver, and flex-1 on the
                    excerpt already bottom-aligns the three Read More rows. */}
                <h3 className="mt-3 text-pretty font-display text-[1.15rem] font-medium leading-snug text-white">
                  {post.title}
                </h3>

                <p className="copy-luxe mt-3 flex-1 text-pretty text-sm">{post.excerpt}</p>

                <div aria-hidden className="rule-faint mt-6 w-full" />

                <span className="mt-5 inline-flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                  Read More
                  <svg
                    aria-hidden
                    viewBox="0 0 20 8"
                    fill="none"
                    className="h-2 w-5 shrink-0 transition-transform duration-500 ease-luxe group-hover:translate-x-1.5 group-focus-visible:translate-x-1.5"
                  >
                    <path
                      d="M0 4h17.2M14 0.9 18 4l-4 3.1"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </GlassCard>
          );

          return (
            <RevealItem key={post.title} as="li" className="h-full">
              {/* The Link wraps rather than being GlassCard's `as` — GlassCard
                  does not forward arbitrary props, so `to` would be dropped. */}
              {local ? (
                <Link to={`/blog/${local.slug}`} className={LINK_CLASSES}>
                  {card}
                </Link>
              ) : (
                <a
                  href={post.externalHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={LINK_CLASSES}
                >
                  {card}
                </a>
              )}
            </RevealItem>
          );
        })}
      </RevealGroup>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-12% 0px -8% 0px" }}
        transition={{ duration: 0.7, delay: reduce ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="mt-12 text-center"
      >
        <LuxeButton variant="outline" size="lg" to="/blog">
          Read All Posts
        </LuxeButton>
      </motion.div>
    </Section>
  );
}
