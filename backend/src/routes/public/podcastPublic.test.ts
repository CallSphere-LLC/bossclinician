import { describe, expect, it } from "vitest";
import {
  episodeGuid,
  episodeNumberTags,
  episodePathId,
  feedNotesHtml,
  publicMediaUrl,
} from "./growthPublic";

/**
 * The pure pieces behind the public podcast page and feed (sheet row R39: the
 * Kajabi show "Lyrical Reflections" imported with its Kajabi episode ids).
 */
describe("episodeGuid", () => {
  it("keeps Kajabi's guid for an imported episode, so subscribers see no duplicates", () => {
    expect(episodeGuid({ id: 12, slug: "kajabi-2148691037" })).toBe("Kajabi-2148691037");
  });

  it("keeps the app's own guid for everything else", () => {
    expect(episodeGuid({ id: 12, slug: "my-first-episode" })).toBe("episode-12");
    expect(episodeGuid({ id: 3, slug: "" })).toBe("episode-3");
    expect(episodeGuid({ id: 4, slug: null })).toBe("episode-4");
    expect(episodeGuid({ id: 5, slug: "kajabi-abc" })).toBe("episode-5");
  });
});

describe("episodePathId", () => {
  it("is Kajabi's episode id for an imported episode, so old links still land", () => {
    expect(episodePathId({ id: 12, slug: "kajabi-2148691045" })).toBe("2148691045");
  });

  it("is the app's id otherwise", () => {
    expect(episodePathId({ id: 12, slug: "welcome" })).toBe("12");
  });
});

describe("episodeNumberTags", () => {
  it("numbers a numbered episode", () => {
    expect(episodeNumberTags(8)).toBe("      <itunes:episode>8</itunes:episode>\n");
  });

  it("leaves an unnumbered episode (a trailer) without a number rather than 'Episode 0'", () => {
    expect(episodeNumberTags(null)).toBe("");
    expect(episodeNumberTags(undefined)).toBe("");
    expect(episodeNumberTags(0)).toBe("");
  });
});

describe("publicMediaUrl", () => {
  const site = "https://example.test";

  it("makes an uploads path absolute", () => {
    expect(publicMediaUrl("/uploads/abc.mp3", site)).toBe("https://example.test/uploads/abc.mp3");
  });

  it("passes somebody else's URL through", () => {
    expect(publicMediaUrl("https://cdn.example/a.mp3", site)).toBe("https://cdn.example/a.mp3");
  });

  it("never hands out a protected file on a public page", () => {
    expect(publicMediaUrl("protected:abc.mp3", site)).toBe("");
  });

  it("is empty for nothing", () => {
    expect(publicMediaUrl("", site)).toBe("");
    expect(publicMediaUrl(null, site)).toBe("");
  });
});

describe("feedNotesHtml", () => {
  it("renders the Markdown show notes as HTML for podcast apps", () => {
    const html = feedNotesHtml("Hello!\n\n- One\n- Two\n\n[Click here!](https://example.test/j)", "");
    expect(html).toContain("<ul><li>One</li><li>Two</li></ul>");
    expect(html).toContain('<a href="https://example.test/j">Click here!</a>');
  });

  it("falls back to the summary, and cannot close the CDATA section", () => {
    expect(feedNotesHtml("", "Just a summary")).toBe("<p>Just a summary</p>");
    expect(feedNotesHtml("a ]]> b", "")).not.toContain("]]>");
    expect(feedNotesHtml(null, null)).toBe("");
  });
});
