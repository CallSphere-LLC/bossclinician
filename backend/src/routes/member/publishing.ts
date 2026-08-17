import crypto from "crypto";
import { Request, Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { pool } from "../../db/pool";
import { env } from "../../config/env";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound, unauthorized } from "../../utils/httpError";
import { denyImpersonation, type AuthedMember } from "../../middleware/memberAuth";
import { listMemberProducts } from "../../services/access";

/**
 * `/api/member/podcasts` and `/api/member/newsletters` — the two things that
 * arrive on a schedule rather than being sat down with.
 *
 * `requireMember` is applied once by routes/member/index.ts. Entitlement is
 * proved separately here, and it differs between the two:
 *
 * - A **private** podcast is listed only against a live access grant, and its
 *   feed URL carries a token minted for this member alone. That URL is a
 *   credential — anybody holding it gets every episode with no sign-in — which
 *   is why it is per-member and revocable rather than one shared secret.
 * - A **public** podcast is listed for everybody, because the public RSS route
 *   already serves it to strangers. Listing it here leaks nothing.
 * - A **paid** newsletter is listed only against a grant; its issues carry the
 *   body text, which is the thing that was sold.
 *
 * Deny by default throughout: a member with no grant sees exactly what a
 * stranger would.
 */
export const memberPublishingRouter = Router();

const MAX_INT4 = 2_147_483_647;

/** Enough recent episodes to browse; the feed itself carries the whole run. */
const EPISODE_LIMIT = 12;
const ISSUE_LIMIT = 50;

/**
 * One lock class for this file, keyed on the member id.
 *
 * `podcast_feed_tokens` has no unique constraint to lean on, so "issue a token
 * if this member has none" is a read followed by a write. Two tabs opening
 * /podcasts at the same moment would otherwise both find nothing and both
 * insert, leaving the member with two live credentials where revoking one would
 * appear to do nothing.
 */
const TOKEN_LOCK_CLASS = 8242;

const TOO_MANY = { error: "Too many requests. Please try again in a few minutes." };

const byMember = (req: Request): string =>
  req.member ? `member:${req.member.id}` : ipKeyGenerator(req.ip ?? "");

/** Rotating a feed and flipping a preference both write; reading does not. */
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: byMember,
});

function currentMember(req: Request): AuthedMember {
  if (!req.member) throw unauthorized("Please sign in to continue");
  return req.member;
}

const idParamSchema = z.object({ id: z.coerce.number().int().positive().max(MAX_INT4) });

/** Media is stored as either a full URL or a path under the site's own origin. */
function absoluteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${env.publicSiteUrl.replace(/\/$/, "")}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/* ------------------------------------------------------------- entitlement */

interface OwnedIds {
  podcastIds: number[];
  newsletterIds: number[];
}

/** Routed through access.ts, never through orders or subscriptions. */
async function ownedIds(memberId: number): Promise<OwnedIds> {
  const products = await listMemberProducts(memberId);
  return {
    podcastIds: products
      .map((product) => product.podcastId)
      .filter((id): id is number => id !== null),
    newsletterIds: products
      .map((product) => product.newsletterId)
      .filter((id): id is number => id !== null),
  };
}

/* ------------------------------------------------------------------ podcasts */

interface PodcastRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  cover_image: string;
  author: string;
  visibility: string;
  episode_count: number;
  latest_episode_at: Date | null;
}

interface EpisodeRow {
  id: number;
  podcast_id: number;
  title: string;
  description: string;
  audio_url: string;
  duration_seconds: number;
  episode_number: number | null;
  season: number;
  published_at: Date | null;
}

interface EpisodeJson {
  id: number;
  title: string;
  description: string;
  audioUrl: string;
  durationSeconds: number;
  episodeNumber: number | null;
  season: number;
  publishedAt: string | null;
}

