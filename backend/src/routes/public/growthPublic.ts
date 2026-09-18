import fs from "fs";
import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { env } from "../../config/env";
import { leadsLimiter } from "../../middleware/rateLimit";
import { fireTriggerAsync } from "../../automations/engine";
// The v2 engine is where the automation builder writes its rules; the legacy
// engine above still owns `lead_created` until that mount is switched, so a form
// submission has to reach both. Aliased because the two export the same name.
import { publishDomainEvent } from "../../services/domainEvents";
import { exitContactOnFormSubmission } from "../../services/sequences";
import {
  applyTags,
  linkContact,
  recordActivity,
  upsertContactWithStatus,
} from "../../services/contacts";
import { enrollContact } from "../../services/sequences";
import { isProtectedRef, signDownload } from "../../services/signedUrls";
import {
  FILE_TYPE,
  answerProblem,
  asFields,
  keptAnswers,
  visibleQuestionKeys,
} from "../../services/formLogic";
import { keepStagedFile, receiveFormFiles, type StagedFile } from "../../services/formUploads";
import { kindFromMime } from "../../services/mediaStorage";

/** Public endpoints for podcasts (RSS), forms and funnels. */
export const growthPublicRouter = Router();

/** Faster than this and nobody read the form, let alone filled it in. */
const MIN_FILL_MS = 2000;

/** XML entity escaping — podcast titles routinely contain & and quotes. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(date: string | Date | null): string {
  return new Date(date ?? Date.now()).toUTCString();
}

/**
 * How long an enclosure URL in a private feed stays alive.
 *
 * A podcast app is not a browser: it fetches the feed on its own schedule —
 * every few hours at best, and not at all while the phone is asleep or the app
 * is closed — then keeps the enclosure URL it found and uses it when the
 * listener presses play, which may be days later. The two hours that
 * `podcast-episode` links normally carry are right for a <video> element on a
 * page somebody is looking at and quite wrong here: the show would work for the
 * first two hours after each refresh and 404 for the rest of the day.
 *
 * A week is long enough that a client which has not refreshed since last
 * Thursday still plays, and short enough that a link forwarded out of a paid
 * feed dies on its own. The listener's own access is re-checked on every hit
 * anyway (routes/public/verify.ts re-proves entitlement per request), so a
 * revoked feed token or a cancelled membership stops the audio immediately
 * rather than at the end of the week.
 */
const FEED_AUDIO_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Where a signed file token is redeemed. Owned by services/signedUrls.ts, which
 * does not export it; the RSS feed needs an absolute URL rather than the
 * relative one `signedFileUrl` builds, and a per-episode lifetime of its own.
 */
const FILE_ROUTE = "/api/files";

function hhmmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * GET /podcast/:slug/rss.xml
 *
 * Private shows require ?token=… matching a non-revoked feed token, which is
 * what lets a single listener's feed be cut off without rotating everyone's.
 */
