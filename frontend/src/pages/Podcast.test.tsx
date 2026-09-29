import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router";
import Podcast, { episodeLength, episodeMeta, splitEpisodeTitle } from "./Podcast";
import { SsrProvider } from "@/ssr/context";
import type { PublicPodcast } from "@/lib/publishingApi";

/**
 * The public podcast page (sheet row R39): the Kajabi show "Lyrical
 * Reflections", at the addresses it had on Kajabi. Rendered from a seeded
 * payload, the way the SSR harness hands a page its data.
 */
const SHOW: PublicPodcast = {
  slug: "lyrical-reflections",
  title: "Lyrical Reflections",
  description: "Healing one lyric at a time.",
  author: "Yvette Howard",
  category: "Health & Fitness",
  coverImage: "https://example.com/uploads/cover.jpg",
  feedUrl: "https://example.com/api/podcast/lyrical-reflections/rss.xml",
  episodes: [
    {
      id: 11,
      pathId: "2148691041",
      title: "Cheating was my way out. | How to be honest with yourself.",
      description: "Hello, Lyrical Minds!",
      showNotesMd: "Hello, Lyrical Minds!\n\n- Honesty\n\n[Click here!](https://example.test/journal)",
      audioUrl: "https://example.com/uploads/ep4.mp3",
      durationSeconds: 818,
      episodeNumber: 4,
      season: 1,
      publishedAt: "2024-03-06T16:00:00.000Z",
      coverImage: "https://example.com/uploads/cover.jpg",
    },
    {
      id: 12,
      pathId: "2148691045",
      title: "Welcome to Lyrical Reflections!",
      description: "Welcome.",
      showNotesMd: "",
      audioUrl: "https://example.com/uploads/trailer.mp3",
      durationSeconds: 84,
      episodeNumber: null,
      season: 1,
      publishedAt: "2023-11-25T16:00:00.000Z",
      coverImage: "https://example.com/uploads/cover.jpg",
    },
  ],
};

function render(location: string, data: PublicPodcast | null = SHOW): string {
  return renderToStaticMarkup(
    <SsrProvider
      runtime={{
        payload: {
          origin: "https://example.com",
          indexable: true,
          data: { "podcast:lyrical-reflections": data },
        },
        headSink: [],
      }}
    >
      <StaticRouter location={location}>
        <Routes>
          <Route path="/podcasts/:slug" element={<Podcast />} />
          <Route path="/podcasts/:slug/episodes/:episodeId" element={<Podcast />} />
        </Routes>
      </StaticRouter>
    </SsrProvider>,
  );
}

describe("the public show page", () => {
  it("lists every episode, linked at its Kajabi address", () => {
    const html = render("/podcasts/lyrical-reflections");
    expect(html).toContain("Lyrical Reflections");
    expect(html).toContain("with Yvette Howard");
    expect(html).toContain("2 episodes");
    expect(html).toContain('href="/podcasts/lyrical-reflections/episodes/2148691041"');
    expect(html).toContain('href="/podcasts/lyrical-reflections/episodes/2148691045"');
    expect(html).toContain('href="https://example.com/api/podcast/lyrical-reflections/rss.xml"');
  });

  it("opens one episode with its player and full show notes", () => {
    const html = render("/podcasts/lyrical-reflections/episodes/2148691041");
    expect(html).toContain('src="https://example.com/uploads/ep4.mp3"');
    expect(html).toContain("<li>Honesty</li>");
    expect(html).toContain('href="https://example.test/journal" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Episode 4");
    expect(html).toContain("How to be honest with yourself.");
  });

  it("falls back to the summary when an episode has no show notes", () => {
    const html = render("/podcasts/lyrical-reflections/episodes/2148691045");
    expect(html).toContain("Welcome.");
    expect(html).toContain('src="https://example.com/uploads/trailer.mp3"');
  });

  it("is the not-found page for an unknown episode or show", () => {
    expect(render("/podcasts/lyrical-reflections/episodes/1")).not.toContain("ep4.mp3");
    expect(render("/podcasts/lyrical-reflections", null)).not.toContain("with Yvette Howard");
  });
});

describe("episode helpers", () => {
  it("splits a Kajabi title at its bar and nowhere else", () => {
    expect(splitEpisodeTitle("A | B")).toEqual({ head: "A", accent: "B" });
    expect(splitEpisodeTitle("No bar here")).toEqual({ head: "No bar here" });
  });

  it("describes length and position, leaving out what is unknown", () => {
    expect(episodeLength(0)).toBe("");
    expect(episodeLength(84)).toBe("1 min");
    expect(episodeLength(539)).toBe("9 min");
    expect(episodeLength(3900)).toBe("1 hr 5 min");
    expect(episodeMeta({ ...SHOW.episodes[1], publishedAt: null })).toBe("1 min");
    expect(episodeMeta(SHOW.episodes[0])).toMatch(/^Episode 4 · Mar \d, 2024 · 14 min$/);
  });
});
