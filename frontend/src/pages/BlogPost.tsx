import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";
import { Seo } from "@/components/Seo";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxePageHero } from "@/components/luxe/LuxePageHero";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { GoldRule, Section } from "@/components/luxe/Section";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { usePageData } from "@/hooks/usePageData";
import { api } from "@/lib/api";
import { findBlogPostBySlug } from "@/content/blog";
import { articleNode, breadcrumbNode } from "@/seo/schema";
import { ssrKeys } from "@/ssr/keys";
import { useHeadContext } from "@/ssr/context";
import type { BlogPost as BlogPostType } from "@/types";
import NotFound from "@/pages/NotFound";
import { cn } from "@/lib/cn";

const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const VIEWPORT = { once: true, margin: "-12% 0px -8% 0px" } as const;

/** Where the closing card sends the reader. Unchanged from the source page. */
const APPLY_ROUTE = "/apply";
const BLOG_ROUTE = "/blog";

/**
 * The cover has to stop being a rectangle pasted onto the panel: the bottom
 * stop here matches the surface underneath it, so the photograph dissolves into
 * the page instead of ending at a hard edge.
 */
const COVER_SCRIM =
  "linear-gradient(to top, rgba(9,6,17,0.92) 0%, rgba(9,6,17,0.62) 20%, rgba(9,6,17,0.2) 52%, rgba(9,6,17,0) 80%)";

