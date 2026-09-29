import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase } from "../../testing/db";

/**
 * The public podcast page's API and feed, against a real database built from
 * every migration (sheet row R39: the Kajabi show "Lyrical Reflections",
 * imported with Kajabi's episode ids in `kajabi-<id>` slugs).
 *
 * Skipped when TEST_DATABASE_URL is unset, like every other suite here.
 */

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("the public podcast page and feed (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let client: Client;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = await createTestDatabase("podcastpublic");
    client = db.client;
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "integration-test-secret";

    const [{ growthPublicRouter }, { errorHandler }] = await Promise.all([
      import("./growthPublic"),
      import("../../middleware/errorHandler"),
    ]);

    const app = express();
    app.use(express.json());
    app.use("/api", growthPublicRouter);
    app.use(errorHandler);

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const show = await client.query<{ id: number }>(
      `INSERT INTO podcasts (slug, title, description, cover_image, author, category, visibility, published)
       VALUES ('lyrical-reflections', 'Lyrical Reflections', 'Healing one lyric at a time.',
               '/uploads/cover.jpg', 'Yvette Howard', 'Health & Fitness', 'public', true)
       RETURNING id`,
    );
    const id = show.rows[0].id;
    await client.query(
      `INSERT INTO podcast_episodes (podcast_id, slug, title, description, show_notes_md, audio_url,
                                     audio_bytes, duration_seconds, episode_number, published, published_at)
       VALUES ($1, 'kajabi-2148691037', 'Give Yourself Grace in Every Space', 'Hello, Lyrical Minds!',
               'Hello, **Lyrical Minds**! [Click here!](https://example.test/journal)',
               '/uploads/ep8.mp3', 8626694, 539, 8, true, '2024-05-01T16:00:00Z'),
              ($1, 'kajabi-2148691045', 'Welcome to Lyrical Reflections!', 'Welcome.', '',
               '/uploads/trailer.mp3', 2691892, 84, NULL, true, '2023-11-25T16:00:00Z'),
              ($1, 'draft', 'Not out yet', '', '', '', 0, 0, 9, false, NULL)`,
      [id],
    );
    await client.query(
      `INSERT INTO podcasts (slug, title, visibility, published)
       VALUES ('members-show', 'Members Show', 'private', true),
              ('draft-show', 'Draft Show', 'public', false)`,
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const { pool } = await import("../../db/pool");
    await pool.end().catch(() => undefined);
    await db?.drop();
  });

  it("serves a public show with its published episodes, newest first, at Kajabi's ids", async () => {
    const res = await fetch(`${baseUrl}/api/podcast/lyrical-reflections`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      author: string;
      coverImage: string;
      feedUrl: string;
      episodes: {
        pathId: string;
        title: string;
        showNotesMd: string;
        audioUrl: string;
        episodeNumber: number | null;
        durationSeconds: number;
        coverImage: string;
      }[];
    };
    expect(body.title).toBe("Lyrical Reflections");
    expect(body.author).toBe("Yvette Howard");
    expect(body.coverImage).toMatch(/^https?:\/\/.+\/uploads\/cover\.jpg$/);
    expect(body.feedUrl).toMatch(/\/api\/podcast\/lyrical-reflections\/rss\.xml$/);
    expect(body.episodes.map((e) => e.pathId)).toEqual(["2148691037", "2148691045"]);
    expect(body.episodes[0].showNotesMd).toContain("[Click here!](https://example.test/journal)");
    expect(body.episodes[0].audioUrl).toMatch(/\/uploads\/ep8\.mp3$/);
    expect(body.episodes[0].durationSeconds).toBe(539);
    expect(body.episodes[1].episodeNumber).toBeNull();
    // No artwork of its own: the show's stands in.
    expect(body.episodes[1].coverImage).toBe(body.coverImage);
  });

  it("does not show a members-only or unpublished show to the public", async () => {
    expect((await fetch(`${baseUrl}/api/podcast/members-show`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/podcast/draft-show`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/podcast/nothing-here`)).status).toBe(404);
  });

  it("keeps Kajabi's guids in the feed and does not number the trailer 0", async () => {
    const xml = await (await fetch(`${baseUrl}/api/podcast/lyrical-reflections/rss.xml`)).text();
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain('<guid isPermaLink="false">Kajabi-2148691037</guid>');
    expect(xml).toContain('<guid isPermaLink="false">Kajabi-2148691045</guid>');
    expect(xml).toContain("<itunes:episode>8</itunes:episode>");
    expect(xml).not.toContain("<itunes:episode>0</itunes:episode>");
    expect(xml).toMatch(/<link>[^<]*\/podcasts\/lyrical-reflections<\/link>/);
  });

  it("leaves no redirect sending the show's Kajabi addresses to /blog (migration 080)", async () => {
    const rows = await client.query(
      `SELECT from_path FROM redirects WHERE from_path LIKE '/podcasts/lyrical-reflections%'`,
    );
    expect(rows.rows).toEqual([]);
  });
});
