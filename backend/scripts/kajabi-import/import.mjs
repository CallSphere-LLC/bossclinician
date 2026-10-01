#!/usr/bin/env node
/**
 * Kajabi course content -> Boss Clinician curriculum.
 *
 * Reads the browser export (/var/tmp/kajabi-export/kajabi-export.json) and the
 * media the parent already fetched into /var/tmp/kajabi-export/files (indexed by
 * manifest.json: original URL -> relative path). Nothing is downloaded from
 * Kajabi or S3 here.
 *
 *   products   -> matched to our products by normalized title (or product-map.json)
 *   categories -> course_modules (sub-modules flattened in after their parent)
 *   posts      -> course_lessons (body HTML converted to Markdown)
 *   videos     -> protected:<file> in course_lessons.video_url
 *   downloads  -> lesson_files rows (protected:<file>)
 *   images     -> /uploads/<file> (lesson thumbnails, module posters, body images)
 *
 * Every file it places gets a media_assets row (folder "Kajabi import"), the
 * same shape the admin upload route writes (routes/admin/media.ts).
 *
 * Idempotent: modules, lessons and lesson files are upserted by kajabi_id
 * (migration 094); stored filenames are derived from the source URL, so a rerun
 * finds the files it already placed. Never touches access grants, offers,
 * enrollments, or anything that sends email.
 *
 * Usage (on server-64gbRam; sudo because the upload volumes live under the
 * root-only /var/lib/docker):
 *
 *   sudo systemd-run --scope -p MemoryMax=2G /usr/bin/node \
 *     ~/bc-sheet-1001/backend/scripts/kajabi-import/import.mjs --dry-run
 *
 * Flags:
 *   --dry-run                 plan only: no DB writes (read-only transaction), no file writes
 *   --product <id|title>      only this Kajabi product (repeatable)
 *   --media-only              place files into the upload volumes only, no DB writes
 *   --db-only                 skip copying files (uses whatever is already placed)
 *   --link                    hard-link instead of copy when source and volume share a filesystem
 *                             (they do not on server-64gbRam: the volumes are on /dev/mapper/pgdata,
 *                             /var/tmp on /dev/md3, so this falls back to copying)
 *   --prefer-kajabi-video     replace a video an adopted lesson already has
 *   --keep-placeholders       never delete non-Kajabi lessons, even obvious test ones
 *   --with-drip               copy Kajabi category dripDays onto modules (off by default)
 *   --downloads               also import Kajabi "Downloads" products (kajabi-downloads.local.json) into product_files
 *   --downloads-only          only the Downloads products, no courses
 *   --no-convert-downloads    leave a course-kind product with no curriculum alone instead of converting it to
 *                             kind 'download' (as migration 051 did) when Kajabi sells it as a Downloads product
 *   --verbose                 print every lesson in the plan
 *
 * Schema: a real run applies migration 094 (idempotent ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
 * EXISTS) itself when its columns are missing, so it works against the schema in production today; the
 * later deploy then records 094 in schema_migrations as a no-op.
 *
 * Env:
 *   DATABASE_URL              default: built from DB_PASSWORD in /opt/bossclinician/.env via the db-bridge (10.42.0.1:15432)
 *   KAJABI_EXPORT_DIR         default /var/tmp/kajabi-export
 *   UPLOAD_DIR                default /var/lib/docker/volumes/bossclinician_uploads_data/_data
 *   PROTECTED_UPLOAD_DIR      default /var/lib/docker/volumes/bossclinician_protected_uploads_data/_data
 *   FILE_UID / FILE_GID       owner for placed files when run as root (default 1000:1000, the backend's uid)
 *   MIN_FREE_GB               refuse to place more files below this much free disk (default 15)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { htmlToMarkdown } from "./html-to-md.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ config -- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const multi = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));

const DRY = flag("--dry-run");
const MEDIA_ONLY = flag("--media-only");
const DB_ONLY = flag("--db-only");
const LINK = flag("--link");
const PREFER_KAJABI_VIDEO = flag("--prefer-kajabi-video");
const KEEP_PLACEHOLDERS = flag("--keep-placeholders");
const WITH_DRIP = flag("--with-drip");
const VERBOSE = flag("--verbose");
const ONLY = multi("--product");
const DOWNLOADS = flag("--downloads") || flag("--downloads-only");
const COURSES = !flag("--downloads-only");
const CONVERT_DOWNLOADS = !flag("--no-convert-downloads");

const EXPORT_DIR = process.env.KAJABI_EXPORT_DIR || "/var/tmp/kajabi-export";
const EXPORT_FILE = path.join(EXPORT_DIR, "kajabi-export.json");
const MANIFEST_FILE = path.join(EXPORT_DIR, "manifest.json");
const FILES_DIR = path.join(EXPORT_DIR, "files");
const LOG_FILE = path.join(EXPORT_DIR, DRY ? "import-dry-run.log" : "import.log");
const PLAN_FILE = path.join(EXPORT_DIR, "import-plan.json");
const MAP_FILE = path.join(HERE, "product-map.json");
const DOWNLOADS_FILE = path.join(EXPORT_DIR, "kajabi-downloads.local.json");
const SCHEMA_FILE = path.resolve(HERE, "../../src/db/migrations/094_kajabi_course_import.sql");
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/var/lib/docker/volumes/bossclinician_uploads_data/_data";
const PROTECTED_DIR =
  process.env.PROTECTED_UPLOAD_DIR || "/var/lib/docker/volumes/bossclinician_protected_uploads_data/_data";
const FILE_UID = Number(process.env.FILE_UID || 1000);
const FILE_GID = Number(process.env.FILE_GID || 1000);
const MIN_FREE_BYTES = Number(process.env.MIN_FREE_GB || 15) * 1024 ** 3;
const MEDIA_FOLDER = "Kajabi import";

/* --------------------------------------------------------------------- log -- */

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
function log(...parts) {
  const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  console.log(line);
  logStream.write(`${new Date().toISOString()} ${line}\n`);
}
const warnings = [];
function warn(msg) {
  warnings.push(msg);
  log(`WARN ${msg}`);
}

/* --------------------------------------------------------------- helpers -- */

const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/** Ported verbatim from backend/src/routes/admin/curriculum.ts. */
function lessonSlug(title) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "lesson"
  );
}
function nextLessonSlug(base, taken) {
  const prefix = `${base}-`;
  let highest = 0;
  for (const slug of taken) {
    if (slug === base) highest = Math.max(highest, 1);
    else if (slug.startsWith(prefix) && /^\d+$/.test(slug.slice(prefix.length))) {
      highest = Math.max(highest, Number(slug.slice(prefix.length)));
    }
  }
  return highest === 0 ? base : `${base}-${highest + 1}`;
}

const stripQuery = (url) => String(url || "").replace(/&amp;/g, "&").split("?")[0].split("#")[0];

