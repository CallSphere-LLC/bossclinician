import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion, useReducedMotion } from "motion/react";
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

  // The API pages the archive (10 per page by default). The first page arrives
  // with the page (SSR); later pages are appended by "Load more articles" and
  // are dropped whenever the topic changes.
  const [extra, setExtra] = useState<BlogCard[]>([]);
  const [nextPage, setNextPage] = useState(2);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  useEffect(() => {
    setExtra([]);
    setNextPage(2);
    setMoreError(false);
  }, [tag]);

  const items = useMemo(() => {
    // The bundled archive stands in whenever the API is unreachable, so the
    // page still lists articles rather than reading as empty.
    const all = list.status === "ready" ? [...list.data.items, ...extra] : fallbackBlogCards();
    const seen = new Set<string>();
    const unique = all.filter((post) => (seen.has(post.slug) ? false : (seen.add(post.slug), true)));
    if (!tag) return unique;
    return unique.filter((post) => post.tags.includes(tag));
  }, [list, extra, tag]);

  const total = list.status === "ready" ? list.data.total : 0;
  const loadedCount = list.status === "ready" ? list.data.items.length + extra.length : 0;
  const hasMore = list.status === "ready" && loadedCount < total;

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await api.blogList({ tag, page: nextPage });
      setExtra((previous) => [...previous, ...page.items]);
      setNextPage((n) => n + 1);
      // A page that comes back empty means the count moved under us; stop
      // offering more rather than looping on the same request.
      if (page.items.length === 0) setNextPage(Number.POSITIVE_INFINITY);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

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

      <JournalHero />

      <Section surface="base" space="md" seam={false} className="blog-collection" aria-label="Blog articles">
        {/* A topic archive names its topic above the articles it filtered, with
            the way back to the whole journal beside it. The hero stays the same
            on every archive: it is the journal's masthead, not the topic's. */}
        {tag && (
          <div className="blog-heading">
            <p className="blog-archive-label">
              <span className="blog-archive-eyebrow">Topic</span>
              {topicLabel(tag)}
            </p>
            <Link to="/blog" className="blog-reset">All articles <span aria-hidden>↗</span></Link>
          </div>
        )}

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

        {hasMore && Number.isFinite(nextPage) && (
          <div className="mt-12 flex flex-col items-center gap-3">
            <LuxeButton
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              aria-busy={loadingMore}
              className="w-full sm:w-auto"
            >
              {loadingMore ? "Loading…" : "Load more articles"}
            </LuxeButton>
            <p className="copy-luxe text-sm" aria-live="polite">
              {moreError
                ? "Those articles didn’t load. Please try again."
                : `Showing ${loadedCount} of ${total} articles`}
            </p>
          </div>
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

/* ── Journal masthead ─────────────────────────────────────────────────── */

/**
 * The live site opens its blog on a looping clip of a woman reading a tablet in
 * a warm, lamp-lit office (Wistia 0f2z9y2psc, 1280x720), with the words and a
 * slate tint band burned into every frame. This is a frame of that clip with
 * both lifted out: the lettering masked by its temporal minimum (the camera
 * pans, the text does not) and inpainted, the band's blend inverted. The words
 * are then real text: one h1 for the page, in the site's own type.
 */
const JOURNAL_PHOTO = {
  src: "/images/blog/journal-hero.webp",
  width: 1280,
  height: 720,
} as const;

/**
 * The same clip, playing, as it does on the live site. Cleaned the same way as
 * the still: the burned-in words (the source spells them "CLINICAN JORNAL")
 * masked by their temporal minimum and inpainted on every frame, and the slate
 * band over the lower half unblended, so the real h1 below is the only text in
 * the band. 17.9s loop, H.264 High, no audio, faststart, 30fps — the Club
 * band's recipe. The source is 720p, so there is no 1080p file.
 */
const JOURNAL_VIDEO = {
  src720: "/videos/blog-journal-hero-720.mp4",
  src540: "/videos/blog-journal-hero-540.mp4",
} as const;

/** Phones get the 540p file, as on the Club's video band. */
const PHONE_QUERY = "(max-width: 767px)";

/** `navigator.connection` is not in lib.dom; only the one field read here is declared. */
type ConnectionNavigator = Navigator & { connection?: { saveData?: boolean } };

/**
 * The hero's footage, layered over the still rather than replacing it: the
 * server render and the first client render are the photograph alone (no
 * `src`, nothing that reads `window`), so the LCP image and the measured
 * contrast below are untouched. Once mounted, the clip loads and fades in over
 * the still on its first painted frame — never a blank flash.
 *
 * Reduced motion and Save-Data keep the still: no `src` is ever set. Reduced
 * motion is read with `useReducedMotion()`, not `useEntranceMotion()`, which
 * answers `true` for the whole life of a server-rendered component and would
 * mean the clip never plays on this (server-rendered) page.
 */
function useJournalVideo() {
  const prefersReduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string>();
  // Pause while the hero is scrolled away; the visitor's own pause is separate
  // so scrolling back never overrules it.
  const [inView, setInView] = useState(true);
  const [userPaused, setUserPaused] = useState(false);
  // What the element is actually doing — autoplay can be refused (iOS Low
  // Power Mode), and the button has to describe the truth, not the intent.
  const [playing, setPlaying] = useState(false);
  // Stays true once the first frame has painted, so a pause holds the frame
  // instead of cutting back to the still.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (prefersReduced) {
      setSrc(undefined);
      setShown(false);
      return;
    }
    if ((navigator as ConnectionNavigator).connection?.saveData) return;
    setSrc(window.matchMedia(PHONE_QUERY).matches ? JOURNAL_VIDEO.src540 : JOURNAL_VIDEO.src720);
  }, [prefersReduced]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setInView(entry.isIntersecting);
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (inView && !userPaused && !prefersReduced) {
      // React does not reliably serialise `muted` to the attribute, and an
      // element the browser believes has sound is refused autoplay.
      video.muted = true;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [src, inView, userPaused, prefersReduced]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setUserPaused(false);
      // Also called here: when autoplay was refused the state does not change,
      // and only a call inside the gesture is allowed to start it.
      video.muted = true;
      video.play().catch(() => {});
    } else {
      setUserPaused(true);
      video.pause();
    }
  };

  return { videoRef, src, playing, setPlaying, shown, setShown, toggle };
}

