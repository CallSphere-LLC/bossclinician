import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError, badRequest, serviceUnavailable } from "../../utils/httpError";
import { generateBlogSchema } from "../../validation/schemas";
import { env } from "../../config/env";
import { requirePermission } from "../../services/permissions";
import { recordAdminAction } from "../../services/adminAudit";
import { ensureCourseProduct } from "../../services/courseProduct";
import {
  courseOutlineRequestSchema,
  createCourseFromOutlineSchema,
  createCourseFromOutline,
  generateCourseOutline,
} from "../../services/courseOutline";

export const adminAiRouter = Router();

adminAiRouter.post(
  "/generate-blog",
  asyncHandler(async (req, res) => {
    const parsed = generateBlogSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid payload", parsed.error.flatten());

    let aiRes: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      aiRes = await fetch(`${env.aiBaseUrl}/generate/blog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (err) {
      throw serviceUnavailable(
        `AI service is unreachable at ${env.aiBaseUrl}. Please try again shortly.`
      );
    }

    if (!aiRes.ok) {
      throw serviceUnavailable(`AI service returned an error (status ${aiRes.status}).`);
    }

    const data = await aiRes.json();
    res.json(data);
  })
);

/* ------------------------- Build a course with AI ------------------------- */

/**
 * This router is mounted behind the *website* gate (it began as the blog
 * writer), and Marketing holds `website.manage` but only `products.view`. These
 * two routes write courses, so they answer to the products permission as well —
 * without it, "Build with AI" would be a side door past the Products gate.
 */
const coursesManage = requirePermission("products.manage");

/**
 * Each generation is one paid model call of up to a minute or two. Keyed by the
 * signed-in admin rather than the address: req.ip is the same for everybody
 * behind the proxy in production (see app.ts), so a per-IP counter would be one
 * counter for the whole team.
 */
const courseOutlineLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "That's a lot of outlines in one hour. Please try again a little later." },
  keyGenerator: (req: Request): string =>
    req.user?.sub ? `admin:${req.user.sub}` : ipKeyGenerator(req.ip ?? ""),
});

/**
 * The sentence the screen shows. The schema's own messages are written for her
 * ("Every lesson needs a title."); "Invalid payload" tells her nothing.
 */
function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid payload";
}

/** POST /admin/ai/course-outline — draft an outline from a course name. Writes nothing. */
adminAiRouter.post(
  "/course-outline",
  coursesManage,
  courseOutlineLimiter,
  asyncHandler(async (req, res) => {
    const parsed = courseOutlineRequestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error), parsed.error.flatten());

    // Stop paying for an answer nobody is waiting for any more.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    const result = await generateCourseOutline(parsed.data, { signal: controller.signal });
    if (!result.ok) {
      if (result.status === 499) return;
      throw new HttpError(result.status, result.error);
    }
    res.json({ outline: result.outline });
  })
);

/**
 * POST /admin/ai/course-outline/create — save the reviewed outline as a draft
 * course with its sections and lessons, and answer with the new course's id so
 * the screen can open it in the course builder.
 */
adminAiRouter.post(
  "/course-outline/create",
  coursesManage,
  asyncHandler(async (req, res) => {
    const parsed = createCourseFromOutlineSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(firstIssue(parsed.error), parsed.error.flatten());

    const created = await createCourseFromOutline(parsed.data.outline, {
      publishLessons: parsed.data.publishLessons,
    });
    // The product that lets the course be sold and granted, as "Add a course"
    // makes one (routes/admin/courses.ts, sheet row 160). Idempotent and asked
    // again by the course's Offers tab, so a failure here is logged rather than
    // turned into an error for a course that was in fact created.
    try {
      await ensureCourseProduct(created.courseId);
    } catch (err) {
      console.error(`[course-ai] course ${created.courseId} created without its product:`, err);
    }
    await recordAdminAction({
      req,
      action: "course.ai_create",
      entityType: "course",
      entityId: created.courseId,
      after: {
        title: parsed.data.outline.title,
        slug: created.slug,
        published: false,
        modules: created.moduleCount,
        lessons: created.lessonCount,
        lessonsPublished: parsed.data.publishLessons,
      },
    });
    res.status(201).json(created);
  })
);
