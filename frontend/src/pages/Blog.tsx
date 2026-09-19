import { Fragment, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { Seo } from "@/components/Seo";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section, SectionTitle } from "@/components/luxe/Section";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { usePageData } from "@/hooks/usePageData";
import { ssrKeys } from "@/ssr/keys";
import { api } from "@/lib/api";
import { blogCards as fallbackBlogCards } from "@/content/blog";
import type { BlogCard } from "@/types";
import "./blog.css";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/**
 * Internal on purpose. An absolute bossclinician.com link becomes a link to this
 * very app at cutover; the redirect map already sends /offer-quiz here.
 */
const QUIZ_URL = "/practice-quiz";

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
  // `blog_posts.published_at` is nullable — both list queries order by it with
  // NULLS LAST — so a published post can arrive without one.
  if (!iso) return "";
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
  const [searchParams] = useSearchParams();
  const tag = searchParams.get("tag") ?? undefined;

  // Preserve existing indexed topic URLs after removing the topic selector.
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

      <Section surface="base" space="md" seam={false} className="blog-collection" aria-label="Blog articles">
        <div className="blog-heading">
          <h1>BOSS CLINICIAN BLOG</h1>
          {tag && <Link to="/blog" className="blog-reset">All articles <span aria-hidden>↗</span></Link>}
        </div>
        {tag && <p className="blog-archive-label">{topicLabel(tag)}</p>}

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

        {rest.length > 0 && (
          <RevealGroup as="ul" className="blog-grid">
            {rest.map((post) => (
              <RevealItem key={post.slug} as="li" className="h-full">
                <BlogCardTile post={post} />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
      </Section>

      <div className="blog-lower-content">
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
              to={QUIZ_URL}
              className="w-full sm:w-auto"
            >
              Take the Free Quiz →
            </LuxeButton>
          </div>
        </Section>
      </div>
    </>
  );
}

/** Shared card structure keeps the archive and lead article visually consistent. */
function ArticleCard({ post, featured = false }: { post: BlogCard; featured?: boolean }) {
  const category = post.tags.find((tag) => tag !== "boss clinician") ?? post.tags[0];
  // Some source excerpts are a byline; the author already has a dedicated row.
  const excerpt = /^by\s/i.test(post.excerpt.trim()) ? null : post.excerpt;

  return (
    <article className={`blog-card${featured ? " blog-card-featured" : ""}`}>
      <Link to={`/blog/${post.slug}`} className="group blog-card-link" aria-label={`Read article: ${post.title}`}>
        <div className="blog-card-image">
          <img src={post.coverImage ?? undefined} alt="" loading={featured ? "eager" : "lazy"} fetchPriority={featured ? "high" : undefined} decoding="async" />
        </div>
        <div className="blog-card-body">
          <div className="blog-card-meta">
            {category && <span className="blog-category">{topicLabel(category)}</span>}
            {post.readMinutes > 0 && <span className="blog-reading-time">{post.readMinutes} min read</span>}
          </div>
          <h2>{post.title}</h2>
          {excerpt && <p className="blog-card-excerpt">{excerpt}</p>}
          {featured && <p className="blog-card-author">{post.author}</p>}
          <div className="blog-card-footer">
            {post.publishedAt ? (
              <time dateTime={post.publishedAt.slice(0, 10)}>{publishedLabel(post.publishedAt)}</time>
            ) : (
              <span />
            )}
            <span className="blog-read">Read article <ReadArrow /></span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function FeaturedArticle({ post }: { post: BlogCard }) {
  return <ArticleCard post={post} featured />;
}

function BlogCardTile({ post }: { post: BlogCard }) {
  return <ArticleCard post={post} />;
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
