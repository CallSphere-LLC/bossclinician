import { Router } from "express";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";

/**
 * `/sitemap.xml` and `/robots.txt`.
 *
 * Both paths previously fell through to the SPA, which answered HTTP 200 with
 * an HTML document. That is worse than a 404: a crawler asked for a sitemap,
 * got a page, and had no way to know the difference. They are served from the
 * backend so they can be generated from what is actually published rather than
 * maintained by hand.
 *
 * nginx routes these two paths here explicitly — see nginx/site.conf.
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/** The hand-maintained routes — everything not driven by a database row. */
const STATIC_ROUTES: SitemapEntry[] = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/about", changefreq: "monthly", priority: "0.8" },
  { loc: "/work-with-me", changefreq: "monthly", priority: "0.9" },
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
      {
        sql: `SELECT slug, updated_at FROM pages ORDER BY slug`,
        map: (r) => ({
          loc: `${base}/${r.slug as string}`,
          lastmod: r.updated_at as string,
          changefreq: "monthly",
          priority: "0.6",
        }),
      },
      {
        sql: `SELECT slug FROM podcasts WHERE published = true`,
        map: (r) => ({
          loc: `${base}/podcasts/${r.slug as string}`,
          changefreq: "weekly",
          priority: "0.7",
        }),
      },
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

/**
 * robots.txt.
 *
 * Indexing is OFF by default and switched on with SEO_ALLOW_INDEXING=true.
 *
 * The reason is specific to this migration: bossclinician.callsphere.site is a
 * staging host for a rebuild of bossclinician.com, which is live and indexed.
 * Letting a crawler index both would put the staging copy in competition with
 * the real site for its own content. The flag flips as part of the DNS cutover,
 * not before.
 */
seoRouter.get("/robots.txt", (_req, res) => {
  res.type("text/plain");
  res.set("Cache-Control", "public, max-age=3600");

  if (!env.seoAllowIndexing) {
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
      "Disallow: /api/",
      "",
      `Sitemap: ${env.publicSiteUrl}/sitemap.xml`,
      "",
    ].join("\n")
  );
});
