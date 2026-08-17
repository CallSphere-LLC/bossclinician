import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { leadsLimiter } from "../../middleware/rateLimit";
import { recordNotFound, resolveRedirect } from "../../services/redirects";

/**
 * Runtime half of the redirect map.
 *
 * The nginx map serves the 301s that matter for SEO. These two endpoints cover
 * what a static map cannot: a redirect added in the admin a minute ago (which
 * the edge has not reloaded yet), and reporting on the paths that matched
 * nothing at all.
 */
export const redirectsRouter = Router();

const pathSchema = z.object({ path: z.string().min(1).max(2000) });

/**
 * Asked by the SPA's 404 page before it renders.
 *
 * Answers `{redirect: null}` rather than 404 when there is no rule: "no
 * redirect exists" is a successful answer to this question, and a 404 here
 * would be indistinguishable from the endpoint itself being missing.
 */
redirectsRouter.get(
  "/redirects/resolve",
  asyncHandler(async (req, res) => {
    const parsed = pathSchema.safeParse({ path: req.query.path });
    if (!parsed.success) throw badRequest("A path is required");

    const hit = await resolveRedirect(parsed.data.path);
    res.set("Cache-Control", "public, max-age=300");
    res.json(hit ? { redirect: hit.toPath, statusCode: hit.statusCode } : { redirect: null });
  })
);

const missSchema = z.object({
  path: z.string().min(1).max(2000),
  referrer: z.string().max(2000).optional(),
});

/**
 * Beacon from the 404 page.
 *
 * Rate limited and always 204: this is fire-and-forget telemetry, and a
 * visitor who has already hit a dead link should not then see an error from the
 * thing that was supposed to record it.
 */
redirectsRouter.post(
  "/redirects/miss",
  leadsLimiter,
  asyncHandler(async (req, res) => {
    const parsed = missSchema.safeParse(req.body);
    if (parsed.success) {
      try {
        await recordNotFound({
          path: parsed.data.path,
          referrer: parsed.data.referrer,
          userAgent: req.headers["user-agent"] ?? "",
        });
      } catch (err) {
        console.error("[redirects] failed to record a miss:", (err as Error).message);
      }
    }
    res.status(204).end();
  })
);
