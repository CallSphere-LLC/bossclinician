#!/usr/bin/env node
/**
 * Kajabi marketing -> Boss Clinician admin (QA sheet 2026-10-05).
 *
 * The admin Email Campaigns, Funnels, Automations, Events and Forms pages were
 * showing test rows. This brings over the client's real Kajabi history from the
 * admin dumps in /var/tmp/kajabi-marketing-1005 (nothing is fetched from Kajabi):
 *
 *   kj_campaigns.json + kj_previews.json  -> email_campaigns (broadcasts + event emails)
 *   kj_sequences.json                     -> email_sequences + sequence_emails
 *   kj_events_edit.json + kj_event_regs   -> events + event_registrations
 *   kj_forms_edit.json + kj_form_subs     -> forms (matched to ours, or new) + form_submissions
 *   kj_automations.json + kj_auto_edit    -> automations + automation_actions (ALL paused)
 *   kj_funnels.json + kj_funnel_pages     -> funnels + funnel_steps
 *
 * NOTHING IT WRITES CAN SEND AN EMAIL OR CHARGE ANYONE:
 *   - campaigns are status 'sent' (Kajabi sent) or 'draft' (Kajabi draft/scheduled),
 *     scheduled_at NULL, audience 'kajabi_import' (unknown to audiencePredicate, so a
 *     manual Send refuses until a real audience is picked). The broadcast, event-anchor
 *     and registration tickers select status 'scheduled'/'sending' only.
 *   - sequences get no sequence_subscriptions; the sequence tick only sends to active
 *     subscriptions, and no form/funnel/assessment/active automation points at them.
 *   - events are published = false with no event_reminders; reminders need both.
 *   - automations are status 'paused'; both engines run status = 'active' only, and the
 *     admin "turn on" gate refuses a step with nothing chosen. Triggers that could not be
 *     pinned to a real form/offer/quiz are pinned to id -1 (matches nothing) rather than
 *     left empty ("any").
 *   - registrations / submissions are history rows; nothing is fired for them, no contact
 *     is created (contact_id only by case-insensitive email match).
 *
 * Also deletes the rebuild's own dummy rows (name/title starting "ZZ"): events 1,2,
 * funnel 3, form 4, sequence 1, automation 2, with their children.
 *
 * Idempotent: every row is upserted by kajabi_id (migration 107's partial unique
 * indexes); registrations by (event_id, email); a rerun updates in place and keeps
 * slugs. Matched forms only gain kajabi_id/kajabi_title/kajabi_opt_in/source — their
 * slug, fields, name and published flag are left alone (live pages post to them).
 *
 * Usage (on server-64gbRam, from the worktree):
 *
 *   sudo systemd-run --scope -p MemoryMax=2G --uid=ubuntu \
 *     /usr/bin/node backend/scripts/kajabi-import/import-marketing.mjs            # dry run (default)
 *   ... import-marketing.mjs --commit                                            # real import
 *
 * Flags:
 *   --dry-run      (default) everything in one transaction that ends in ROLLBACK
 *   --commit       apply migration 107 in its own short transaction if its columns are
 *                  missing, then import in one transaction and COMMIT
 *   --dir <path>   dump directory (env KAJABI_MARKETING_DIR, default /var/tmp/kajabi-marketing-1005)
 *   --verbose      print every mapping decision and sample rows
 *   --twice        (dry run only) import twice inside the one transaction; pass 2 must only update
 *
 * Env:
 *   DATABASE_URL   default: the contents of ~/.bc-dburl (TLS, verify-full)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { htmlToMarkdown, decodeEntities } from "./html-to-md.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ config -- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

if (flag("--commit") && flag("--dry-run")) {
  console.error("Choose --dry-run or --commit, not both.");
  process.exit(2);
}
const COMMIT = flag("--commit");
const DRY = !COMMIT;
const VERBOSE = flag("--verbose");
/** Dry run only: run the whole import twice in the one transaction, to prove a rerun only updates. */
const TWICE = DRY && flag("--twice");
const DIR = opt("--dir") || process.env.KAJABI_MARKETING_DIR || "/var/tmp/kajabi-marketing-1005";
const SCHEMA_FILE = path.resolve(HERE, "../../src/db/migrations/107_kajabi_marketing_import.sql");
const DEFAULT_TZ = "America/Los_Angeles";
const SENTINEL_AUDIENCE = "kajabi_import";
const NO_MATCH_ID = -1;
const NEW_FORM_DESCRIPTION = "Imported from Kajabi. Not published here; Kajabi still hosts its page.";
/** Rebuild automations that are live and must come out of this byte-for-byte unchanged. */
const LIVE_AUTOMATION_IDS = Array.from({ length: 20 }, (_, i) => i + 6);
/** The rebuild's dummy rows, removed only while their name still starts "ZZ". */
const ZZ = { events: [1, 2], funnels: [3], forms: [4], sequences: [1], automations: [2] };

const log = (...parts) => console.log(...parts);
const vlog = (...parts) => VERBOSE && console.log(...parts);
const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  vlog(`WARN ${msg}`);
};

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.join(os.homedir(), ".bc-dburl");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  throw new Error("DATABASE_URL not set and ~/.bc-dburl not found");
}

/* --------------------------------------------------------------- summary -- */

const summary = new Map();
function tally(entity) {
  if (!summary.has(entity)) {
    summary.set(entity, { inserted: 0, updated: 0, matched: 0, deleted: 0, skipped: 0, reasons: new Map() });
  }
  return summary.get(entity);
}
function skip(entity, reason) {
  const t = tally(entity);
  t.skipped += 1;
  t.reasons.set(reason, (t.reasons.get(reason) || 0) + 1);
}
function note(entity, reason) {
  const t = tally(entity);
  t.reasons.set(reason, (t.reasons.get(reason) || 0) + 1);
}
function counted(entity, row) {
  const t = tally(entity);
  if (row.inserted) t.inserted += 1;
  else t.updated += 1;
}

/* --------------------------------------------------------------- helpers -- */

const read = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, "");
const clip = (s, n) => {
  const v = squash(s);
  return v.length > n ? `${v.slice(0, n - 1).trimEnd()}…` : v;
};
const idFromHref = (href, kind) => {
  const m = String(href || "").match(new RegExp(`/admin/${kind}/(\\d+)`));
  return m ? m[1] : null;
};

/** Same shape as routes/admin/formsV2.ts slugify, capped at 80. */
function slugify(value, fallback = "item") {
  const s = String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return s || fallback;
}
function freeSlug(base, taken) {
  let slug = base;
  for (let n = 2; taken.has(slug.toLowerCase()); n += 1) slug = `${base}-${n}`;
  taken.add(slug.toLowerCase());
  return slug;
}
function keyFromLabel(label, taken) {
  let base = String(label ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/, "");
  if (!/^[a-z]/.test(base)) base = `q_${base}`.replace(/_+$/, "") || "q";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  taken.add(key);
  return key;
}

/* ------------------------------------------------------------------ dates -- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function tzOffsetMs(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - utcMs;
}
/** A wall-clock time in an IANA zone -> the instant. */
function zonedToUtc(y, mo, d, h, mi, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = tzOffsetMs(guess, timeZone);
  let t = guess - first;
  const second = tzOffsetMs(t, timeZone);
  if (second !== first) t = guess - second;
  return new Date(t);
}
const to24 = (h, ampm) => (ampm ? (Number(h) % 12) + (/p/i.test(ampm) ? 12 : 0) : Number(h));

/** "September 26, 2026 05:00 AM", "Sep 30, 2026 10:46 AM", "Oct 6, 2026 11:00 AM", "September 25, 2026". */
function parseKajabiDate(text, timeZone) {
  const m = squash(text).match(/([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})(?:,? (\d{1,2}):(\d{2}) ?([AP]M))?/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  if (!month) return null;
  return zonedToUtc(+m[3], month, +m[2], m[4] ? to24(m[4], m[6]) : 0, m[5] ? +m[5] : 0, timeZone);
}
/** event[occurs_at]: ISO with an offset (an instant), or "2026-09-25 10:00 PM" on the event's wall clock. */
function parseOccursAt(value, timeZone) {
  const v = squash(value);
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)$/.test(v)) return new Date(v);
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}) ?([AP]M)?$/i);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], to24(m[4], m[6]), +m[5], timeZone);
}
/** Piecewise-linear id -> date, from ids whose date is known. Kajabi ids grow with time. */
function interpolator(points) {
  const pts = points.filter(([id, t]) => Number.isFinite(id) && t instanceof Date && !Number.isNaN(t.getTime()))
    .map(([id, t]) => [id, t.getTime()])
    .sort((a, b) => a[0] - b[0]);
  return (id) => {
    if (!pts.length || !Number.isFinite(id)) return null;
    let ms;
    if (id <= pts[0][0]) ms = pts[0][1];
    else if (id >= pts[pts.length - 1][0]) ms = pts[pts.length - 1][1];
    else {
      let i = 1;
      while (pts[i][0] < id) i += 1;
      const [a, ta] = pts[i - 1];
      const [b, tb] = pts[i];
      ms = ta + ((id - a) / (b - a || 1)) * (tb - ta);
    }
    return new Date(Math.min(ms, Date.now()));
  };
}

/** "(GMT-08:00) Pacific Time (US & Canada)" -> IANA. */
const ZONES = {
  "pacific time (us & canada)": "America/Los_Angeles",
  tijuana: "America/Tijuana",
  "mountain time (us & canada)": "America/Denver",
  arizona: "America/Phoenix",
  "central time (us & canada)": "America/Chicago",
  "eastern time (us & canada)": "America/New_York",
  "indiana (east)": "America/Indiana/Indianapolis",
  "atlantic time (canada)": "America/Halifax",
  hawaii: "Pacific/Honolulu",
  alaska: "America/Juneau",
  "puerto rico": "America/Puerto_Rico",
  "new delhi": "Asia/Kolkata",
  kolkata: "Asia/Kolkata",
  mumbai: "Asia/Kolkata",
  chennai: "Asia/Kolkata",
  london: "Europe/London",
  edinburgh: "Europe/London",
  dublin: "Europe/Dublin",
  utc: "UTC",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  sydney: "Australia/Sydney",
  "mexico city": "America/Mexico_City",
};
function ianaFor(label) {
  const name = squash(label).replace(/^\(GMT[+-]\d{2}:\d{2}\)\s*/i, "").toLowerCase();
  return ZONES[name] || null;
}

/* ------------------------------------------------------------ email HTML -- */

const LITERAL_SALUTATIONS = new Set(["therapist friend", "flourisher", "boss clinician", "friend", "there"]);

/**
 * Kajabi's rendered email -> readable Markdown.
 *
 * The layout is nested presentation tables with the copy in <td class="tb"> cells,
 * which html-to-md would turn into one long table row. So: drop the head, styles,
 * Outlook-only blocks, the hidden preheader, Kajabi's spacer/tracking pixels,
 * "View in Web Browser" and the unsubscribe footer, and turn the table cells into
 * plain blocks before converting.
 */