growthPublicRouter.get(
  "/podcast/:slug/rss.xml",
  asyncHandler(async (req, res) => {
    const podcastResult = await pool.query(
      "SELECT * FROM podcasts WHERE slug = $1 AND published = true",
      [req.params.slug],
    );
    const podcast = podcastResult.rows[0];
    if (!podcast) throw notFound("Podcast not found");

    // Who this copy of the feed is for. Null for a public show, and null for a
    // private feed token that was issued without naming a listener — the audio
    // of such a feed cannot be signed to anybody, which is dealt with below.
    let listenerId: number | null = null;

    if (podcast.visibility === "private") {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) throw forbidden("This feed is private");
      const valid = await pool.query<{ member_id: number | null }>(
        "SELECT member_id FROM podcast_feed_tokens WHERE podcast_id = $1 AND token = $2 AND revoked = false",
        [podcast.id, token],
      );
      if (valid.rowCount === 0) throw forbidden("Invalid or revoked feed token");
      listenerId = valid.rows[0].member_id ?? null;
    }

    const episodes = await pool.query(
      `SELECT * FROM podcast_episodes
        WHERE podcast_id = $1 AND published = true
        ORDER BY published_at DESC NULLS LAST, id DESC`,
      [podcast.id],
    );

    const site = env.publicSiteUrl.replace(/\/$/, "");

    /**
     * The address a podcast app should fetch this episode's audio from.
     *
     * A paid show's audio lives in the protected upload directory, which no web
     * server serves: emitting the stored reference put `…/protected:ep12.mp3`
     * in the enclosure and every app on every phone got a 404 — the show was
     * simply broken for the people paying for it. The protected form has to be
     * signed into a `/api/files` token, and the only person it can be signed for
     * is the listener the feed token names.
     */
    const enclosureUrl = (ep: { id: number; audio_url: unknown }): string => {
      const audio = String(ep.audio_url ?? "");
      if (!isProtectedRef(audio)) {
        // Somebody else's host (a CDN, Libsyn) or a file in the public uploads
        // directory. Neither is ours to sign, and the second is a permanent
        // anonymous URL: audio for a paid show belongs in the protected
        // directory, which is a content decision made at upload time and not
        // something this route can put right. Noted in docs/bugs/backend-growth.md.
        return audio.startsWith("http") ? audio : `${site}${audio}`;
      }
      if (listenerId === null) {
        // A protected file with nobody to sign it to. Better a link that fails
        // than a link that works for everybody, so the stored reference is left
        // as it is: it 404s, exactly as it did before, and does not hand paid
        // audio to an anonymous fetch.
        return `${site}${audio}`;
      }
      const { token } = signDownload({
        kind: "podcast-episode",
        fileId: Number(ep.id),
        memberId: listenerId,
        ttlSeconds: FEED_AUDIO_TTL_SECONDS,
      });
      return `${site}${FILE_ROUTE}/${token}`;
    };

    const items = episodes.rows
      .map((ep) => {
        const audioUrl = enclosureUrl(ep as { id: number; audio_url: unknown });
        return `    <item>
      <title>${xmlEscape(String(ep.title))}</title>
      <description><![CDATA[${ep.show_notes_md || ep.description || ""}]]></description>
      <pubDate>${rfc822(ep.published_at)}</pubDate>
      <guid isPermaLink="false">episode-${ep.id}</guid>
      <enclosure url="${xmlEscape(audioUrl)}" length="${Number(ep.audio_bytes) || 0}" type="audio/mpeg"/>
      <itunes:duration>${hhmmss(Number(ep.duration_seconds) || 0)}</itunes:duration>
      <itunes:episode>${Number(ep.episode_number) || 0}</itunes:episode>
      <itunes:season>${Number(ep.season) || 1}</itunes:season>
      <itunes:explicit>${podcast.explicit ? "true" : "false"}</itunes:explicit>
    </item>`;
      })
      .join("\n");

    const coverImage = String(podcast.cover_image ?? "");
    const coverUrl = coverImage.startsWith("http") ? coverImage : `${site}${coverImage}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEscape(String(podcast.title))}</title>
    <link>${xmlEscape(site)}</link>
    <description><![CDATA[${podcast.description ?? ""}]]></description>
    <language>${xmlEscape(String(podcast.language ?? "en-us"))}</language>
    <itunes:author>${xmlEscape(String(podcast.author ?? ""))}</itunes:author>
    <itunes:explicit>${podcast.explicit ? "true" : "false"}</itunes:explicit>
    <itunes:category text="${xmlEscape(String(podcast.category ?? "Business"))}"/>
    ${coverImage ? `<itunes:image href="${xmlEscape(coverUrl)}"/>` : ""}
    <itunes:type>episodic</itunes:type>
${items}
  </channel>
</rss>`;

    // A private feed now carries one signed link per episode, so it must not sit
    // in a shared cache on the way out.
    if (podcast.visibility === "private") {
      res.setHeader("Cache-Control", "private, no-store");
    }
    res.type("application/rss+xml").send(xml);
  }),
);

/* ------------------------------------------------------------------- Forms */

/** The public contract always names the identity fields, including old forms. */
export function publicFormFields(fields: unknown): Record<string, unknown>[] {
  const custom = Array.isArray(fields)
    ? fields.filter((field) => {
        if (!field || typeof field !== "object") return false;
        const key = (field as Record<string, unknown>).key;
        return key !== "name" && key !== "email";
      })
    : [];
  return [
    { key: "name", label: "Your name", type: "text", required: true },
    { key: "email", label: "Email address", type: "email", required: true },
    ...custom,
  ];
}

