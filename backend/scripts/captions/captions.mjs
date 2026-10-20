#!/usr/bin/env node
/**
 * Closed captions for course lesson videos (QA sheet row 241).
 *
 * For every course_lessons row with a video and no captions_url:
 *
 *   S3 video  -> /var/tmp download -> ffmpeg mono 16 kHz 32 kbps mp3 (video deleted at once)
 *             -> cut into <= 20 min pieces at a silence near each boundary
 *             -> OpenAI whisper-1 (verbose_json, segment + word timestamps), one call per piece
 *             -> offsets added back, re-flowed into cues of <= 2 lines x 42 chars, <= 7 s
 *             -> one WebVTT, stored beside the video under the same scheme:
 *                  protected:<name>.mp4   -> protected:<name>.vtt   (media/protected/<name>.vtt)
 *                  /uploads/<name>.mp4    -> /uploads/<name>.vtt    (media/public/<name>.vtt)
 *             -> course_lessons.captions_url set (only where it is still empty), and
 *                course_lessons.transcript filled with the plain text (only where empty;
 *                the member CoursePlayer shows it in TranscriptPanel).
 *
 * Nothing else in the row is touched (not even updated_at).
 *
 * Idempotent and resumable:
 *   - lessons that already have captions_url are skipped;
 *   - every OpenAI response is written to <work>/cache/<fingerprint>/seg-N.json before it is
 *     used, so a crash never re-bills a piece that was already transcribed;
 *   - identical videos (same byte size + sha256 of the first and last MiB) are transcribed
 *     once and the VTT is stored under each lesson's own reference (courses 52 and 53 carry
 *     the same lessons as separate files).
 *
 * Usage (server-64gbRam, as ubuntu; bounded because production shares the box):
 *
 *   systemd-run --user --scope -p MemoryMax=3G -p CPUQuota=200% nice -n 10 \
 *     node backend/scripts/captions/captions.mjs --lessons 306,308
 *   ... captions.mjs --all                 every video lesson still without captions
 *   ... captions.mjs --check 306           validate the stored VTT of a lesson, print sample cues
 *   ... captions.mjs --media <file> --out <file.vtt> [--transcript <file.txt>]
 *                                          caption a local media file only (no S3, no DB)
 *   flags: --dry-run (plan only), --limit N, --force-upload (re-put an existing VTT object)
 *
 * Env (defaults in brackets):
 *   OPENAI_API_KEY or OPENAI_KEY_FILE      [<work>/openai.key]  never printed
 *   CAPTIONS_WORK_DIR                      [/var/tmp/bc-1020]  log: captions.log, summary: captions-summary.json
 *   AWS_CONFIG_FILE / AWS_PROFILE          [<work>/aws-config / bossclinician-media]
 *       a copy of /var/lib/postgresql/business-aws-identities/bossclinician/media/aws-config.host
 *       with `credential_process = sudo -n /usr/local/bin/aws_signing_helper ...` (the cert dir
 *       is root-only) - the same Roles Anywhere role the backend uses
 *   MEDIA_STORAGE_BUCKET                   [bossclinician-media-662904411994-us-west-2]
 *   MEDIA_STORAGE_ACCOUNT                  [662904411994]
 *   MEDIA_STORAGE_KMS_KEY or <work>/kms-arn   (the backend's MEDIA_STORAGE_KMS_KEY; objects are SSE-KMS)
 *   DB_CONTAINER                           [bossclinician-db-1]  (psql via docker exec)
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ config */

