import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { alumniPreview, saveAlumniSettings } from "../../services/retreatAlumni";

/**
 * Post-retreat alumni emails (sheet row 249) — mounted at
 * /api/admin/retreat-alumni behind the marketing module.
 *
 *   GET /:slug/preview?firstName=Jasmine   send dates, the four emails rendered
 *                                          for that retreat, its guests, gaps
 *   PUT /:slug/settings                    { nextUrl?, featuredRetreatSlug?, enabled? }
 *
 * Read-only apart from the settings row; nothing here enrols or sends.
 */
export const adminRetreatAlumniRouter = Router();

adminRetreatAlumniRouter.get(
  "/:slug/preview",
  asyncHandler(async (req, res) => {
    const firstName =
      typeof req.query.firstName === "string" && req.query.firstName.trim()
        ? req.query.firstName.trim().slice(0, 60)
        : "Jasmine";
    const preview = await alumniPreview(req.params.slug, firstName);
    if (!preview) throw notFound("Retreat not found");
    res.json(preview);
  })
);

adminRetreatAlumniRouter.put(
  "/:slug/settings",
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        nextUrl: z
          .string()
          .trim()
          .max(2000)
          .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Use a full https:// link, or leave it blank")
          .optional(),
        featuredRetreatSlug: z.string().trim().max(200).nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(req.body);
    let saved: boolean;
    try {
      saved = await saveAlumniSettings(req.params.slug, input);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Could not save");
    }
    if (!saved) throw notFound("Retreat not found");
    const preview = await alumniPreview(req.params.slug);
    res.json(preview);
  })
);
