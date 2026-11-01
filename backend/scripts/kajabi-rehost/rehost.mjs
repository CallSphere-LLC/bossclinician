#!/usr/bin/env node
/**
 * Kajabi closes 23 Nov 2026. Emails and automations that still link a file on Kajabi's
 * storage get a copy on this site, and the link moves to the copy.
 *
 * Migration 188 has already dealt with the images, the mykajabi links and every file
 * the site held. What is left for this script, as of 1 Nov, are the three free guides:
 * Practice Reset Planner (automation 1364), Group Practice Assessment (1365) and
 * Practice Reset Audit (1366). It finds its work by scanning, so anything added since
 * is picked up, and a file it does not recognise is reported rather than guessed at.
 *
 * Where the copy goes: /uploads/kajabi-rehost/<name>-<hash>.<ext>. That is the public
 * S3 media path (objectStorage.ts, served by app.ts), so no frontend rebuild is needed,
 * which frontend/public/downloads would need. The media library lists each copy under
 * the folder "Kajabi rehost". Nothing is ever deleted, here or at Kajabi.
 *
 * Run it inside the backend pod: that is where the S3 identity, the database and the
 * compiled services are. Migration 188 must have run first, or this script will
 * publish the two paid files 188 sends to the buyer's library.
 *
 *   K='sudo -n kubectl -n bossclinician'
 *   P=$($K get pods -o name --field-selector=status.phase=Running | grep boss-app | head -1)
 *   $K exec -i $P -c backend -- node --input-type=module < rehost.mjs                     # dry run
 *   $K exec -i $P -c backend -- env REHOST_COMMIT=1 node --input-type=module < rehost.mjs # real
 *
 * Dry run (default): downloads and verifies, writes nothing, prints the plan.
 * Commit: stores each file, reads it back through the public site, and only then moves
 * the links, one file to one transaction. Safe to run again: a stored copy of the same
 * bytes is reused and a link already moved is not found again.
 *
 * If the pod cannot reach its own public address, REHOST_VERIFY_BASE gives the read-back
 * another one (the links still use the public site).
 *
 * The report is JSON on stdout. Exit code 1 if any file could not be moved.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire("/app/package.json");
const { pool } = require("/app/dist/db/pool.js");
const { mediaStore, readStoredMedia, usesS3Media } = require("/app/dist/services/objectStorage.js");
const { kindFromMime } = require("/app/dist/services/mediaStorage.js");

const COMMIT = process.env.REHOST_COMMIT === "1" || process.argv.includes("--commit");
const SITE = (process.env.REHOST_SITE || "https://www.bossclinician.com").replace(/\/$/, "");
/** Where the read-back goes. Set to the in-cluster address if the pod cannot reach SITE. */
const VERIFY_BASE = (process.env.REHOST_VERIFY_BASE || SITE).replace(/\/$/, "");
const MAX_BYTES = 100 * 1024 * 1024;
const FOLDER = "Kajabi rehost";

/** Downloadable files only. Images and links are migration 188's. */
const FILE_URL =
  /https?:\/\/(?:s3\.amazonaws\.com\/kajabi-storefronts-production|kajabi-storefronts-production\.kajabi-cdn\.com\/kajabi-storefronts-production)\/file-uploads\/[^\s)"'<>]*\/downloads\/[^\s)"'<>]+/g;
/** Whatever else still points at Kajabi, reported so nothing is missed on 23 Nov. */
const ANY_KAJABI = /kajabi-storefronts-production|kajabi-cdn\.com|mykajabi\.com|app\.kajabi\.com/i;

/** Every place content can hold a link, per the 1 Nov scan. Report-only unless it is an email. */
const REPORT_ONLY = [
  ["course_lessons", "id", "coalesce(body_md,'') || ' ' || coalesce(video_url,'') || ' ' || coalesce(audio_url,'') || ' ' || coalesce(attachment_url,'') || ' ' || coalesce(embed_html,'') || ' ' || coalesce(thumbnail_url,'')"],
  ["lesson_files", "id", "storage_path"],
  ["product_files", "id", "storage_path"],
  ["offers", "id", "o::text"],
  ["forms", "id", "o::text"],
  ["products", "id", "o::text"],
  ["pages", "slug", "sections::text"],
];

