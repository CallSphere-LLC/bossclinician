import { Router } from "express";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";

/**
 * `/sitemap.xml`, `/robots.txt` and `/blog.rss`.
 *
 * The first two previously fell through to the SPA, which answered HTTP 200 with
 * an HTML document. That is worse than a 404: a crawler asked for a sitemap,
 * got a page, and had no way to know the difference. They are served from the
 * backend so they can be generated from what is actually published rather than
 * maintained by hand.
 *
 * `/blog.rss` is the same story one release later: the source site publishes
 * its blog feed at exactly that path, feed readers and a few aggregators hold
 * that URL, and here it answered 200 with an HTML shell — which a feed reader
 * reports as "this feed is broken", not as "this feed has moved".
 *
 * nginx routes these three paths here explicitly — see nginx/site.conf.
 */
export const seoRouter = Router();

/** XML-escapes a URL or title before it goes into the document. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface SitemapEntry {
  loc: string;
  lastmod?: string | null;
  changefreq?: string;
  priority?: string;
}

function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const parts = [`    <loc>${xmlEscape(e.loc)}</loc>`];
      if (e.lastmod) parts.push(`    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>`);
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority) parts.push(`    <priority>${e.priority}</priority>`);
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");

  // The namespace is sitemaps.org, plural. A validator rejects the singular
  // outright, and Search Console reports it as an unparseable file rather than
  // as a wrong namespace, which makes it an annoying thing to diagnose later.
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/** The hand-maintained routes — everything not driven by a database row. */
const STATIC_ROUTES: SitemapEntry[] = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/about", changefreq: "monthly", priority: "0.8" },
  { loc: "/work-with-me", changefreq: "monthly", priority: "0.9" },
  // The two programme sales pages. Same paths as on the source site, where
  // both are indexed.
  { loc: "/club", changefreq: "monthly", priority: "0.9" },
  { loc: "/lounge", changefreq: "monthly", priority: "0.9" },
  { loc: "/courses", changefreq: "weekly", priority: "0.9" },
  { loc: "/store", changefreq: "weekly", priority: "0.8" },
  { loc: "/resources", changefreq: "weekly", priority: "0.7" },
  { loc: "/resource-hub", changefreq: "weekly", priority: "0.7" },
  { loc: "/retreats", changefreq: "monthly", priority: "0.7" },
  { loc: "/blog", changefreq: "daily", priority: "0.8" },
  { loc: "/contact", changefreq: "yearly", priority: "0.5" },
  { loc: "/apply", changefreq: "monthly", priority: "0.7" },
  { loc: "/practice-quiz", changefreq: "monthly", priority: "0.7" },
  { loc: "/practice-reset-planner", changefreq: "monthly", priority: "0.6" },
  { loc: "/terms", changefreq: "yearly", priority: "0.2" },
  { loc: "/privacy-policy", changefreq: "yearly", priority: "0.2" },
  { loc: "/disclaimer", changefreq: "yearly", priority: "0.2" },
  { loc: "/financial-disclaimer", changefreq: "yearly", priority: "0.2" },
];

seoRouter.get(
  "/sitemap.xml",
  asyncHandler(async (_req, res) => {
    const base = env.publicSiteUrl;
    const entries: SitemapEntry[] = STATIC_ROUTES.map((r) => ({ ...r, loc: `${base}${r.loc}` }));

    // Each block is guarded independently: a table that does not exist yet in a
    // half-migrated environment must not take the whole sitemap down, because a
    // 500 here is indistinguishable to a crawler from the site being broken.
    const blocks: { sql: string; map: (row: Record<string, unknown>) => SitemapEntry }[] = [
      {
        sql: `SELECT slug, updated_at FROM blog_posts WHERE published = true ORDER BY published_at DESC NULLS LAST`,
        map: (r) => ({
          loc: `${base}/blog/${r.slug as string}`,
          lastmod: r.updated_at as string,
          changefreq: "monthly",
          priority: "0.7",
        }),
      },
      {
        sql: `SELECT slug, updated_at FROM courses WHERE published = true ORDER BY sort`,
        map: (r) => ({
          loc: `${base}/courses/${r.slug as string}`,
          lastmod: r.updated_at as string,
          changefreq: "monthly",
          priority: "0.8",
        }),
      },
      // Two blocks were removed from here rather than fixed, because there was
      // nothing to fix: they advertised paths the app does not route.
      //
      //  - `pages` was emitted as `/<slug>`. That table holds the *content* of
      //    the hand-built pages — the rows are read by `/api/pages/:slug` to
      //    fill in a page that already has its own route. There is no
      //    `/:slug` route, so every one of those URLs was a 404 with a
      //    priority attached to it.
      //  - `podcasts` was emitted as `/podcasts/<slug>`. `/podcasts` exists,
      //    but only inside the member area behind `RequireMember`, and there
      //    is no per-show route at all.
      //
      // Submitting either is worse than omitting it: a sitemap full of 404s is
      // how a domain loses the crawl budget it needs on the week it changes
      // platforms, which is exactly the week this file matters. If a public
      // podcast page is built later, its block belongs back here — checked
      // against the route table in frontend/src/App.tsx, which is the list of
      // paths that actually resolve.
    ];

    for (const block of blocks) {
      try {
        const result = await pool.query(block.sql);
        for (const row of result.rows) entries.push(block.map(row));
      } catch (err) {
        console.error("[sitemap] skipped a block:", (err as Error).message);
      }
    }

    // Blog tag archives. 21 of these are indexed on the live Kajabi site, so
    // they carry real traffic and have to survive the migration.
    try {
      const tags = await pool.query<{ tag: string }>(
        `SELECT DISTINCT unnest(tags) AS tag FROM blog_posts WHERE published = true ORDER BY 1`
      );
      for (const { tag } of tags.rows) {
        entries.push({
          loc: `${base}/blog?tag=${encodeURIComponent(tag)}`,
          changefreq: "weekly",
          priority: "0.5",
        });
      }
    } catch (err) {
      console.error("[sitemap] skipped tag archives:", (err as Error).message);
    }

    res.type("application/xml");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(renderSitemap(entries));
  })
);

