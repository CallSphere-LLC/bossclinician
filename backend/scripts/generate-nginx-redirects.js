#!/usr/bin/env node
/**
 * Writes the `redirects` table out as an nginx map.
 *
 * Why a generated file rather than a lookup at request time: these 301s serve
 * the marketing site's crawler traffic, and routing every page view through the
 * API to ask "is this a redirect?" would make the public site unavailable
 * whenever the backend restarts. The map costs nothing at runtime and survives
 * the app being down.
 *
 * The cost is that adding a redirect needs an nginx reload to take effect at
 * the edge. Until then the SPA's runtime fallback (GET /api/redirects/resolve)
 * still sends humans to the right place — see services/redirects.ts.
 *
 *   node scripts/generate-nginx-redirects.js [outfile]
 *   docker compose exec nginx nginx -s reload
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const OUT =
  process.argv[2] || path.join(__dirname, "..", "..", "nginx", "redirects.map");

/** nginx map values are unquoted tokens; quote anything with whitespace. */
function nginxValue(value) {
  return /[\s"']/.test(value) ? JSON.stringify(value) : value;
}

/**
 * site.conf builds the Location header as `https://$host$redirect_target`, so a
 * target that is already absolute would produce `https://host https://other/`.
 * Off-site redirects are not a thing this map supports; catching it here beats
 * discovering it as a broken link after a reload.
 */
function assertRelative(rows) {
  const absolute = rows.filter((r) => !r.to_path.startsWith("/"));
  if (absolute.length > 0) {
    const list = absolute.map((r) => `${r.from_path} -> ${r.to_path}`).join(", ");
    throw new Error(`Redirect targets must be site-relative paths. Offending rows: ${list}`);
  }
}

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/bossclinician";

  const client = new Client({ connectionString });
  await client.connect();

  const { rows } = await client.query(
    `SELECT from_path, to_path, status_code
       FROM redirects
      ORDER BY from_path`
  );
  await client.end();

  assertRelative(rows);

  const permanent = rows.filter((r) => r.status_code === 301 || r.status_code === 308);
  const temporary = rows.filter((r) => r.status_code === 302 || r.status_code === 307);

  const lines = [
    "# GENERATED FILE — do not edit by hand.",
    "# Source: the `redirects` table. Regenerate with:",
    "#   docker compose exec backend node scripts/generate-nginx-redirects.js",
    "#   docker compose exec nginx nginx -s reload",
    `# Generated from ${rows.length} rows.`,
    "",
    "# The podcast episode paths (/podcasts/<show>/episodes/<id>) overflow the",
    "# 64-byte default bucket, and nginx refuses to start rather than truncating.",
    "map_hash_bucket_size 128;",
    "",
    "# Keyed on $uri: nginx has already decoded it and stripped the query string,",
    "# which matches what services/redirects.ts normalizePath() produces.",
    "map $uri $redirect_target {",
    "    default '';",
    ...permanent.map((r) => `    ${nginxValue(r.from_path)} ${nginxValue(r.to_path)};`),
    "}",
    "",
    "map $uri $redirect_target_temp {",
    "    default '';",
    ...temporary.map((r) => `    ${nginxValue(r.from_path)} ${nginxValue(r.to_path)};`),
    "}",
    "",
  ];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");

  console.log(
    `[redirects] wrote ${rows.length} rules (${permanent.length} permanent, ${temporary.length} temporary) to ${OUT}`
  );
}

main().catch((err) => {
  console.error("[redirects] generation failed:", err.message);
  process.exit(1);
});