/** Only types a person downloads, recognised by their first bytes as well as the header. */
const TYPES = [
  { ext: "pdf", mime: "application/pdf", magic: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { ext: "zip", mime: "application/zip", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
];

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/** "4c36ced-f41c-251-bdd4-c8d2b1134e0_The_First_30_Days_Success_Planner_26.pdf" -> a name objectKey accepts. */
function plainName(url) {
  const file = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  const withoutPrefix = file.includes("_") ? file.slice(file.indexOf("_") + 1) : file;
  const stem = withoutPrefix.replace(/(\.[A-Za-z0-9]+)+$/, "");
  return { original: withoutPrefix, stem: stem.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "file" };
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim(), bytes };
}

/** Throws in words if this is not plainly the file: an error page must not become a guide. */
function verify(url, fetched) {
  if (fetched.status !== 200) throw new Error(`HTTP ${fetched.status}`);
  if (fetched.bytes.length === 0) throw new Error("empty file");
  if (fetched.bytes.length > MAX_BYTES) throw new Error(`too large: ${fetched.bytes.length} bytes`);
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
  const type = TYPES.find((candidate) => candidate.ext === ext);
  if (!type) throw new Error(`file type .${ext} is not one this script stores`);
  if (!type.magic(fetched.bytes)) throw new Error(`content is not a .${ext} (server said ${fetched.contentType || "nothing"})`);
  return type;
}

async function findFileLinks() {
  const places = new Map();
  const add = (url, where) => {
    const list = places.get(url) ?? [];
    list.push(where);
    places.set(url, list);
  };
  const emails = await pool.query(`SELECT id, sequence_id, position, body_md FROM sequence_emails WHERE body_md LIKE '%kajabi%'`);
  for (const row of emails.rows) {
    for (const url of row.body_md.match(FILE_URL) ?? []) add(url, `sequence ${row.sequence_id} email ${row.position}`);
  }
  const actions = await pool.query(
    `SELECT id, automation_id, config ->> 'bodyMd' AS body FROM automation_actions
      WHERE action_type = 'send_email' AND config ->> 'bodyMd' LIKE '%kajabi%'`
  );
  for (const row of actions.rows) {
    for (const url of row.body.match(FILE_URL) ?? []) add(url, `automation ${row.automation_id}`);
  }
  return places;
}

async function moveLinks(oldUrl, newUrl, name, type, size) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const emails = await client.query(
      `UPDATE sequence_emails SET body_md = replace(body_md, $1, $2), updated_at = now() WHERE strpos(body_md, $1) > 0`,
      [oldUrl, newUrl]
    );
    const actions = await client.query(
      `UPDATE automation_actions
          SET config = jsonb_set(config, '{bodyMd}', to_jsonb(replace(config ->> 'bodyMd', $1, $2))), updated_at = now()
        WHERE action_type = 'send_email' AND strpos(config ->> 'bodyMd', $1) > 0`,
      [oldUrl, newUrl]
    );
    const url = new URL(newUrl).pathname;
    const known = await client.query(`SELECT 1 FROM media_assets WHERE url = $1 LIMIT 1`, [url]);
    if (!known.rowCount) {
      await client.query(
        `INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title, folder, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [url.split("/").pop(), name.original, url, type.mime, kindFromMime(type.mime), size, name.original, FOLDER, ["kajabi"]]
      );
    }
    await client.query("COMMIT");
    return { emails: emails.rowCount ?? 0, automations: actions.rowCount ?? 0 };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function stillOnKajabi() {
  const out = {};
  const sql = {
    sequence_emails: `SELECT count(*)::int AS n FROM sequence_emails WHERE body_md ~* $1`,
    automation_actions: `SELECT count(*)::int AS n FROM automation_actions WHERE config::text ~* $1`,
  };
  for (const [table, key, column] of REPORT_ONLY) {
    sql[table] = `SELECT count(*)::int AS n FROM ${table} o WHERE (${column}) ~* $1 AND ${key} IS NOT NULL`;
  }
  // History only: nothing re-sends a campaign that has gone out.
  sql.email_campaigns_not_sent = `SELECT count(*)::int AS n FROM email_campaigns WHERE status <> 'sent' AND body_md ~* $1`;
  for (const [name, query] of Object.entries(sql)) {
    const { rows } = await pool.query(query, [ANY_KAJABI.source]);
    if (rows[0].n > 0) out[name] = rows[0].n;
  }
  return out;
}

async function main() {
  if (COMMIT && !usesS3Media()) throw new Error("This pod is not using S3 media storage; nothing done.");
  const report = { mode: COMMIT ? "commit" : "dry-run", site: SITE, files: [], problems: [] };
  const places = await findFileLinks();

  for (const [url, where] of places) {
    const entry = { from: url, usedBy: where };
    report.files.push(entry);
    try {
      const fetched = await fetchBytes(url);
      const type = verify(url, fetched);
      const digest = sha256(fetched.bytes);
      const name = plainName(url);
      // The hash in the name makes it the same address on every run, and a different
      // file under the same Kajabi name can never overwrite this one.
      const reference = `/uploads/kajabi-rehost/${name.stem}-${digest.slice(0, 12)}.${type.ext}`;
      const to = `${SITE}${reference}`;
      Object.assign(entry, { to, bytes: fetched.bytes.length, contentType: fetched.contentType, sha256: digest });

      if (!COMMIT) {
        entry.status = "would move";
        continue;
      }

      const store = mediaStore();
      const existing = await store.head(reference);
      if (existing) {
        const held = await readStoredMedia(reference, MAX_BYTES);
        if (!held || sha256(held) !== digest) throw new Error(`${reference} is already there with different bytes`);
      } else {
        await store.putBuffer(reference, fetched.bytes, type.mime, true);
      }

      // As a customer will reach it. Links only move once this has answered.
      const served = await fetchBytes(`${VERIFY_BASE}${reference}`);
      if (served.status !== 200 || sha256(served.bytes) !== digest) {
        throw new Error(`stored, but ${VERIFY_BASE}${reference} answered ${served.status} or with different bytes; links not moved. If the pod cannot reach the public site, set REHOST_VERIFY_BASE to the in-cluster address and run again.`);
      }

      Object.assign(entry, await moveLinks(url, to, name, type, fetched.bytes.length), { status: "moved" });
    } catch (err) {
      entry.status = "failed";
      entry.error = err instanceof Error ? err.message : String(err);
      report.problems.push(`${url}: ${entry.error}`);
    }
  }

  report.stillOnKajabi = await stillOnKajabi();
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
