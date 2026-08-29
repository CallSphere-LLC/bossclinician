import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { env } from "../../config/env";
import { leadsLimiter } from "../../middleware/rateLimit";
import { fireTriggerAsync } from "../../automations/engine";
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
      `SELECT id, slug, name, description, fields, submit_label, success_message
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
    const email = (parsed.data.email ?? (data.email as string | undefined) ?? "")
      .toString()
      .toLowerCase();

    await pool.query(
      "INSERT INTO form_submissions (form_id, data, email) VALUES ($1, $2, $3)",
      [form.id, JSON.stringify(data), email],
    );

    if (form.create_lead && email) {
      const name = String(data.name ?? data.fullName ?? "Form submission");
      await pool.query(
        `INSERT INTO leads (name, email, message, source, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [name, email, String(data.message ?? ""), `form:${form.slug}`, JSON.stringify(data)],
      );
      fireTriggerAsync("lead_created", { email, name, source: `form:${form.slug}` });
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