growthPublicRouter.get(
  "/forms/:slug",
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      // `description_md`, `post_action` and `redirect_url` are the three the
      // builder writes and this list used to leave behind. Absent from the
      // payload they could not be honoured: the intro Yvette typed never
      // appeared above the questions, and every form ended on the thank-you
      // message however she had configured it — a form built to send people to
      // a booking page simply did not.
      `SELECT id, slug, name, description, description_md, fields, submit_label,
              success_message, post_action, redirect_url
         FROM forms WHERE slug = $1 AND published = true`,
      [req.params.slug],
    );
    if (result.rowCount === 0) throw notFound("Form not found");

    // Views drive the opt-in conversion rate on the Forms screen.
    await pool.query("UPDATE forms SET views = views + 1 WHERE id = $1", [result.rows[0].id]);
    const form = rowsToCamel<Record<string, unknown>>(result.rows)[0];
    res.json({ ...form, fields: publicFormFields(form.fields) });
  }),
);

const submitSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  email: z.string().email().max(320).optional(),
  // The honeypot pair, same shape as the lead form's. On the envelope rather
  // than inside `data`, where a form may well ask for a "company" of its own.
  company: z.string().max(200).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

/**
 * Whether a reply came from a script rather than a person.
 *
 * The same two signals the lead and event forms read: a field nobody can see
 * has something in it, or the form came back faster than anyone could have
 * read it. A reply carrying neither value is let through — a page cached from
 * before the trap existed must not lose somebody's answers.
 */
export function isAutomatedSubmission(input: { company?: string; elapsedMs?: number }): boolean {
  return Boolean(input.company?.trim()) || (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MS);
}

/**
 * A stored question, as much of one as a submission has to understand.
 *
 * `forms.fields` is a jsonb column the builder owns, so a row written by an
 * older version of it may be missing any of these — nothing read out of it is
 * assumed to be there, or to be a string.
 */
interface StoredFormField {
  key?: unknown;
  type?: unknown;
  contactField?: unknown;
}

/**
 * The contact columns a question may be pointed at, and nothing else.
 *
 * `contactField` is text an admin typed: the builder offers five columns and a
 * "a detail of your own" box that accepts whatever she writes in it. Every name
 * on this list becomes a *named argument* of `upsertContact`, which owns the
 * statement; every name off it becomes a key inside the `custom_fields` jsonb,
 * where a strange name is a value rather than an identifier. There is no branch
 * in which any of it reaches SQL as text, which is the point of the list.
 */
const CONTACT_COLUMNS = ["firstName", "lastName", "phone", "timezone"] as const;

type ContactColumn = (typeof CONTACT_COLUMNS)[number];

function isContactColumn(name: string): name is ContactColumn {
  return (CONTACT_COLUMNS as readonly string[]).includes(name);
}

/** The key rule the builder validates against — routes/admin/formsV2.ts. */
const CUSTOM_FIELD_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * Loose enough to be the same rule the page applies, strict enough to protect
 * the contact list.
 *
 * An address is what a contact is keyed on, so anything reaching `contacts`
 * that is not one is a row nobody can ever merge, mail or find again. The
 * envelope's own `email` is validated by the schema above; a question mapped to
 * the address column is not, and neither is a field that merely happens to be
 * keyed `email`.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Long enough for any answer worth segmenting on, short enough to bound a column. */
const CONTACT_VALUE_MAX = 200;

export interface SubmissionContact {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string;
  timezone: string;
  customFields: Record<string, unknown>;
}

/**
 * Reads the contact a submission describes out of the answers.
 *
 * Until this existed the answers reached `form_submissions.data` and stopped
 * there: a form asking for a phone number filed it in a JSON blob that no
 * segment, sequence or contact screen could see, which is the entire reason the
 * builder offers a "save this answer to" menu. The menu was stored and never
 * read.
 *
 * Pure on purpose. The allowlist above is the boundary that keeps an
 * admin-typed name out of a statement, and a boundary is worth being able to
 * test without a database in front of it.
 */
