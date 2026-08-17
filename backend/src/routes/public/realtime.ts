import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";
import { chatLimiter } from "../../middleware/rateLimit";

export const realtimeRouter = Router();

/**
 * Mints the browser's ephemeral Realtime credential.
 *
 * This only proxies: the OpenAI key lives in the AI service and never leaves
 * it, matching how /api/chat already works. The browser receives a secret that
 * expires in about a minute, which is enough to open its WebRTC session and
 * worthless afterwards.
 *
 * Rate limited with the chat limiter because each successful call starts a
 * billable audio session — this is the most expensive unauthenticated endpoint
 * on the site, so it must not be freely spammable.
 */
realtimeRouter.post(
  "/realtime/session",
  chatLimiter,
  asyncHandler(async (_req, res) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const aiRes = await fetch(`${env.aiBaseUrl}/realtime/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });

      const body = (await aiRes.json().catch(() => null)) as
        | { clientSecret?: string; detail?: string }
        | null;

      if (!aiRes.ok || !body?.clientSecret) {
        // 503, not 500: the widget reads this as "voice is unavailable right
        // now" and stays on text chat rather than surfacing a broken mic.
        res.status(503).json({
          error: "voice_unavailable",
          message:
            typeof body?.detail === "string"
              ? body.detail
              : "The voice assistant is unavailable right now.",
        });
        return;
      }

      res.json(body);
    } catch {
      res
        .status(503)
        .json({ error: "voice_unavailable", message: "The voice assistant is unavailable right now." });
    } finally {
      clearTimeout(timeout);
    }
  }),
);