interface PodcastJson {
  id: number;
  slug: string;
  title: string;
  description: string;
  coverImage: string;
  author: string;
  visibility: "public" | "private";
  episodeCount: number;
  latestEpisodeAt: string | null;
  feedUrl: string;
  /** True when `feedUrl` is this member's alone and must not be passed on. */
  personal: boolean;
  episodes: EpisodeJson[];
}

function feedUrl(slug: string, token: string | null): string {
  const base = `${env.publicSiteUrl.replace(/\/$/, "")}/api/podcast/${encodeURIComponent(slug)}/rss.xml`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/**
 * This member's live token for each private show they own, minting any missing.
 *
 * The token is 36 hex characters of randomness rather than anything derived
 * from the member — a guessable feed URL would be a paid show published to the
 * open internet.
 */
async function ensureFeedTokens(
  memberId: number,
  podcastIds: number[]
): Promise<Map<number, string>> {
  const tokens = new Map<number, string>();
  if (podcastIds.length === 0) return tokens;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [TOKEN_LOCK_CLASS, memberId]);

    const existing = await client.query<{ podcast_id: number; token: string }>(
      `SELECT DISTINCT ON (podcast_id) podcast_id, token
         FROM podcast_feed_tokens
        WHERE member_id = $1 AND podcast_id = ANY($2::int[]) AND revoked = false
        ORDER BY podcast_id, id DESC`,
      [memberId, podcastIds]
    );
    for (const row of existing.rows) tokens.set(row.podcast_id, row.token);

    for (const podcastId of podcastIds) {
      if (tokens.has(podcastId)) continue;
      const token = crypto.randomBytes(18).toString("hex");
      await client.query(
        `INSERT INTO podcast_feed_tokens (podcast_id, member_id, token, label)
         VALUES ($1, $2, $3, 'Member feed')`,
        [podcastId, memberId, token]
      );
      tokens.set(podcastId, token);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return tokens;
}

async function loadEpisodes(podcastIds: number[]): Promise<Map<number, EpisodeJson[]>> {
  const byPodcast = new Map<number, EpisodeJson[]>();
  if (podcastIds.length === 0) return byPodcast;

  // One query with a per-show window rather than a query per show: a member
  // with six feeds should still cost one round trip.
  const res = await pool.query<EpisodeRow>(
    `SELECT id, podcast_id, title, description, audio_url, duration_seconds,
            episode_number, season, published_at
       FROM (
         SELECT e.*, row_number() OVER (
                  PARTITION BY e.podcast_id
                  ORDER BY e.published_at DESC NULLS LAST, e.id DESC
                ) AS rank
           FROM podcast_episodes e
          WHERE e.podcast_id = ANY($1::int[]) AND e.published = true
       ) ranked
      WHERE rank <= $2
      ORDER BY podcast_id, published_at DESC NULLS LAST, id DESC`,
    [podcastIds, EPISODE_LIMIT]
  );

  for (const row of res.rows) {
    const list = byPodcast.get(row.podcast_id) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      description: row.description,
      audioUrl: absoluteUrl(row.audio_url),
      durationSeconds: row.duration_seconds,
      episodeNumber: row.episode_number,
      season: row.season,
      publishedAt: row.published_at?.toISOString() ?? null,
    });
    byPodcast.set(row.podcast_id, list);
  }
  return byPodcast;
}

/**
 * GET /api/member/podcasts
 */
