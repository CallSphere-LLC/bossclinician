import fs from "node:fs";
import path from "node:path";
import { pool } from "../db/pool";
import { env } from "../config/env";

/**
 * Server-side rendering for the public marketing pages.
 *
 * The React app is built twice: once for the browser (dist/client) and once as
 * a self-contained CommonJS bundle (dist/server/entry-server.cjs) that this
 * process requires. This module owns loading those two artefacts and stitching
 * a finished document together; what to load for a given URL lives in
 * routes/public/render.ts.
 *
 * Every failure path here ends at the untouched index.html. A render that
 * throws must cost the visitor its SEO benefit and nothing else — the page
 * still arrives, and the browser builds it the way it always did.
 */

const HEAD_MARKER = "<!--bc-head-->";
const APP_MARKER = "<!--bc-app-->";

export interface SsrPayload {
  origin: string;
  indexable: boolean;
  data: Record<string, unknown>;
}

interface RenderResult {
  head: string;
  bootstrap: string;
  html: string;
  status: number;
}

/** The surface entry-server.tsx exports. */
interface SsrBundle {
  render(url: string, payload: SsrPayload): Promise<RenderResult>;
  ssrKeys: {
    testimonials(): string;
    courses(): string;
    resources(): string;
    blogList(tag?: string): string;
    blogPost(slug: string): string;
    courseDetail(slug: string): string;
  };
}

/** Both build outputs, side by side, exactly as `vite build` leaves them. */
const distDir = path.resolve(
  process.env.SSR_DIST_DIR ?? path.join(process.cwd(), "..", "frontend", "dist"),
);

let template: string | null | undefined;
let bundle: SsrBundle | null | undefined;

/**
 * index.html with its own title and description removed.
 *
 * Those two tags exist so a client-rendered boot has something in the tab
 * before React runs. A server-rendered document writes its own, and a document
 * carrying two `<title>` elements is one a crawler has to guess about.
 */
function loadTemplate(): string | null {
  if (template !== undefined) return template;

  try {
    const raw = fs.readFileSync(path.join(distDir, "client", "index.html"), "utf8");
    if (!raw.includes(HEAD_MARKER) || !raw.includes(APP_MARKER)) {
      throw new Error("index.html is missing its render markers");
    }
    template = raw
      .replace(/<title\b[^>]*\bdata-bc-default\b[^>]*>[\s\S]*?<\/title>\s*/gi, "")
      .replace(/<meta\b[^>]*\bdata-bc-default\b[^>]*>\s*/gi, "");
  } catch (err) {
    console.error("[ssr] no usable index.html:", (err as Error).message);
    template = null;
  }

  return template;
}

function loadBundle(): SsrBundle | null {
  if (bundle !== undefined) return bundle;

  try {
    // .cjs, not .js — the frontend package.json declares "type": "module", so
    // a .js entry is read as ESM and this require throws. See vite.config.ts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    bundle = require(path.join(distDir, "server", "entry-server.cjs")) as SsrBundle;
  } catch (err) {
    console.error("[ssr] no usable server bundle:", (err as Error).message);
    bundle = null;
  }

  return bundle;
}

/** The key builders from the app itself, so a loader cannot misfile a result. */
export function ssrKeys(): SsrBundle["ssrKeys"] | null {
  return loadBundle()?.ssrKeys ?? null;
}

export interface RenderedPage {
  html: string;
  status: number;
}

/**
 * Whether crawlers may index this host.
 *
 * Mirrors the rule robots.txt is served under (routes/public/seo.ts): off
 * unless the environment or the website settings row says otherwise. Emitting
 * `noindex` as well as disallowing in robots.txt matters because they fail
 * differently — a URL that is merely disallowed can still be indexed from an
 * inbound link, and this host serves the same words as the live domain.
 */
let indexableCache: { value: boolean; at: number } | null = null;
const INDEXABLE_TTL_MS = 60_000;

async function indexingAllowed(): Promise<boolean> {
  if (env.seoAllowIndexing) return true;
  if (indexableCache && Date.now() - indexableCache.at < INDEXABLE_TTL_MS) {
    return indexableCache.value;
  }

  let value = false;
  try {
    const res = await pool.query<{ value: { allowIndexing?: unknown } }>(
      `SELECT value FROM settings WHERE key = 'seo'`,
    );
    value = res.rows[0]?.value?.allowIndexing === true;
  } catch {
    // Unreadable settings must not accidentally open the site to indexing.
    value = false;
  }

  indexableCache = { value, at: Date.now() };
  return value;
}

/**
 * Substitutes the two markers in the shell.
 *
 * The replacements are functions, and that is the whole point. `String.replace`
 * reads `$&`, `` $` ``, `$'` and `$$` inside a *replacement string* as
 * substitution patterns, and both replacements here carry page content: a blog
 * post whose excerpt contains `$'` would expand to everything in index.html
 * after the marker, closing the JSON payload block on the shell's own
 * `</script>` and emitting the rest of the document a second time. A function
 * replacement is inserted verbatim.
 */
export function composeDocument(shell: string, head: string, app: string): string {
  return shell.replace(HEAD_MARKER, () => head).replace(APP_MARKER, () => app);
}

/**
 * Renders one URL into a finished document.
 *
 * Returns the plain SPA shell — HTTP 200, empty root — whenever anything is
 * missing or throws, which is exactly what this host served before.
 */
export async function renderPage(
  url: string,
  data: Record<string, unknown>,
): Promise<RenderedPage | null> {
  const shell = loadTemplate();
  if (!shell) return null;

  const ssr = loadBundle();
  if (!ssr) return { html: shell, status: 200 };

  try {
    const payload: SsrPayload = {
      origin: env.publicSiteUrl,
      indexable: await indexingAllowed(),
      // Round-tripped through JSON before it is rendered from, so the server
      // sees exactly what the browser will. node-postgres hands back a `Date`
      // for a timestamp column and the browser receives an ISO string; render
      // from the one and hydrate from the other and the two documents disagree
      // wherever a date reaches the page.
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
    };
    const result = await ssr.render(url, payload);

    return {
      html: composeDocument(shell, `${result.head}\n    ${result.bootstrap}`, result.html),
      status: result.status,
    };
  } catch (err) {
    // The URL is the visitor's: an argument, never part of the format string (a
    // `%o` in a path would swallow the stack trace), and JSON-quoted so it cannot
    // end the line and start a forged one.
    console.error("[ssr] %s fell back to the client:", JSON.stringify(url), (err as Error).stack);
    return { html: shell, status: 200 };
  }
}
