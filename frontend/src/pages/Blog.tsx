import { Fragment, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { usePageData } from "@/hooks/usePageData";
import { ssrKeys } from "@/ssr/keys";
import { api } from "@/lib/api";
import { blogCards as fallbackBlogCards, allBlogTags } from "@/content/blog";
import type { BlogCard } from "@/types";
import { cn } from "@/lib/cn";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** Lives on the source site only; kept absolute until the route is built here. */
const QUIZ_URL = "https://www.bossclinician.com/offer-quiz";
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * The founder block, verbatim and in source order. Each entry is one
 * paragraph; an entry with two strings is a paragraph the source breaks across
 * two lines, so the break is data rather than a second <p>.
 */
const MEET_YVETTE: readonly (readonly string[])[] = [
  [
    "I’m here to help therapists turn their clinical skills into sustainable, aligned businesses—without burning out or breaking their values.",
  ],
  [
    "Here, it’s not either/or.",
    // The \u00a0 escapes below are the source's own non-breaking spaces, kept
    // as escapes so they survive a copy/paste through any editor.
    "It’s\u00a0impact and income. Ethics and ease. Purpose and profit.",
  ],
  [
    "I didn’t start out wanting to be an entrepreneur—I started out trying to survive a broken system. I worked underpaid agency jobs, chased licensure, juggled multiple roles, and learned the hard way what school never taught us: being a great therapist doesn’t automatically build a great business.",
  ],
  ["So I built my own."],
  [
    "I grew from solo practitioner to group practice owner, made every mistake imaginable, navigated insurance chaos, scaled into a W2 agency, and learned how to lead a practice that supports both clients and clinicians. Today, I run a thriving group practice, serve as a clinical supervisor, and build businesses that create freedom, flexibility, and stability—for me and for the therapists I support.",
  ],
  [
    "Now, through\u00a0Boss Clinician, I teach therapists how to become CEOs of their clinical expertise and build practices that actually support their lives.",
  ],
];

/**
 * Cover photos have to stop being rectangles pasted onto the panel. The bottom
 * stop here matches the composited glass surface, so the image dissolves into
 * the card instead of ending at a hard edge.
 */
const COVER_SCRIM =
  "linear-gradient(to top, rgba(9,6,17,0.96) 0%, rgba(9,6,17,0.72) 18%, rgba(9,6,17,0.26) 46%, rgba(9,6,17,0) 76%)";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "2026-06-01" → "Jun 01, 2026", the format the index carries under every
 * headline. Split by hand rather than run through `Date`: an ISO date parses as
 * UTC midnight, which renders a day early for every reader west of Greenwich.
 */
function publishedLabel(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  const name = MONTHS[Number(month) - 1];
  if (!year || !day || !name) return iso;
  return `${name} ${day}, ${year}`;
}

/**
 * Topics are stored lower-case so a chip's `?tag=` value matches the source
 * site's own links; the display form is rebuilt here. The word-boundary anchor
 * is what keeps hyphenated topics right — "audit-ready notes" has to come back
 * as "Audit-Ready Notes", not "Audit-ready Notes".
 */
function topicLabel(tag: string): string {
  return tag.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** One rise recipe for the page; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

export default function Blog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tag = searchParams.get("tag") ?? undefined;

  // Keyed on the tag rather than fetched once: a visitor who arrives on one of
  // the indexed `?tag=` archives is seeded with that topic's posts only, and
  // picking a different topic has to fetch that topic rather than filter the
  // seeded subset down to nothing.
  const list = usePageData(ssrKeys.blogList(tag), () => api.blogList({ tag }));
  const loading = list.status === "loading";

  const items = useMemo(() => {
    // The bundled archive stands in whenever the API is unreachable, so the
    // page still lists articles rather than reading as empty.
    const all = list.status === "ready" ? list.data.items : fallbackBlogCards();
    if (!tag) return all;
    return all.filter((post) => post.tags.includes(tag));
  }, [list, tag]);

  const featured = items[0];
  const rest = items.slice(1);

  function setTag(next?: string) {
    if (!next) {
      setSearchParams({});
    } else {
      setSearchParams({ tag: next });
    }
  }

  return (
    <>
      <Seo
        title={
          tag
            ? `${tag} | Boss Clinician Blog`
            : "Boss Clinician Blog | Business & Growth for Clinicians"
        }
        description={
          tag
            ? `Articles on ${tag} for therapists and clinicians building profitable, sustainable private practices.`
            : "Practical strategies, tools, and insights to help clinicians grow profitable, sustainable practices without burnout."
        }
        // A tag archive is its own indexed URL — 21 of them carry traffic on the
        // live site — so the filter belongs in the canonical rather than being
        // folded back into the unfiltered index.
        canonicalPath={tag ? `/blog?tag=${encodeURIComponent(tag)}` : "/blog"}
      />

      {/* The source index opens straight onto its "BEST OF" collection with no
          hero copy of its own, so the headline is that label and the eyebrow
          and lede are the page's own <title> and meta description rather than
          anything written for the occasion. */}
      <LuxePageHero
        eyebrow="BOSS CLINICIAN BLOG"
        title="BEST OF"
        lede="Practical strategies, tools, and insights to help clinicians grow profitable, sustainable practices without burnout."
        tone="violet"
      />

      {/* ── Filter + lead article ──────────────────────────────────────────
          `base` (bg-night) is required rather than chosen: the page hero fades
          its bottom edge into night, so any other elevation would show a step
          under the handoff. The filter lives in the same band as the article it
          governs — a control stranded in its own section reads as decoration. */}
      <Section
        surface="base"
        space="md"
        aurora="plum"
        auroraIntensity={0.55}
        aria-label="Latest articles"
      >
        <TagFilterRow active={tag} onSelect={setTag} />

        {loading && items.length === 0 ? (
          <p role="status" className="copy-luxe mt-10 text-center">
            Loading articles…
          </p>
        ) : items.length === 0 ? (
          <p role="status" className="copy-luxe mt-10 text-center">
            No articles found for that topic yet.
          </p>
        ) : (
          featured && <FeaturedArticle post={featured} />
        )}
      </Section>

      {/* ── The rest of the archive ─────────────────────────────────────── */}
      {rest.length > 0 && (
        <Section
          surface="raised"
          space="md"
          aurora="violet"
          auroraIntensity={0.35}
          aria-label="More articles"
        >
          <RevealGroup
            as="ul"
            className="mx-auto grid max-w-md list-none grid-cols-1 items-stretch gap-6 sm:max-w-none sm:grid-cols-2 sm:gap-7 lg:grid-cols-3"
          >
            {rest.map((post) => (
              <RevealItem key={post.slug} as="li" className="h-full">
                <BlogCardTile post={post} />
              </RevealItem>
            ))}
          </RevealGroup>
        </Section>
      )}

      <MeetYvette />

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <Section
        surface="deep"
        space="md"
        aurora="mixed"
        auroraIntensity={0.6}
        aria-label="Find the right offer"
      >
        <SectionTitle
          title="Ready to build a practice that actually works for your life?"
          body="Find the right Boss Clinician offer in 2 minutes."
        />

        <div className="mt-10 flex justify-center">
          <LuxeButton
            variant="foil"
            size="lg"
            href={QUIZ_URL}
            {...EXTERNAL}
            className="w-full sm:w-auto"
          >
            Take the Free Quiz →
          </LuxeButton>
        </div>
      </Section>
    </>
  );
}

/* ── Topic filter ─────────────────────────────────────────────────────── */

function TagFilterRow({
  active,
  onSelect,
}: {
  active?: string;
  onSelect: (next?: string) => void;
}) {
  const reduce = useEntranceMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, ease: EASE_LUXE }}
      role="group"
      aria-label="Filter articles by topic"
      // Two decisions in one line. The row scrolls instead of wrapping: twenty
      // topics wrapped build an eight-row wall on a phone and push the articles
      // off the screen. And it bleeds to the container gutter (the negative
      // margins exactly cancel Container's padding at each breakpoint) so a chip
      // clipped by the screen edge does the work of a "there is more" hint.
      // `py-2` keeps focus rings inside the scroll box rather than clipped by it.
      className="-mx-5 overflow-x-auto px-5 py-2 sm:-mx-8 sm:px-8 lg:-mx-12 lg:px-12"
    >
      {/* `w-max` + auto margins: centred while the row fits, and auto margins
          resolve to 0 once it overflows, so nothing is ever scrolled out of
          reach on the left the way `justify-center` would strand it. */}
      <div className="mx-auto flex w-max items-center gap-2.5">
        <TagButton active={!active} label="All Topics" onClick={() => onSelect(undefined)} />
        {allBlogTags.map((t) => (
          <TagButton
            key={t}
            active={active === t}
            label={topicLabel(t)}
            onClick={() => onSelect(t)}
          />
        ))}
      </div>
    </motion.div>
  );
}

function TagButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 py-2.5",
        // 0.7rem (11.2px) is the floor for uppercase micro-type; tracking is
        // eased on phones, where wide letterspacing costs more than it buys.
        "text-[0.7rem] font-semibold uppercase tracking-[0.1em] sm:tracking-[0.16em]",
        "transition-colors duration-300 ease-luxe",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        active
          ? "border-gold/55 bg-gold/[0.13] text-gold shadow-[0_10px_28px_-16px_rgba(201,164,106,0.8)]"
          : "border-white/12 bg-white/[0.045] text-orchid hover:border-gold/35 hover:bg-white/[0.075] hover:text-white",
      )}
    >
      {label}
    </button>
  );
}

/* ── Lead article ─────────────────────────────────────────────────────── */

function FeaturedArticle({ post }: { post: BlogCard }) {
  const reduce = useEntranceMotion();

  return (
    <motion.div {...rise(reduce, 0.05)} className="mt-8 sm:mt-10">
      {/* The Link wraps rather than being GlassCard's `as` — GlassCard does not
          forward arbitrary props, so `to` would be silently dropped. */}
      <Link
        to={`/blog/${post.slug}`}
        className="group block rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
      >
        <GlassCard accent="gold" className="grid overflow-hidden lg:grid-cols-2">
          <CoverPlate
            src={post.coverImage}
            ratio="aspect-[16/10] lg:aspect-auto"
            imgClassName="group-hover:scale-[1.05]"
          />

          <div className="flex flex-col justify-center p-7 sm:p-9 lg:p-10">
            <TopicLine tags={post.tags} />

            <h2 className="mt-4 text-balance font-display text-[1.55rem] font-medium leading-tight text-white sm:text-[1.95rem] lg:text-[2.15rem]">
              {post.title}
            </h2>

            <GoldRule className="mt-6" />

            <p className="copy-luxe mt-6 max-w-[54ch] text-pretty">{post.excerpt}</p>

            <p className="mt-7 inline-flex items-center gap-2.5 self-start text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-gold sm:tracking-[0.16em]">
              {publishedLabel(post.publishedAt)}
              <ReadArrow />
            </p>
          </div>
        </GlassCard>
      </Link>
    </motion.div>
  );
}