/** Mirrors EXT_TO_MIME in backend/src/services/mediaStorage.ts (+ .vtt for captions). */
const EXT_TO_MIME = new Map([
  [".mp4", "video/mp4"], [".m4v", "video/x-m4v"], [".webm", "video/webm"], [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"], [".m4a", "audio/mp4"], [".wav", "audio/wav"], [".ogg", "audio/ogg"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
  [".gif", "image/gif"], [".avif", "image/avif"], [".pdf", "application/pdf"], [".csv", "text/csv"],
  [".txt", "text/plain"], [".zip", "application/zip"], [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);
function kindFromMime(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/zip") return "file";
  return "document";
}

const KAJABI_HOST = /(^|\.)(kajabi-cdn\.com|kajabi\.com|wistia\.com|wistia\.net)$/i;
function isKajabiHosted(url) {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    if (KAJABI_HOST.test(u.host)) return true;
    if (/amazonaws\.com$/i.test(u.host) && /kajabi/i.test(u.host + u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

const gb = (n) => `${(n / 1024 ** 3).toFixed(2)} GB`;
const mb = (n) => `${(n / 1024 ** 2).toFixed(1)} MB`;

/* ------------------------------------------------------------ media index -- */

/**
 * One placed file per source URL (query stripped). The stored name is derived
 * from the URL so a rerun recognizes what it already placed; the extension is
 * the source's, and only whitelisted ones are placed (the same rule the upload
 * route applies, so nothing here can land as served HTML/SVG).
 */
class Media {
  constructor(manifest) {
    this.byUrl = new Map();
    for (const [url, rel] of Object.entries(manifest)) this.byUrl.set(stripQuery(url), rel);
    this.items = new Map(); // key -> item
  }

  /** Register a use of `url`; returns the item or null when there is no local copy. */
  want(url, { visibility, originalName, title, purpose }) {
    const key = stripQuery(url);
    if (!key) return null;
    const existing = this.items.get(key);
    if (existing) {
      if (visibility === "protected") existing.visibility = "protected"; // stricter use wins
      existing.uses.push(purpose);
      return existing;
    }
    const rel = this.byUrl.get(key);
    if (!rel) {
      warn(`no local copy for ${purpose}: ${key}`);
      return null;
    }
    return this.wantFile(key, rel, { visibility, originalName, title, purpose });
  }

  /** Register a file already on disk under FILES_DIR, identified by `key`. */
  wantFile(key, rel, { visibility, originalName, title, purpose }) {
    const existing = this.items.get(key);
    if (existing) {
      if (visibility === "protected") existing.visibility = "protected";
      existing.uses.push(purpose);
      return existing;
    }
    const source = path.join(FILES_DIR, rel);
    let size = 0;
    try {
      size = fs.statSync(source).size;
    } catch {
      warn(`manifest names ${rel} but the file is missing (${purpose})`);
      return null;
    }
    if (size === 0) {
      warn(`local copy is empty: ${rel} (${purpose})`);
      return null;
    }
    let ext = path.extname(rel).toLowerCase();
    if (ext === ".jfif" || ext === ".jpe") ext = ".jpg"; // JPEG under another name
    if (!EXT_TO_MIME.has(ext)) {
      warn(`extension ${ext || "(none)"} not allowed, skipping ${rel} (${purpose})`);
      return null;
    }
    // QuickTime (.mov) does not play in Chrome/Firefox as video/quicktime, and two
    // of Kajabi's originals are HEVC, which most desktop browsers cannot decode.
    // Those are stored as .mp4: remuxed when H.264, re-encoded when not.
    let convert = null;
    if (ext === ".mov" || ext === ".m4v") {
      convert = videoCodec(source) === "h264" ? "remux" : "transcode";
      ext = ".mp4";
    } else if (ext === ".mp4" && videoCodec(source) === "hevc") {
      convert = "transcode";
    }
    const mime = EXT_TO_MIME.get(ext);
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 20);
    const item = {
      key,
      rel,
      source,
      size,
      ext,
      mime,
      kind: kindFromMime(mime),
      visibility,
      filename: `kajabi-${hash}${ext}`,
      originalName: originalName || path.basename(rel),
      title: title || originalName || path.basename(rel),
      uses: [purpose],
      placed: false,
      duration: 0,
      convert,
    };
    this.items.set(key, item);
    return item;
  }

  ref(item) {
    return item.visibility === "protected" ? `protected:${item.filename}` : `/uploads/${item.filename}`;
  }
  dest(item) {
    return path.join(item.visibility === "protected" ? PROTECTED_DIR : UPLOAD_DIR, item.filename);
  }
}

function videoCodec(file) {
  try {
    return execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], {
      encoding: "utf8",
      timeout: 60_000,
    }).trim();
  } catch {
    return "";
  }
}

function probeDuration(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8", timeout: 60_000 },
    );
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) ? Math.round(seconds) : 0;
  } catch {
    return 0;
  }
}

function placeFiles(media) {
  const items = [...media.items.values()];
  const total = items.reduce((a, i) => a + i.size, 0);
  log(`media: ${items.length} files, ${gb(total)} (${LINK ? "hard-link" : "copy"} into the upload volumes)`);
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  let placed = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    const dest = media.dest(item);
    try {
      const st = fs.statSync(dest);
      // A converted file has its own size; it only ever appears by rename, so
      // being there at all means it is complete.
      if (item.convert ? st.size > 0 : st.size === item.size) {
        if (item.convert) item.size = st.size;
        item.placed = true;
        skipped++;
        continue;
      }
    } catch {
      /* not there yet */
    }
    if (DRY) continue;
    if (freeBytes(path.dirname(dest)) - item.size < MIN_FREE_BYTES) {
      warn(`disk floor reached (${gb(freeBytes(path.dirname(dest)))} free); not placing ${item.rel} or anything after it`);
      failed += items.length - placed - skipped - failed;
      break;
    }
    const partsDir = path.join(path.dirname(dest), ".parts");
    fs.mkdirSync(partsDir, { recursive: true });
    const part = path.join(partsDir, `${item.filename}.part`);
    try {
      fs.rmSync(part, { force: true });
      let linked = false;
      if (LINK && !item.convert) {
        try { fs.linkSync(item.source, part); linked = true; } catch (err) { if (err.code !== "EXDEV") throw err; }
      }
      if (item.convert) {
        const codec = item.convert === "remux" ? ["-c", "copy"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"];
        log(`media: ${item.convert} ${item.rel} -> mp4`);
        execFileSync("nice", ["-n", "15", "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", item.source, "-map", "0:v:0", "-map", "0:a?", ...codec, "-threads", "2", "-movflags", "+faststart", "-f", "mp4", part], { stdio: ["ignore", "ignore", "pipe"], timeout: 3 * 3600_000 });
        item.size = fs.statSync(part).size;
        if (!item.size) throw new Error("ffmpeg produced an empty file");
      } else {
        if (!linked) fs.copyFileSync(item.source, part);
        if (fs.statSync(part).size !== item.size) throw new Error("size mismatch after copy");
      }
      if (asRoot) fs.chownSync(part, FILE_UID, FILE_GID);
      fs.chmodSync(part, item.visibility === "protected" ? 0o640 : 0o644);
      fs.renameSync(part, dest);
      item.placed = true;
      placed++;
      if (placed % 25 === 0) log(`media: placed ${placed}/${items.length}`);
    } catch (err) {
      failed++;
      fs.rmSync(part, { force: true });
      warn(`could not place ${item.rel}: ${err.message}`);
    }
  }
  for (const item of items) {
    if (item.kind === "video" && (item.placed || DRY)) item.duration = probeDuration(item.placed ? media.dest(item) : item.source);
  }
  log(`media: placed ${placed}, already present ${skipped}, failed ${failed}${DRY ? " (dry run: nothing written)" : ""}`);
  return { total, placed, skipped, failed };
}

/* ---------------------------------------------------------------- planning -- */

