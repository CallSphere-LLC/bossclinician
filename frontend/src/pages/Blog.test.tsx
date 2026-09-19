import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import Blog from "./Blog";
import { SsrProvider } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";
import type { BlogCard } from "@/types";

/**
 * The blog index is server-rendered, so anything it dereferences it dereferences
 * inside `renderToString`. `blog_posts.published_at` and `cover_image` are both
 * nullable in the database (both list queries order by the first with NULLS
 * LAST) while the frontend's `BlogCard` types them as plain strings — so TypeScript
 * cannot catch a missing one and a single dateless row would take the whole
 * archive down: the server render throws, the renderer falls back to the empty
 * SPA shell, and the browser then hits the same error and shows the route error
 * screen.
 */
function renderBlog(items: unknown[], location = "/blog"): string {
  return renderToStaticMarkup(
    <SsrProvider
      runtime={{
        payload: {
          origin: "https://example.com",
          indexable: true,
          data: {
            [ssrKeys.blogList(location.includes("tag=") ? "marketing" : undefined)]: {
              items,
              total: items.length,
              page: 1,
              pageSize: 10,
            },
          },
        },
        headSink: [],
      }}
    >
      <StaticRouter location={location}>
        <Blog />
      </StaticRouter>
    </SsrProvider>,
  );
}

const POST: BlogCard = {
  id: "1",
  slug: "first-post",
  title: "First Post",
  excerpt: "What this one is about.",
  coverImage: "/images/first.webp",
  tags: ["marketing", "boss clinician"],
  author: "Yvette Howard, LCSW",
  readMinutes: 6,
  publishedAt: "2026-06-01T00:00:00.000Z",
};

const SECOND: BlogCard = { ...POST, id: "2", slug: "second-post", title: "Second Post" };

describe("Blog index", () => {
  it("prints the publication date under a headline", () => {
    const html = renderBlog([POST]);
    expect(html).toContain("First Post");
    expect(html).toContain("Jun 01, 2026");
  });

  it("still renders every article when a published post carries no date", () => {
    const html = renderBlog([{ ...POST, publishedAt: null }, SECOND]);
    expect(html).toContain("First Post");
    expect(html).toContain("Second Post");
    // The dateless post drops its <time>, it does not print "null".
    expect(html).not.toContain("null");
  });

  it("keeps the archive reset link on a topic URL", () => {
    const html = renderBlog([POST], "/blog?tag=marketing");
    expect(html).toContain('href="/blog"');
  });
});