memberPublishingRouter.get(
  "/podcasts",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const owned = await ownedIds(member.id);

    const shows = await pool.query<PodcastRow>(
      `SELECT p.id, p.slug, p.title, p.description, p.cover_image, p.author, p.visibility,
              (SELECT count(*) FROM podcast_episodes e
                WHERE e.podcast_id = p.id AND e.published = true)::int AS episode_count,
              (SELECT max(e.published_at) FROM podcast_episodes e
                WHERE e.podcast_id = p.id AND e.published = true) AS latest_episode_at
         FROM podcasts p
        WHERE p.published = true
          AND (p.visibility <> 'private' OR p.id = ANY($1::int[]))
        ORDER BY p.title`,
      [owned.podcastIds]
    );

    const privateOwned = shows.rows
      .filter((row) => row.visibility === "private")
      .map((row) => row.id);

    const [tokens, episodes] = await Promise.all([
      ensureFeedTokens(member.id, privateOwned),
      loadEpisodes(shows.rows.map((row) => row.id)),
    ]);

    const body: PodcastJson[] = shows.rows.map((row) => {
      const isPrivate = row.visibility === "private";
      const token = isPrivate ? (tokens.get(row.id) ?? null) : null;
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        coverImage: absoluteUrl(row.cover_image),
        author: row.author,
        visibility: isPrivate ? "private" : "public",
        episodeCount: row.episode_count,
        latestEpisodeAt: row.latest_episode_at?.toISOString() ?? null,
        feedUrl: feedUrl(row.slug, token),
        personal: token !== null,
        episodes: episodes.get(row.id) ?? [],
      };
    });

    res.json(body);
  })
);

/**
 * POST /api/member/podcasts/:id/feed/rotate
 *
 * Replaces this member's token for one show. Every old token of theirs is
 * revoked rather than deleted, so a leaked URL stops working everywhere at once
 * and the admin's record of what was issued survives.
 */
memberPublishingRouter.post(
  "/podcasts/:id/feed/rotate",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound("We couldn't find that show.");

    const owned = await ownedIds(member.id);

    // Only a private show this member owns has a token to rotate. Anything else
    // — a public show, or somebody else's paid one — is simply not found.
    const show = await pool.query<{ id: number; slug: string }>(
      `SELECT id, slug FROM podcasts
        WHERE id = $1 AND published = true AND visibility = 'private' AND id = ANY($2::int[])`,
      [params.data.id, owned.podcastIds]
    );
    const row = show.rows[0];
    if (!row) throw notFound("We couldn't find that show.");

    const token = crypto.randomBytes(18).toString("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [TOKEN_LOCK_CLASS, member.id]);
      await client.query(
        `UPDATE podcast_feed_tokens SET revoked = true
          WHERE podcast_id = $1 AND member_id = $2 AND revoked = false`,
        [row.id, member.id]
      );
      await client.query(
        `INSERT INTO podcast_feed_tokens (podcast_id, member_id, token, label)
         VALUES ($1, $2, $3, 'Member feed')`,
        [row.id, member.id, token]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    res.json({ feedUrl: feedUrl(row.slug, token) });
  })
);

/* --------------------------------------------------------------- newsletters */

/**
 * The kinds of email this business sends, and which of them a member may stop.
 *
 * A catalogue in code rather than a table: these are the names the sending code
 * checks, so a topic that exists only as a row somebody typed would be a switch
 * that changes nothing. `essential` marks the mail that carries something the
 * member paid for or asked for — a coaching reminder, a receipt — which is not
 * marketing and is not offered as a toggle.
 */
const EMAIL_TOPICS = [
  {
    topic: "account_notices",
    label: "Account and receipts",
    description:
      "Purchase receipts, password changes and anything about the security of your account.",
    essential: true,
  },
  {
    topic: "coaching_reminders",
    label: "Coaching reminders",
    description: "Confirmations and reminders for calls you have booked.",
    essential: true,
  },
  {
    topic: "course_updates",
    label: "Course updates",
    description: "When a new lesson unlocks or something is added to a programme you own.",
    essential: false,
  },
  {
    topic: "community_digest",
    label: "Community digest",
    description: "A weekly summary of what has been happening in the community.",
    essential: false,
  },
  {
    topic: "product_news",
    label: "New programmes and workshops",
    description: "Occasional word when something new opens, including early-bird pricing.",
    essential: false,
  },
] as const;

type TopicName = (typeof EMAIL_TOPICS)[number]["topic"];

const TOPIC_NAMES = EMAIL_TOPICS.map((entry) => entry.topic) as [TopicName, ...TopicName[]];

interface TopicJson {
  topic: string;
  label: string;
  description: string;
  subscribed: boolean;
  essential: boolean;
}