function JournalHero() {
  const reduce = useEntranceMotion();
  const video = useJournalVideo();

  return (
    <Section
      surface="deep"
      seam={false}
      aria-label="Welcome to the Boss Clinician Journal"
      className="flex min-h-[27rem] items-center py-20 sm:min-h-[30rem] sm:py-24 lg:min-h-[34rem] lg:py-28 2xl:min-h-[38rem] 2xl:py-28 short:py-16"
      containerClassName="w-full max-w-6xl"
      // The band is dark in both themes, so the veils stay veils and the type
      // over them stays white when the site is in its light theme.
      data-media-surface
      backdrop={
        <>
          {/* Her face sits a little above centre in the frame; the `y` bias
              keeps it in view when a phone crops the wide frame to a column. */}
          <img
            src={JOURNAL_PHOTO.src}
            alt=""
            aria-hidden
            width={JOURNAL_PHOTO.width}
            height={JOURNAL_PHOTO.height}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="pointer-events-none absolute inset-0 size-full object-cover object-[center_40%]"
          />
          {/* The footage, over the still. Same crop as the photograph, so the
              fade-in on the first painted frame does not shift anything. */}
          <video
            ref={video.videoRef}
            src={video.src}
            poster={JOURNAL_PHOTO.src}
            muted
            loop
            playsInline
            preload="none"
            disablePictureInPicture
            disableRemotePlayback
            aria-hidden
            tabIndex={-1}
            onPlaying={() => {
              video.setPlaying(true);
              video.setShown(true);
            }}
            onPause={() => video.setPlaying(false)}
            className={`pointer-events-none absolute inset-0 size-full object-cover object-[center_40%] transition-opacity duration-700 ease-out motion-reduce:transition-none ${
              video.shown && video.src ? "opacity-100" : "opacity-0"
            }`}
          />
          {/* Two token-based veils, as on the Club's closing band. The flat one
              calms the whole frame; the second is the source's own dark band
              behind the words, widened to the full text block and softened at
              both edges. Measured against the brightest pixel behind each
              line (390 to 1440 wide, both themes), the title holds 4.1:1 or
              more (large text, AA is 3:1) and the eyebrow and subtitle 4.6:1
              or more (AA is 4.5:1); the lamp at tablet width is the tightest.
              Lighten these only with a re-measure. */}
          <div aria-hidden className="absolute inset-0 bg-night-deep/20" />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-night-deep/10 via-night-deep/60 to-night-deep/35"
          />
          {/* WCAG 2.2.2: motion that starts by itself and runs past five
              seconds needs a way to stop it. Absent when there is nothing to
              stop. Above the veils and the content layer (z-[1]). */}
          {video.src && (
            <button
              type="button"
              onClick={video.toggle}
              aria-label={video.playing ? "Pause background video" : "Play background video"}
              className="absolute bottom-4 right-4 z-[2] inline-flex items-center gap-2 rounded-full border border-white/12 bg-night-deep/55 px-3.5 py-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-white/80 backdrop-blur transition-colors hover:bg-night-deep/80 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:bottom-5 sm:right-6"
            >
              <svg aria-hidden viewBox="0 0 12 12" className="size-2.5 fill-current">
                {video.playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1v10l8-5z" />}
              </svg>
              {video.playing ? "Pause" : "Play"}
            </button>
          )}
        </>
      }
    >
      <div className="text-center">
        {/* The source's eyebrow is nearly half the height of its title, so
            this one is set larger than the site's section eyebrows. Bright
            foil is a literal on purpose: on the light theme, the media-surface
            rules repaint every `text-gold*` class and `.eyebrow-luxe` to the
            deeper foil, which would drop this line under 4.5:1. */}
        <motion.p
          {...rise(reduce, 0)}
          className="text-[0.8rem] font-semibold uppercase tracking-[0.28em] text-[#E8CE9A] sm:text-[0.95rem] sm:tracking-[0.32em] lg:text-[1.05rem]"
        >
          Welcome to the
        </motion.p>
        <motion.h1
          {...rise(reduce, 0.08)}
          className="mt-4 text-balance font-display text-[2.35rem] font-medium uppercase leading-[1.05] tracking-[0.02em] text-white min-[400px]:text-[2.6rem] sm:mt-5 sm:text-[3.4rem] lg:text-[4rem] xl:text-[4.5rem] 2xl:text-[5rem]"
        >
          Boss Clinician Journal
        </motion.h1>
        <motion.div {...rise(reduce, 0.14)}>
          <GoldRule className="mx-auto mt-6 sm:mt-8" />
        </motion.div>
        <motion.p
          {...rise(reduce, 0.2)}
          className="mx-auto mt-6 max-w-3xl text-balance text-[1rem] font-medium leading-[1.7] text-white sm:mt-8 sm:text-[1.15rem] lg:max-w-[62rem] lg:text-[1.3rem]"
        >
          Your space for private practice strategy, sustainable growth, business
          clarity, and the kind of big-sister advice from a therapist who’s been
          where you are.
        </motion.p>
      </div>
    </Section>
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
