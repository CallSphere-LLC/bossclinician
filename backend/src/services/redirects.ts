import { pool } from "../db/pool";

/**
 * Redirect resolution and 404 reporting.
 *
 * Delivery is deliberately two-layered:
 *
 *  - `scripts/generate-nginx-redirects.js` writes this table into an nginx map
 *    that is loaded at startup. That is what serves the real 301s to crawlers,
 *    at zero runtime cost and with no dependency on the API being up — a
 *    marketing site that goes down because the app server is restarting is not
 *    an acceptable trade for a lookup.
 *  - This module answers the same question at runtime, so a redirect Yvette
 *    adds in the admin works for a human immediately, before the next nginx
 *    reload picks it up.
 *
 * Both read the same table, so they cannot disagree about intent — only about
 * how recently they were refreshed.
 */

/**
 * Canonical form: lowercase, single leading slash, no trailing slash, no query
 * or fragment. Applied on both write and read so the lookup is one indexed
 * equality test.
 *
 * Kajabi URLs are mixed-case (`/Practice-Protection-Pack`), and a visitor
 * arriving from a five-year-old Instagram bio will not have matched our casing.
 */
export function normalizePath(raw: string): string {
  let path = (raw || "").trim();

  // An absolute URL may arrive from a Referer header or a pasted link.
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // Unparseable: fall through and treat it as a literal path.
    }
  }

  path = path.split("#")[0].split("?")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");

  return path.toLowerCase().slice(0, 2000);
}

export interface ResolvedRedirect {
  toPath: string;
  statusCode: number;
}

/**
 * Looks up a redirect and records the hit.
 *
 * The counter is incremented in the same statement that reads the row, so the
 * "which of these old URLs still get traffic" report is a by-product of serving
 * rather than a second write that could be skipped under load.
 */
export async function resolveRedirect(rawPath: string): Promise<ResolvedRedirect | null> {
  const path = normalizePath(rawPath);
  if (path === "/") return null;

  const res = await pool.query<{ to_path: string; status_code: number }>(
    `UPDATE redirects
        SET hit_count = hit_count + 1, last_hit_at = now()
      WHERE from_path = $1
      RETURNING to_path, status_code`,
    [path]
  );

  const row = res.rows[0];
  if (!row) return null;

  // A redirect onto itself is a loop the browser will refuse. Treat a
  // misconfigured row as "no redirect" rather than serving an error page.
  if (normalizePath(row.to_path) === path) return null;

  return { toPath: row.to_path, statusCode: row.status_code };
}

/**
 * Records a path that matched nothing.
 *
 * This is how the redirect map gets finished: Appendix B lists what the site
 * map knows about, and real traffic finds the rest — old PDFs, email footers,
 * and links from other people's blogs that nobody has an inventory of.
 */
export async function recordNotFound(input: {
  path: string;
  referrer?: string;
  userAgent?: string;
}): Promise<void> {
  const path = normalizePath(input.path);
  if (!path || path === "/") return;

  await pool.query(
    `INSERT INTO not_found_log (path, referrer, user_agent)
     VALUES ($1, $2, $3)
     ON CONFLICT (path) DO UPDATE
       SET hit_count = not_found_log.hit_count + 1,
           last_seen = now(),
           -- Keep the first referrer seen: the later ones are usually internal
           -- navigation to a link that was already broken.
           referrer  = CASE WHEN not_found_log.referrer = ''
                            THEN EXCLUDED.referrer ELSE not_found_log.referrer END`,
    [path, (input.referrer ?? "").slice(0, 2000), (input.userAgent ?? "").slice(0, 500)]
  );
}

export interface RedirectRow {
  id: number;
  fromPath: string;
  toPath: string;
  statusCode: number;
  targetExists: boolean;
  note: string;
  hitCount: number;
  lastHitAt: string | null;
}

export async function listRedirects(): Promise<RedirectRow[]> {
  const res = await pool.query(
    `SELECT id, from_path, to_path, status_code, target_exists, note, hit_count, last_hit_at
       FROM redirects ORDER BY target_exists, hit_count DESC, from_path`
  );
  return res.rows.map((r) => ({
    id: r.id,
    fromPath: r.from_path,
    toPath: r.to_path,
    statusCode: r.status_code,
    targetExists: r.target_exists,
    note: r.note,
    hitCount: r.hit_count,
    lastHitAt: r.last_hit_at,
  }));
}