interface PublicationRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  access: string;
  issue_count: number;
  latest_issue_at: Date | null;
  subscription_status: string | null;
}

interface PublicationJson {
  id: number;
  slug: string;
  name: string;
  description: string;
  subscribed: boolean;
  issueCount: number;
  latestIssueAt: string | null;
}

/**
 * Which publications this member may see at all.
 *
 * Free ones are open to every signed-in member; a paid one needs a grant, since
 * its issues carry the body text that was sold.
 */
const PUBLICATION_SELECT = `
  SELECT n.id, n.slug, n.name, n.description, n.access,
         (SELECT count(*) FROM newsletter_issues i
           WHERE i.newsletter_id = n.id AND i.status = 'sent')::int AS issue_count,
         (SELECT max(i.sent_at) FROM newsletter_issues i
           WHERE i.newsletter_id = n.id AND i.status = 'sent') AS latest_issue_at,
         (SELECT s.status FROM newsletter_subscriptions s
           WHERE s.newsletter_id = n.id AND (s.member_id = $1 OR s.email = $2)
           ORDER BY (s.member_id = $1) DESC, s.id DESC
           LIMIT 1) AS subscription_status
    FROM newsletters n
   WHERE n.published = true
     AND (n.access = 'free' OR n.id = ANY($3::int[]))`;

/**
 * Whether this member is on the list.
 *
 * An explicit row wins. With no row at all, a publication they bought counts as
 * subscribed — they paid for it and the first issue should not have to be asked
 * for — while a free one does not, because nobody has opted in to it yet.
 */
function isSubscribed(row: PublicationRow, ownedNewsletterIds: number[]): boolean {
  if (row.subscription_status === "subscribed") return true;
  if (row.subscription_status === "unsubscribed") return false;
  return ownedNewsletterIds.includes(row.id);
}

function toPublicationJson(row: PublicationRow, ownedNewsletterIds: number[]): PublicationJson {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    subscribed: isSubscribed(row, ownedNewsletterIds),
    issueCount: row.issue_count,
    latestIssueAt: row.latest_issue_at?.toISOString() ?? null,
  };
}

interface IssueRow {
  id: number;
  newsletter_id: number;
  newsletter_name: string;
  subject: string;
  preview_text: string;
  body_md: string;
  sent_at: Date | null;
}

/**
 * GET /api/member/newsletters
 */
memberPublishingRouter.get(
  "/newsletters",
  asyncHandler(async (req, res) => {
    const member = currentMember(req);
    const owned = await ownedIds(member.id);

    const publications = await pool.query<PublicationRow>(
      `${PUBLICATION_SELECT} ORDER BY n.name`,
      [member.id, member.email, owned.newsletterIds]
    );

    const visibleIds = publications.rows.map((row) => row.id);

    // Bodies are only ever read for publications the query above already
    // cleared, so a paid archive cannot be reached by asking for it directly.
    const issues = visibleIds.length
      ? await pool.query<IssueRow>(
          `SELECT i.id, i.newsletter_id, n.name AS newsletter_name, i.subject,
                  i.preview_text, i.body_md, i.sent_at
             FROM newsletter_issues i
             JOIN newsletters n ON n.id = i.newsletter_id
            WHERE i.newsletter_id = ANY($1::int[]) AND i.status = 'sent'
            ORDER BY i.sent_at DESC NULLS LAST, i.id DESC
            LIMIT $2`,
          [visibleIds, ISSUE_LIMIT]
        )
      : { rows: [] as IssueRow[] };

    const preferences = await pool.query<{ topic: string; subscribed: boolean }>(
      `SELECT topic, subscribed FROM member_email_preferences WHERE member_id = $1`,
      [member.id]
    );
    const saved = new Map(preferences.rows.map((row) => [row.topic, row.subscribed]));

    const topics: TopicJson[] = EMAIL_TOPICS.map((entry) => ({
      topic: entry.topic,
      label: entry.label,
      description: entry.description,
      // Opt-out rather than opt-in: these are the emails that come with having
      // an account, and an essential one is on whatever the table says.
      subscribed: entry.essential ? true : (saved.get(entry.topic) ?? true),
      essential: entry.essential,
    }));

    res.json({
      publications: publications.rows.map((row) => toPublicationJson(row, owned.newsletterIds)),
      topics,
      issues: issues.rows.map((row) => ({
        id: row.id,
        newsletterId: row.newsletter_id,
        newsletterName: row.newsletter_name,
        subject: row.subject,
        previewText: row.preview_text,
        sentAt: row.sent_at?.toISOString() ?? null,
        bodyMd: row.body_md,
      })),
    });
  })
);