const WORK = process.env.CAPTIONS_WORK_DIR || "/var/tmp/bc-1020";
const CACHE = path.join(WORK, "captions-cache");
const TMP = path.join(WORK, "captions-tmp");
const LOG = path.join(WORK, "captions.log");
const SUMMARY = path.join(WORK, "captions-summary.json");
const BUCKET = process.env.MEDIA_STORAGE_BUCKET || "bossclinician-media-662904411994-us-west-2";
const OWNER = process.env.MEDIA_STORAGE_ACCOUNT || "662904411994";
const DB_CONTAINER = process.env.DB_CONTAINER || "bossclinician-db-1";
const MAX_PIECE = 1200; // seconds; 20 min of 32 kbps mp3 is ~4.8 MB, far under Whisper's 25 MB
const MIN_PIECE = 900; // look for a silence to cut at between 15 and 20 min
const LINE = 42;
const MAX_CUE_SECONDS = 7;
const PROMPT =
  "Boss Clinician training with Yvette Howard, LCSW. Private practice, clinical documentation, " +
  "progress notes, treatment plans, medical necessity, CPT codes, ICD-10, HIPAA, Medicaid, Medicare, " +
  "insurance audits, credentialing, telehealth, superbills, therapists and clients.";

process.env.AWS_CONFIG_FILE ||= path.join(WORK, "aws-config");
process.env.AWS_SHARED_CREDENTIALS_FILE ||= "/dev/null";
process.env.AWS_PROFILE ||= "bossclinician-media";
process.env.AWS_PAGER = "";

/* ----------------------------------------------------------------- helpers */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

