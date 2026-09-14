import { Request, Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { serviceUnavailable } from "../../utils/httpError";
import { renderPage, ssrKeys } from "../../ssr/renderer";
import {
  loadBlogList,
  loadBlogPost,
  loadCourseDetail,
  loadCourses,
  loadResources,
  loadTestimonials,
} from "../../ssr/loaders";

/**
 * HTML for the public marketing pages.
 *
 * These are the URLs a crawler asks for and the 125 indexed bossclinician.com
 * paths redirect to, and until now every one of them answered with an empty
 * `<div id="root">`. nginx sends exactly this list here; everything else — the
 * member app, the admin, checkout — keeps being served as the client-rendered
 * shell it has always been. Those are all behind a sign-in, no crawler sees
 * them, and rendering them on the server would multiply the risk for nothing.
 *
 * A route's loader reads what its page needs, and nothing else: the payload is
 * embedded in the document, so anything put in here is published.
 */
export const renderRouter = Router();

type SsrKeys = NonNullable<ReturnType<typeof ssrKeys>>;
type Loader = (req: Request, keys: SsrKeys) => Promise<Record<string, unknown>>;

const ROUTES: { path: string; load?: Loader }[] = [
  {
    path: "/",
    load: async (_req, keys) => ({ [keys.testimonials()]: await loadTestimonials() }),
  },
  { path: "/about" },
  { path: "/work-with-me" },
  {
    path: "/courses",
    load: async (_req, keys) => ({ [keys.courses()]: await loadCourses() }),
  },
  // Where 55 of the legacy bossclinician.com product URLs land.
  {
    path: "/courses/:slug",
    load: async (req, keys) => ({
      [keys.courseDetail(req.params.slug)]: await loadCourseDetail(req.params.slug),
    }),
  },
  { path: "/partners" },
  {
    path: "/resources",
    load: async (_req, keys) => ({ [keys.resources()]: await loadResources() }),
  },
  { path: "/resource-hub" },
  {
    // The tag archives are 21 separately indexed URLs on the live site, so the
    // filtered listing is rendered as its own page rather than as the unfiltered
    // one with a query string hanging off it.
    path: "/blog",
    load: async (req, keys) => {
      const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
      return { [keys.blogList(tag)]: await loadBlogList(tag) };
    },
  },
  {
    path: "/blog/:slug",
    load: async (req, keys) => ({
      [keys.blogPost(req.params.slug)]: await loadBlogPost(req.params.slug),
    }),
  },
  { path: "/apply" },
  { path: "/contact" },
  { path: "/retreats" },
  { path: "/store" },
  { path: "/practice-quiz" },
  { path: "/practice-reset-planner" },
  { path: "/privacy-policy" },
  { path: "/terms" },
  { path: "/disclaimer" },
  { path: "/financial-disclaimer" },
];

for (const route of ROUTES) {
  renderRouter.get(
    route.path,
    asyncHandler(async (req, res) => {
      const keys = ssrKeys();

      let data: Record<string, unknown> = {};
      if (keys && route.load) {
        try {
          data = await route.load(req, keys);
        } catch (err) {
          // An unreadable database costs the page its server-rendered content
          // and nothing more: with no seed the browser renders exactly what the
          // server just did — the bundled fallback copy — and then fetches.
          // Visitor-supplied URL: an argument, quoted — see the same line in ssr/renderer.ts.
          console.error("[ssr] %s loaded no data:", JSON.stringify(req.originalUrl), (err as Error).message);
        }
      }

      const page = await renderPage(req.originalUrl, data);
      if (!page) {
        // No index.html means the frontend build never reached this image.
        // nginx answers a 503 here by serving the SPA container instead.
        throw serviceUnavailable("Page rendering is unavailable");
      }

      res.status(page.status);
      res.type("html");
      // The document carries whatever the visitor's session makes true, so it
      // is revalidated rather than held. Its assets are immutable and cached
      // by their hashed names, which is where the caching actually pays.
      res.set("Cache-Control", "public, max-age=0, must-revalidate");
      res.send(page.html);
    }),
  );
}