export function contactFromSubmission(
  fields: unknown,
  data: Record<string, unknown>,
  fallbackEmail: string,
): SubmissionContact {
  const asAddress = (value: unknown): string => {
    const address = String(value).trim().toLowerCase().slice(0, 320);
    return EMAIL_SHAPE.test(address) ? address : "";
  };

  const contact: SubmissionContact = {
    email: asAddress(fallbackEmail),
    name: "",
    firstName: "",
    lastName: "",
    phone: "",
    timezone: "",
    customFields: {},
  };

  for (const stored of Array.isArray(fields) ? (fields as StoredFormField[]) : []) {
    const key = typeof stored?.key === "string" ? stored.key : "";
    const target = typeof stored?.contactField === "string" ? stored.contactField.trim() : "";
    if (!key || !target) continue;
    // A file is attached to the contact as a file (see the submit route), never
    // written into a text detail as its metadata.
    if (stored?.type === FILE_TYPE) continue;

    const answer = data[key];
    if (answer === undefined || answer === null || answer === "") continue;

    if (target === "email") {
      // The question she pointed at the address column beats the envelope's own
      // `email`, which the page fills in only when it can guess which field
      // holds one. A form whose email question is keyed `work_address` used to
      // produce a submission with no address on it at all.
      const address = asAddress(answer);
      if (address) contact.email = address;
      continue;
    }

    if (isContactColumn(target)) {
      contact[target] = String(answer).trim().slice(0, CONTACT_VALUE_MAX);
      continue;
    }

    // Everything else is a custom field. A key the builder itself would have
    // refused is dropped rather than stored: `custom_fields` is what segments
    // are built out of, and a key no rule can name is a value nobody can reach.
    if (CUSTOM_FIELD_KEY.test(target)) contact.customFields[target] = answer;
  }

  // Nothing was pointed at a name — the default for the "Your name" starter and
  // for every form built before the menu existed. The two keys the lead path has
  // always read stand in, so a person still arrives on the contact list as a
  // name rather than as an address.
  if (!contact.firstName && !contact.lastName) {
    contact.name = String(data.name ?? data.fullName ?? "")
      .trim()
      .slice(0, CONTACT_VALUE_MAX);
  }

  return contact;
}

/** What to call somebody, given whichever half of a name the form asked for. */
function displayName(contact: SubmissionContact): string {
  return contact.name || `${contact.firstName} ${contact.lastName}`.trim();
}

/**
 * Runs one after-effect of a stored submission and swallows its failure.
 *
 * The ordering it enforces is the whole of the fix. Everything below the insert
 * is bookkeeping — a tag id left pointing at a tag somebody deleted, a sequence
 * with no emails in it, an automation with a dead webhook on the end of it —
 * and any of it throwing used to be a 500 on a public page. A visitor reads a
 * 500 as "the form is broken" and answers it by filling the form in again; the
 * lead was captured a moment earlier and losing it to a bookkeeping error is
 * the one outcome worth engineering against.
 */