/** Run a command, return { stdout, stderr }; reject on non-zero exit. */
function run(cmd, argv, { input, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0 && !allowFail) {
        reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-600)}`));
      } else resolve({ stdout, stderr, code });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const file = process.env.OPENAI_KEY_FILE || path.join(WORK, "openai.key");
  return fs.readFileSync(file, "utf8").trim();
}

function kmsKey() {
  if (process.env.MEDIA_STORAGE_KMS_KEY) return process.env.MEDIA_STORAGE_KMS_KEY.trim();
  return fs.readFileSync(path.join(WORK, "kms-arn"), "utf8").trim();
}

/* ---------------------------------------------------------------- storage */

/** Mirrors backend/src/services/objectStorage.ts objectKey(). */
function objectKey(reference) {
  const isProtected = reference.startsWith("protected:");
  const key = isProtected ? reference.slice(10) : reference.replace(/^\/?uploads\//, "");
  if (!key || key.includes("..") || key.includes(":") || key.includes("%") || key.includes("\\")) {
    throw new Error(`Invalid object reference ${reference}`);
  }
  if (key.split("/").some((p) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p))) {
    throw new Error(`Invalid object reference ${reference}`);
  }
  return `media/${isProtected ? "protected" : "public"}/${key}`;
}

function captionsRefFor(videoRef) {
  if (!/\.[A-Za-z0-9]+$/.test(videoRef)) return `${videoRef}.vtt`;
  return videoRef.replace(/\.[A-Za-z0-9]+$/, ".vtt");
}

async function s3Head(reference) {
  const r = await run(
    "aws",
    ["s3api", "head-object", "--bucket", BUCKET, "--key", objectKey(reference), "--expected-bucket-owner", OWNER, "--output", "json"],
    { allowFail: true }
  );
  if (r.code !== 0) {
    if (/\(404\)|Not Found|NoSuchKey/i.test(r.stderr)) return null;
    throw new Error(`head ${reference}: ${r.stderr.slice(-300)}`);
  }
  return JSON.parse(r.stdout);
}

async function s3Range(reference, range, dest) {
  await run("aws", [
    "s3api", "get-object", "--bucket", BUCKET, "--key", objectKey(reference),
    "--expected-bucket-owner", OWNER, "--range", range, dest,
  ]);
  return fs.readFileSync(dest);
}

async function s3Download(reference, dest) {
  await run("aws", ["s3api", "get-object", "--bucket", BUCKET, "--key", objectKey(reference), "--expected-bucket-owner", OWNER, dest]);
}

async function s3PutVtt(reference, file) {
  const r = await run("aws", [
    "s3api", "put-object", "--bucket", BUCKET, "--key", objectKey(reference), "--body", file,
    "--expected-bucket-owner", OWNER, "--server-side-encryption", "aws:kms", "--ssekms-key-id", kmsKey(),
    "--bucket-key-enabled", "--content-type", "text/vtt; charset=utf-8", "--cache-control", "private, no-store",
    "--output", "json",
  ]);
  const version = JSON.parse(r.stdout).VersionId;
  if (!version || version === "null") throw new Error("S3 put returned no VersionId");
  return version;
}

/** Same-bytes check for videos uploaded twice: size + sha256 of first and last MiB. */
async function fingerprint(reference) {
  const head = await s3Head(reference);
  if (!head) throw new Error(`video object missing: ${objectKey(reference)}`);
  const size = head.ContentLength;
  const mib = 1024 * 1024;
  const a = path.join(TMP, "fp-a.bin");
  const b = path.join(TMP, "fp-b.bin");
  const hash = crypto.createHash("sha256");
  hash.update(await s3Range(reference, `bytes=0-${Math.min(size, mib) - 1}`, a));
  if (size > mib) hash.update(await s3Range(reference, `bytes=${Math.max(mib, size - mib)}-${size - 1}`, b));
  return `${size}-${hash.digest("hex").slice(0, 16)}`;
}

/* --------------------------------------------------------------------- db */

async function psql(sql) {
  const r = await run(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "boss", "-d", "bossclinician", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-At"],
    { input: sql }
  );
  return r.stdout.trim();
}

function dollar(text) {
  let tag;
  do tag = `cap_${crypto.randomBytes(5).toString("hex")}`;
  while (text.includes(tag));
  return `$${tag}$${text}$${tag}$`;
}

async function lessons(where) {
  const out = await psql(`
    SELECT coalesce(json_agg(x ORDER BY x.priority DESC, x.id), '[]') FROM (
      SELECT l.id, m.course_id, l.video_url, l.captions_url, l.transcript = '' AS transcript_empty,
             l.video_duration_seconds, (m.course_id IN (62, 63)) AS priority
        FROM course_lessons l JOIN course_modules m ON m.id = l.module_id
       WHERE l.video_url <> '' AND (${where})
    ) x;`);
  return JSON.parse(out);
}

/* ------------------------------------------------------------------ audio */

async function extractAudio(input, dest) {
  await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "mp3", dest]);
}

async function duration(file) {
  const r = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(r.stdout.trim());
}

async function loudness(file) {
  const r = await run("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  const n = (m) => (!m || m[1] === "-inf" ? -100 : Number(m[1]));
  return { max: n(max), mean: n(mean) };
}

async function silences(file) {
  const r = await run("ffmpeg", ["-nostdin", "-hide_banner", "-i", file, "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"]);
  const result = [];
  let start = null;
  for (const line of r.stderr.split("\n")) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (s) start = Math.max(0, Number(s[1]));
    if (e && start !== null) {
      result.push((start + Number(e[1])) / 2);
      start = null;
    }
  }
  return result;
}

function cutPoints(total, mids) {
  const cuts = [0];
  let at = 0;
  while (total - at > MAX_PIECE) {
    const inWindow = mids.filter((m) => m > at + MIN_PIECE && m < at + MAX_PIECE);
    at = inWindow.length ? inWindow[inWindow.length - 1] : at + MAX_PIECE;
    cuts.push(at);
  }
  return cuts;
}

async function cutPiece(audio, start, length, dest) {
  await run("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", start.toFixed(3), "-t", length.toFixed(3),
    "-i", audio, "-ac", "1", "-ar", "16000", "-b:a", "32k", dest,
  ]);
}

/* ---------------------------------------------------------------- whisper */

async function transcribe(file, prompt) {
  const key = openaiKey();
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), path.basename(file));
      form.append("model", "whisper-1");
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
      form.append("timestamp_granularities[]", "word");
      form.append("language", "en");
      form.append("temperature", "0");
      form.append("prompt", prompt);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, attempt * 15000));
          continue;
        }
        throw lastError;
      }
      return JSON.parse(text);
    } catch (e) {
      lastError = e;
      if (/OpenAI 4(0[0-9]|1[0-9])/.test(String(e.message)) && !/OpenAI 429/.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, attempt * 15000));
    }
  }
  throw lastError;
}

const HALLUCINATIONS = /^(thank you\.?|thanks for watching[.!]?|you|bye\.?|\.+|subtitles by .*)$/i;

/** Keep a Whisper segment unless it looks like text invented over silence. */
function keepSegment(s) {
  const text = s.text.trim();
  if (!text) return false;
  if (s.no_speech_prob > 0.6 && s.avg_logprob < -1) return false;
  if (HALLUCINATIONS.test(text) && s.no_speech_prob > 0.3) return false;
  // A word or three that Whisper itself rates as probably not speech.
  if (s.no_speech_prob > 0.75 && text.split(/\s+/).length <= 3) return false;
  return true;
}

/**
 * Whisper fills a long silence (a break in a live workshop) with the same short
 * word every 30-second window: "Okay." x9 across five minutes of lesson 308.
 * Three or more consecutive identical segments of <= 3 words are dropped whole.
 */
function dropRepeatedFiller(segments, label) {
  const norm = (s) => s.text.trim().toLowerCase().replace(/[^a-z0-9' ]/g, "");
  const drop = new Set();
  let i = 0;
  while (i < segments.length) {
    let j = i + 1;
    while (j < segments.length && norm(segments[j]) === norm(segments[i])) j++;
    if (j - i >= 3 && segments[i].text.trim().split(/\s+/).length <= 3) for (let k = i; k < j; k++) drop.add(k);
    i = j;
  }
  if (drop.size) {
    log(`${label}: dropped ${drop.size} repeated filler segment(s)`);
    const kept = segments.filter((_, k) => !drop.has(k));
    segments.length = 0;
    segments.push(...kept);
  }
}

/* ------------------------------------------------------------------- cues */

function wrap(words) {
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= LINE) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Whisper segments (absolute times) -> cues of at most two 42-char lines and
 * MAX_CUE_SECONDS. Token times come from the word timestamps when the segment's
 * words line up one-to-one with its text, otherwise from its length share.
 */
function buildCues(segments, words) {
  const cues = [];
  let wi = 0;
  for (const seg of segments) {
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    while (wi < words.length && words[wi].start < seg.start - 0.25) wi++;
    const mine = [];
    let wj = wi;
    while (wj < words.length && words[wj].start < seg.end + 0.05) mine.push(words[wj++]);
    let times;
    if (mine.length === tokens.length && tokens.length > 0) {
      times = mine.map((w) => [Math.max(w.start, seg.start), Math.min(Math.max(w.end, w.start), seg.end)]);
      wi = wj;
    } else {
      const total = tokens.reduce((n, t) => n + t.length + 1, 0);
      let at = seg.start;
      const span = seg.end - seg.start;
      times = tokens.map((t) => {
        const d = (span * (t.length + 1)) / total;
        const r = [at, at + d];
        at += d;
        return r;
      });
      if (mine.length) wi = wj;
    }
    let cur = [];
    let curStart = null;
    const flush = (end) => {
      if (!cur.length) return;
      cues.push({ start: curStart, end, text: wrap(cur).join("\n") });
      cur = [];
      curStart = null;
    };
    tokens.forEach((tok, i) => {
      const [ts, te] = times[i];
      const candidate = [...cur, tok];
      const fits = wrap(candidate).length <= 2;
      if (cur.length && (!fits || te - curStart > MAX_CUE_SECONDS)) flush(times[i - 1][1]);
      if (curStart === null) curStart = ts;
      cur.push(tok);
      const sentenceEnd = /[.?!]["')\]]?$/.test(tok);
      if (sentenceEnd && cur.join(" ").length >= 24 && i < tokens.length - 1) flush(te);
    });
    flush(times.length ? times[times.length - 1][1] : seg.end);
  }
  // Monotonic, non-overlapping, every cue at least a little visible.
  // Forward pass: each start at least 50 ms after the previous one, the
  // previous cue cut off where this one begins, every cue >= 0.6 s unless the
  // next one starts sooner.
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (i > 0) {
      const p = cues[i - 1];
      if (c.start < p.start + 0.05) c.start = p.start + 0.05;
      if (p.end > c.start) p.end = c.start;
    }
    if (c.end < c.start + 0.6) c.end = c.start + 0.6;
  }
  return cues;
}

function stamp(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

function escapeCue(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/-->/g, "->");
}

function toVtt(cues) {
  const body = cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${escapeCue(c.text)}`);
  return `WEBVTT\n\n${body.join("\n\n")}${body.length ? "\n" : ""}`;
}

