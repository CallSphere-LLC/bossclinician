import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, forbidden, notFound } from "../../utils/httpError";
import { env } from "../../config/env";
import { fireTriggerAsync } from "../../automations/engine";

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

    if (podcast.visibility === "private") {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) throw forbidden("This feed is private");
      const valid = await pool.query(
        "SELECT 1 FROM podcast_feed_tokens WHERE podcast_id = $1 AND token = $2 AND revoked = false",
        [podcast.id, token],
      );
      if (valid.rowCount === 0) throw forbidden("Invalid or revoked feed token");
    }

    const episodes = await pool.query(
      `SELECT * FROM podcast_episodes
        WHERE podcast_id = $1 AND published = true
        ORDER BY published_at DESC NULLS LAST, id DESC`,
      [podcast.id],
    );

    const site = env.publicSiteUrl.replace(/\/$/, "");
    const items = episodes.rows
      .map((ep) => {
        const audio = String(ep.audio_url ?? "");
        const audioUrl = audio.startsWith("http") ? audio : `${site}${audio}`;
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

growthPublicRouter.post(
  "/forms/:slug/submit",
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
    const column = req.params.event === "convert" ? "conversions" : "views";
    const result = await pool.query(
      `UPDATE funnel_steps SET ${column} = ${column} + 1 WHERE id = $1`,
      [req.params.id],
    );
    if (result.rowCount === 0) throw notFound("Step not found");
    res.status(204).end();
  }),
);