async function afterSubmission<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[forms] ${what} failed after the submission was stored:`, (err as Error).message);
    return null;
  }
}

/** A reply carrying files arrives as multipart; every other reply is JSON, as before. */
function isMultipart(req: Request): boolean {
  return Boolean(req.is("multipart/form-data"));
}

const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/**
 * Replies with files, per address. Tighter than `leadsLimiter`, because each one
 * can put up to five files on disk. Replies without files are not counted.
 */
const formUploadIpLimiter = rateLimit({
  windowMs: UPLOAD_WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isMultipart(req),
  message: { error: "You've sent a lot of files in the last hour. Please try again a little later." },
});

/**
 * Replies with files, per form — so a spread of addresses can't fill the disk
 * through one form either. Keyed on the form's id, which is only known once the
 * slug has been looked up, so a made-up slug 404s before it can mint a key.
 */
const formUploadFormLimiter = rateLimit({
  windowMs: UPLOAD_WINDOW_MS,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !isMultipart(req),
  keyGenerator: (_req, res) => `form-upload:${String((res.locals.form as { id?: unknown }).id)}`,
  message: {
    error: "This form has had a lot of files sent to it in the last hour. Please try again a little later.",
  },
});

/** The multipart reply's answers: one `payload` field holding the JSON body. */
function multipartPayload(body: unknown): unknown {
  const raw = (body as Record<string, unknown> | undefined)?.payload;
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Stores the reply, and any files with it, as one unit.
 *
 * Without files this is the single insert it always was. With them, each file is
 * moved from its temp name to a random permanent one in the protected root, gets
 * a media-library row, and its answer becomes a pointer to that row — all inside
 * one transaction, with the moved files deleted again if any of it fails. A
 * reply is never stored pointing at a file that isn't there, and a file is never
 * left behind for a reply that wasn't stored.
 */
async function storeSubmission(input: {
  formId: number;
  data: Record<string, unknown>;
  email: string;
  ip: string;
  userAgent: string;
  files: StagedFile[];
}): Promise<{ submissionId: number; answers: Record<string, unknown> }> {
  const insertSql = `INSERT INTO form_submissions (form_id, data, email, ip, user_agent)
                     VALUES ($1, $2, $3, $4, $5) RETURNING id`;
  const values = (answers: Record<string, unknown>) => [
    input.formId,
    JSON.stringify(answers),
    input.email,
    input.ip,
    input.userAgent,
  ];

  if (input.files.length === 0) {
    const inserted = await pool.query<{ id: number }>(insertSql, values(input.data));
    return { submissionId: inserted.rows[0].id, answers: input.data };
  }

  const answers: Record<string, unknown> = { ...input.data };
  const moved: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const assetIds: number[] = [];
    for (const file of input.files) {
      const stored = await keepStagedFile(file);
      moved.push(stored.absolutePath);
      const asset = await client.query<{ id: number }>(
        `INSERT INTO media_assets
           (filename, original_name, url, mime, kind, size_bytes, title, folder, form_field_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Form uploads', $8)
         RETURNING id`,
        [
          stored.filename,
          // Unique on purpose: the library refuses a second upload under a name
          // it already holds, and a stranger's "photo.jpg" must never block the
          // owner's own. `title` carries the name people see.
          `${file.displayName} · ${stored.filename}`,
          stored.reference,
          file.mime,
          kindFromMime(file.mime),
          file.sizeBytes,
          file.displayName,
          file.fieldKey,
        ],
      );
      const assetId = asset.rows[0].id;
      assetIds.push(assetId);
      answers[file.fieldKey] = {
        file: true,
        mediaAssetId: assetId,
        name: file.displayName,
        mime: file.mime,
        sizeBytes: file.sizeBytes,
      };
    }

    const inserted = await client.query<{ id: number }>(insertSql, values(answers));
    const submissionId = inserted.rows[0].id;
    await client.query(`UPDATE media_assets SET form_submission_id = $1 WHERE id = ANY($2::int[])`, [
      submissionId,
      assetIds,
    ]);
    await client.query("COMMIT");
    return { submissionId, answers };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    await Promise.all(moved.map((file) => fs.promises.unlink(file).catch(() => undefined)));
    throw err;
  } finally {
    client.release();
  }
}

// The same limiter every other public write carries. A form submission inserts
// a row, can insert a lead, and fires an automation for it; without a ceiling
// this is the one unauthenticated write on the site that a script can repeat as
// fast as it can open sockets.
growthPublicRouter.post(
  "/forms/:slug/submit",
  leadsLimiter,
  formUploadIpLimiter,
  // Looked up before the body is read: a multipart body can only be checked
  // against the form's own file questions, and the per-form limit needs its id.
  asyncHandler(async (req, res, next) => {
    const formResult = await pool.query(
      "SELECT * FROM forms WHERE slug = $1 AND published = true",
      [req.params.slug],
    );
    if (!formResult.rows[0]) throw notFound("Form not found");
    res.locals.form = formResult.rows[0];
    next();
  }),
  formUploadFormLimiter,
  asyncHandler(async (req, res) => {
    const form = res.locals.form;
    const fields = asFields(form.fields);
    const fileFields = fields.filter((field) => field.type === FILE_TYPE);

    const multipart = isMultipart(req);
    let received: StagedFile[] = [];
    if (multipart) {
      try {
        received = await receiveFormFiles(req, res, fileFields);
      } catch (err) {
        // Read and drop whatever is left of the body before answering, so the
        // refusal reaches the browser instead of a reset connection. Bounded by
        // the Content-Length ceiling `receiveFormFiles` checks first.
        req.resume();
        throw err;
      }
    }

    const parsed = submitSchema.safeParse(multipart ? multipartPayload(req.body) : req.body);
    if (!parsed.success) throw badRequest("Invalid submission", parsed.error.flatten());

    // A filled honeypot, or a form sent faster than a person can read it, is a
    // script. It gets the same 201 a real submission gets — an error response
    // is just feedback a bot can tune against — but nothing is written, mailed
    // or triggered. Checked here for both kinds of reply: a multipart one has
    // its files in temp names by now, and those are deleted when this response
    // closes, as they are for any reply that is not kept.
    if (isAutomatedSubmission(parsed.data)) {
      res.status(201).json({ ok: true, message: form.success_message });
      return;
    }

    // Nothing a client says about a file question is its answer — only a file
    // that actually arrived is. Otherwise `{ mediaAssetId: 12 }` typed into the
    // JSON would attach somebody else's document to this contact.
    const typed: Record<string, unknown> = { ...parsed.data.data };
    for (const field of fileFields) delete typed[field.key];
    const filesPresent = new Set(received.map((file) => file.fieldKey));
    const withFiles: Record<string, unknown> = { ...typed };
    for (const key of filesPresent) withFiles[key] = { file: true };

    // The page hides questions whose conditions aren't met; this decides it
    // again, because the page is only a page. A hidden question is not
    // required, and nothing sent for it is kept — not its typed answer, and not
    // its file, which is deleted with the other temp files when this response
    // closes.
    const visible = visibleQuestionKeys(fields, withFiles);
    const problem = answerProblem(fields, withFiles, visible, filesPresent);
    if (problem) throw badRequest(problem);

    const data = keptAnswers(fields, typed, visible);
    const keptFiles = received.filter((file) => visible.has(file.fieldKey));

    // Accept the email either explicitly or from a field literally named email.
    const envelopeEmail = (parsed.data.email ?? (data.email as string | undefined) ?? "")
      .toString()
      .toLowerCase();

    const contact = contactFromSubmission(form.fields, data, envelopeEmail);
    const email = contact.email;
    const name = displayName(contact);
    const origin = `form: ${form.slug}`;

    // A form reply has to identify the person. Without both values there is no
    // contact to receive the form's tags or sequence, and the reply is filed as
    // "No name given" even though the visitor was told their send succeeded.
    if (!email) throw badRequest("Please enter a valid email address.");
    if (!name) throw badRequest("Please enter your name.");

    // First, and on its own. Whatever else goes wrong below, the answers a
    // stranger just typed are on disk.
    const { submissionId, answers } = await storeSubmission({
      formId: form.id,
      data,
      email,
      ip: (req.ip ?? "").slice(0, 64),
      userAgent: String(req.get("user-agent") ?? "").slice(0, 500),
      files: keptFiles,
    });

    // Views were counted and sends were not, so the Forms screen printed a 0%
    // conversion rate for every form on it however many replies had come in.
    await afterSubmission(`the send counter on ${form.slug}`, () =>
      pool.query(`UPDATE forms SET submit_count = submit_count + 1 WHERE id = $1`, [form.id]),
    );

    const contactRecord = email
      ? await afterSubmission(`the contact record for ${form.slug}`, () =>
          upsertContactWithStatus({
            email,
            // Blank rather than an empty string, so `upsertContact` falls back
            // to assembling the name out of the two halves it was given.
            name: contact.name || undefined,
            firstName: contact.firstName,
            lastName: contact.lastName,
            phone: contact.phone,
            timezone: contact.timezone,
            customFields: contact.customFields,
            source: origin,
            consentSource: origin,
            consentIp: req.ip ?? "",
          }),
        )
      : null;
    const contactId = contactRecord?.id ?? null;

    if (contactId !== null) {
      await afterSubmission(`attaching submission ${submissionId} to its contact`, async () => {
        await pool.query(
          `UPDATE form_submissions SET contact_id = $2 WHERE id = $1 AND contact_id IS NULL`,
          [submissionId, contactId],
        );
        await recordActivity({
          contactId,
          kind: "form.submitted",
          title: `Filled in ${form.name}`,
          subjectType: "form",
          subjectId: form.id,
        });
      });

      if (keptFiles.length > 0) {
        // So the files open from the contact, not only from the reply.
        await afterSubmission(`linking the files on submission ${submissionId} to their contact`, () =>
          pool.query(
            `UPDATE media_assets SET contact_id = $1
              WHERE form_submission_id = $2 AND contact_id IS NULL`,
            [contactId, submissionId],
          ),
        );
      }

      if ((form.apply_tag_ids ?? []).length > 0) {
        await afterSubmission(`the tags on ${form.slug}`, async () => {
          // The form stores tag ids because that is what the builder picks from;
          // `applyTags` is keyed by slug because a slug is what a tag is. The
          // event registration path resolves the two the same way.
          const tags = await pool.query<{ slug: string }>(
            `SELECT slug::text AS slug FROM tags WHERE id = ANY($1::int[])`,
            [form.apply_tag_ids],
          );
          await applyTags(
            contactId,
            tags.rows.map((tag) => tag.slug),
            `form:${form.slug}`,
          );
        });
      }

      if (form.subscribe_sequence_id) {
        await afterSubmission(`the sequence enrolment on ${form.slug}`, () =>
          enrollContact(Number(form.subscribe_sequence_id), contactId, { reason: origin }),
        );
      }
    }

    if (form.create_lead && email) {
      await afterSubmission(`the lead for ${form.slug}`, async () => {
        const lead = await pool.query<{ id: number }>(
          `INSERT INTO leads (name, email, message, source, meta)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            name || "Form submission",
            email,
            String(data.message ?? ""),
            `form:${form.slug}`,
            JSON.stringify(answers),
          ],
        );
        // The lead row and the contact are one person. Left unlinked they are
        // two, which is the silo `services/contacts.ts` exists to close.
        if (contactId !== null) await linkContact("lead", lead.rows[0].id, contactId);
        fireTriggerAsync("lead_created", { email, name, source: `form:${form.slug}` });
      });
    }

    if (contactRecord?.created) {
      await publishDomainEvent("contact_created", {
        eventKey: `contact-created:${contactRecord.id}`,
        contactId: contactRecord.id,
        email,
        name,
        source: origin,
      });
    }

    // Fire-and-forget, and after the response is decided: `fireTrigger` never
    // throws, and an automation that sends an email must not hold a visitor on
    // a spinner while it does.
    await publishDomainEvent("form_submitted", {
      eventKey: `form-submitted:${submissionId}`,
      contactId,
      email,
      name,
      subjectId: form.id,
      source: `form:${form.slug}`,
    });

    // 3.7: a sequence whose job was to get somebody to fill in THIS form has
    // nothing left to say once they have. The global purchase switch never
    // fires here, because no money moved.
    if (contactId !== null) {
      await exitContactOnFormSubmission(contactId, form.id, `filled in ${form.name}`).catch(
        (error: unknown) => {
          // Worth having, never worth failing a form submission for.
          console.error(
            "[forms] could not apply sequence exclude rules:",
            (error as Error).message
          );
          return 0;
        }
      );
    }

    res.status(201).json({ ok: true, message: form.success_message });
  }),
);

