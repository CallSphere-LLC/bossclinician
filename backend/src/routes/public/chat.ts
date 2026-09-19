import { Router } from "express";
import crypto from "crypto";
import { asyncHandler } from "../../utils/asyncHandler";
import { recordInboxTurn } from "../../services/conversationInbox";
import { chatSchema, chatTranscriptSchema } from "../../validation/schemas";
import { badRequest } from "../../utils/httpError";
import { env } from "../../config/env";
import { chatLimiter, chatTranscriptLimiter } from "../../middleware/rateLimit";

export const chatRouter = Router();

const FALLBACK_REPLY =
  "Thanks for reaching out! I'm having trouble connecting right now, but you can explore the B.O.S.S. Club, Boardroom, or retreats or explore the free masterclass while I get back online — or email bossclinician@gmail.com directly.";

interface AiChatResponse {
  reply: string;
  suggestions?: string[];
  leadSignal?: boolean;
}

chatRouter.post(
  "/chat",
  chatLimiter,
  asyncHandler(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid chat payload", parsed.error.flatten());
    const { message } = parsed.data;
    const sessionId = parsed.data.sessionId ?? crypto.randomUUID();

    // Written before the model is called, not after, so a question survives a
    // model that never answers.
    await recordInboxTurn({ sessionId, lines: [{ role: "user", content: message }] });

    let reply = FALLBACK_REPLY;
    let suggestions: string[] = [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const aiRes = await fetch(`${env.aiBaseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (aiRes.ok) {
        const data = (await aiRes.json()) as AiChatResponse;
        reply = data.reply ?? FALLBACK_REPLY;
        suggestions = data.suggestions ?? [];
      } else {
        // eslint-disable-next-line no-console
        console.error(`[chat] AI service responded ${aiRes.status}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[chat] AI service unreachable, using fallback reply:", err);
    }

    await recordInboxTurn({ sessionId, lines: [{ role: "assistant", content: reply }] });

    res.json({ sessionId, reply, suggestions });
  })
);

/**
 * POST /chat/transcript
 *
 * Voice audio travels browser <-> OpenAI over WebRTC, so those words never
 * pass through this server the way typed ones do. The widget posts each
 * completed turn here instead, into the same two tables the text chat writes,
 * so one admin screen holds a whole conversation whichever way it was held.
 */
chatRouter.post(
  "/chat/transcript",
  chatTranscriptLimiter,
  asyncHandler(async (req, res) => {
    const parsed = chatTranscriptSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid transcript payload", parsed.error.flatten());
    const { sessionId, lines } = parsed.data;

    // A visitor can press Talk without ever typing, so the session row may not
    // exist yet, and the `voice` flag is what the inbox tells the two modes
    // apart by. See services/conversationInbox.ts for why it is merged.
    await recordInboxTurn({ sessionId, lines, meta: { voice: true } });

    res.status(201).json({ ok: true });
  })
);