function categoryPublished(cat, byId) {
  // "locked" is Kajabi's "published, opens after a condition" — still content.
  const ok = (c) => c && !c.isHidden && (c.publishing?.status ?? "published") !== "draft";
  if (!ok(cat)) return false;
  if (cat.parentId) return ok(byId.get(cat.parentId)) || !byId.get(cat.parentId);
  return true;
}

function planProduct(product, media) {
  const byId = new Map(product.categories.map((c) => [c.id, c]));
  const postsByCat = new Map();
  for (const post of product.posts) {
    if (!postsByCat.has(post.categoryId)) postsByCat.set(post.categoryId, []);
    postsByCat.get(post.categoryId).push(post);
  }
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id));
  const tops = product.categories.filter((c) => !c.parentId || !byId.has(c.parentId)).sort(byPos);
  const ordered = [];
  for (const top of tops) {
    ordered.push(top);
    for (const sub of product.categories.filter((c) => c.parentId === top.id).sort(byPos)) ordered.push(sub);
  }

  const modules = [];
  const skippedModules = [];
  const subsWithPosts = (id) => product.categories.some((c) => c.parentId === id && (postsByCat.get(c.id) || []).length);
  for (const cat of ordered) {
    const posts = (postsByCat.get(cat.id) || []).slice().sort(byPos);
    if (!posts.length && !(cat.parentId == null && subsWithPosts(cat.id))) {
      skippedModules.push(`${cat.title} (${cat.publishing?.status}${cat.isHidden ? ", hidden" : ""}, no lessons)`);
      continue;
    }
    const published = categoryPublished(cat, byId);
    let imageUrl = "";
    if (cat.posterImageUrl) {
      const item = media.want(cat.posterImageUrl, { visibility: "public", purpose: `module poster "${cat.title}"` });
      if (item) imageUrl = media.ref(item);
    }
    const mod = {
      kajabiId: String(cat.id),
      kajabiParentId: cat.parentId && byId.has(cat.parentId) ? String(cat.parentId) : null,
      title: cat.title.trim(),
      summary: cat.description ? htmlToMarkdown(cat.description) : "",
      imageUrl,
      published,
      status: cat.publishing?.status,
      dripDays: WITH_DRIP && Number.isInteger(cat.dripDays) && cat.dripDays >= 0 ? cat.dripDays : null,
      kajabiDripDays: cat.dripDays,
      lessons: [],
    };
    for (const post of posts) mod.lessons.push(planLesson(post, mod, media));
    modules.push(mod);
  }
  return { modules, skippedModules };
}

function planLesson(post, mod, media) {
  const title = post.title.trim().replace(/\s+/g, " ");
  const lessonPublished = mod.published && (post.publishing?.status ?? "published") === "published";
  const video = post.video && post.video.urls && post.video.urls.downloadUrl ? post.video : null;
  const quiz = post.video && post.video.ref && post.video.ref.type === "quiz" ? post.video.ref : null;

  let videoItem = null;
  if (video) {
    const name = path.basename(stripQuery(video.originalVideo || video.urls.downloadUrl));
    videoItem = media.want(video.urls.downloadUrl, {
      visibility: "protected",
      originalName: name,
      title: `${title} (video)`,
      purpose: `video "${title}"`,
    });
  }

  let thumbItem = null;
  const thumbUrl = post.posterImageUrl || video?.urls?.stillUrl || "";
  if (thumbUrl) {
    thumbItem = media.want(thumbUrl, { visibility: "public", purpose: `thumbnail "${title}"` });
    if (!thumbItem && post.posterImageUrl && video?.urls?.stillUrl) {
      thumbItem = media.want(video.urls.stillUrl, { visibility: "public", purpose: `thumbnail "${title}"` });
    }
  }

  const files = [];
  for (const dl of (post.downloads || []).slice().sort((a, b) => (a.attributes?.position ?? 0) - (b.attributes?.position ?? 0))) {
    const a = dl.attributes || {};
    if (!a.assetUrl) continue;
    const name = a.name || a.displayAssetName || "file";
    const item = media.want(a.assetUrl, {
      visibility: "protected",
      originalName: name,
      title: a.displayName || a.displayAssetName || name,
      purpose: `download "${name}" in "${title}"`,
    });
    files.push({ kajabiId: String(dl.id), title: a.displayName || a.displayAssetName || name, filename: name, item });
  }

  // Body: images on Kajabi's CDN become our public copies; other files linked on
  // Kajabi's CDN become protected lesson files (a public /uploads link to a
  // paid worksheet would be the worksheet given away) and the link becomes text.
  const iframes = [];
  const scripts = [];
  const foreignLinks = [];
  const bodyFiles = [];
  const rewriteUrl = (url, kind) => {
    if (!/^https?:/i.test(url)) return null;
    if (!isKajabiHosted(url)) {
      if (/bossclinician\.com/i.test(url)) foreignLinks.push(url);
      return null;
    }
    const ext = path.extname(new URL(stripQuery(url)).pathname).toLowerCase();
    const looksImage = kind === "img" || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"].includes(ext);
    if (looksImage) {
      const item = media.want(url, { visibility: "public", purpose: `body image in "${title}"` });
      return item ? { url: media.ref(item) } : null;
    }
    const item = media.want(url, { visibility: "protected", purpose: `body file link in "${title}"` });
    if (!item) return null;
    bodyFiles.push({ kajabiId: `body:${item.key}`, title: item.originalName, filename: item.originalName, item });
    return { text: " (in this lesson's downloads below)" };
  };
  const bodyMd = htmlToMarkdown(post.body || "", { rewriteUrl, iframes, scripts });
  for (const f of bodyFiles) if (!files.some((x) => x.item && x.item.key === f.item.key)) files.push(f);

  // A post that is only an embedded form (Google Form, JotForm) and has no
  // video becomes an `embed` lesson so the form shows in the player; the
  // Markdown keeps a plain link to it as well.
  let contentType = videoItem ? "video" : "text";
  let embedHtml = "";
  if (!videoItem && iframes.length) {
    contentType = "embed";
    const jot = scripts.filter((s) => /jotform|jotfor\.ms/i.test(s.attrs?.src || s.raw || ""));
    embedHtml = iframes.map((f) => f.html).join("\n");
    if (jot.length) {
      embedHtml += "\n" + jot.map((s) => (s.attrs?.src ? `<script src="${s.attrs.src}"></script>` : `<script>${s.raw}</script>`)).join("\n");
    }
  }

  return {
    kajabiId: String(post.id),
    title,
    published: lessonPublished,
    postStatus: post.publishing?.status,
    commentsEnabled: post.commentsMode !== "hidden" && post.commentsMode !== "disabled",
    bodyMd,
    contentType,
    embedHtml,
    videoItem,
    thumbItem,
    files,
    quiz: quiz ? quiz.id : null,
    interactive:
      /<(input|select|textarea|button)[\s>/]/i.test(post.body || "") ||
      scripts.some((sc) => !/jotform|jotfor\.ms/i.test(sc.attrs?.src || sc.raw || "")),
    foreignLinks,
  };
}

