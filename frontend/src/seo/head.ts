import { absoluteUrl, organizationNode, personNode, webSiteNode } from "./schema";
import type { HeadDescriptor, JsonLdNode, ResolvedHead } from "./types";

/**
 * Turns a page's `<Seo>` props into the exact set of tags the document should
 * carry, then writes them either as markup (server) or into the live head
 * (browser). Nothing else in the app composes head tags.
 */

/** Matches the `<title>` and description shipped in index.html. */
export const DEFAULT_TITLE = "Boss Clinician | Private Practice Strategist for Therapists";
export const DEFAULT_DESCRIPTION =
  "Yvette Howard, LCSW helps therapists and clinicians break free from Alma, Headway, Talkspace, and similar platforms to build a profitable, sustainable private practice that's actually theirs.";
const DEFAULT_IMAGE = "/images/yvette-hero-portrait.jpg";
const TWITTER_HANDLE = "@bossclinician";
/** Served by the API (routes/public/seo.ts) at the source site's own feed path. */
const FEED_PATH = "/blog.rss";
const FEED_TITLE = "Boss Clinician Blog";

/** Attribute marking a tag this module owns, so it can replace its own work. */
export const MANAGED_ATTR = "data-bc-seo";
/** Attribute on the fallback tags in index.html, dropped once a page speaks. */
export const DEFAULT_ATTR = "data-bc-default";

export interface HeadContext {
  /** Absolute origin, no trailing slash. */
  origin: string;
  /** Path (and query, where it matters) currently being rendered. */
  url: string;
  /**
   * False on hosts that must stay out of the index. Forces `noindex` on every
   * page rather than trusting robots.txt alone — the staging host serves the
   * same content as the live domain, and one indexed copy competes with the
   * other for its own words.
   */
  indexable: boolean;
}

function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** Strips the query so `?utm_source=` cannot mint a second canonical URL. */
function pathOf(url: string): string {
  const [path] = url.split("?");
  return path || "/";
}

export function resolveHead(
  descriptor: HeadDescriptor | undefined,
  context: HeadContext,
): ResolvedHead {
  const { origin, indexable } = context;
  const d = descriptor;

  const title = d?.title ? clamp(d.title, 90) : DEFAULT_TITLE;
  const description = clamp(d?.description || DEFAULT_DESCRIPTION, 300);
  const canonical = `${origin}${d?.canonicalPath ?? pathOf(context.url)}`;
  const image = absoluteUrl(origin, d?.image || DEFAULT_IMAGE);
  const type = d?.type ?? "website";

  const meta: ResolvedHead["meta"] = [
    { name: "description", content: description },
    {
      name: "robots",
      content:
        indexable && !d?.noindex
          ? "index, follow, max-image-preview:large, max-snippet:-1"
          : "noindex, nofollow",
    },

    { property: "og:type", content: type },
    { property: "og:site_name", content: "Boss Clinician" },
    { property: "og:locale", content: "en_US" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: image },

    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: TWITTER_HANDLE },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];

  if (type === "article") {
    if (d?.publishedTime) meta.push({ property: "article:published_time", content: d.publishedTime });
    if (d?.modifiedTime) meta.push({ property: "article:modified_time", content: d.modifiedTime });
    if (d?.author) meta.push({ property: "article:author", content: d.author });
    for (const tag of d?.tags ?? []) meta.push({ property: "article:tag", content: tag });
  }

  // Organization and Person on every page: they are what tie a scattered set of
  // URLs together into one publisher and one named expert, and a knowledge
  // panel is built from the whole site rather than from a single page.
  const jsonLd: JsonLdNode[] = [
    organizationNode(origin),
    personNode(origin),
    webSiteNode(origin),
    ...(d?.jsonLd ?? []),
  ];

  return {
    title,
    meta,
    links: [
      { rel: "canonical", href: canonical },
      // Feed autodiscovery, on every page rather than only under /blog: it is
      // how a reader pointed at the home page finds the feed at all.
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: FEED_TITLE,
        href: `${origin}${FEED_PATH}`,
      },
    ],
    jsonLd,
  };
}

/* ── Server ───────────────────────────────────────────────────────────── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON inside a `<script>` is parsed by the HTML tokenizer first, so a `</` in
 * any string value ends the block early and the rest of the document becomes
 * script text. Escaping the angle bracket keeps the JSON valid and the document
 * intact — blog bodies genuinely contain HTML fragments.
 */
function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderHead(head: ResolvedHead): string {
  const lines: string[] = [`<title ${MANAGED_ATTR}>${escapeHtml(head.title)}</title>`];

  for (const tag of head.meta) {
    const key = tag.name ? `name="${escapeHtml(tag.name)}"` : `property="${escapeHtml(tag.property ?? "")}"`;
    lines.push(`<meta ${MANAGED_ATTR} ${key} content="${escapeHtml(tag.content)}" />`);
  }

  for (const link of head.links) {
    const extra =
      (link.type ? ` type="${escapeHtml(link.type)}"` : "") +
      (link.title ? ` title="${escapeHtml(link.title)}"` : "");
    lines.push(
      `<link ${MANAGED_ATTR} rel="${escapeHtml(link.rel)}"${extra} href="${escapeHtml(link.href)}" />`,
    );
  }

  for (const node of head.jsonLd) {
    const payload = escapeJsonLd({ "@context": "https://schema.org", ...node });
    lines.push(`<script ${MANAGED_ATTR} type="application/ld+json">${payload}</script>`);
  }

  return lines.join("\n    ");
}

/* ── Browser ──────────────────────────────────────────────────────────── */

/**
 * Rewrites the managed part of the head in place.
 *
 * Every managed tag is removed and rebuilt rather than diffed: a page that
 * drops `article:published_time` must not inherit the previous article's, and
 * a dozen tags is far too little work to be worth reconciling.
 */
export function applyHead(head: ResolvedHead): void {
  const { head: headEl } = document;

  // The fallbacks from index.html only exist so a client-rendered boot has a
  // title before React runs. Once a page has spoken they would be duplicates.
  for (const stale of headEl.querySelectorAll(`[${DEFAULT_ATTR}]`)) stale.remove();
  for (const stale of headEl.querySelectorAll(`[${MANAGED_ATTR}]:not(title)`)) stale.remove();

  document.title = head.title;

  const fragment = document.createDocumentFragment();

  for (const tag of head.meta) {
    const el = document.createElement("meta");
    el.setAttribute(MANAGED_ATTR, "");
    if (tag.name) el.setAttribute("name", tag.name);
    else if (tag.property) el.setAttribute("property", tag.property);
    el.setAttribute("content", tag.content);
    fragment.appendChild(el);
  }

  for (const link of head.links) {
    const el = document.createElement("link");
    el.setAttribute(MANAGED_ATTR, "");
    el.setAttribute("rel", link.rel);
    if (link.type) el.setAttribute("type", link.type);
    if (link.title) el.setAttribute("title", link.title);
    el.setAttribute("href", link.href);
    fragment.appendChild(el);
  }

  for (const node of head.jsonLd) {
    const el = document.createElement("script");
    el.setAttribute(MANAGED_ATTR, "");
    el.setAttribute("type", "application/ld+json");
    el.textContent = JSON.stringify({ "@context": "https://schema.org", ...node });
    fragment.appendChild(el);
  }

  headEl.appendChild(fragment);
}