/** One rise recipe for the page; only the delay changes. */
function rise(reduce: boolean | null, delay: number) {
  return {
    initial: reduce ? false : { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: VIEWPORT,
    transition: { duration: 0.8, delay: reduce ? 0 : delay, ease: EASE_LUXE },
  };
}

/** Turns that carry their mark into the *second* clause (the space is eaten). */
const LEADING_TURNS = [" (", " — ", " – "] as const;
/** Turns whose mark stays on the *first* clause (the space is eaten). */
const TRAILING_TURNS = [": ", "? "] as const;

/**
 * Split an article headline at its natural turn so the second clause can be set
 * in foil italic under the first — the same two-part headline every other Luxe
 * page opens with.
 *
 * The split never edits the string: `head + " " + accent` reassembles the exact
 * title it came from, so a dynamic headline can never lose a character. Titles
 * with no turn (or a turn too close to either end to be worth a line break) are
 * set whole.
 */
function splitHeadline(title: string): { head: string; accent?: string } {
  for (const mark of LEADING_TURNS) {
    const at = title.indexOf(mark);
    if (at > 14 && title.length - at > 10) {
      return { head: title.slice(0, at), accent: title.slice(at + 1) };
    }
  }
  for (const mark of TRAILING_TURNS) {
    const at = title.indexOf(mark);
    if (at > 12 && title.length - at > 12) {
      return { head: title.slice(0, at + 1), accent: title.slice(at + 2) };
    }
  }
  return { head: title };
}

/** Rough, and only ever read as the `wordCount` of the article's schema node. */
function countWords(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

export default function BlogPost() {
  const { slug = "" } = useParams();
  const { origin } = useHeadContext();
  const staticEntrance = useEntranceMotion();
  const reduce = useReducedMotion();

  // Reading progress. Tracked against the document rather than a ref'd element:
  // the article does not exist on the first render (the fetch is still in
  // flight), and a target ref that starts null measures nothing.
  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.4,
  });

  const article = usePageData(ssrKeys.blogPost(slug), () => api.blogPost(slug));

  if (article.status === "loading") {
    return (
      <>
        {/* On the server this branch means only one thing: the loader could not
            read the article. Answering 200 would publish the site's default
            title and description under this URL, so the crawler is told the
            page is temporarily unavailable and to come back — a placeholder
            served as a success is how an article's own title is replaced in
            the index by the home page's. */}
        <Seo title="Loading… | Boss Clinician" noindex httpStatus={503} />
        <Section
          surface="deep"
          space="xl"
          aurora="violet"
          auroraIntensity={0.55}
          seam={false}
          aria-label="Loading article"
          containerClassName="flex min-h-[40vh] flex-col items-center justify-center text-center"
        >
          <GoldRule className="mx-auto" />
          <p role="status" className="copy-luxe mt-6">
            Loading article…
          </p>
        </Section>
      </>
    );
  }

  // An unreachable API is not the same as a retired post, but the reader cannot
  // tell and does not care: the bundled copy of the archive is served either
  // way, and only a slug that exists in neither place is a genuine 404.
  const post: BlogPostType | null =
    article.status === "ready" ? article.data : (findBlogPostBySlug(slug) ?? null);

  if (post === null) {
    return <NotFound />;
  }

  const { head, accent } = splitHeadline(post.title);

  return (
    <>
      <Seo
        title={`${post.title} | Boss Clinician`}
        description={post.excerpt}
        type="article"
        image={post.coverImage}
        author={post.author}
        publishedTime={post.publishedAt}
        modifiedTime={post.updatedAt ?? post.publishedAt}
        tags={post.tags}
        jsonLd={[
          articleNode(origin, {
            title: post.title,
            description: post.excerpt,
            slug: post.slug,
            coverImage: post.coverImage,
            author: post.author,
            publishedAt: post.publishedAt,
            updatedAt: post.updatedAt ?? post.publishedAt,
            tags: post.tags,
            wordCount: countWords(post.bodyMd),
          }),
          breadcrumbNode(origin, [
            { name: "Blog", path: BLOG_ROUTE },
            { name: post.title, path: `${BLOG_ROUTE}/${post.slug}` },
          ]),
        ]}
      />

      {/* Reading rail. Sits above the sticky header (z-50) and below the grain
          overlay (z-60), so it reads as the top edge of the page itself. */}
      <motion.div
        aria-hidden
        style={{ scaleX: reduce ? scrollYProgress : smoothProgress }}
        className="fixed inset-x-0 top-0 z-[55] h-[2px] origin-left bg-gold-foil"
      />

      <article>
        <LuxePageHero
          // The post's own topics, verbatim, set as the gold topic rail rather
          // than as a second row of chips under the headline.
          eyebrow={post.tags.length > 0 ? post.tags.join(" · ") : undefined}
          title={head}
          titleAccent={accent}
          tone="violet"
          actions={<ArticleMeta author={post.author} readMinutes={post.readMinutes} />}
          aside={<CoverPlate src={post.coverImage} />}
        />

        {/* ── The article ──────────────────────────────────────────────────
            `base` (bg-night) is required rather than chosen: the page hero
            fades its bottom edge into night, so any other elevation would show
            a step under the handoff. No aurora here — drifting light under a
            column of body text is the one place it costs more than it gives —
            and one entrance reveal for the whole body rather than one per
            paragraph, which would strobe a 9-minute read. */}
        <Section surface="base" space="md" aurora={false}>
          <motion.div {...rise(staticEntrance, 0)} className="mx-auto max-w-[68ch]">
            {/* The body is author-supplied Markdown, so the column has to be
                proof against whatever arrives: words break rather than push the
                page sideways, and a GFM table scrolls inside itself instead of
                widening the document on a 360px screen. */}
            <div className="prose-boss break-words [&_table]:block [&_table]:overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.bodyMd}</ReactMarkdown>
            </div>

            <div aria-hidden className="rule-faint mt-10 w-full" />

            <div className="mt-6">
              <BackToBlog variant="outline" />
            </div>
          </motion.div>
        </Section>
      </article>

      {/* ── Closing offer ──────────────────────────────────────────────────
          `raised` on both sides: it lifts off the article above it and off the
          night-deep footer below, so the last card on the page is the brightest
          thing on it. */}
      <Section
        surface="raised"
        space="lg"
        aurora="gold"
        auroraIntensity={0.6}
        aria-label="Ready for a real strategy?"
      >
        <motion.div {...rise(staticEntrance, 0.05)} className="mx-auto max-w-3xl">
          <GlassCard
            accent="gold"
            interactive={false}
            spotlight={false}
            className="overflow-hidden px-6 py-10 text-center sm:px-12 sm:py-12"
          >
            {/* A pool of foil low behind the card's type, so the closing note
                sits on a horizon of light rather than on flat glass. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-full h-72 w-[min(150%,44rem)] -translate-x-1/2 -translate-y-1/2 blur-2xl"
              style={{
                background:
                  "radial-gradient(ellipse at center, rgba(201,164,106,0.22) 0%, rgba(123,94,167,0.08) 46%, transparent 72%)",
              }}
            />

            <div className="relative">
              <h2 className="text-balance font-display text-[1.7rem] font-medium leading-tight text-white sm:text-[2.2rem]">
                Ready for a real strategy?
              </h2>

              <GoldRule className="mx-auto mt-6" />

              <p className="copy-luxe mx-auto mt-6 max-w-[46ch] text-pretty">
                Need more support building, scaling, or growing your practice? Let's build the
                practice you dreamed of.
              </p>

              <LuxeButton variant="foil" size="lg" to={APPLY_ROUTE} className="mt-8">
                Apply to Work With Yvette
                <Arrow />
              </LuxeButton>
            </div>
          </GlassCard>
        </motion.div>
      </Section>
    </>
  );
}

/* ── Byline ───────────────────────────────────────────────────────────── */

function ArticleMeta({ author, readMinutes }: { author: string; readMinutes: number }) {
  return (
    <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span className="text-sm font-medium text-white/90">{author}</span>
        {/* The source separator was a literal "·"; a foil dot keeps the beat
            without asking the reader to parse punctuation as decoration. */}
        <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-gold/70" />
        <span className="text-sm font-light text-orchid-dim">{readMinutes} min read</span>
      </p>

      <BackToBlog variant="glass" />
    </div>
  );
}

/* ── Exits ────────────────────────────────────────────────────────────── */

/**
 * The source link read "← Back to the blog". The glyph becomes a drawn arrow —
 * the same substitution the archive cards make for their "→" — so it can travel
 * on hover and keyboard focus while the words stay exactly as written.
 */
function BackToBlog({ variant }: { variant: "glass" | "outline" }) {
  return (
    <LuxeButton
      variant={variant}
      size="sm"
      to={BLOG_ROUTE}
      className="min-h-[44px] self-start tracking-[0.1em] sm:self-auto sm:tracking-[0.16em]"
    >
      <Arrow direction="back" />
      Back to the blog
    </LuxeButton>
  );
}

function Arrow({ direction = "forward" }: { direction?: "forward" | "back" }) {
  const back = direction === "back";

  return (
    <svg
      aria-hidden
      viewBox="0 0 20 8"
      fill="none"
      // The flip is a utility, not an inline style: Tailwind composes scale and
      // translate through the same custom properties, so the mirrored arrow can
      // still travel on hover. An inline `transform` would replace both.
      className={cn(
        "h-2 w-5 shrink-0 transition-transform duration-500 ease-luxe",
        back
          ? "-scale-x-100 group-hover:-translate-x-1.5 group-focus-visible:-translate-x-1.5"
          : "group-hover:translate-x-1.5 group-focus-visible:translate-x-1.5",
      )}
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

/* ── Cover ────────────────────────────────────────────────────────────── */

/**
 * Editorial stock at full brightness on near-black reads as a lit rectangle
 * glued to the page. Four passes seat it instead: a plum bloom behind the
 * frame, the photo graded down, a violet multiply that pulls its whites into
 * the page's palette, and a vignette plus scrim that hand it off to the dark.
 */
function CoverPlate({ src }: { src: string }) {
  return (
    <div className="relative isolate mx-auto max-w-md sm:max-w-lg lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] blur-3xl"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 34%, rgba(123,94,167,0.44) 0%, transparent 72%)",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-gold/25 shadow-[0_44px_100px_-36px_rgba(0,0,0,0.95)]">
        <img
          src={src}
          // alt="" as in the source: the headline this photograph belongs to
          // sits inches away in the same header band, so naming the picture
          // would only make a screen reader read the article twice.
          alt=""
          // Deliberately not lazy: on desktop this is the largest element in
          // the first viewport, and deferring it would delay the page's LCP.
          decoding="async"
          className="aspect-[16/10] w-full max-w-full object-cover brightness-[0.8] contrast-[1.06] saturate-[0.8]"
        />
        <div aria-hidden className="absolute inset-0 bg-glow-violet/35 mix-blend-multiply" />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(118%_82%_at_50%_24%,transparent_28%,rgba(10,7,19,0.46)_68%,rgba(6,4,11,0.88)_100%)]"
        />
        <div aria-hidden className="absolute inset-0" style={{ background: COVER_SCRIM }} />
      </div>

      {/* Offset registration marks — a printer's crop frame a few pixels
          outside the plate, so the eye reads a mounted photograph rather than
          an inline image. Kept inside the hero's own gutter at every width. */}
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