/* --------------------------------------------------------------- database -- */

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync("/opt/bossclinician/.env", "utf8");
  const m = env.match(/^DB_PASSWORD=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not set and DB_PASSWORD not found in /opt/bossclinician/.env");
  const pw = m[1].trim().replace(/^["']|["']$/g, "");
  return `postgres://boss:${encodeURIComponent(pw)}@10.42.0.1:15432/bossclinician`;
}

async function hasKajabiColumns(client) {
  const r = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name IN ('products','course_modules','course_lessons','lesson_files','product_files') AND column_name = 'kajabi_id')
          OR (table_name = 'course_modules' AND column_name IN ('kajabi_parent_id','image_url')))`,
  );
  return r.rowCount === 7;
}

async function loadProducts(client) {
  const r = await client.query(
    `SELECT p.id, p.slug, p.title, p.kind, p.status, p.course_id
            ${(await hasKajabiColumns(client)) ? ", p.kajabi_id" : ", NULL::text AS kajabi_id"}
       FROM products p ORDER BY p.id`,
  );
  return r.rows;
}

function matchProduct(kp, ours, overrides) {
  const o = overrides[kp.id] ?? overrides[kp.title];
  if (o === "skip") return { action: "skip", reason: "product-map.json says skip" };
  if (o === "create") return { action: "create" };
  if (o !== undefined) {
    const p = ours.find((x) => x.id === Number(o));
    if (!p) return { action: "error", reason: `product-map.json names product ${o}, which does not exist` };
    return { action: "match", product: p, via: "product-map.json" };
  }
  const byKajabi = ours.find((x) => x.kajabi_id === String(kp.id));
  if (byKajabi) return { action: "match", product: byKajabi, via: "kajabi_id" };
  const hits = ours.filter((x) => norm(x.title) === norm(kp.title));
  if (hits.length === 1) return { action: "match", product: hits[0], via: "title" };
  if (hits.length > 1) {
    const course = hits.filter((h) => h.kind === "course");
    if (course.length === 1) return { action: "match", product: course[0], via: "title (course of several)" };
    return { action: "error", reason: `title matches ${hits.length} products (${hits.map((h) => h.id).join(", ")}); add it to product-map.json` };
  }
  return { action: "create" };
}

const TEST_TITLE = /\b(test|testing|zz+|sample|lorem|placeholder|untitled|dummy|asdf)\b/i;

async function importProduct(client, kp, target, plan, media, report, hasCols) {
  const r = { kajabiId: kp.id, title: kp.title, ...report };
  let productId = target.product?.id ?? null;
  let courseId = target.product?.course_id ?? null;

  if (target.action === "create") {
    const base = lessonSlug(kp.title);
    const taken = (
      await client.query(
        `SELECT slug FROM courses WHERE slug = $1 OR slug LIKE $1 || '-%'
          UNION SELECT slug FROM products WHERE slug = $1 OR slug LIKE $1 || '-%'`,
        [base],
      )
    ).rows.map((x) => x.slug);
    const slug = nextLessonSlug(base, taken);
    r.createdSlug = slug;
    if (!DRY) {
      const c = await client.query(
        `INSERT INTO courses (slug, title, url, published, sort)
         VALUES ($1, $2, '/courses/' || $1, false, (SELECT COALESCE(MAX(sort), 0) + 1 FROM courses)) RETURNING id`,
        [slug, kp.title.trim()],
      );
      courseId = c.rows[0].id;
      const p = await client.query(
        `INSERT INTO products (slug, title, kind, course_id, status, sort, kajabi_id)
         VALUES ($1, $2, 'course', $3, 'draft', (SELECT COALESCE(MAX(sort), 0) + 1 FROM products), $4) RETURNING id`,
        [slug, kp.title.trim(), courseId, String(kp.id)],
      );
      productId = p.rows[0].id;
    }
  } else if (!DRY && hasCols) {
    await client.query(`UPDATE products SET kajabi_id = $1 WHERE id = $2 AND kajabi_id IS NULL`, [String(kp.id), productId]);
  }

  // Existing curriculum of the target course.
  const existingModules = courseId
    ? (
        await client.query(
          `SELECT id, title, sort ${hasCols ? ", kajabi_id" : ", NULL::text AS kajabi_id"} FROM course_modules WHERE course_id = $1 ORDER BY sort, id`,
          [courseId],
        )
      ).rows
    : [];
  const existingLessons = courseId
    ? (
        await client.query(
          `SELECT l.id, l.module_id, l.title, l.slug, l.sort, l.video_url, l.audio_url, l.attachment_url, l.body_md, l.embed_html,
                  l.thumbnail_url, l.content_type ${hasCols ? ", l.kajabi_id" : ", NULL::text AS kajabi_id"},
                  (SELECT count(*) FROM lesson_progress p WHERE p.lesson_id = l.id)::int AS progress,
                  (SELECT count(*) FROM lesson_comments c WHERE c.lesson_id = l.id)::int AS comments,
                  (SELECT count(*) FROM lesson_notes n WHERE n.lesson_id = l.id)::int AS notes,
                  (SELECT count(*) FROM lesson_files f WHERE f.lesson_id = l.id)::int AS files,
                  (SELECT count(*) FROM assessments a WHERE a.lesson_id = l.id)::int AS assessments
             FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
            WHERE m.course_id = $1 ORDER BY m.sort, l.sort, l.id`,
          [courseId],
        )
      ).rows
    : [];
  for (const l of existingLessons) {
    l.videoSize = 0;
    const key = /^protected:/i.test(l.video_url) ? l.video_url.slice("protected:".length).trim() : "";
    if (key && !key.includes("/") && !key.includes("..")) {
      try { l.videoSize = fs.statSync(path.join(PROTECTED_DIR, key)).size; } catch { /* missing */ }
    }
  }
  // A Kajabi lesson may already exist under another course (e.g. a rerun after a
  // product-map change); kajabi_id is unique across all lessons.
  const lessonByKajabi = new Map();
  if (hasCols) {
    const ids = plan.modules.flatMap((m) => m.lessons.map((l) => l.kajabiId));
    if (ids.length) {
      for (const row of (await client.query(`SELECT id, module_id, slug, video_url, kajabi_id FROM course_lessons WHERE kajabi_id = ANY($1)`, [ids])).rows) {
        lessonByKajabi.set(row.kajabi_id, row);
      }
    }
  }

  const adoptedModuleIds = new Set();
  const adoptedLessonIds = new Set();
  const slugsByModule = new Map();
  const slugsOf = async (moduleId) => {
    if (!slugsByModule.has(moduleId)) {
      const rows = DRY && typeof moduleId === "string" ? [] : (await client.query(`SELECT id, slug FROM course_lessons WHERE module_id = $1`, [moduleId])).rows;
      slugsByModule.set(moduleId, new Map(rows.map((x) => [x.id, x.slug])));
    }
    return slugsByModule.get(moduleId);
  };

  r.modules = [];
  let sort = 0;
  let fakeId = 0;
  for (const mod of plan.modules) {
    const mr = { kajabiId: mod.kajabiId, title: mod.title, parent: mod.kajabiParentId, published: mod.published, lessons: [] };
    let existing = existingModules.find((m) => m.kajabi_id === mod.kajabiId);
    if (existing) mr.action = "update";
    else {
      existing = existingModules.find((m) => !m.kajabi_id && !adoptedModuleIds.has(m.id) && norm(m.title) === norm(mod.title));
      mr.action = existing ? `adopt existing module ${existing.id}` : "insert";
    }
    let moduleId = existing?.id;
    if (existing) adoptedModuleIds.add(existing.id);
    if (!DRY) {
      if (existing) {
        await client.query(
          `UPDATE course_modules SET title = $1, summary = $2, sort = $3, kajabi_id = $4, kajabi_parent_id = $5,
                  image_url = $6, drip_days = CASE WHEN $8 THEN $7::int ELSE drip_days END, updated_at = now()
            WHERE id = $9`,
          [mod.title, mod.summary, sort, mod.kajabiId, mod.kajabiParentId, mod.imageUrl, mod.dripDays, WITH_DRIP, existing.id],
        );
      } else {
        const ins = await client.query(
          `INSERT INTO course_modules (course_id, title, summary, sort, kajabi_id, kajabi_parent_id, image_url, drip_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [courseId, mod.title, mod.summary, sort, mod.kajabiId, mod.kajabiParentId, mod.imageUrl, mod.dripDays],
        );
        moduleId = ins.rows[0].id;
      }
    } else if (!moduleId) {
      moduleId = `new-module-${++fakeId}`;
    }
    sort++;

    let lsort = 0;
    for (const les of mod.lessons) {
      const lr = { kajabiId: les.kajabiId, title: les.title, published: les.published, type: les.contentType, files: les.files.length };
      let row = lessonByKajabi.get(les.kajabiId);
      if (row) lr.action = "update";
      else {
        // Adopt a lesson that was created before this importer existed rather than
        // duplicating it: same title, or the very same video file (byte size), or
        // one title containing the other ("Credentialing with Confidence" inside
        // "CEU: Credentialing with Confidence: Insurance Enrollment ...").
        const free = existingLessons.filter((l) => !l.kajabi_id && !adoptedLessonIds.has(l.id));
        let how = "same title";
        row = free.find((l) => norm(l.title) === norm(les.title));
        if (!row && les.videoItem) {
          row = free.find((l) => l.videoSize && l.videoSize === les.videoItem.size);
          how = "same video file";
        }
        if (!row) {
          const a = norm(les.title);
          row = free.find((l) => {
            const b = norm(l.title);
            const [short, long] = a.length < b.length ? [a, b] : [b, a];
            return short.length >= 12 && long.includes(short);
          });
          how = "title contains title";
        }
        lr.action = row ? `adopt existing lesson ${row.id} "${row.title}" (${how})` : "insert";
      }
      if (row) adoptedLessonIds.add(row.id);

      // Media columns. A video counts only once its file is in the volume
      // (or, on a dry run, would be): never `video` with an empty video_url.
      let videoUrl = "";
      let contentType = les.contentType;
      const videoReady = les.videoItem && (les.videoItem.placed || DRY);
      if (les.videoItem && videoReady) videoUrl = media.ref(les.videoItem);
      // A video this importer did not place (uploaded in the admin, or an earlier
      // migration's import-*.mp4) is kept unless --prefer-kajabi-video; one it
      // did place is always brought up to date.
      const placedByUs = (ref) => /^(protected:|\/uploads\/)kajabi-/.test(ref || "");
      if (row && row.video_url && !placedByUs(row.video_url) && (!PREFER_KAJABI_VIDEO || !videoReady) && row.video_url !== videoUrl) {
        if (les.videoItem) lr.note = `keeps its existing video ${row.video_url} (use --prefer-kajabi-video to replace)`;
        videoUrl = row.video_url;
        contentType = "video";
      }
      if (contentType === "video" && !videoUrl) {
        contentType = les.embedHtml ? "embed" : "text";
        warn(`"${les.title}": video file not placed, importing as ${contentType} for now (rerun after placing the file)`);
      }
      const thumb = les.thumbItem && (les.thumbItem.placed || DRY) ? media.ref(les.thumbItem) : "";
      const duration = les.videoItem && videoUrl === media.ref(les.videoItem) ? les.videoItem.duration : 0;
      if (les.quiz) lr.note = `Kajabi quiz ${les.quiz} not migrated (rebuild as an assessment)`;
      if (les.interactive) lr.note = `${lr.note ? lr.note + "; " : ""}interactive form/calculator in the Kajabi body was flattened to text`;

      // Slug: kept for an adopted/updated lesson staying in its module; a lesson
      // that is new or moving gets the first free one in the destination.
      const slugs = await slugsOf(moduleId);
      let slug = row?.slug;
      // An existing lesson keeps its slug even when it moves, if the
      // destination has it free: it is in members' bookmarks and in emails.
      const taken = [...slugs.entries()].filter(([id]) => !row || id !== row.id).map(([, s]) => s);
      if (!slug || taken.includes(slug)) slug = nextLessonSlug(lessonSlug(les.title), taken);
      if (row) slugs.set(row.id, slug);
      else slugs.set(`pending-${les.kajabiId}`, slug);
      lr.slug = slug;

      let lessonId = row?.id;
      if (!DRY) {
        if (row && row.module_id !== moduleId) {
          // Free the slug in the old module's map; the unique index is per module.
          const old = slugsByModule.get(row.module_id);
          if (old) old.delete(row.id);
        }
        const values = [
          moduleId, les.title, slug, les.bodyMd, videoUrl, contentType, les.embedHtml, thumb,
          les.published, lsort, les.commentsEnabled, duration, Math.ceil(duration / 60), les.kajabiId,
        ];
        if (row) {
          await client.query(
            // Quiz lessons (migration 104) and calculator lessons (tool_key) were rebuilt
            // after the import; a re-run must not turn them back into Kajabi text.
            `UPDATE course_lessons SET module_id = $1, title = $2, slug = $3,
                    body_md = CASE WHEN course_lessons.tool_key IS NOT NULL OR course_lessons.content_type = 'assessment' THEN course_lessons.body_md ELSE $4 END,
                    video_url = $5,
                    content_type = CASE WHEN course_lessons.content_type = 'assessment' THEN course_lessons.content_type ELSE $6 END,
                    embed_html = $7, thumbnail_url = CASE WHEN $8 = '' THEN thumbnail_url ELSE $8 END,
                    published = $9, sort = $10, comments_enabled = $11,
                    video_duration_seconds = CASE WHEN $12 > 0 THEN $12 ELSE video_duration_seconds END,
                    duration_minutes = CASE WHEN $13 > 0 THEN $13 ELSE duration_minutes END,
                    kajabi_id = $14, updated_at = now()
              WHERE id = $15`,
            [...values, row.id],
          );
        } else {
          const ins = await client.query(
            `INSERT INTO course_lessons (module_id, title, slug, body_md, video_url, content_type, embed_html, thumbnail_url,
                    published, sort, comments_enabled, video_duration_seconds, duration_minutes, kajabi_id, preview)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false) RETURNING id`,
            values,
          );
          lessonId = ins.rows[0].id;
          slugs.set(lessonId, slug);
        }

        // Lesson downloads, upserted by Kajabi download id.
        let fsort = 0;
        for (const f of les.files) {
          if (!f.item || !f.item.placed) {
            warn(`"${les.title}": download "${f.filename}" not placed, skipped`);
            continue;
          }
          const mediaId = await ensureMediaAsset(client, media, f.item);
          const existingFile = await client.query(`SELECT id FROM lesson_files WHERE lesson_id = $1 AND kajabi_id = $2`, [lessonId, f.kajabiId]);
          if (existingFile.rowCount) {
            await client.query(
              `UPDATE lesson_files SET media_id = $1, title = $2, storage_path = $3, filename = $4, mime = $5, size_bytes = $6, sort = $7 WHERE id = $8`,
              [mediaId, f.title, media.ref(f.item), f.filename, f.item.mime, f.item.size, fsort, existingFile.rows[0].id],
            );
          } else {
            await client.query(
              `INSERT INTO lesson_files (lesson_id, media_id, title, storage_path, filename, mime, size_bytes, sort, kajabi_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [lessonId, mediaId, f.title, media.ref(f.item), f.filename, f.item.mime, f.item.size, fsort, f.kajabiId],
            );
          }
          fsort++;
        }
        if (les.videoItem && les.videoItem.placed) await ensureMediaAsset(client, media, les.videoItem);
        if (les.thumbItem && les.thumbItem.placed) await ensureMediaAsset(client, media, les.thumbItem);
      }
      lsort++;
      mr.lessons.push(lr);
    }
    r.modules.push(mr);
  }

  // Whatever of the course was not Kajabi content: leave it (after the Kajabi
  // modules, in its old order) unless it is unmistakably test content nobody has
  // touched, in which case it is removed.
  r.leftLessons = [];
  r.deletedLessons = [];
  for (const l of existingLessons) {
    if (l.kajabi_id || adoptedLessonIds.has(l.id)) continue;
    const untouched = l.progress === 0 && l.comments === 0 && l.notes === 0 && l.assessments === 0;
    const empty = !l.body_md.trim() && !l.video_url && !l.audio_url && !l.attachment_url && !l.embed_html && l.files === 0;
    const desc = `${l.id} "${l.title}" (module ${l.module_id}${l.video_url ? ", has video" : ""}${l.progress ? `, ${l.progress} progress rows` : ""})`;
    if (!KEEP_PLACEHOLDERS && untouched && (TEST_TITLE.test(l.title) || empty)) {
      r.deletedLessons.push(desc);
      if (!DRY) await client.query(`DELETE FROM course_lessons WHERE id = $1`, [l.id]);
    } else {
      r.leftLessons.push(desc);
    }
  }
  r.deletedModules = [];
  r.leftModules = [];
  for (const m of existingModules) {
    if (m.kajabi_id || adoptedModuleIds.has(m.id)) continue;
    const remaining = DRY
      ? existingLessons.filter((l) => l.module_id === m.id && !adoptedLessonIds.has(l.id) && !r.deletedLessons.some((d) => d.startsWith(`${l.id} `))).length
      : Number((await client.query(`SELECT count(*) FROM course_lessons WHERE module_id = $1`, [m.id])).rows[0].count);
    if (remaining === 0 && !KEEP_PLACEHOLDERS) {
      r.deletedModules.push(`${m.id} "${m.title}" (empty after import)`);
      if (!DRY) await client.query(`DELETE FROM course_modules WHERE id = $1`, [m.id]);
    } else {
      r.leftModules.push(`${m.id} "${m.title}" (${remaining} non-Kajabi lessons)`);
      if (!DRY) await client.query(`UPDATE course_modules SET sort = $1 WHERE id = $2`, [sort++, m.id]);
    }
  }
  r.productId = productId;
  r.courseId = courseId;
  return r;
}

async function ensureMediaAsset(client, media, item) {
  const url = media.ref(item);
  const found = await client.query(`SELECT id FROM media_assets WHERE url = $1 ORDER BY id LIMIT 1`, [url]);
  if (found.rowCount) return found.rows[0].id;
  const ins = await client.query(
    `INSERT INTO media_assets (filename, original_name, url, mime, kind, size_bytes, title, folder, tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [item.filename, item.originalName, url, item.mime, item.kind, item.size, item.title, MEDIA_FOLDER, ["kajabi"]],
  );
  return ins.rows[0].id;
}

/* -------------------------------------------------------------- downloads -- */

/** "PP_Pack_.pdf pdf • 303 KB" -> "PP_Pack_.pdf": the display name without Kajabi's type/size suffix. */
function labelTitle(label) {
  return String(label || "")
    .replace(/\s+[A-Za-z0-9]{1,8}\s*•\s*[\d.,]+\s*(bytes|[KMGT]?B)\s*$/i, "")
    .trim();
}

/** "241820_c6f306-764c-8edb-b186-83c4fe861e_PP_Pack_.pdf.pdf" -> "PP_Pack_.pdf" */
function downloadFileName(rel) {
  let name = path.basename(rel).replace(/^\d+_/, "");
  name = name.replace(/^[0-9a-f]{3,12}(-[0-9a-f]{1,12}){2,5}_/i, "");
  name = name.replace(/(\.[a-z0-9]{2,5})\1$/i, "$1");
  return name || path.basename(rel);
}

function planDownloads(data, ours, overrides, media) {
  if (!fs.existsSync(DOWNLOADS_FILE)) {
    warn(`--downloads: ${DOWNLOADS_FILE} not found`);
    return [];
  }
  const collections = JSON.parse(fs.readFileSync(DOWNLOADS_FILE, "utf8")).collections || [];
  const kajabiTitle = new Map(data.products.map((p) => [String(p.id), p.title]));
  const plans = [];
  for (const col of collections) {
    const kajabiId = String(col.kajabiProductId);
    const title = kajabiTitle.get(kajabiId) || col.title;
    if (ONLY.length && !ONLY.some((o) => o === kajabiId || norm(o) === norm(title) || o === col.slug)) continue;
    const dp = { kajabiId, title, slug: col.slug, files: [] };
    plans.push(dp);

    // Match: product-map.json, kajabi_id, normalized title, slug, then one
    // title/slug containing the other ("prepare-to-profit" in "prepare-to-profit-journal").
    const o = overrides[kajabiId] ?? overrides[title];
    if (o === "skip") {
      dp.reason = "product-map.json says skip";
      continue;
    }
    let hit = null;
    let via = "";
    const unique = (list, how) => {
      if (!hit && list.length === 1) {
        hit = list[0];
        via = how;
      }
    };
    if (o !== undefined && o !== "create") unique(ours.filter((x) => x.id === Number(o)), "product-map.json");
    unique(ours.filter((x) => x.kajabi_id === kajabiId), "kajabi_id");
    unique(ours.filter((x) => norm(x.title) === norm(title)), "title");
    unique(ours.filter((x) => x.slug === col.slug), "slug");
    const keys = [norm(title), norm(col.slug)].filter((k) => k.length >= 10);
    unique(ours.filter((x) => keys.some((k) => norm(x.title).includes(k) || norm(x.slug).includes(k))), "title/slug contains");
    if (!hit) {
      dp.reason = "no single matching product (add it to product-map.json)";
      continue;
    }
    if (!["download", "course"].includes(hit.kind)) {
      dp.reason = `matched product ${hit.id} is kind '${hit.kind}'`;
      continue;
    }
    dp.product = hit;
    dp.via = via;

    for (const f of col.files || []) {
      if (!f.ok || !f.localPath) {
        warn(`downloads "${title}": file ${f.fileId} "${f.label}" has no local copy`);
        continue;
      }
      const filename = downloadFileName(f.localPath);
      const fileTitle = labelTitle(f.label) || filename;
      const item = media.wantFile(`kajabi-download:${f.fileId}`, f.localPath, {
        visibility: "protected",
        originalName: filename,
        title: fileTitle,
        purpose: `download product file "${fileTitle}" (${title})`,
      });
      dp.files.push({ kajabiId: `dl:${f.fileId}`, title: fileTitle, filename, item });
    }
  }
  return plans;
}

async function importDownloads(client, dp, media, hasCols) {
  const result = { converted: false, lines: [], inserted: 0, updated: 0, present: 0, missing: 0 };
  const product = dp.product;

  if (product.kind === "course") {
    const curriculum = await client.query(`SELECT count(*)::int AS n FROM course_modules WHERE course_id = $1`, [product.course_id]);
    if (curriculum.rows[0].n > 0 || !CONVERT_DOWNLOADS) {
      result.lines.push(
        `NOT TOUCHED: product ${product.id} is kind 'course' ${curriculum.rows[0].n > 0 ? "with modules" : "(--no-convert-downloads)"}; its files are not attached`,
      );
      return result;
    }
    result.converted = true;
    if (!DRY) {
      // The same move migration 051 made for six products, with the same audit trail.
      await client.query(
        `INSERT INTO product_type_migration_audit (product_id, course_id, title, before_kind, after_kind, evidence, offer_ids, grant_ids)
         SELECT p.id, p.course_id, p.title, p.kind, 'download', $2,
                COALESCE((SELECT jsonb_agg(op.offer_id ORDER BY op.offer_id) FROM offer_products op WHERE op.product_id = p.id), '[]'::jsonb),
                COALESCE((SELECT jsonb_agg(g.id ORDER BY g.id) FROM access_grants g WHERE g.product_id = p.id), '[]'::jsonb)
           FROM products p WHERE p.id = $1
         ON CONFLICT (product_id) DO NOTHING`,
        [product.id, `Kajabi export 2026-10-01: Kajabi product ${dp.kajabiId} is a Downloads product`],
      );
      await client.query(
        `UPDATE products SET kind = 'download', legacy_course_id = course_id, course_id = NULL, updated_at = now()
          WHERE id = $1 AND kind = 'course'`,
        [product.id],
      );
    }
  }
  if (!DRY && hasCols) {
    await client.query(`UPDATE products SET kajabi_id = $1 WHERE id = $2 AND kajabi_id IS NULL`, [dp.kajabiId, product.id]);
  }

  const existing = (
    await client.query(
      `SELECT id, title, filename, size_bytes, sort ${hasCols ? ", kajabi_id" : ", NULL::text AS kajabi_id"}
         FROM product_files WHERE product_id = $1 ORDER BY sort, id`,
      [product.id],
    )
  ).rows;
  let nextSort = existing.reduce((a, r) => Math.max(a, r.sort + 1), 0);
  const claimed = new Set();
  for (const f of dp.files) {
    if (!f.item) {
      result.missing++;
      result.lines.push(`MISSING "${f.title}" (no usable local copy)`);
      continue;
    }
    let row = existing.find((r) => r.kajabi_id === f.kajabiId);
    let how = "kajabi_id";
    if (!row) {
      row = existing.find((r) => !r.kajabi_id && !claimed.has(r.id) && Number(r.size_bytes) === f.item.size);
      how = "same size";
    }
    if (!row) {
      row = existing.find(
        (r) => !r.kajabi_id && !claimed.has(r.id) && (norm(r.filename) === norm(f.filename) || norm(r.title) === norm(f.title)),
      );
      how = "same name";
    }
    if (row) {
      claimed.add(row.id);
      if (row.kajabi_id === f.kajabiId) {
        result.updated++;
        result.lines.push(`= "${f.title}" already imported (product_files ${row.id})`);
      } else {
        result.present++;
        result.lines.push(`= "${f.title}" already present as product_files ${row.id} "${row.title}" (${how}); left as is`);
        if (!DRY && hasCols) {
          await client.query(`UPDATE product_files SET kajabi_id = $1 WHERE id = $2 AND kajabi_id IS NULL`, [f.kajabiId, row.id]);
        }
      }
      continue;
    }
    if (!f.item.placed && !DRY) {
      result.missing++;
      warn(`downloads "${dp.title}": "${f.title}" not placed, skipped`);
      continue;
    }
    result.inserted++;
    result.lines.push(`+ "${f.title}" (${f.filename}, ${mb(f.item.size)}) -> ${media.ref(f.item)}`);
    if (!DRY) {
      const mediaId = await ensureMediaAsset(client, media, f.item);
      await client.query(
        `INSERT INTO product_files (product_id, media_id, title, description, storage_path, filename, mime, size_bytes, sort${hasCols ? ", kajabi_id" : ""})
         VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8${hasCols ? ", $9" : ""})`,
        [product.id, mediaId, f.title, media.ref(f.item), f.filename, f.item.mime, f.item.size, nextSort++, ...(hasCols ? [f.kajabiId] : [])],
      );
    }
  }
  return result;
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  log(`=== kajabi import ${DRY ? "DRY RUN" : "REAL RUN"} ${new Date().toISOString()} args=${argv.join(" ")}`);
  if (!fs.existsSync(EXPORT_FILE)) throw new Error(`export not found: ${EXPORT_FILE}`);
  if (!fs.existsSync(MANIFEST_FILE)) throw new Error(`manifest not found: ${MANIFEST_FILE} (is fetch.py finished?)`);
  const data = JSON.parse(fs.readFileSync(EXPORT_FILE, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const overrides = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : {};
  const media = new Media(manifest);

  for (const dir of [UPLOAD_DIR, PROTECTED_DIR]) {
    if (!fs.existsSync(dir)) {
      if (DRY) warn(`upload dir not readable: ${dir} (run under sudo to check already-placed files)`);
      else throw new Error(`upload dir not found or not accessible: ${dir} (run under sudo)`);
    }
  }

  let products = data.products.filter((p) => (p.posts || []).length > 0);
  const skippedEmpty = data.products.filter((p) => !(p.posts || []).length).map((p) => p.title);
  if (ONLY.length) products = products.filter((p) => ONLY.some((o) => o === p.id || norm(o) === norm(p.title)));

  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  const client = await pool.connect();
  const summary = [];
  try {
    let hasCols = await hasKajabiColumns(client);
    if (!hasCols && !DRY && !MEDIA_ONLY) {
      const sql = fs.readFileSync(SCHEMA_FILE, "utf8");
      log(`schema: kajabi_id columns missing; applying ${SCHEMA_FILE} (idempotent)`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
      hasCols = await hasKajabiColumns(client);
      if (!hasCols) throw new Error("schema: columns still missing after applying 094");
    } else if (!hasCols) {
      log("schema: kajabi_id columns (migration 094) are not in this database yet; a real run adds them first (idempotent)");
    }
    const ours = await loadProducts(client);

    // Plan every product first so the media set is known before anything moves.
    const plans = [];
    for (const kp of COURSES ? products : []) {
      const target = matchProduct(kp, ours, overrides);
      if (target.action === "match" && target.product.kind !== "course") {
        target.action = "skip";
        target.reason = `matched product ${target.product.id} is kind '${target.product.kind}', not a course (add to product-map.json to redirect)`;
      }
      if (target.action === "skip" || target.action === "error") {
        plans.push({ kp, target, plan: null });
        continue;
      }
      plans.push({ kp, target, plan: planProduct(kp, media) });
    }

    const downloadPlans = DOWNLOADS ? planDownloads(data, ours, overrides, media) : [];

    // Disk.
    const need = [...media.items.values()].reduce((a, i) => a + i.size, 0);
    const needProtected = [...media.items.values()].filter((i) => i.visibility === "protected").reduce((a, i) => a + i.size, 0);
    log(
      `disk: media to place ${gb(need)} (${media.items.size} files; ${gb(needProtected)} protected, ${gb(need - needProtected)} public); ` +
        `free: protected volume fs ${gb(freeBytes(PROTECTED_DIR))}, public volume fs ${gb(freeBytes(UPLOAD_DIR))}; floor ${gb(MIN_FREE_BYTES)}`,
    );

    if (!DB_ONLY) placeFiles(media);
    else for (const item of media.items.values()) {
      try {
        const size = fs.statSync(media.dest(item)).size;
        item.placed = item.convert ? size > 0 : size === item.size;
        if (item.placed && item.convert) item.size = size;
      } catch { item.placed = false; }
      if (item.placed && item.kind === "video") item.duration = probeDuration(media.dest(item));
    }

    if (MEDIA_ONLY) {
      log("--media-only: stopping before the database");
      return;
    }

    for (const { kp, target, plan } of plans) {
      const head = `product "${kp.title}" [${kp.id}]`;
      if (!plan) {
        log(`${head}: ${target.action.toUpperCase()} ${target.reason}`);
        summary.push({ kajabiId: kp.id, title: kp.title, action: target.action, reason: target.reason });
        continue;
      }
      const counts = {
        modules: plan.modules.length,
        submodules: plan.modules.filter((m) => m.kajabiParentId).length,
        lessons: plan.modules.reduce((a, m) => a + m.lessons.length, 0),
        unpublishedLessons: plan.modules.reduce((a, m) => a + m.lessons.filter((l) => !l.published).length, 0),
        videos: plan.modules.reduce((a, m) => a + m.lessons.filter((l) => l.videoItem).length, 0),
        embeds: plan.modules.reduce((a, m) => a + m.lessons.filter((l) => l.contentType === "embed").length, 0),
        attachments: plan.modules.reduce((a, m) => a + m.lessons.reduce((b, l) => b + l.files.length, 0), 0),
        quizzes: plan.modules.reduce((a, m) => a + m.lessons.filter((l) => l.quiz).length, 0),
        videoBytes: plan.modules.reduce((a, m) => a + m.lessons.reduce((b, l) => b + (l.videoItem ? l.videoItem.size : 0), 0), 0),
      };
      const where =
        target.action === "create"
          ? "CREATE new draft course product"
          : `-> our product ${target.product.id} "${target.product.title}" (${target.product.status}, course ${target.product.course_id}, via ${target.via})`;
      log(`${head} ${where}`);
      log(
        `  ${counts.modules} modules (${counts.submodules} flattened sub-modules), ${counts.lessons} lessons (${counts.unpublishedLessons} unpublished), ` +
          `${counts.videos} videos (${mb(counts.videoBytes)}), ${counts.embeds} embed lessons, ${counts.attachments} attachments, ${counts.quizzes} Kajabi quizzes`,
      );
      if (plan.skippedModules.length) log(`  skipped empty Kajabi categories: ${plan.skippedModules.join("; ")}`);

      let result;
      try {
        await client.query(DRY ? "BEGIN READ ONLY" : "BEGIN");
        result = await importProduct(client, kp, target, plan, media, counts, hasCols);
        await client.query(DRY ? "ROLLBACK" : "COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        warn(`${head}: FAILED, rolled back: ${err.stack || err.message}`);
        summary.push({ kajabiId: kp.id, title: kp.title, action: "failed", error: err.message });
        continue;
      }
      for (const m of result.modules) {
        const actions = m.lessons.reduce((acc, l) => ((acc[l.action.split(" ")[0]] = (acc[l.action.split(" ")[0]] || 0) + 1), acc), {});
        log(`  module ${m.action === "insert" ? "+" : "~"} "${m.title}"${m.parent ? " (sub-module)" : ""}${m.published ? "" : " [UNPUBLISHED]"}: ${m.action}; lessons ${JSON.stringify(actions)}`);
        for (const l of m.lessons) {
          if (VERBOSE || l.action !== "insert" || l.note) {
            log(`      ${l.action === "insert" ? "+" : "~"} ${l.type.padEnd(5)} ${l.published ? "   " : "[d]"} "${l.title}" ${l.action !== "insert" ? `(${l.action})` : ""}${l.note ? ` NOTE: ${l.note}` : ""}`);
          }
        }
      }
      if (result.deletedLessons.length) log(`  ${DRY ? "would delete" : "deleted"} test/placeholder lessons: ${result.deletedLessons.join("; ")}`);
      if (result.leftLessons.length) log(`  LEFT IN PLACE non-Kajabi lessons: ${result.leftLessons.join("; ")}`);
      if (result.deletedModules.length) log(`  ${DRY ? "would delete" : "deleted"} modules: ${result.deletedModules.join("; ")}`);
      if (result.leftModules.length) log(`  LEFT IN PLACE non-Kajabi modules: ${result.leftModules.join("; ")}`);
      const foreign = plan.modules.flatMap((m) => m.lessons.flatMap((l) => l.foreignLinks.map((u) => `${l.title}: ${u}`)));
      if (foreign.length) log(`  links to bossclinician.com left as-is (check they still resolve): ${[...new Set(foreign)].join(" | ")}`);
      summary.push({ ...result, action: target.action });
    }

    for (const dp of downloadPlans) {
      const head = `downloads "${dp.title}" [${dp.kajabiId}]`;
      if (!dp.product) {
        log(`${head}: SKIP ${dp.reason}`);
        summary.push({ kajabiId: dp.kajabiId, title: dp.title, action: "skip", reason: dp.reason, kind: "downloads" });
        continue;
      }
      log(`${head} -> our product ${dp.product.id} "${dp.product.title}" (${dp.product.kind}, ${dp.product.status}, via ${dp.via}); ${dp.files.length} files`);
      let result;
      try {
        await client.query(DRY ? "BEGIN READ ONLY" : "BEGIN");
        result = await importDownloads(client, dp, media, hasCols);
        await client.query(DRY ? "ROLLBACK" : "COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        warn(`${head}: FAILED, rolled back: ${err.stack || err.message}`);
        summary.push({ kajabiId: dp.kajabiId, title: dp.title, action: "failed", error: err.message, kind: "downloads" });
        continue;
      }
      if (result.converted) {
        log(`  ${DRY ? "would convert" : "converted"} product ${dp.product.id} from kind 'course' (course ${dp.product.course_id}, no curriculum) to 'download' (audit row in product_type_migration_audit)`);
      }
      for (const line of result.lines) log(`    ${line}`);
      summary.push({ kind: "downloads", kajabiId: dp.kajabiId, productId: dp.product.id, ...result });
    }
  } finally {
    client.release();
    await pool.end();
  }

  if (COURSES) log(`courses skipped (no posts${DOWNLOADS ? "" : "; Downloads products need --downloads"}): ${skippedEmpty.join(", ")}`);
  fs.writeFileSync(
    PLAN_FILE,
    JSON.stringify(
      {
        dryRun: DRY,
        at: new Date().toISOString(),
        products: summary,
        media: [...media.items.values()].map(({ source, ...m }) => ({ ...m, ref: media.ref(m) })),
        warnings,
      },
      null,
      1,
    ),
  );
  log(`plan/result written to ${PLAN_FILE}; ${warnings.length} warnings`);
  log(`=== done ${DRY ? "(dry run: nothing written to the database or the upload volumes)" : ""}`);
}

// Run under sudo, the log and plan would otherwise be root-owned in a directory
// the ubuntu user works in.
process.on("exit", () => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    for (const f of [LOG_FILE, PLAN_FILE]) {
      try { fs.chownSync(f, FILE_UID, FILE_GID); } catch { /* not written */ }
    }
  }
});

main()
  .then(() => logStream.end())
  .catch((err) => {
    log(`FATAL ${err.stack || err.message}`);
    logStream.end(() => process.exit(1));
  });