/** Plain transcript: paragraph break on a pause > 2.5 s or once a paragraph passes ~700 chars at a sentence end. */
function toTranscript(segments) {
  const paras = [];
  let cur = "";
  let lastEnd = null;
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    if (cur && ((lastEnd !== null && s.start - lastEnd > 2.5) || (cur.length > 700 && /[.?!]["')]?$/.test(cur)))) {
      paras.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${text}` : text;
    lastEnd = s.end;
  }
  if (cur) paras.push(cur);
  return paras.join("\n\n");
}

/* --------------------------------------------------------------- pipeline */

/**
 * Audio file -> { vtt, transcript, seconds, billedSeconds } with every API
 * response cached under dir, so a rerun only pays for pieces never answered.
 */
async function captionAudio(audio, dir, label) {
  const total = await duration(audio);
  const level = await loudness(audio);
  if (level.max < -45) {
    log(`${label}: silent audio (max ${level.max} dB, ${total.toFixed(1)} s) -> header-only VTT`);
    return { vtt: "WEBVTT\n", transcript: "", seconds: total, billedSeconds: 0, cues: 0 };
  }
  const cuts = cutPoints(total, await silences(audio));
  const segments = [];
  const words = [];
  let billed = 0;
  let previousTail = "";
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i];
    const end = i + 1 < cuts.length ? cuts[i + 1] : total;
    const cached = path.join(dir, `seg-${i}.json`);
    let response;
    if (fs.existsSync(cached)) {
      response = JSON.parse(fs.readFileSync(cached, "utf8"));
      if (response.offset !== start) throw new Error(`${cached} was cut at ${response.offset}, now ${start}`);
    } else {
      const piece = path.join(TMP, `piece-${process.pid}-${i}.mp3`);
      await cutPiece(audio, start, end - start, piece);
      const prompt = previousTail ? `${PROMPT} ${previousTail}` : PROMPT;
      const t0 = Date.now();
      const api = await transcribe(piece, prompt);
      fs.rmSync(piece, { force: true });
      response = { offset: start, length: end - start, api };
      fs.writeFileSync(cached, JSON.stringify(response));
      billed += end - start;
      log(`${label}: piece ${i + 1}/${cuts.length} ${stamp(start)}-${stamp(end)} transcribed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    const { api } = response;
    for (const s of api.segments || []) {
      const abs = { ...s, start: Math.min(s.start + start, end), end: Math.min(s.end + start, end) };
      if (keepSegment(abs)) segments.push(abs);
    }
    for (const w of api.words || []) words.push({ word: w.word, start: Math.min(w.start + start, end), end: Math.min(w.end + start, end) });
    previousTail = (api.text || "").trim().slice(-300).replace(/^\S*\s/, "");
  }
  dropRepeatedFiller(segments, label);
  const cues = buildCues(segments, words);
  return { vtt: toVtt(cues), transcript: toTranscript(segments), seconds: total, billedSeconds: billed, cues: cues.length };
}

/** One distinct video (by fingerprint) -> cached result.json. */
async function captionVideo(reference, fp, label) {
  const dir = path.join(CACHE, fp);
  fs.mkdirSync(dir, { recursive: true });
  // Cues are always rebuilt from the cached audio + seg-N.json responses (cheap,
  // no API call for a piece already answered), so a fix to the cue builder
  // applies to videos transcribed before it.
  const resultFile = path.join(dir, "result.json");
  const audio = path.join(dir, "audio.mp3");
  if (!fs.existsSync(audio)) {
    const video = path.join(TMP, `video-${process.pid}${path.extname(reference) || ".mp4"}`);
    log(`${label}: downloading ${objectKey(reference)}`);
    try {
      await s3Download(reference, video);
      await extractAudio(video, audio + ".part");
      fs.renameSync(audio + ".part", audio);
    } finally {
      fs.rmSync(video, { force: true });
      fs.rmSync(audio + ".part", { force: true });
    }
  }
  const result = await captionAudio(audio, dir, label);
  fs.writeFileSync(path.join(dir, "captions.vtt"), result.vtt);
  fs.writeFileSync(resultFile, JSON.stringify({ ...result, billedSeconds: undefined }));
  if (result.billedSeconds === 0) log(`${label}: built from cached transcription ${fp}`);
  return { ...result, reused: result.billedSeconds === 0 };
}

/* ------------------------------------------------------------- validation */

function parseVtt(vtt) {
  const problems = [];
  if (!vtt.startsWith("WEBVTT")) problems.push("missing WEBVTT header");
  const cues = [];
  const re = /(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})\n([\s\S]*?)(?:\n\n|\n?$)/g;
  let m;
  while ((m = re.exec(vtt))) {
    const t = (a) => Number(m[a]) * 3600 + Number(m[a + 1]) * 60 + Number(m[a + 2]) + Number(m[a + 3]) / 1000;
    cues.push({ start: t(1), end: t(5), text: m[9].trim() });
  }
  cues.forEach((c, i) => {
    if (!(c.end > c.start)) problems.push(`cue ${i + 1} end <= start`);
    if (i && c.start < cues[i - 1].start) problems.push(`cue ${i + 1} starts before cue ${i}`);
    if (i && c.start < cues[i - 1].end - 0.001) problems.push(`cue ${i + 1} overlaps cue ${i}`);
    if (c.end - c.start > MAX_CUE_SECONDS + 1.5) problems.push(`cue ${i + 1} lasts ${(c.end - c.start).toFixed(1)} s`);
    const lines = c.text.split("\n");
    if (lines.length > 2) problems.push(`cue ${i + 1} has ${lines.length} lines`);
    if (lines.some((l) => l.length > LINE && l.includes(" "))) problems.push(`cue ${i + 1} line over ${LINE} chars`);
  });
  return { cues, problems };
}

async function check(id) {
  const [row] = await lessons(`l.id = ${Number(id)}`);
  if (!row) throw new Error(`lesson ${id} not found`);
  if (!row.captions_url) throw new Error(`lesson ${id} has no captions_url`);
  const file = path.join(TMP, `check-${id}.vtt`);
  await s3Download(row.captions_url, file);
  const vtt = fs.readFileSync(file, "utf8");
  const { cues, problems } = parseVtt(vtt);
  const fp = await fingerprint(row.video_url);
  const result = JSON.parse(fs.readFileSync(path.join(CACHE, fp, "result.json"), "utf8"));
  const last = cues.length ? cues[cues.length - 1].end : 0;
  const coverage = result.seconds ? last / result.seconds : 0;
  console.log(JSON.stringify({ lesson: id, captions_url: row.captions_url, cues: cues.length, audioSeconds: result.seconds, lastCueEnd: last, coverage: Number(coverage.toFixed(4)), transcriptChars: result.transcript.length, problems: problems.slice(0, 20), problemCount: problems.length }, null, 2));
  const picks = [0, Math.floor(cues.length / 4), Math.floor(cues.length / 2), Math.floor((3 * cues.length) / 4), cues.length - 1];
  for (const i of [...new Set(picks)].filter((i) => i >= 0 && i < cues.length)) {
    console.log(`#${i + 1} ${stamp(cues[i].start)} --> ${stamp(cues[i].end)}\n${cues[i].text}\n`);
  }
  fs.rmSync(file, { force: true });
  return problems.length === 0;
}

/* -------------------------------------------------------------------- main */

/**
 * --rebuild: a lesson this script already captioned, re-cut from the cached
 * transcription after a change to the cue builder or the filters. Never calls
 * the API for a cached piece. Re-stores the VTT only when it changed, and
 * replaces the transcript only while it is still exactly the one generated last
 * time (an edit made in the admin since then is kept).
 */
const previousOutput = new Map();

async function rebuild(row, label, summary) {
  try {
    const fp = await fingerprint(row.video_url);
    const dir = path.join(CACHE, fp);
    // Snapshot of what was generated before this process touched the cache;
    // two lessons sharing one video must both compare against the old one.
    if (!previousOutput.has(fp)) {
      previousOutput.set(fp, {
        vtt: fs.existsSync(path.join(dir, "captions.vtt")) ? fs.readFileSync(path.join(dir, "captions.vtt"), "utf8") : null,
        transcript: fs.existsSync(path.join(dir, "result.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8")).transcript : null,
      });
    }
    const { vtt: oldVtt, transcript: oldTranscript } = previousOutput.get(fp);
    const result = await captionVideo(row.video_url, fp, label);
    const { problems } = parseVtt(result.vtt);
    if (problems.length) throw new Error(`VTT failed validation: ${problems.slice(0, 5).join("; ")}`);
    let stored = "unchanged";
    if (result.vtt !== oldVtt || flag("--force-upload")) stored = `stored version ${await s3PutVtt(row.captions_url, path.join(dir, "captions.vtt"))}`;
    let transcript = "unchanged";
    if (oldTranscript !== null && result.transcript !== oldTranscript) {
      const updated = await psql(`
        UPDATE course_lessons SET transcript = ${dollar(result.transcript)}
         WHERE id = ${Number(row.id)} AND captions_url = ${dollar(row.captions_url)} AND transcript = ${dollar(oldTranscript)}
        RETURNING id;`);
      transcript = updated ? "replaced" : "kept (edited since)";
    }
    summary.billedSeconds += result.billedSeconds || 0;
    summary.done[row.id] = { ...(summary.done[row.id] || {}), cues: result.cues, rebuiltAt: new Date().toISOString() };
    log(`${label}: rebuilt - ${result.cues} cues, VTT ${stored}, transcript ${transcript}`);
  } catch (e) {
    log(`${label}: FAILED rebuild ${String(e.message || e).slice(0, 500)}`);
  }
}

async function processLessons(rows) {
  const summary = fs.existsSync(SUMMARY) ? JSON.parse(fs.readFileSync(SUMMARY, "utf8")) : { done: {}, failed: {}, billedSeconds: 0 };
  const limit = Number(opt("--limit") || Infinity);
  let n = 0;
  for (const row of rows) {
    if (n >= limit) break;
    const label = `lesson ${row.id} (course ${row.course_id})`;
    if (row.captions_url && flag("--rebuild")) {
      if (row.captions_url === captionsRefFor(row.video_url)) await rebuild(row, label, summary);
      else log(`${label}: captions_url ${row.captions_url} is not ours, leaving it`);
      continue;
    }
    if (row.captions_url) {
      log(`${label}: already has captions_url, skipping`);
      continue;
    }
    n++;
    try {
      const ref = captionsRefFor(row.video_url);
      objectKey(row.video_url);
      objectKey(ref);
      if (flag("--dry-run")) {
        log(`${label}: would caption ${row.video_url} -> ${ref}`);
        continue;
      }
      const fp = await fingerprint(row.video_url);
      const result = await captionVideo(row.video_url, fp, label);
      const vttFile = path.join(CACHE, fp, "captions.vtt");
      const { problems } = parseVtt(result.vtt);
      if (problems.length) throw new Error(`VTT failed validation: ${problems.slice(0, 5).join("; ")}`);
      const existing = await s3Head(ref);
      if (existing && !flag("--force-upload")) log(`${label}: ${objectKey(ref)} already stored, reusing`);
      else log(`${label}: stored ${objectKey(ref)} version ${await s3PutVtt(ref, vttFile)}`);
      const updated = await psql(`
        UPDATE course_lessons
           SET captions_url = ${dollar(ref)},
               transcript = CASE WHEN transcript = '' THEN ${dollar(result.transcript)} ELSE transcript END
         WHERE id = ${Number(row.id)} AND coalesce(captions_url, '') = ''
        RETURNING id;`);
      summary.billedSeconds += result.billedSeconds || 0;
      summary.done[row.id] = {
        course: row.course_id, video: row.video_url, captions: ref, fingerprint: fp, cues: result.cues,
        seconds: Math.round(result.seconds), billedSeconds: Math.round(result.billedSeconds || 0),
        reused: !!result.reused, transcriptFilled: row.transcript_empty && !!result.transcript, dbUpdated: updated !== "",
      };
      delete summary.failed[row.id];
      log(`${label}: done - ${result.cues} cues, ${(result.seconds / 60).toFixed(1)} min, billed ${((result.billedSeconds || 0) / 60).toFixed(1)} min, db ${updated ? "updated" : "unchanged"}`);
    } catch (e) {
      summary.failed[row.id] = { video: row.video_url, error: String(e.message || e).slice(0, 500) };
      log(`${label}: FAILED ${String(e.message || e).slice(0, 500)}`);
    }
    summary.updatedAt = new Date().toISOString();
    summary.billedMinutes = Number((summary.billedSeconds / 60).toFixed(1));
    fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
  }
  log(`batch finished: ${Object.keys(summary.done).length} done, ${Object.keys(summary.failed).length} failed, billed ${summary.billedMinutes ?? 0} min total`);
}

async function main() {
  if (opt("--check")) {
    process.exit((await check(opt("--check"))) ? 0 : 1);
  }
  if (opt("--media")) {
    const input = path.resolve(opt("--media"));
    const out = opt("--out");
    if (!out) throw new Error("--media needs --out <file.vtt>");
    // Content-keyed (size + first/last MiB), like the S3 fingerprint, so a
    // re-downloaded copy of the same file finds its cached transcription.
    const h = crypto.createHash("sha256");
    const st = fs.statSync(input);
    const fd = fs.openSync(input, "r");
    const mib = 1024 * 1024;
    const head = Buffer.alloc(Math.min(st.size, mib));
    fs.readSync(fd, head, 0, head.length, 0);
    h.update(head);
    if (st.size > mib) {
      const tail = Buffer.alloc(Math.min(mib, st.size - mib));
      fs.readSync(fd, tail, 0, tail.length, st.size - tail.length);
      h.update(tail);
    }
    fs.closeSync(fd);
    const dir = path.join(CACHE, `local-${st.size}-${h.digest("hex").slice(0, 16)}`);
    fs.mkdirSync(dir, { recursive: true });
    const audio = path.join(dir, "audio.mp3");
    if (!fs.existsSync(audio)) await extractAudio(input, audio);
    const result = await captionAudio(audio, dir, path.basename(input));
    const { problems } = parseVtt(result.vtt);
    if (problems.length) throw new Error(`VTT failed validation: ${problems.slice(0, 5).join("; ")}`);
    fs.writeFileSync(out, result.vtt);
    if (opt("--transcript")) fs.writeFileSync(opt("--transcript"), result.transcript + "\n");
    log(`${path.basename(input)} -> ${out}: ${result.cues} cues, ${(result.seconds / 60).toFixed(1)} min, billed ${(result.billedSeconds / 60).toFixed(1)} min`);
    return;
  }
  let rows;
  if (opt("--lessons")) {
    const ids = opt("--lessons").split(",").map(Number).filter(Number.isInteger);
    if (!ids.length) throw new Error("--lessons needs ids");
    rows = await lessons(`l.id IN (${ids.join(",")})`);
  } else if (flag("--all")) rows = await lessons("true");
  else throw new Error("say --lessons <ids>, --all, --check <id> or --media <file> --out <file.vtt>");
  log(`starting: ${rows.length} lesson(s), ${rows.filter((r) => !r.captions_url).length} without captions`);
  await processLessons(rows);
}

main().catch((e) => {
  log(`fatal: ${e.stack || e}`);
  process.exit(1);
});