function emailHtmlToMd(html) {
  let h = String(html || "");
  h = h.replace(/<head[\s\S]*?<\/head>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  // html-to-md only treats known block tags as blocks; an <html>/<body> wrapper
  // would make the whole email one inline run.
  h = h.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<\/?(?:html|body)\b[^>]*>/gi, "");
  h = h.replace(/<!--\[if !mso\]><!?-->/gi, "").replace(/<!--<!\[endif\]-->/gi, "");
  h = h.replace(/<!--\[if [^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  h = h.replace(/<div id="section-footer"[\s\S]*$/i, "");
  h = h.replace(/<(div|span|td)\b[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, "");
  h = h.replace(/<img\b[^>]*\bsrc="https?:\/\/a\.kajabi\.com\/[^"]*"[^>]*>/gi, "");
  h = h.replace(/<a\b[^>]*>\s*View in (?:Web )?Browser\s*<\/a>/gi, "");
  h = h.replace(/<\/?(?:table|tbody|thead|tfoot|tr|center)\b[^>]*>/gi, "\n");
  h = h.replace(/<(?:td|th)\b[^>]*>/gi, "<div>").replace(/<\/(?:td|th)>/gi, "</div>");
  return tidyMd(htmlToMarkdown(h));
}
/** A Kajabi automation email body (plain editor HTML). */
function snippetHtmlToMd(html) {
  return tidyMd(htmlToMarkdown(String(html || "")));
}
function tidyMd(md) {
  let s = String(md || "")
    .replace(/[​‌‍͏⁠﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  s = s
    // html-to-md escapes the underscore ("first\_name").
    .replace(/\{\{\s*(?:member\.|contact\.|person\.)?first\\?_name\s*\}\}/gi, "{{firstName}}")
    .replace(/\{\{\s*(?:member\.|contact\.|person\.)?last\\?_name\s*\}\}/gi, "{{lastName}}");
  // Kajabi's previews were rendered for a real contact ("Hey Holly,"): put the token back.
  const head = s.slice(0, 600);
  const m = head.match(/(^|\n)(\s*(?:\*\*|_)?(?:Hi|Hey|Hello|Dear),?\s+)([A-Z][\w’'-]*(?: [A-Z][\w’'-]*)?)(\s*[,!])/);
  if (m && !LITERAL_SALUTATIONS.has(m[3].toLowerCase()) && !/\{\{/.test(m[3])) {
    const at = m.index + m[1].length;
    s = s.slice(0, at) + m[2] + "{{firstName}}" + m[4] + s.slice(at + m[2].length + m[3].length + m[4].length);
    greetingsNormalised += 1;
  }
  return s;
}
let greetingsNormalised = 0;

function parseFrom(line) {
  const v = squash(line);
  if (!v) return { name: "", email: "" };
  const m = v.match(/^(.*?)\s*<([^>]+)>$/);
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { name: "", email: v.includes("@") ? v : "" };
}

/* ---------------------------------------------------------------- load -- */

function loadDumps() {
  const campaignsFile = read("kj_campaigns.json");
  return {
    campaigns: Object.values(campaignsFile.campaigns),
    stats: campaignsFile.stats || {},
    previews: new Map(read("kj_previews.json").map((p) => [String(p.id), p])),
    sequences: read("kj_sequences.json"),
    automations: read("kj_automations.json"),
    autoEdit: new Map(read("kj_auto_edit.json").autos.map((a) => [String(a.id), a])),
    events: read("kj_events_edit.json"),
    eventRegs: new Map(read("kj_event_regs.json").map((r) => [String(r.id), r])),
    forms: read("kj_forms_edit.json"),
    formSubs: new Map(read("kj_form_subs.json").map((s) => [String(s.id), s])),
    publicForms: read("kj_public_forms.json"),
    funnels: read("kj_funnels.json").pipelines || [],
    funnelPages: read("kj_funnel_pages.json"),
  };
}

const inputOf = (dump, name) => {
  const row = (dump.inputs || []).find((r) => r[0] === name);
  return row ? row[1] : null;
};
const inputsOf = (dump, name) => (dump.inputs || []).filter((r) => r[0] === name).map((r) => r[1]);
const selectOf = (dump, name) => {
  const row = (dump.selects || []).find((r) => r[0] === name);
  return row && Array.isArray(row[1]) ? row[1][0] ?? null : null;
};
const textareaOf = (dump, name) => {
  const row = (dump.textareas || []).find((r) => r[0] === name);
  return row ? row[1] : null;
};

/* ------------------------------------------------------------ prepare -- */
/*
 * Everything that does not need the database is worked out here, before the
 * transaction opens: in a dry run the 107 DDL runs inside that transaction and
 * its ACCESS EXCLUSIVE locks are held until ROLLBACK, so it must be short.
 */

function durationMinutes(label) {
  const v = squash(label).toLowerCase();
  const m = v.match(/^([\d.]+)\s*(minute|hour)s?$/);
  if (!m) return 60;
  return Math.round(Number(m[1]) * (m[2] === "hour" ? 60 : 1));
}

function prepareEvents(d) {
  return d.events.map((dump) => {
    const kajabiId = idFromHref(dump.p, "events");
    const title = squash(inputOf(dump, "event[title]")) || "Untitled event";
    const zoneLabel = selectOf(dump, "event[time_zone]");
    let timezone = ianaFor(zoneLabel);
    if (!timezone) {
      warn(`event ${kajabiId}: unknown Kajabi zone "${zoneLabel}", using ${DEFAULT_TZ}`);
      timezone = DEFAULT_TZ;
    }
    const startsAt = parseOccursAt(inputOf(dump, "event[occurs_at]"), timezone);
    const text = squash(dump.text);
    const recurring = inputsOf(dump, "event[recurring]").includes("1");
    const unit = selectOf(dump, "event[recurrence_unit]");
    const interval = Math.max(1, Number(inputOf(dump, "event[recurrence_interval]") || 1));
    const phraseMatch = text.match(/\bevent (Daily|Hourly|Weekly|Monthly|Every \d+ (?:minutes|hours|days|weeks|months)) next up ([A-Z][a-z]{2,8} \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M)/);
    const location = squash(inputOf(dump, "event[location]"));
    const actionsText = (text.match(/Event Actions (.*?) Add Email/) || [])[1] || "";
    const event = {
      kajabiId,
      title,
      timezone,
      startsAt,
      durationMinutes: durationMinutes(selectOf(dump, "event[duration_in_minutes]")),
      kind: "live",
      evergreenIntervalMinutes: null,
      recurrenceFreq: null,
      recurrenceInterval: 1,
      recurrenceCount: null,
      kajabiRecurrence: null,
      roomUrl: /^https?:\/\//i.test(location) ? location : "",
      locationType: location && !/^https?:\/\//i.test(location) ? "in_person" : "online",
      locationAddress: location && !/^https?:\/\//i.test(location) ? location : "",
      actions: parseEventActions(actionsText, title),
      descriptionLines: [],
    };
    if (recurring) {
      const phrase = phraseMatch ? phraseMatch[1] : `Every ${interval} ${unit}`;
      event.kajabiRecurrence = phrase;
      const firstSession = startsAt;
      const perUnit = { minutes: 1, hours: 60, days: 1440, weeks: 10080 }[unit];
      if (perUnit) {
        // Kajabi's open-ended cadence ("Every 15 minutes", "Hourly", "Daily", "Every 4 days"):
        // evergreen on a fixed interval, anchored on Kajabi's ORIGINAL first session — the
        // admin computes "next up" forward from starts_at. (A recurrence_freq series must
        // end, and 200 dailies from 2025 would already be over.)
        event.kind = "evergreen";
        event.evergreenIntervalMinutes = interval * perUnit;
        event.descriptionLines.push(
          `In Kajabi this repeats ${phrase.toLowerCase()} with no end date, first session ${fmt(firstSession, timezone)}` +
            `${phraseMatch ? `; Kajabi's next session was ${phraseMatch[2]}` : ""}.`,
        );
      } else if (unit === "months") {
        // Months are not a fixed number of minutes: a live monthly series, from the
        // original start, for the maximum 200 sessions.
        event.kind = "live";
        event.recurrenceFreq = "monthly";
        event.recurrenceInterval = Math.min(99, interval);
        event.recurrenceCount = 200;
        event.descriptionLines.push(
          `In Kajabi this repeats ${phrase.toLowerCase()} with no end date (first session ${fmt(firstSession, timezone)}); here it runs for 200 sessions.`,
        );
      } else {
        warn(`event ${kajabiId}: recurring with unknown unit "${unit}" — imported as a one-off`);
      }
    }
    if (event.kind === "live" && !event.startsAt) {
      warn(`event ${kajabiId}: no usable start time — imported as a replay`);
      event.kind = "replay";
    }
    return event;
  });
}
function fmt(date, timeZone) {
  if (!date) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** "You're in. … email At time of registration One week out … check_circle email 7 days before event …" */
function parseEventActions(segment, eventTitle) {
  const out = [];
  if (!segment || /^No Actions/.test(segment) && !/ email /.test(segment)) return out;
  const re = /(.*?)\s*(?:check_circle\s+)?email\s+(At time of registration|\d+\s+(?:minute|hour|day|week)s?\s+(?:before|after)\s+event)/g;
  let m;
  while ((m = re.exec(segment))) {
    let title = m[1]
      .replace(/^.*?\bevent [A-Z][a-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2} [AP]M \([A-Z]{2,5}\)\s*/, "")
      .replace(/^No Actions (?:Before|After) Event\s*/, "")
      .trim();
    const when = m[2];
    let anchorKind = "event_start";
    let offset = 0;
    if (/registration/i.test(when)) anchorKind = "event_registration";
    else {
      const w = when.match(/(\d+)\s+(minute|hour|day|week)s?\s+(before|after)/);
      const mult = { minute: 1, hour: 60, day: 1440, week: 10080 }[w[2]];
      offset = Number(w[1]) * mult * (w[3] === "before" ? -1 : 1);
    }
    out.push({ title, when, anchorKind, offset });
  }
  void eventTitle;
  return out;
}

function prepareSequences(d) {
  const campaignById = new Map(d.campaigns.map((c) => [String(c.id), c]));
  return d.sequences.map((q) => {
    let prevDay = 0;
    const steps = (q.steps || []).map((s, index) => {
      const when = squash(s.when);
      const day = /^immediately$/i.test(when) ? 0 : Number((when.match(/^Day (\d+)/i) || [])[1]);
      let delayMinutes = 0;
      if (!Number.isFinite(day)) {
        warn(`sequence ${q.kajabi_id} step ${s.kajabi_id}: unreadable schedule "${when}", no wait`);
      } else {
        if (day < prevDay) warn(`sequence ${q.kajabi_id} step ${s.kajabi_id}: Day ${day} after Day ${prevDay}, no wait`);
        delayMinutes = Math.max(0, day - prevDay) * 1440;
        prevDay = Math.max(prevDay, day);
      }
      const raw = squash(decodeEntities(s.stats_raw || ""));
      const sent = Number((raw.match(/^(\d+)\s+Sent/) || [])[1]);
      const pct = (label) => {
        const m = raw.match(new RegExp(`([\\d.]+)%\\s+${label}`));
        return m ? Number(m[1]) : null;
      };
      const from = parseFrom(s.from);
      return {
        kajabiId: s.kajabi_id,
        position: index + 1,
        delayMinutes,
        when,
        subject: squash(s.subject) || squash(s.title),
        title: squash(s.title),
        previewText: squash(s.preview_text),
        bodyMd: emailHtmlToMd(s.body_html),
        fromName: from.name,
        sentCount: Number.isFinite(sent) ? sent : null,
        openedPct: pct("Opened"),
        clickedPct: pct("Clicked"),
        unsubPct: pct("Unsubscribed"),
      };
    });
    const campaign = campaignById.get(String(q.campaign_id));
    const stats = d.stats[String(q.campaign_id)] || null;
    return {
      kajabiId: q.kajabi_id,
      campaignId: q.campaign_id,
      name: squash(q.name) || "Untitled sequence",
      status: q.status,
      subscribers: Number(q.subscribers) || 0,
      triggers: q.triggers || [],
      folder: squash(campaign?.folder_name),
      kajabiDescription: squash(campaign?.description),
      stats,
      steps,
    };
  });
}

/* --------------------------------------------------------------- import -- */

async function main() {
  const t0 = Date.now();
  const d = loadDumps();
  log(`Kajabi marketing import — ${DRY ? "DRY RUN (rolled back)" : "COMMIT"} — ${DIR}`);

  // ---------- JS-only preparation
  const events = prepareEvents(d);
  const sequences = prepareSequences(d);

  const campaigns = d.campaigns
    .filter((c) => c.emailable_type === "EmailBroadcast" || c.emailable_type === "EventOccurrenceAction")
    .map((c) => {
      const p = d.previews.get(String(c.id)) || {};
      const desc = squash(c.description);
      const sentAt = /^Sent /.test(desc) ? parseKajabiDate(desc, DEFAULT_TZ) : null;
      const updatedAt = /^Updated /.test(desc) ? parseKajabiDate(desc, DEFAULT_TZ) : null;
      const scheduledFor = /^Scheduled for /.test(desc) ? parseKajabiDate(desc, DEFAULT_TZ) : null;
      return {
        kajabiId: c.id,
        type: c.emailable_type,
        kajabiStatus: c.status,
        status: c.status === "sent" ? "sent" : "draft",
        name: squash(c.title) || squash(p.subject) || "Untitled email",
        folder: squash(c.folder_name),
        subject: squash(p.subject) || squash(c.title),
        previewText: squash(p.preview_text),
        bodyMd: p.body_html ? emailHtmlToMd(p.body_html) : "",
        hasPreview: Boolean(p.body_html),
        from: parseFrom(p.from),
        to: squash(p.to),
        sentAt,
        updatedAt,
        scheduledFor,
        kajabiEventId: c.event_id ? String(c.event_id) : null,
        stats: d.stats[String(c.id)] || null,
      };
    });
  const campaignDate = interpolator(campaigns.map((c) => [Number(c.kajabiId), c.sentAt || c.updatedAt]));

  const sequenceCampaigns = d.campaigns.filter((c) => c.emailable_type === "EmailSequence");
  for (const c of d.campaigns) {
    if (!["EmailBroadcast", "EventOccurrenceAction", "EmailSequence"].includes(c.emailable_type)) {
      skip("email_campaigns", `unknown Kajabi type ${c.emailable_type}`);
    }
  }
  note("email_campaigns", `${sequenceCampaigns.length} Kajabi EmailSequence rows go to email_sequences, not here`);

  // Forms (JS part)
  const kForms = d.forms.map((dump) => {
    const kajabiId = idFromHref(dump.p, "forms");
    const text = squash(dump.text);
    const fieldsSeg = (text.match(/Form Fields (.*?) Add Form Field/) || [])[1] || "";
    const fields = [...fieldsSeg.matchAll(/(.+?) \((\w+Field)\) Edit(?: Remove)?(?= |$)/g)].map((m) => ({
      label: decodeEntities(m[1].trim()),
      type: m[2],
    }));
    const autoSeg = (text.match(/Automations Learn more When Then If (.*?) Add Automation/) || [])[1] || "";
    const subs = d.formSubs.get(kajabiId) || { headers: [], rows: [], total: 0 };
    return {
      kajabiId,
      title: squash(decodeEntities(inputOf(dump, "form[title]") || "")) || "Untitled form",
      doubleOptIn: inputOf(dump, "form[double_opt_in]") === "1",
      notifyRecipients: squash(inputOf(dump, "form[submission_notification_recipients]")),
      fields,
      autoSeg,
      subs,
    };
  });
  const formFirstSub = new Map();
  for (const f of kForms) {
    const ri = f.subs.headers.indexOf("Received");
    let first = null;
    for (const r of f.subs.rows) {
      const t = ri >= 0 ? parseKajabiDate(r.cells[ri], DEFAULT_TZ) : null;
      if (t && (!first || t < first)) first = t;
    }
    if (first) formFirstSub.set(f.kajabiId, first);
  }
  const resourceDate = interpolator([...formFirstSub].map(([id, t]) => [Number(id), t]));

  // Automation edit dialogs (send-email subject/body, conditions)
  const unjs = (s) =>
    String(s).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, c) =>
      c[0] === "u" && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c === "n" ? "\n" : c === "t" ? "\t" : c,
    );
  const autoDialogs = new Map();
  for (const [id, a] of d.autoEdit) {
    const h = unjs(a.body);
    const subjInput = h.match(/<input[^>]*name="automation_rule\[action_attributes\]\[subject\]"[^>]*>/);
    const subject = subjInput ? decodeEntities((subjInput[0].match(/value="([^"]*)"/) || [])[1] || "") : "";
    const ta = h.match(/<textarea[^>]*name="automation_rule\[action_attributes\]\[body\]"[^>]*>([\s\S]*?)<\/textarea>/);
    const passed = (h.match(/name="passed_assessment_id"[^>]*value="(\d+)"/) || [])[1] || null;
    const actionType = (h.match(/<select[^>]*name="automation_rule\[action_attributes\]\[type\]"[\s\S]*?<option[^>]*selected[^>]*>([^<]*)/) || [])[1] || "";
    if (/Send an email/i.test(actionType) && !ta) {
      throw new Error(`kj_auto_edit ${id}: the email body textarea is cut off (dump truncated at ${a.body.length} chars)`);
    }
    autoDialogs.set(id, {
      subject: squash(subject),
      bodyMd: ta ? snippetHtmlToMd(decodeEntities(ta[1])) : "",
      passedAssessmentId: passed,
      actionType,
    });
  }

  // ---------- database
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 });
  const client = await pool.connect();
  let finished = false;
  try {
    const schemaSql = fs.readFileSync(SCHEMA_FILE, "utf8");
    const expectedCols = (schemaSql.match(/ADD COLUMN IF NOT EXISTS/g) || []).length;
    const haveCols = await countImportColumns(client);
    const needDdl = haveCols < expectedCols;

    if (needDdl && COMMIT) {
      log(`schema: ${haveCols}/${expectedCols} migration-107 columns present — applying 107 in its own transaction`);
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query(schemaSql);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }

    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    if (needDdl && DRY) {
      log(`schema: ${haveCols}/${expectedCols} migration-107 columns present — applying 107 inside the dry-run transaction`);
      await client.query(schemaSql);
    } else if (!needDdl) {
      log(`schema: all ${expectedCols} migration-107 columns present`);
    }

    const liveBefore = await snapshotLiveAutomations(client);

    const siteTz =
      (await client.query(`SELECT value->>'timezone' AS tz FROM settings WHERE key = 'site_timezone'`)).rows[0]?.tz ||
      DEFAULT_TZ;
    if (siteTz !== DEFAULT_TZ) warn(`site_timezone is ${siteTz}; Kajabi dates were read as ${DEFAULT_TZ}`);

    const contacts = new Map(
      (await client.query(`SELECT id, lower(email) AS email FROM contacts WHERE email IS NOT NULL AND email <> ''`)).rows.map(
        (r) => [r.email, r.id],
      ),
    );
    const contactFor = (email) => contacts.get(String(email || "").trim().toLowerCase()) ?? null;

    for (let pass = 1; pass <= (TWICE ? 2 : 1); pass += 1) {
    if (TWICE) log(`
######## pass ${pass} of 2 ########`);
    summary.clear();
    warnings.length = 0;
    await deleteZz(client);

    /* ------------------------------------------------------------ events */
    const takenEventSlugs = await takenSlugs(client, "events");
    const eventIdByKajabi = new Map();
    const eventRowByKajabi = new Map();
    for (const e of events) {
      const description = [
        "Imported from Kajabi. Kajabi still hosts this event's registration page and sends its emails; it is not published here.",
        ...e.descriptionLines,
        e.actions.length
          ? `Kajabi event emails:\n${e.actions.map((a) => `- ${a.when}: ${a.title}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const existing = await client.query(`SELECT id, slug FROM events WHERE kajabi_id = $1`, [e.kajabiId]);
      const slug = existing.rows[0]?.slug ?? freeSlug(slugify(e.title, "event"), takenEventSlugs);
      const res = await client.query(
        `INSERT INTO events
           (slug, title, description_md, kind, starts_at, duration_minutes, timezone,
            evergreen_interval_minutes, room_url, published, recurrence_freq, recurrence_interval,
            recurrence_count, location_type, location_address, kajabi_id, source, kajabi_recurrence,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12,$13,$14,$15,'kajabi',$16,
                 LEAST(COALESCE($5::timestamptz, now()), now()), now())
         ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
           title = EXCLUDED.title, description_md = EXCLUDED.description_md, kind = EXCLUDED.kind,
           starts_at = EXCLUDED.starts_at, duration_minutes = EXCLUDED.duration_minutes,
           timezone = EXCLUDED.timezone, evergreen_interval_minutes = EXCLUDED.evergreen_interval_minutes,
           room_url = EXCLUDED.room_url, recurrence_freq = EXCLUDED.recurrence_freq,
           recurrence_interval = EXCLUDED.recurrence_interval, recurrence_count = EXCLUDED.recurrence_count,
           location_type = EXCLUDED.location_type, location_address = EXCLUDED.location_address,
           source = 'kajabi', kajabi_recurrence = EXCLUDED.kajabi_recurrence, updated_at = now()
         RETURNING id, starts_at, kind, (xmax = 0) AS inserted`,
        [
          slug, e.title, description, e.kind, e.startsAt, e.durationMinutes, e.timezone,
          e.evergreenIntervalMinutes, e.roomUrl, e.recurrenceFreq, e.recurrenceInterval,
          e.recurrenceCount, e.locationType, e.locationAddress, e.kajabiId, e.kajabiRecurrence,
        ],
      );
      counted("events", res.rows[0]);
      eventIdByKajabi.set(e.kajabiId, res.rows[0].id);
      eventRowByKajabi.set(e.kajabiId, { ...e, id: res.rows[0].id, startsAt: res.rows[0].starts_at });
      if (e.kind !== "live" || e.recurrenceFreq) note("events", `${e.title}: Kajabi "${e.kajabiRecurrence}" -> ${e.kind}${e.recurrenceFreq ? ` ${e.recurrenceFreq}×${e.recurrenceInterval}, 200 sessions` : ` every ${e.evergreenIntervalMinutes} min`}`);
      vlog(`event ${e.kajabiId} -> #${res.rows[0].id} ${slug} ${e.kind} ${e.startsAt?.toISOString?.() ?? ""}`);
    }

    /* ------------------------------------------------ event registrations */
    for (const [kid, reg] of d.eventRegs) {
      const event = eventRowByKajabi.get(kid);
      if (!event) {
        for (const _ of reg.rows || []) skip("event_registrations", "event not in the events dump");
        continue;
      }
      const seen = new Set();
      for (const row of reg.rows || []) {
        const email = squash(row[0]).toLowerCase();
        if (!email || !email.includes("@")) {
          skip("event_registrations", "no email");
          continue;
        }
        if (seen.has(email)) {
          skip("event_registrations", "same email twice on one event");
          continue;
        }
        seen.add(email);
        const createdAt = parseKajabiDate(row[2], DEFAULT_TZ) || new Date();
        // A live session is the event's start; an evergreen one is unknown, so the day they registered.
        const sessionAt = event.kind === "live" && event.startsAt ? event.startsAt : createdAt;
        const res = await client.query(
          `INSERT INTO event_registrations (event_id, contact_id, email, name, timezone, session_at, created_at, source)
           VALUES ($1, $2, $3, $4, '', $5, $6, 'kajabi')
           ON CONFLICT (event_id, email) DO UPDATE SET
             name = EXCLUDED.name, session_at = EXCLUDED.session_at, created_at = EXCLUDED.created_at,
             contact_id = COALESCE(event_registrations.contact_id, EXCLUDED.contact_id)
           WHERE event_registrations.source = 'kajabi'
           RETURNING id, (xmax = 0) AS inserted`,
          [event.id, contactFor(email), email, squash(row[1]), sessionAt, createdAt],
        );
        if (res.rows[0]) counted("event_registrations", res.rows[0]);
        else skip("event_registrations", "already registered here (not from Kajabi), left alone");
        if (contactFor(email)) note("event_registrations", "linked to an existing contact");
      }
    }

    /* ------------------------------------------------------ sequences */
    const takenSeqSlugs = await takenSlugs(client, "email_sequences");
    const seqIdByKajabi = new Map();
    const seqStepIndex = new Map(); // kajabi step id -> { seqKajabiId, position, when }
    for (const q of sequences) {
      const existing = await client.query(`SELECT id, slug FROM email_sequences WHERE kajabi_id = $1`, [q.kajabiId]);
      const slug = existing.rows[0]?.slug ?? freeSlug(slugify(q.name, "sequence"), takenSeqSlugs);
      const status = { active: "active", draft: "draft", paused: "paused", archived: "archived" }[q.status] || "draft";
      if (status !== q.status) note("email_sequences", `Kajabi status "${q.status}" -> ${status}`);
      const created = campaignDate(Number(q.campaignId)) || new Date();
      const description = [
        "Imported from Kajabi.",
        q.triggers.length ? `In Kajabi, people join it when: ${q.triggers.join("; ")}.` : "",
        `Kajabi had ${q.subscribers} subscriber${q.subscribers === 1 ? "" : "s"} on it; they were not brought across, so nobody is enrolled here.`,
        "Kajabi sends each email at a set time of day (see each email's Kajabi schedule); here the waits are whole days.",
      ]
        .filter(Boolean)
        .join(" ");
      const res = await client.query(
        `INSERT INTO email_sequences
           (name, slug, description, status, topic, use_contact_timezone, timezone, folder,
            kajabi_id, source, recipient_count, opened_count, clicked_count, unsubscribed_count,
            kajabi_subscribers, kajabi_triggers, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'marketing',false,$5,$6,$7,'kajabi',$8,$9,$10,$11,$12,$13::jsonb,$14,$14)
         ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
           timezone = EXCLUDED.timezone, folder = EXCLUDED.folder, source = 'kajabi',
           recipient_count = EXCLUDED.recipient_count, opened_count = EXCLUDED.opened_count,
           clicked_count = EXCLUDED.clicked_count, unsubscribed_count = EXCLUDED.unsubscribed_count,
           kajabi_subscribers = EXCLUDED.kajabi_subscribers, kajabi_triggers = EXCLUDED.kajabi_triggers
         RETURNING id, (xmax = 0) AS inserted`,
        [
          q.name, slug, description, status, DEFAULT_TZ, q.folder, q.kajabiId,
          q.stats?.send_count ?? 0, q.stats?.opened_count ?? 0, q.stats?.clicked_count ?? 0,
          q.stats?.unsubscribed_count ?? 0, q.subscribers, JSON.stringify(q.triggers), created,
        ],
      );
      counted("email_sequences", res.rows[0]);
      const seqId = res.rows[0].id;
      seqIdByKajabi.set(String(q.kajabiId), seqId);

      // Kajabi's own "N emails over D days" against ours.
      const span = q.steps.reduce((a, s) => a + s.delayMinutes, 0) / 1440;
      const km = q.kajabiDescription.match(/(\d+) emails? over (\d+) days?/);
      if (km && (Number(km[1]) !== q.steps.length || Number(km[2]) !== span)) {
        warn(`sequence ${q.kajabiId} "${q.name}": Kajabi says "${q.kajabiDescription}", import has ${q.steps.length} emails over ${span} days`);
        note("email_sequences", "email count/span differs from Kajabi's list line (see warnings)");
      }

      // Positions: park the sequence's Kajabi rows out of the way first so a rerun with a
      // different order cannot trip UNIQUE (sequence_id, position).
      await client.query(
        `UPDATE sequence_emails SET position = -position - 1000 WHERE sequence_id = $1 AND source = 'kajabi'`,
        [seqId],
      );
      for (const s of q.steps) {
        seqStepIndex.set(String(s.kajabiId), { seqKajabiId: String(q.kajabiId), position: s.position, when: s.when, title: s.title });
        const r = await client.query(
          `INSERT INTO sequence_emails
             (sequence_id, position, delay_minutes, subject, preview_text, body_md, from_name, from_email,
              enabled, kajabi_id, source, kajabi_when, kajabi_sent_count, kajabi_opened_pct,
              kajabi_clicked_pct, kajabi_unsub_pct, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'',true,$8,'kajabi',$9,$10,$11,$12,$13,$14,$14)
           ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
             sequence_id = EXCLUDED.sequence_id, position = EXCLUDED.position,
             delay_minutes = EXCLUDED.delay_minutes, subject = EXCLUDED.subject,
             preview_text = EXCLUDED.preview_text, body_md = EXCLUDED.body_md,
             from_name = EXCLUDED.from_name, source = 'kajabi', kajabi_when = EXCLUDED.kajabi_when,
             kajabi_sent_count = EXCLUDED.kajabi_sent_count, kajabi_opened_pct = EXCLUDED.kajabi_opened_pct,
             kajabi_clicked_pct = EXCLUDED.kajabi_clicked_pct, kajabi_unsub_pct = EXCLUDED.kajabi_unsub_pct,
             updated_at = now()
           RETURNING id, (xmax = 0) AS inserted`,
          [
            seqId, s.position, s.delayMinutes, s.subject, s.previewText, s.bodyMd, s.fromName, s.kajabiId,
            s.when, s.sentCount, s.openedPct, s.clickedPct, s.unsubPct, created,
          ],
        );
        counted("sequence_emails", r.rows[0]);
        if (!s.bodyMd) note("sequence_emails", "empty body in the Kajabi dump");
      }
      const stray = await client.query(
        `DELETE FROM sequence_emails WHERE sequence_id = $1 AND source = 'kajabi' AND position < 0 RETURNING id`,
        [seqId],
      );
      tally("sequence_emails").deleted += stray.rowCount;
    }

    /* ------------------------------------------------------------ forms */
    const ourForms = (
      await client.query(`SELECT id, slug, name, fields, description, kajabi_id::text AS kajabi_id FROM forms ORDER BY id`)
    ).rows;
    // A form this import created is never a match candidate: it goes back through the upsert.
    const candidates = ourForms.filter((f) => f.description !== NEW_FORM_DESCRIPTION);
    const bySlug = new Map(candidates.map((f) => [f.slug, f]));
    const formMatch = new Map(); // kajabi form id -> our form row
    const claimed = new Set();
    const claim = (kid, form, how) => {
      if (!form || formMatch.has(kid) || claimed.has(form.id)) return false;
      if (form.kajabi_id && form.kajabi_id !== kid) return false;
      formMatch.set(kid, { ...form, how });
      claimed.add(form.id);
      return true;
    };
    // 1. a previous run's link
    //    (a form this import created is not "matched": it goes back through the upsert below)
    for (const f of candidates) if (f.kajabi_id) claim(f.kajabi_id, f, "kajabi_id");
    // 2. the live public page the form sits on (our pages post by slug)
    const SLUG_ALIAS = {
      "careful-form": "quiz-careful",
      "steady-form": "quiz-steady",
      "reluctant-form": "quiz-reluctant",
      "visionary-form": "quiz-visionary",
      "reset-audit-form": "reset-audit",
      "reset-planner-form": "reset-planner",
    };
    for (const p of d.publicForms) claim(String(p.form_id), bySlug.get(SLUG_ALIAS[p.page] || p.page), `page /${p.page}`);
    // 3. title (exact, or ours begins with Kajabi's minus a trailing "Form")
    for (const k of kForms) {
      if (formMatch.has(k.kajabiId)) continue;
      const kt = norm(k.title.replace(/\s+form\s*$/i, ""));
      // Long enough that a shared first word ("Masterclass …") is not a match.
      if (kt.length < 16) continue;
      const hits = candidates.filter(
        (f) => !claimed.has(f.id) && !/^ZZ/.test(f.name) && (norm(f.name) === norm(k.title) || norm(f.name).startsWith(kt)),
      );
      if (hits.length === 1) claim(k.kajabiId, hits[0], "title");
      else if (hits.length > 1) warn(`form ${k.kajabiId} "${k.title}": ${hits.length} of ours share its title — not matched`);
    }

    const takenFormSlugs = new Set(ourForms.map((f) => f.slug.toLowerCase()));
    const labelOptions = new Map(); // our existing questions' choices, by label
    for (const f of ourForms) {
      for (const field of Array.isArray(f.fields) ? f.fields : []) {
        if (Array.isArray(field.options) && field.options.length && !labelOptions.has(norm(field.label))) {
          labelOptions.set(norm(field.label), field.options);
        }
      }
    }

    const formIdByKajabi = new Map();
    const formKeyMap = new Map(); // kajabi form id -> (header -> key)
    for (const k of kForms) {
      const optIn = k.doubleOptIn ? "double" : "single";
      const match = formMatch.get(k.kajabiId);
      if (match) {
        const r = await client.query(
          `UPDATE forms SET kajabi_id = $2, kajabi_title = $3, kajabi_opt_in = $4, source = 'kajabi',
                  kajabi_submissions_count = 0
            WHERE id = $1 RETURNING id`,
          [match.id, k.kajabiId, k.title, optIn],
        );
        tally("forms").matched += r.rowCount;
        note("forms", `matched by ${match.how.startsWith("page") ? "public page" : match.how}`);
        log(`  form match: Kajabi ${k.kajabiId} "${k.title}" -> #${match.id} /${match.slug} (${match.how})`);
        formIdByKajabi.set(k.kajabiId, match.id);
        formKeyMap.set(k.kajabiId, headerKeysFor(match.fields || [], k.subs.headers));
        continue;
      }

      // A new form, unpublished, built from Kajabi's field list.
      const fields = [];
      const keys = new Set();
      const headerToKey = new Map();
      for (const kf of k.fields) {
        if (/credit card|expiration|^cw$|^cvv$|^cvc$/i.test(kf.label)) {
          note("forms", `card-detail question dropped ("${kf.label}" on "${k.title}")`);
          continue;
        }
        const field = buildField(kf, keys, labelOptions, k.subs);
        fields.push(field);
        headerToKey.set(norm(kf.label), field.key);
      }
      const existing = await client.query(`SELECT id, slug FROM forms WHERE kajabi_id = $1`, [k.kajabiId]);
      const slug = existing.rows[0]?.slug ?? freeSlug(slugify(k.title, "form"), takenFormSlugs);
      const created = formFirstSub.get(k.kajabiId) || resourceDate(Number(k.kajabiId)) || new Date();
      const r = await client.query(
        `INSERT INTO forms
           (slug, name, description, fields, published, create_lead, double_opt_in, kajabi_id, source,
            kajabi_submissions_count, kajabi_opt_in, kajabi_title, created_at, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,false,false,$5,$6,'kajabi',0,$7,$2,$8,$8)
         ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, fields = EXCLUDED.fields,
           double_opt_in = EXCLUDED.double_opt_in, source = 'kajabi', kajabi_submissions_count = 0,
           kajabi_opt_in = EXCLUDED.kajabi_opt_in, kajabi_title = EXCLUDED.kajabi_title
         RETURNING id, (xmax = 0) AS inserted`,
        [
          slug, k.title,
          NEW_FORM_DESCRIPTION,
          JSON.stringify(fields), k.doubleOptIn, k.kajabiId, optIn, created,
        ],
      );
      counted("forms", r.rows[0]);
      if (k.notifyRecipients) note("forms", "Kajabi team notification recipients not carried over");
      formIdByKajabi.set(k.kajabiId, r.rows[0].id);
      formKeyMap.set(k.kajabiId, (header) => headerToKey.get(norm(header)) ?? null);
      vlog(`  form new: Kajabi ${k.kajabiId} "${k.title}" -> #${r.rows[0].id} /${slug} (${fields.length} questions)`);
    }

    /* ------------------------------------------------- form submissions */
    for (const k of kForms) {
      const formId = formIdByKajabi.get(k.kajabiId);
      const keyOf = formKeyMap.get(k.kajabiId);
      const headers = k.subs.headers || [];
      const taken = new Set();
      const fallbackKeys = new Map();
      const keyFor = (h) => {
        const known = keyOf ? keyOf(h) : null;
        if (known) return known;
        if (!fallbackKeys.has(h)) fallbackKeys.set(h, keyFromLabel(h, taken));
        return fallbackKeys.get(h);
      };
      const ri = headers.indexOf("Received");
      const ei = headers.findIndex((h) => /^email$/i.test(h));
      for (const row of k.subs.rows || []) {
        if (!row.kid) {
          skip("form_submissions", "no Kajabi id");
          continue;
        }
        const data = {};
        headers.forEach((h, i) => {
          if (!h || i === ri) return;
          const v = squash(row.cells[i]);
          if (v === "") return;
          data[keyFor(h)] = v;
        });
        const email = ei >= 0 ? squash(row.cells[ei]).toLowerCase() : "";
        const createdAt = ri >= 0 ? parseKajabiDate(row.cells[ri], DEFAULT_TZ) : null;
        if (!createdAt) note("form_submissions", "unreadable Received date, used now()");
        const r = await client.query(
          `INSERT INTO form_submissions (form_id, data, email, created_at, contact_id, kajabi_id, source)
           VALUES ($1, $2::jsonb, $3, COALESCE($4::timestamptz, now()), $5, $6, 'kajabi')
           ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
             form_id = EXCLUDED.form_id, data = EXCLUDED.data, email = EXCLUDED.email,
             created_at = EXCLUDED.created_at, source = 'kajabi',
             contact_id = COALESCE(form_submissions.contact_id, EXCLUDED.contact_id)
           RETURNING id, (xmax = 0) AS inserted`,
          [formId, JSON.stringify(data), email, createdAt, contactFor(email), row.kid],
        );
        counted("form_submissions", r.rows[0]);
        if (contactFor(email)) note("form_submissions", "linked to an existing contact");
      }
      if (k.subs.total && k.subs.total !== (k.subs.rows || []).length) {
        warn(`form ${k.kajabiId}: Kajabi total ${k.subs.total}, dump has ${(k.subs.rows || []).length} rows`);
      }
    }

    /* -------------------------------------------------------- campaigns */
    for (const c of campaigns) {
      const event = c.kajabiEventId ? eventRowByKajabi.get(c.kajabiEventId) : null;
      let anchorKind = "absolute";
      let anchorOffset = 0;
      if (c.type === "EventOccurrenceAction") {
        if (!event) note("email_campaigns", "event email whose Kajabi event is not in the events dump (no anchor)");
        else {
          const hit = event.actions.find((a) => {
            const at = norm(a.title.replace(/(\.\.\.|…)$/, ""));
            return at.length >= 6 && (norm(c.subject).startsWith(at) || norm(c.name).startsWith(at));
          });
          if (hit) {
            anchorKind = hit.anchorKind;
            anchorOffset = hit.offset;
          } else note("email_campaigns", "event email linked to its event, timing not found in Kajabi's action list");
        }
      }
      const created = c.sentAt || c.updatedAt || campaignDate(Number(c.kajabiId)) || new Date();
      if (!c.hasPreview) note("email_campaigns", "no body in the previews dump");
      // A record of what went out keeps Kajabi's From; a draft someone may send uses our sender.
      const fromName = c.status === "sent" ? c.from.name : "";
      const fromEmail = c.status === "sent" ? c.from.email : "";
      const r = await client.query(
        `INSERT INTO email_campaigns
           (name, subject, preview_text, body_md, audience, status, scheduled_at, sent_at,
            recipient_count, opened_count, clicked_count, unsubscribed_count, folder, topic,
            from_name, from_email, timezone, anchor_kind, anchor_event_id, anchor_offset_minutes,
            kajabi_id, source, kajabi_type, kajabi_status, kajabi_event_id, kajabi_audience,
            kajabi_scheduled_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11,$12,'marketing',$13,$14,$15,$16,$17,$18,
                 $19,'kajabi',$20,$21,$22,$23,$24,$25,$25)
         ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
           name = EXCLUDED.name, subject = EXCLUDED.subject, preview_text = EXCLUDED.preview_text,
           body_md = EXCLUDED.body_md, audience = EXCLUDED.audience, status = EXCLUDED.status,
           scheduled_at = NULL, sent_at = EXCLUDED.sent_at, recipient_count = EXCLUDED.recipient_count,
           opened_count = EXCLUDED.opened_count, clicked_count = EXCLUDED.clicked_count,
           unsubscribed_count = EXCLUDED.unsubscribed_count, folder = EXCLUDED.folder,
           from_name = EXCLUDED.from_name, from_email = EXCLUDED.from_email, timezone = EXCLUDED.timezone,
           anchor_kind = EXCLUDED.anchor_kind, anchor_event_id = EXCLUDED.anchor_event_id,
           anchor_offset_minutes = EXCLUDED.anchor_offset_minutes, source = 'kajabi',
           kajabi_type = EXCLUDED.kajabi_type, kajabi_status = EXCLUDED.kajabi_status,
           kajabi_event_id = EXCLUDED.kajabi_event_id, kajabi_audience = EXCLUDED.kajabi_audience,
           kajabi_scheduled_at = EXCLUDED.kajabi_scheduled_at, created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at
         WHERE email_campaigns.status IN ('sent', 'draft')
         RETURNING id, (xmax = 0) AS inserted`,
        [
          c.name, c.subject, c.previewText, c.bodyMd, SENTINEL_AUDIENCE, c.status, c.sentAt,
          c.stats?.send_count ?? 0, c.stats?.opened_count ?? 0, c.stats?.clicked_count ?? 0,
          c.stats?.unsubscribed_count ?? 0, c.folder, fromName, fromEmail, DEFAULT_TZ,
          anchorKind, event?.id ?? null, anchorOffset, c.kajabiId, c.type, c.kajabiStatus,
          c.kajabiEventId, c.to, c.scheduledFor, created,
        ],
      );
      if (r.rows[0]) counted("email_campaigns", r.rows[0]);
      else skip("email_campaigns", "already imported and since scheduled/sent here — left alone");
      if (c.kajabiStatus === "scheduled") note("email_campaigns", "Kajabi 'scheduled' -> draft (Kajabi sends it; kajabi_scheduled_at kept)");
    }

    /* ---------------------------------------------------------- funnels */
    const takenFunnelSlugs = await takenSlugs(client, "funnels");
    const pageByTitle = new Map(
      d.funnelPages.map((p) => [squash(inputOf(p, "landing_page[title]")).toLowerCase(), p]),
    );
    for (const f of d.funnels) {
      const existing = await client.query(`SELECT id, slug FROM funnels WHERE kajabi_id = $1`, [f.id]);
      const slug = existing.rows[0]?.slug ?? freeSlug(slugify(f.title, "funnel"), takenFunnelSlugs);
      const kind = { new_sales_page: "sales" }[f.blueprint_id] || "sales";
      const pages = d.funnelPages.map((p) => ({
        kajabiId: idFromHref(p.p, "landing_pages"),
        title: squash(inputOf(p, "landing_page[title]")),
        path: squash(inputOf(p, "landing_page[path]")),
        pageTitle: squash(inputOf(p, "landing_page[page_title]")),
        description: squash(textareaOf(p, "landing_page[page_description]")),
        published: inputOf(p, "landing_page[publishing_option]") === "published",
      }));
      const description =
        `Imported from Kajabi (${f.title}; blueprint ${f.blueprint_id}, ${f.steps} steps, ${f.visitors} visitors, status ${f.status}). ` +
        `Its pages are served by this site: ${pages.map((p) => `/${p.path}`).join(", ")}. ` +
        `Kajabi's third step is its checkout, which had no offer attached.`;
      const r = await client.query(
        `INSERT INTO funnels (slug, name, description, kind, published, kajabi_id, source, kajabi_status,
                              kajabi_visitors, created_at, updated_at)
         VALUES ($1,$2,$3,$4,false,$5,'kajabi',$6,$7,$8,$8)
         ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, kind = EXCLUDED.kind,
           source = 'kajabi', kajabi_status = EXCLUDED.kajabi_status, kajabi_visitors = EXCLUDED.kajabi_visitors
         RETURNING id, (xmax = 0) AS inserted`,
        [slug, squash(f.title), description, kind, f.id, f.status, f.visitors ?? null, f.created_at ? new Date(f.created_at) : new Date()],
      );
      counted("funnels", r.rows[0]);
      const funnelId = r.rows[0].id;
      let sort = 0;
      for (const p of pages) {
        const isThanks = /thank/i.test(p.title) || /thank-you/.test(p.path);
        const sr = await client.query(
          `INSERT INTO funnel_steps (funnel_id, name, slug, step_type, headline, body_md, cta_label, cta_url,
                                     sort, views, kajabi_id, source, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'Open page',$7,$8,$9,$10,'kajabi',$11,$11)
           ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
             funnel_id = EXCLUDED.funnel_id, name = EXCLUDED.name, slug = EXCLUDED.slug,
             step_type = EXCLUDED.step_type, headline = EXCLUDED.headline, body_md = EXCLUDED.body_md,
             cta_url = EXCLUDED.cta_url, sort = EXCLUDED.sort, views = EXCLUDED.views, source = 'kajabi'
           RETURNING id, (xmax = 0) AS inserted`,
          [
            funnelId, p.title, p.path, isThanks ? "thank_you" : "landing", p.pageTitle || p.title,
            p.description, `/${p.path}`, sort, sort === 0 ? f.visitors ?? 0 : 0, p.kajabiId,
            f.created_at ? new Date(f.created_at) : new Date(),
          ],
        );
        counted("funnel_steps", sr.rows[0]);
        if (!p.published) note("funnel_steps", `Kajabi page /${p.path} is not published there`);
        sort += 1;
      }
      void pageByTitle;
    }

    /* ------------------------------------------------------ automations */
    const offers = (await client.query(`SELECT id, title, internal_title FROM offers`)).rows;
    const assessments = (await client.query(`SELECT id, title FROM assessments`)).rows;
    const tagRows = (await client.query(`SELECT id, name, slug::text AS slug FROM tags`)).rows;
    const tagsByName = new Map(tagRows.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const tagsBySlug = new Map(tagRows.map((t) => [t.slug.toLowerCase(), t.id]));
    const takenTagSlugs = new Set(tagRows.map((t) => t.slug.toLowerCase()));
    const kSeqByName = new Map(sequences.map((q) => [norm(q.name), q]));

    const uniqueBy = (rows, fn, value) => {
      const hits = rows.filter((r) => fn(r) === value);
      return hits.length === 1 ? hits[0] : null;
    };
    // Exact title first: "The Lounge | VIP" and "The Lounge VIP" are two different offers.
    const exact = (s) => squash(s).toLowerCase();
    const offerFor = (name) => {
      const n = norm(name);
      if (!n) return null;
      return (
        uniqueBy(offers, (o) => exact(o.title), exact(name)) ||
        uniqueBy(offers, (o) => exact(o.internal_title), exact(name)) ||
        uniqueBy(offers, (o) => norm(o.title), n) ||
        uniqueBy(offers, (o) => norm(o.internal_title), n)
      );
    };
    const assessmentFor = (name) => uniqueBy(assessments, (a) => norm(a.title), norm(name));
    const tagFor = async (name) => {
      const clean = squash(decodeEntities(name || ""));
      if (!clean) return null;
      // Kajabi's tag "quiz-visionary" is our tag with slug quiz-visionary.
      const known = tagsByName.get(clean.toLowerCase()) ?? tagsBySlug.get(slugify(clean, "tag"));
      if (known) return known;
      const slug = freeSlug(slugify(clean, "tag"), takenTagSlugs);
      const r = await client.query(
        `INSERT INTO tags (name, slug, description) VALUES ($1, $2, 'Created by the Kajabi automations import')
         ON CONFLICT (slug) DO UPDATE SET name = tags.name RETURNING id, (xmax = 0) AS inserted`,
        [clean, slug],
      );
      counted("tags", r.rows[0]);
      tagsByName.set(clean.toLowerCase(), r.rows[0].id);
      return r.rows[0].id;
    };

    // "Add a tag" names, from each form's own automations list (newest first, as on the form page).
    const formTagNames = new Map();
    for (const k of kForms) {
      const names = [];
      for (const piece of k.autoSeg.split(`Form is submitted ${k.title} `).slice(1)) {
        const m = piece.match(/^Add a tag (.*?) (?:&mdash;|—) Edit/);
        if (m) names.push(m[1]);
      }
      formTagNames.set(k.kajabiId, names);
    }
    const addTagByAutomation = new Map();
    for (const [fid, names] of formTagNames) {
      const autos = d.automations
        .filter((a) => a.when.label === "Form is submitted" && a.then.label === "Add a tag" && idFromHref(a.when.href, "forms") === fid)
        .sort((a, b) => b.kajabi_id - a.kajabi_id);
      if (autos.length && autos.length === names.length) autos.forEach((a, i) => addTagByAutomation.set(String(a.kajabi_id), names[i]));
      else if (autos.length) warn(`form ${fid}: ${autos.length} add-tag automations but ${names.length} tag names on its page`);
    }

    const unmapped = [];
    const kajabiAutomationIds = [];
    for (const a of d.automations) {
      const kid = String(a.kajabi_id);
      kajabiAutomationIds.push(kid);
      const dialog = autoDialogs.get(kid);
      const notes = [];
      const kajabi = {
        id: kid,
        when: { label: a.when.label, name: a.when.name, href: a.when.href },
        then: { label: a.then.label, name: a.then.name, href: a.then.href },
      };

      // ----- trigger
      let triggerType;
      let subjectKey;
      let subjectId = NO_MATCH_ID;
      const wl = a.when.label;
      if (wl === "Form is submitted") {
        triggerType = "form_submitted";
        subjectKey = "formId";
        subjectId = formIdByKajabi.get(idFromHref(a.when.href, "forms")) ?? NO_MATCH_ID;
      } else if (wl === "Offer is purchased" || wl === "Payment plan complete") {
        triggerType = wl === "Offer is purchased" ? "offer_purchased" : "payment_plan_completed";
        subjectKey = "offerId";
        subjectId = offerFor(a.when.name)?.id ?? NO_MATCH_ID;
      } else if (wl === "Recurring payments cancelation initiated/completed") {
        triggerType = "subscription_cancelled";
        subjectKey = "planId";
        notes.push(`Kajabi fires this for the offer “${a.when.name}”; there is no matching subscription plan here`);
      } else if (wl === "Email sequence is completed") {
        triggerType = "sequence_completed";
        subjectKey = "sequenceId";
        subjectId = seqIdByKajabi.get(idFromHref(a.when.href, "email_sequences")) ?? NO_MATCH_ID;
      } else if (wl === "Email sequence email is sent") {
        // No "an email in a sequence went out" trigger here. When that email is the
        // sequence's first, sent immediately, "is added to the sequence" is the same moment.
        const step = seqStepIndex.get(idFromHref(a.when.href, "email_sequence_emails"));
        triggerType = "sequence_subscribed";
        subjectKey = "sequenceId";
        if (step && step.position === 1 && /^immediately$/i.test(step.when)) {
          subjectId = seqIdByKajabi.get(step.seqKajabiId) ?? NO_MATCH_ID;
          notes.push(`Kajabi: when the email “${a.when.name}” is sent — it is the first email of its sequence, sent immediately, so this fires when someone is added to that sequence`);
        } else notes.push(`Kajabi: when the email “${a.when.name}” is sent — no equivalent trigger here`);
      } else if (wl === "Tag is added") {
        triggerType = "tag_added";
        subjectKey = "tagId";
        // Kajabi's list leaves the tag blank; the target sequence's entry rules name it.
        const target = sequences.find((q) => String(q.kajabiId) === idFromHref(a.then.href, "email_sequences"));
        const tagNames = (target?.triggers || []).filter((t) => /^Tag is added: /.test(t)).map((t) => t.slice(14));
        if (tagNames.length === 1) subjectId = (await tagFor(tagNames[0])) ?? NO_MATCH_ID;
        else notes.push("Kajabi's export does not say which tag");
      } else if (wl === "Quiz is passed" || wl === "Quiz is completed" || wl === "Assessment is completed") {
        triggerType = wl === "Quiz is passed" ? "assessment_passed" : "assessment_completed";
        subjectKey = "assessmentId";
        subjectId = assessmentFor(a.when.name)?.id ?? NO_MATCH_ID;
      } else {
        triggerType = "form_submitted";
        subjectKey = "formId";
        notes.push(`Kajabi trigger “${wl}” has no equivalent here`);
      }
      if (subjectId === NO_MATCH_ID && triggerType !== "subscription_cancelled") {
        notes.push(`couldn't find “${a.when.name ?? "(unnamed)"}” here for the trigger — it is pinned to nothing until you choose one`);
      }
      if (dialog?.passedAssessmentId) {
        kajabi.passedAssessmentId = dialog.passedAssessmentId;
        notes.push(`Kajabi also required “has passed assessment ${dialog.passedAssessmentId}”, which has no condition here`);
      }

      // ----- action
      let actionType;
      const config = { kajabi: { label: a.then.label, name: a.then.name, href: a.then.href } };
      const tl = a.then.label;
      if (tl === "Subscribe to an email sequence" || tl === "Unsubscribe from an email sequence") {
        actionType = tl.startsWith("Subscribe") ? "subscribe_sequence" : "unsubscribe_sequence";
        const id = seqIdByKajabi.get(idFromHref(a.then.href, "email_sequences"));
        if (id) config.sequenceId = id;
        else notes.push(`sequence “${a.then.name}” isn't here`);
      } else if (tl === "Add a tag") {
        actionType = "add_tag";
        const name = addTagByAutomation.get(kid) || a.then.name || null;
        const id = name ? await tagFor(name) : null;
        if (id) {
          config.tagId = id;
          config.kajabi.name = name;
        } else notes.push("Kajabi's export does not say which tag to add — choose one");
      } else if (tl === "Send an email") {
        actionType = "send_email";
        config.subject = dialog?.subject || "";
        config.bodyMd = dialog?.bodyMd || "";
        config.fromName = "";
        config.fromEmail = "";
        config.topic = "marketing";
        if (!config.subject || !config.bodyMd) notes.push("the email's subject or body wasn't in the export");
      } else if (tl === "Register to an event") {
        actionType = "register_event";
        const id = eventIdByKajabi.get(idFromHref(a.then.href, "events"));
        if (id) config.eventId = id;
        else notes.push(`event “${a.then.name}” isn't here`);
      } else if (tl === "Grant an offer" || tl === "Revoke an offer" || tl === "Deactivate from offer") {
        actionType = tl === "Grant an offer" ? "grant_offer" : "revoke_offer";
        const offer = offerFor(a.then.name);
        if (offer) config.offerId = offer.id;
        else notes.push(`offer “${a.then.name}” isn't here`);
      } else {
        actionType = "create_task";
        config.title = clip(`Kajabi step “${tl}” — set this up by hand`, 120);
        config.note = "";
        notes.push(`Kajabi step “${tl}” has no equivalent here`);
      }

      const whenPart = a.when.name ? `${a.when.label}: ${clip(a.when.name, 70)}` : a.when.label;
      const thenName = a.then.name || (actionType === "add_tag" ? addTagByAutomation.get(kid) : null) || (actionType === "send_email" ? config.subject : null);
      const thenPart = thenName ? `${a.then.label}: ${clip(thenName, 70)}` : a.then.label;
      const name = clip(`${whenPart} → ${thenPart}`, 200);
      const sentence =
        `When ${a.when.label.toLowerCase()}${a.when.name ? ` “${a.when.name}”` : ""}, then ${a.then.label.toLowerCase()}` +
        `${thenName ? ` “${thenName}”` : ""}${a.if && a.if !== "—" ? ` (only if: ${a.if})` : ""}.`;
      const description = [sentence, ...notes.map((n) => `${n[0].toUpperCase()}${n.slice(1)}.`)].join(" ");

      // Flat scalars only: the admin PATCH validates triggerConfig as record<string, scalar>.
      const triggerConfig = {
        [subjectKey]: subjectId,
        kajabiId: kid,
        kajabiWhen: a.when.name ? `${a.when.label}: ${a.when.name}` : a.when.label,
        kajabiWhenHref: a.when.href ?? null,
        ...(kajabi.passedAssessmentId ? { kajabiPassedAssessmentId: kajabi.passedAssessmentId } : {}),
      };
      const r = await client.query(
        `INSERT INTO automations (name, description, trigger_type, trigger_config, conditions, status,
                                  kajabi_id, source, created_at, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,'{"match":"all","rules":[]}'::jsonb,'paused',$5,'kajabi',now(),now())
         ON CONFLICT (kajabi_id) WHERE kajabi_id IS NOT NULL DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description, trigger_type = EXCLUDED.trigger_type,
           trigger_config = EXCLUDED.trigger_config, conditions = EXCLUDED.conditions,
           status = 'paused', source = 'kajabi', updated_at = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [name, description, triggerType, JSON.stringify(triggerConfig), kid],
      );
      counted("automations", r.rows[0]);
      const automationId = r.rows[0].id;
      const del = await client.query(`DELETE FROM automation_actions WHERE automation_id = $1 RETURNING id`, [automationId]);
      if (!r.rows[0].inserted) tally("automation_actions").deleted += del.rowCount;
      const ar = await client.query(
        `INSERT INTO automation_actions (automation_id, action_type, config, sort, delay_minutes, conditions)
         VALUES ($1, $2, $3::jsonb, 0, 0, '{}'::jsonb) RETURNING id, true AS inserted`,
        [automationId, actionType, JSON.stringify(config)],
      );
      counted("automation_actions", ar.rows[0]);
      if (actionType === "add_tag" && config.tagId) note("automation_actions", `add_tag “${config.kajabi.name}”`);
      if (notes.length) unmapped.push({ kid, id: automationId, name, notes });
      vlog(`  automation ${kid} -> #${automationId} ${triggerType}(${subjectKey}=${subjectId}) -> ${actionType} ${JSON.stringify({ ...config, kajabi: undefined, bodyMd: config.bodyMd ? `${config.bodyMd.length} chars` : undefined })}`);
    }

    /* ------------------------------------------------------- safety checks */
    const liveAfter = await snapshotLiveAutomations(client);
    if (liveBefore !== liveAfter) throw new Error("live automations 6–25 changed — aborting");

    const checks = await client.query(`
      SELECT
        (SELECT count(*) FROM email_campaigns WHERE source = 'kajabi' AND status NOT IN ('sent','draft'))        AS campaigns_not_sent_or_draft,
        (SELECT count(*) FROM email_campaigns WHERE source = 'kajabi' AND scheduled_at IS NOT NULL)               AS campaigns_with_schedule,
        (SELECT count(*) FROM email_campaigns WHERE source = 'kajabi' AND audience <> '${SENTINEL_AUDIENCE}')     AS campaigns_with_real_audience,
        (SELECT count(*) FROM automations WHERE source = 'kajabi' AND status <> 'paused')                         AS automations_not_paused,
        (SELECT count(*) FROM sequence_subscriptions s JOIN email_sequences q ON q.id = s.sequence_id
          WHERE q.source = 'kajabi')                                                                             AS kajabi_sequence_subscriptions,
        (SELECT count(*) FROM forms f WHERE f.subscribe_sequence_id IN (SELECT id FROM email_sequences WHERE source = 'kajabi')) AS forms_enrolling_into_kajabi_sequences,
        (SELECT count(*) FROM funnels f WHERE f.sequence_id IN (SELECT id FROM email_sequences WHERE source = 'kajabi'))         AS funnels_enrolling_into_kajabi_sequences,
        (SELECT count(*) FROM automation_actions x JOIN automations a ON a.id = x.automation_id
          WHERE a.status = 'active' AND x.action_type = 'subscribe_sequence'
            AND (x.config->>'sequenceId')::int IN (SELECT id FROM email_sequences WHERE source = 'kajabi'))      AS active_automations_enrolling_into_kajabi_sequences,
        (SELECT count(*) FROM events WHERE source = 'kajabi' AND published)                                       AS kajabi_events_published,
        (SELECT count(*) FROM event_reminders r JOIN events e ON e.id = r.event_id WHERE e.source = 'kajabi')     AS kajabi_event_reminders,
        (SELECT count(*) FROM forms WHERE source = 'kajabi' AND kajabi_id IS NOT NULL AND published
            AND id NOT IN (${[...formMatch.values()].map((f) => Number(f.id)).join(",") || "0"}))                AS new_forms_published
    `);
    const safety = checks.rows[0];
    const bad = Object.entries(safety).filter(([k, v]) => Number(v) !== 0);

    const counts = await client.query(`
      SELECT 'email_campaigns' AS t, count(*) FILTER (WHERE source = 'kajabi') AS kajabi, count(*) AS total FROM email_campaigns
      UNION ALL SELECT 'email_campaigns (broadcast)', count(*) FILTER (WHERE kajabi_type = 'EmailBroadcast'), NULL FROM email_campaigns
      UNION ALL SELECT 'email_campaigns (event email)', count(*) FILTER (WHERE kajabi_type = 'EventOccurrenceAction'), NULL FROM email_campaigns
      UNION ALL SELECT 'email_campaigns (event-anchored)', count(*) FILTER (WHERE source = 'kajabi' AND anchor_event_id IS NOT NULL), NULL FROM email_campaigns
      UNION ALL SELECT 'email_sequences', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM email_sequences
      UNION ALL SELECT 'sequence_emails', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM sequence_emails
      UNION ALL SELECT 'events', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM events
      UNION ALL SELECT 'event_registrations', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM event_registrations
      UNION ALL SELECT 'forms (kajabi-linked)', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM forms
      UNION ALL SELECT 'form_submissions', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM form_submissions
      UNION ALL SELECT 'funnels', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM funnels
      UNION ALL SELECT 'funnel_steps', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM funnel_steps
      UNION ALL SELECT 'automations', count(*) FILTER (WHERE source = 'kajabi'), count(*) FROM automations
      UNION ALL SELECT 'automation_actions', count(*) FILTER (WHERE a.source = 'kajabi'), count(*)
                  FROM automation_actions x JOIN automations a ON a.id = x.automation_id
      UNION ALL SELECT 'ZZ rows left', (SELECT count(*) FROM events WHERE title LIKE 'ZZ%')
                  + (SELECT count(*) FROM funnels WHERE name LIKE 'ZZ%') + (SELECT count(*) FROM forms WHERE name LIKE 'ZZ%')
                  + (SELECT count(*) FROM email_sequences WHERE name LIKE 'ZZ%') + (SELECT count(*) FROM automations WHERE name LIKE 'ZZ%'), NULL
    `);

    printSummary(counts.rows, safety, unmapped);
    if (VERBOSE) await printSamples(client);

    if (bad.length) {
      throw new Error(`safety check failed: ${bad.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    if (pass === 2) {
      const inserted = [...summary].filter(([k, t]) => t.inserted > 0 && k !== "automation_actions");
      if (inserted.length) throw new Error(`rerun inserted rows: ${inserted.map(([k, t]) => `${k}=${t.inserted}`).join(", ")}`);
      log("\nrerun check: pass 2 inserted nothing new (automation steps are replaced by design)");
    }
    }

    if (DRY) {
      await client.query("ROLLBACK");
      log(`\nDRY RUN — rolled back. Nothing was written. (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } else {
      await client.query("COMMIT");
      log(`\nCOMMITTED. (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    finished = true;
  } finally {
    if (!finished) await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
}

/* --------------------------------------------------------- db helpers -- */

async function countImportColumns(client) {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE 'kajabi\\_%' OR column_name = 'source'
             OR (table_name = 'email_sequences' AND column_name IN ('recipient_count','opened_count','clicked_count','unsubscribed_count')))
        AND table_name IN ('email_campaigns','email_sequences','sequence_emails','events','event_registrations',
                           'funnels','funnel_steps','forms','form_submissions','automations')`,
  );
  return r.rows[0].n;
}

async function takenSlugs(client, table) {
  const r = await client.query(`SELECT lower(slug::text) AS slug FROM ${table}`);
  return new Set(r.rows.map((row) => row.slug));
}

async function snapshotLiveAutomations(client) {
  const r = await client.query(
    `SELECT md5(string_agg(row_to_json(a)::text || coalesce(x.acts, ''), '|' ORDER BY a.id)) AS h
       FROM automations a
       LEFT JOIN LATERAL (SELECT string_agg(row_to_json(y)::text, ',' ORDER BY y.id) AS acts
                            FROM automation_actions y WHERE y.automation_id = a.id) x ON true
      WHERE a.id = ANY($1::int[])`,
    [LIVE_AUTOMATION_IDS],
  );
  return r.rows[0].h;
}

/** The rebuild's own dummy rows, only while they are still called "ZZ …". */
async function deleteZz(client) {
  // Nothing live may point at what is about to go.
  const refs = await client.query(
    `SELECT a.id, a.name FROM automations a
      WHERE NOT (a.id = ANY($1::int[]) AND a.name LIKE 'ZZ%')
        AND ((a.trigger_config->>'formId')::text = ANY($2::text[])
          OR (a.trigger_config->>'eventId')::text = ANY($3::text[])
          OR (a.trigger_config->>'sequenceId')::text = ANY($4::text[])
          OR EXISTS (SELECT 1 FROM automation_actions x WHERE x.automation_id = a.id
                      AND ((x.config->>'sequenceId')::text = ANY($4::text[])
                        OR (x.config->>'eventId')::text = ANY($3::text[]))))`,
    [ZZ.automations, ZZ.forms.map(String), ZZ.events.map(String), ZZ.sequences.map(String)],
  );
  for (const row of refs.rows) {
    warn(`automation #${row.id} "${row.name}" points at a ZZ row being deleted (left as is; its step will show as unfinished)`);
  }

  const children = async (sql, ids) => Number((await client.query(sql, [ids])).rows[0].n);
  const t = tally("ZZ cleanup");
  const before = {
    registrations: await children(`SELECT count(*) AS n FROM event_registrations WHERE event_id = ANY($1::int[])`, ZZ.events),
    reminders: await children(`SELECT count(*) AS n FROM event_reminders WHERE event_id = ANY($1::int[])`, ZZ.events),
    steps: await children(`SELECT count(*) AS n FROM funnel_steps WHERE funnel_id = ANY($1::int[])`, ZZ.funnels),
    submissions: await children(`SELECT count(*) AS n FROM form_submissions WHERE form_id = ANY($1::int[])`, ZZ.forms),
    seqEmails: await children(`SELECT count(*) AS n FROM sequence_emails WHERE sequence_id = ANY($1::int[])`, ZZ.sequences),
    subscriptions: await children(`SELECT count(*) AS n FROM sequence_subscriptions WHERE sequence_id = ANY($1::int[])`, ZZ.sequences),
    actions: await children(`SELECT count(*) AS n FROM automation_actions WHERE automation_id = ANY($1::int[])`, ZZ.automations),
    runs: await children(`SELECT count(*) AS n FROM automation_runs WHERE automation_id = ANY($1::int[])`, ZZ.automations),
  };
  const del = async (label, sql, ids) => {
    const r = await client.query(sql, [ids]);
    t.deleted += r.rowCount;
    for (const row of r.rows) log(`  ZZ cleanup: deleted ${label} #${row.id} "${row.name}"`);
    return r.rowCount;
  };
  // Automation first (its step points at sequence 1), then the rest; FKs cascade the children.
  await del("automation", `DELETE FROM automations WHERE id = ANY($1::int[]) AND name LIKE 'ZZ%' RETURNING id, name`, ZZ.automations);
  await del("funnel", `DELETE FROM funnels WHERE id = ANY($1::int[]) AND name LIKE 'ZZ%' RETURNING id, name`, ZZ.funnels);
  await del("form", `DELETE FROM forms WHERE id = ANY($1::int[]) AND name LIKE 'ZZ%' RETURNING id, name`, ZZ.forms);
  await del("event", `DELETE FROM events WHERE id = ANY($1::int[]) AND title LIKE 'ZZ%' RETURNING id, title AS name`, ZZ.events);
  await del("sequence", `DELETE FROM email_sequences WHERE id = ANY($1::int[]) AND name LIKE 'ZZ%' RETURNING id, name`, ZZ.sequences);
  const kids = Object.entries(before).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ");
  if (kids) note("ZZ cleanup", `cascaded: ${kids}`);
}

/* --------------------------------------------------------- field builder -- */

const TYPE_MAP = {
  TextField: "text",
  EmailField: "email",
  TextAreaField: "textarea",
  PhoneField: "phone",
  SelectBoxField: "select",
  RadioButtonsField: "radio",
  CheckboxField: "checkbox",
  CountryField: "text",
  NumberField: "number",
  DateField: "date",
};
function buildField(kf, keys, labelOptions, subs) {
  const label = kf.label.slice(0, 200);
  const n = norm(label);
  let type = TYPE_MAP[kf.type] || "text";
  const field = { key: "", label, type, required: false };
  if (n === "firstname") Object.assign(field, { key: "first_name", contactField: "firstName", required: true });
  else if (n === "lastname") Object.assign(field, { key: "last_name", contactField: "lastName" });
  else if (kf.type === "EmailField") Object.assign(field, { key: "email", contactField: "email", required: true });
  else if (kf.type === "PhoneField") Object.assign(field, { key: "phone", contactField: "phone" });
  if (field.key) {
    if (keys.has(field.key)) field.key = keyFromLabel(label, keys);
    else keys.add(field.key);
  } else field.key = keyFromLabel(label, keys);

  if (type === "select" || type === "radio") {
    let options = labelOptions.get(n) || null;
    if (!options) {
      const col = (subs.headers || []).findIndex((h) => norm(h) === n);
      if (col >= 0) {
        const values = [...new Set((subs.rows || []).map((r) => squash(r.cells[col])).filter(Boolean))];
        if (values.length) {
          options = values.slice(0, 100).map((v) => v.slice(0, 200));
          field.helpText = "Choices rebuilt from the answers Kajabi had collected; Kajabi may have offered more.";
        }
      }
    }
    if (options) field.options = options;
    else {
      field.type = "text";
      field.helpText = `In Kajabi this was a ${type === "select" ? "drop-down" : "multiple-choice"} question; its choices weren't in the export.`;
    }
  }
  if (kf.type === "CountryField") field.helpText = "In Kajabi this was a country picker.";
  return field;
}

/** For a matched form: Kajabi column header -> our question's key (by label, then by contact detail). */
function headerKeysFor(fields, headers) {
  const map = new Map();
  for (const h of headers || []) {
    if (!h || h === "Received") continue;
    const n = norm(h);
    const byLabel = fields.find((f) => norm(f.label) === n);
    let hit = byLabel;
    if (!hit && n === "firstname") hit = fields.find((f) => f.contactField === "firstName") || fields.find((f) => f.key === "first_name" || f.key === "name");
    if (!hit && n === "lastname") hit = fields.find((f) => f.contactField === "lastName") || fields.find((f) => f.key === "last_name");
    if (!hit && n === "email") hit = fields.find((f) => f.contactField === "email" || f.type === "email");
    if (!hit && n.startsWith("phone")) hit = fields.find((f) => f.contactField === "phone" || f.type === "phone");
    if (hit) map.set(n, hit.key);
  }
  return (header) => map.get(norm(header)) ?? null;
}

/* --------------------------------------------------------------- output -- */

async function printSamples(client) {
  const show = async (label, sql) => {
    const r = await client.query(sql);
    log(`
--- sample: ${label}`);
    for (const row of r.rows) log(JSON.stringify(row, null, 1).slice(0, 2500));
  };
  await show("broadcast", `SELECT id, name, status, sent_at, recipient_count, opened_count, from_email, kajabi_audience, left(body_md, 900) AS body FROM email_campaigns WHERE kajabi_id = 32616073`);
  await show("event email", `SELECT id, name, anchor_kind, anchor_event_id, anchor_offset_minutes, sent_at, left(body_md, 400) AS body FROM email_campaigns WHERE kajabi_type = 'EventOccurrenceAction' ORDER BY sent_at DESC LIMIT 3`);
  await show("scheduled->draft", `SELECT id, name, status, kajabi_status, kajabi_scheduled_at, scheduled_at, created_at FROM email_campaigns WHERE kajabi_status = 'scheduled' LIMIT 2`);
  await show("sequence", `SELECT q.id, q.name, q.slug, q.status, q.recipient_count, q.created_at, (SELECT json_agg(json_build_object('pos', e.position, 'delay', e.delay_minutes, 'when', e.kajabi_when, 'sent', e.kajabi_sent_count, 'open', e.kajabi_opened_pct, 'subj', e.subject) ORDER BY e.position) FROM sequence_emails e WHERE e.sequence_id = q.id) AS emails FROM email_sequences q WHERE q.kajabi_id = 2148593386`);
  await show("sequence email body", `SELECT left(body_md, 900) AS body FROM sequence_emails WHERE kajabi_id = (SELECT min(kajabi_id) FROM sequence_emails WHERE body_md LIKE '%{{firstName}}%')`);
  await show("events", `SELECT id, slug, title, kind, starts_at, timezone, duration_minutes, evergreen_interval_minutes, recurrence_freq, room_url, kajabi_recurrence FROM events WHERE source = 'kajabi' ORDER BY starts_at DESC NULLS LAST`);
  await show("new form", `SELECT id, slug, name, published, double_opt_in, kajabi_opt_in, created_at, fields FROM forms WHERE kajabi_id = 2149358494`);
  await show("matched form submission", `SELECT s.form_id, s.data, s.created_at, s.contact_id FROM form_submissions s JOIN forms f ON f.id = s.form_id WHERE f.slug = 'marketing-step-form' AND s.source = 'kajabi' LIMIT 2`);
  await show("automation send_email", `SELECT a.id, a.name, a.trigger_type, a.trigger_config - 'kajabi' AS trig, x.config->>'subject' AS subject, left(x.config->>'bodyMd', 500) AS body FROM automations a JOIN automation_actions x ON x.automation_id = a.id WHERE a.kajabi_id = 2155543604`);
  await show("funnel", `SELECT f.id, f.slug, f.kind, f.kajabi_visitors, (SELECT json_agg(json_build_object('name', s.name, 'type', s.step_type, 'cta', s.cta_url, 'views', s.views) ORDER BY s.sort) FROM funnel_steps s WHERE s.funnel_id = f.id) AS steps FROM funnels f WHERE f.source = 'kajabi'`);
  await show("tags created", `SELECT id, name, slug FROM tags WHERE description = 'Created by the Kajabi automations import'`);
}

function printSummary(countRows, safety, unmapped) {
  const order = [
    "ZZ cleanup", "events", "event_registrations", "email_sequences", "sequence_emails", "forms",
    "form_submissions", "email_campaigns", "funnels", "funnel_steps", "tags", "automations", "automation_actions",
  ];
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  log("\n=== Summary ===");
  log(`${pad("entity", 22)}${padL("inserted", 9)}${padL("updated", 9)}${padL("matched", 9)}${padL("deleted", 9)}${padL("skipped", 9)}`);
  for (const name of [...order, ...[...summary.keys()].filter((k) => !order.includes(k))]) {
    const t = summary.get(name);
    if (!t) continue;
    log(`${pad(name, 22)}${padL(t.inserted, 9)}${padL(t.updated, 9)}${padL(t.matched, 9)}${padL(t.deleted, 9)}${padL(t.skipped, 9)}`);
    for (const [reason, n] of t.reasons) log(`${pad("", 24)}- ${reason}: ${n}`);
  }
  log(`\nemail greetings put back to {{firstName}} (Kajabi previews were rendered for a real contact): ${greetingsNormalised}`);

  log("\n=== Rows in the database inside this transaction (source = 'kajabi' / all) ===");
  for (const r of countRows) log(`${pad(r.t, 34)}${padL(r.kajabi, 6)}${r.total === null ? "" : ` / ${r.total}`}`);

  log("\n=== Nothing-sends checks (all must be 0) ===");
  for (const [k, v] of Object.entries(safety)) log(`${pad(k, 56)}${v}`);

  log(`\n=== Automations needing a person (${unmapped.length} of them; all imported paused) ===`);
  for (const u of unmapped) log(`- #${u.id} (Kajabi ${u.kid}) ${u.name}\n    ${u.notes.join("\n    ")}`);

  if (warnings.length) {
    log(`\n=== Warnings (${warnings.length}) ===`);
    for (const w of warnings) log(`- ${w}`);
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.stack || err.message || err}`);
  process.exit(1);
});