const subscriptionSchema = z.object({ subscribed: z.boolean() });

/**
 * PATCH /api/member/newsletters/:id/subscription
 *
 * The row is keyed on the address rather than the member id, because that is
 * what the unique constraint and the sending code both use — a member and a
 * form signup from the same inbox are one subscriber, not two.
 */
memberPublishingRouter.patch(
  "/newsletters/:id/subscription",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const params = idParamSchema.safeParse(req.params);
    if (!params.success) throw notFound("We couldn't find that newsletter.");

    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("We couldn't save that", parsed.error.flatten());

    const owned = await ownedIds(member.id);
    const visible = await pool.query<PublicationRow>(`${PUBLICATION_SELECT} AND n.id = $4`, [
      member.id,
      member.email,
      owned.newsletterIds,
      params.data.id,
    ]);
    if (!visible.rows[0]) throw notFound("We couldn't find that newsletter.");

    await pool.query(
      `INSERT INTO newsletter_subscriptions (newsletter_id, member_id, email, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (newsletter_id, email) DO UPDATE
         SET status    = EXCLUDED.status,
             member_id = COALESCE(newsletter_subscriptions.member_id, EXCLUDED.member_id)`,
      [
        params.data.id,
        member.id,
        member.email,
        parsed.data.subscribed ? "subscribed" : "unsubscribed",
      ]
    );

    // Read back rather than echoing the request: the row the page redraws must
    // be the row the database now holds, including a count another request may
    // have moved in the meantime.
    const after = await pool.query<PublicationRow>(`${PUBLICATION_SELECT} AND n.id = $4`, [
      member.id,
      member.email,
      owned.newsletterIds,
      params.data.id,
    ]);
    const saved = after.rows[0];
    if (!saved) throw notFound("We couldn't find that newsletter.");

    res.json(toPublicationJson(saved, owned.newsletterIds));
  })
);

const preferenceSchema = z.object({
  topic: z.enum(TOPIC_NAMES),
  subscribed: z.boolean(),
});

/**
 * PATCH /api/member/email-preferences
 *
 * One topic at a time, deliberately. A single "email preferences" form that
 * saves everything at once turns "stop the digest" into a chance to lose the
 * other four settings to a stale page.
 */
memberPublishingRouter.patch(
  "/email-preferences",
  denyImpersonation,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const member = currentMember(req);

    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("We couldn't save that", parsed.error.flatten());

    const entry = EMAIL_TOPICS.find((row) => row.topic === parsed.data.topic);
    if (!entry) throw notFound("We couldn't find that setting.");
    if (entry.essential) {
      throw badRequest(
        "These emails are part of your account — receipts, reminders for calls you booked — so they cannot be turned off."
      );
    }

    await pool.query(
      `INSERT INTO member_email_preferences (member_id, topic, subscribed)
       VALUES ($1, $2, $3)
       ON CONFLICT (member_id, topic) DO UPDATE
         SET subscribed = EXCLUDED.subscribed, updated_at = now()`,
      [member.id, entry.topic, parsed.data.subscribed]
    );

    const body: TopicJson = {
      topic: entry.topic,
      label: entry.label,
      description: entry.description,
      subscribed: parsed.data.subscribed,
      essential: entry.essential,
    };
    res.json(body);
  })
);