/* ── Archive card ─────────────────────────────────────────────────────── */

function BlogCardTile({ post }: { post: BlogCard }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block h-full rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
    >
      <GlassCard accent="neutral" className="flex h-full flex-col overflow-hidden">
        <CoverPlate
          src={post.coverImage}
          ratio="aspect-[16/10]"
          imgClassName="group-hover:scale-[1.06]"
        />

        <div className="flex flex-1 flex-col px-6 pb-6 pt-5 sm:px-7 sm:pb-7">
          <TopicLine tags={post.tags} />

          <h2 className="mt-3 text-pretty font-display text-[1.15rem] font-medium leading-snug text-white">
            {post.title}
          </h2>

          {/* flex-1 here — not on a wrapper — is what bottom-aligns the read
              affordance across cards of unequal headline and excerpt length. */}
          <p className="copy-luxe mt-3 line-clamp-3 flex-1 text-pretty text-sm">{post.excerpt}</p>

          <div aria-hidden className="rule-faint mt-6 w-full" />

          <p className="mt-5 inline-flex items-center gap-2.5 self-start text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-gold sm:tracking-[0.14em]">
            {publishedLabel(post.publishedAt)}
            <ReadArrow />
          </p>
        </div>
      </GlassCard>
    </Link>
  );
}

/**
 * Every topic the source index prints under a headline, in its order. The lead
 * one carries the gold and the rest step back to orchid, so a post filed under
 * five topics still reads as one accent instead of five competing ones.
 */
function TopicLine({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem] font-semibold uppercase leading-tight tracking-[0.1em] sm:tracking-[0.16em]">
      <span aria-hidden className="h-px w-4 shrink-0 bg-gold/45" />
      {tags.map((t, i) => (
        <span key={t} className={cn("min-w-0", i === 0 ? "text-gold" : "text-orchid-dim")}>
          {topicLabel(t)}
        </span>
      ))}
    </p>
  );
}

/* ── Meet Yvette ──────────────────────────────────────────────────────── */

/**
 * The editorial spread the index closes on: a held portrait on one side, the
 * founder's own account running past it on the other. The photograph is sticky
 * at desktop so the person telling the story stays in frame while it scrolls.
 */
