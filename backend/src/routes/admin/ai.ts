import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, serviceUnavailable } from "../../utils/httpError";
import { generateBlogSchema } from "../../validation/schemas";
import { env } from "../../config/env";

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
