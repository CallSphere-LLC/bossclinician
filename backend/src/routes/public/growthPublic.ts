import { Router } from "express";
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
import {
  applyTags,
  linkContact,
  recordActivity,
  upsertContactWithStatus,
} from "../../services/contacts";
import { enrollContact } from "../../services/sequences";
import { isProtectedRef, signDownload } from "../../services/signedUrls";

/** Public endpoints for podcasts (RSS), forms and funnels. */
export const growthPublicRouter = Router();

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
    res.json(rowsToCamel(result.rows)[0]);
  }),
);

const submitSchema = z.object({
  data: z.record(z.unknown()),
  email: z.string().email().max(320).optional(),
});

/**
 * A stored question, as much of one as a submission has to understand.
 *
 * `forms.fields` is a jsonb column the builder owns, so a row written by an
 * older version of it may be missing any of these — nothing read out of it is
 * assumed to be there, or to be a string.
 */
interface StoredFormField {
  key?: unknown;
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

// The same limiter every other public write carries. A form submission inserts
// a row, can insert a lead, and fires an automation for it; without a ceiling
// this is the one unauthenticated write on the site that a script can repeat as
// fast as it can open sockets.
growthPublicRouter.post(
  "/forms/:slug/submit",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid submission", parsed.error.flatten());

    const formResult = await pool.query(
      "SELECT * FROM forms WHERE slug = $1 AND published = true",
      [req.params.slug],
    );
    const form = formResult.rows[0];
    if (!form) throw notFound("Form not found");

    const data = parsed.data.data;
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
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO form_submissions (form_id, data, email, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        form.id,
        JSON.stringify(data),
        email,
        (req.ip ?? "").slice(0, 64),
        String(req.get("user-agent") ?? "").slice(0, 500),
      ],
    );
    const submissionId = inserted.rows[0].id;

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
            JSON.stringify(data),
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