function MeetYvette() {
  const reduce = useEntranceMotion();

  return (
    <Section
      surface="base"
      space="md"
      aurora="plum"
      auroraIntensity={0.5}
      aria-label="About Yvette Howard"
    >
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        {/* `self-stretch` overrides the grid's `items-start` for this column
            only: a sticky child needs a containing block taller than itself,
            and a content-sized grid item gives it nowhere to travel. */}
        <div className="lg:self-stretch">
          <div className="lg:sticky lg:top-28">
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={VIEWPORT}
              transition={{ duration: 1.05, ease: EASE_LUXE }}
              className="relative isolate mx-auto w-full max-w-[17rem] sm:max-w-xs lg:max-w-none"
            >
              {/* Plum bloom behind the frame. Without a light source of its own
                  the portrait reads as a rectangle cut out of the page. */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] blur-3xl"
                style={{
                  background:
                    "radial-gradient(62% 55% at 42% 32%, rgba(123,94,167,0.44) 0%, transparent 72%)",
                }}
              />

              <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
                <img
                  src="/images/yvette-hero-portrait.jpg"
                  alt="Yvette Howard private practice consultant and therapist business strategist"
                  width={960}
                  height={1440}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/5] w-full max-w-full object-cover object-top"
                />
              </div>

              {/* Offset crop marks — a printer's registration frame sitting a
                  few pixels outside the photograph, so the eye reads a mounted
                  plate rather than an inline image. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -left-3 -top-3 h-12 w-12 rounded-tl-xl border-l border-t border-gold/45 sm:-left-4 sm:-top-4 sm:h-16 sm:w-16"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-3 -right-3 h-12 w-12 rounded-br-xl border-b border-r border-gold/45 sm:-bottom-4 sm:-right-4 sm:h-16 sm:w-16"
              />
            </motion.div>
          </div>
        </div>

        <div>
          <motion.h2
            {...rise(reduce, 0.05)}
            className="font-display text-[2rem] font-medium leading-[1.1] tracking-[0.02em] text-white sm:text-[2.6rem] lg:text-[3.1rem]"
          >
            MEET YVETTE
          </motion.h2>

          <GoldRule className="mt-7" />

          <div className="mt-8 space-y-6">
            {MEET_YVETTE.map((lines, i) => (
              <motion.p
                key={lines[0]}
                {...rise(reduce, 0.1 + i * 0.03)}
                className="copy-luxe text-pretty"
              >
                {lines.map((line, j) => (
                  <Fragment key={line}>
                    {j > 0 && <br />}
                    {line}
                  </Fragment>
                ))}
              </motion.p>
            ))}
          </div>

          <motion.div {...rise(reduce, 0.3)} className="mt-10">
            <LuxeButton variant="outline" size="lg" to="/about" className="w-full sm:w-auto">
              LEARN MORE ABOUT ME
            </LuxeButton>
          </motion.div>
        </div>
      </div>
    </Section>
  );
}

/* ── Shared parts ─────────────────────────────────────────────────────── */

/**
 * The read affordance, drawn rather than typed: the source card ended on a
 * literal "→" glyph, and an SVG keeps that meaning while giving the arrow room
 * to travel on hover and keyboard focus.
 */
function ReadArrow() {
  return (
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
  );
}

interface CoverPlateProps {
  src: string;
  /** Aspect utility for the frame; the image fills it. */
  ratio: string;
  imgClassName?: string;
}

/**
 * Editorial stock at full brightness on near-black reads as a lit rectangle
 * glued to the page. Three passes seat it instead: the photo is graded down, a
 * violet multiply pulls its whites into the page's plum, and a vignette plus
 * bottom scrim hand it off to the copy underneath.
 */
function CoverPlate({ src, ratio, imgClassName }: CoverPlateProps) {
  return (
    <div className={cn("relative w-full overflow-hidden bg-night-deep", ratio)}>
      <img
        src={src}
        // alt="" as in the source: the headline this photo belongs to sits
        // inches away inside the same link, so naming the picture too would
        // only make a screen reader read the card twice.
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          "h-full w-full max-w-full object-cover brightness-[0.8] contrast-[1.06] saturate-[0.8]",
          "transition-transform duration-700 ease-luxe",
          imgClassName,
        )}
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-glow-violet/40 mix-blend-multiply transition-opacity duration-700 ease-luxe group-hover:opacity-70"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(118%_82%_at_50%_24%,transparent_28%,rgba(10,7,19,0.48)_68%,rgba(6,4,11,0.9)_100%)]"
      />
      <div aria-hidden className="absolute inset-0" style={{ background: COVER_SCRIM }} />
    </div>
  );
}