/* ── /blog.rss ─────────────────────────────────────────────────────────── */

// A type alias, not an interface: pg's `QueryResultRow` constraint is an index
// signature, which an interface does not implicitly satisfy.
type FeedRow = {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[] | null;
  author: string;
  published_at: string | Date | null;
  created_at: string | Date;
};

/** How many posts a feed carries. Readers poll; nobody pages an RSS file. */
const FEED_LIMIT = 50;

/** RFC 822, which is what RSS 2.0 specifies and what `toUTCString` produces. */
function rfc822(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
}

function renderFeed(base: string, rows: FeedRow[]): string {
  const items = rows
    .map((row) => {
      const url = `${base}/blog/${encodeURIComponent(row.slug)}`;
      const published = rfc822(row.published_at ?? row.created_at);
      const parts = [
        `      <title>${xmlEscape(row.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        // The permalink is the identity. A reader that has already shown a post
        // must not show it again because its title was edited.
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
      ];
      if (published) parts.push(`      <pubDate>${published}</pubDate>`);
      if (row.excerpt) parts.push(`      <description>${xmlEscape(row.excerpt)}</description>`);
      // RSS 2.0's <author> is an email address, which these rows do not carry;
      // dc:creator is the element for a name.
      if (row.author) parts.push(`      <dc:creator>${xmlEscape(row.author)}</dc:creator>`);
      for (const tag of row.tags ?? []) parts.push(`      <category>${xmlEscape(tag)}</category>`);
      return `    <item>\n${parts.join("\n")}\n    </item>`;
    })
    .join("\n");

  const newest = rfc822(rows[0]?.published_at ?? rows[0]?.created_at);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Boss Clinician Blog</title>
    <link>${xmlEscape(`${base}/blog`)}</link>
    <description>Private practice strategy for therapists and clinicians, from Yvette Howard, LCSW.</description>
    <language>en-us</language>
    <atom:link href="${xmlEscape(`${base}/blog.rss`)}" rel="self" type="application/rss+xml" />${
      newest ? `\n    <lastBuildDate>${newest}</lastBuildDate>` : ""
    }
${items}
  </channel>
</rss>
`;
}

seoRouter.get(
  "/blog.rss",
  asyncHandler(async (_req, res) => {
    // Same rule as the sitemap: a database that cannot be read must not turn the
    // feed into a 500, which a reader treats as the feed being gone. An empty
    // channel is a valid document and the next poll fills it.
    let rows: FeedRow[] = [];
    try {
      const result = await pool.query<FeedRow>(
        `SELECT slug, title, excerpt, tags, author, published_at, created_at
           FROM blog_posts
          WHERE published = true
          ORDER BY published_at DESC NULLS LAST, created_at DESC
          LIMIT $1`,
        [FEED_LIMIT]
      );
      rows = result.rows;
    } catch (err) {
      console.error("[rss] served an empty feed:", (err as Error).message);
    }

    res.type("application/rss+xml");
    res.set("Cache-Control", "public, max-age=900");
    res.send(renderFeed(env.publicSiteUrl, rows));
  })
);

/**
 * Whether crawlers may index this host.
 *
 * Off unless something says otherwise, and either the environment variable or
 * the website settings row can say so. Both are honoured because the switch on
 * the settings screen would otherwise be decorative — it appeared to work and
 * changed nothing, which is the worst possible shape for a control whose entire
 * job is a one-way door at DNS cutover.
 *
 * The default matters here: bossclinician.callsphere.site is a staging host for
 * a rebuild of bossclinician.com, which is live and indexed. Letting a crawler
 * index both puts the staging copy in competition with the real site for its
 * own content.
 */
async function indexingAllowed(): Promise<boolean> {
  if (env.seoAllowIndexing) return true;
  try {
    const res = await pool.query<{ value: { allowIndexing?: unknown } }>(
      `SELECT value FROM settings WHERE key = 'seo'`
    );
    return res.rows[0]?.value?.allowIndexing === true;
  } catch {
    // A settings table that cannot be read must not accidentally open the site
    // to indexing — the default is closed.
    return false;
  }
}

seoRouter.get("/robots.txt", asyncHandler(async (_req, res) => {
  res.type("text/plain");
  res.set("Cache-Control", "public, max-age=3600");

  if (!(await indexingAllowed())) {
    res.send(
      [
        "# Staging host for the bossclinician.com rebuild — deliberately not indexed.",
        "# Flip SEO_ALLOW_INDEXING=true at DNS cutover.",
        "User-agent: *",
        "Disallow: /",
        "",
      ].join("\n")
    );
    return;
  }

  res.send(
    [
      "User-agent: *",
      "Allow: /",
      "",
      "# Private surfaces: nothing here is useful to a crawler and some of it",
      "# is behind a login anyway.",
      "Disallow: /admin",
      "Disallow: /account",
      "Disallow: /library",
      "Disallow: /checkout",
      "Disallow: /login",
      "Disallow: /signup",
      "Disallow: /reset-password",
      "Disallow: /verify-email",
      "Disallow: /host-link",
      "Disallow: /downloads",
      "Disallow: /verify",
      "Disallow: /api/",
      "",
      `Sitemap: ${env.publicSiteUrl}/sitemap.xml`,
      "",
    ].join("\n")
  );
}));