/* ----------------------------------------------------------------- Funnels */

growthPublicRouter.get(
  "/funnels/:slug",
  asyncHandler(async (req, res) => {
    const funnelResult = await pool.query(
      "SELECT * FROM funnels WHERE slug = $1 AND published = true",
      [req.params.slug],
    );
    const funnel = funnelResult.rows[0];
    if (!funnel) throw notFound("Funnel not found");

    const steps = await pool.query(
      `SELECT id, name, slug, step_type, headline, body_md, cta_label, cta_url, sort
         FROM funnel_steps WHERE funnel_id = $1 ORDER BY sort, id`,
      [funnel.id],
    );

    res.json({
      slug: funnel.slug,
      name: funnel.name,
      description: funnel.description,
      kind: funnel.kind,
      steps: rowsToCamel(steps.rows),
    });
  }),
);

/** Counter bumps for funnel analytics. Unauthenticated by design. */
growthPublicRouter.post(
  "/funnels/steps/:id/:event",
  asyncHandler(async (req, res) => {
    // The id reaches an integer column, so a non-numeric one is a 400 rather
    // than a Postgres cast error surfacing as a 500 on a public endpoint.
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("Invalid step id");

    const column = req.params.event === "convert" ? "conversions" : "views";
    const result = await pool.query(
      `UPDATE funnel_steps SET ${column} = ${column} + 1 WHERE id = $1`,
      [id],
    );
    if (result.rowCount === 0) throw notFound("Step not found");
    res.status(204).end();
  }),
);
