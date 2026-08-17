import { Router } from "express";
import crypto from "crypto";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { chatSchema, chatTranscriptSchema } from "../../validation/schemas";
import { badRequest } from "../../utils/httpError";
import { env } from "../../config/env";
import { chatLimiter, chatTranscriptLimiter } from "../../middleware/rateLimit";

export const chatRouter = Router();

const FALLBACK_REPLY =
  "Thanks for reaching out! I'm having trouble connecting right now, but you can apply for 1:1 coaching or explore the free masterclass while I get back online — or email bossclinician@gmail.com directly.";

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

    await pool.query(
      `INSERT INTO chat_sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [sessionId]
    );
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
      [sessionId, message]
    );

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

    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
      [sessionId, reply]
    );

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
    // exist yet. The `voice` flag is merged rather than assigned: a session
    // that also holds typed messages keeps whatever else it was carrying, and
    // the inbox uses the flag to tell the two modes apart.
    await pool.query(
      `INSERT INTO chat_sessions (id, meta) VALUES ($1, '{"voice": true}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET meta = chat_sessions.meta || '{"voice": true}'::jsonb`,
      [sessionId]
    );

    // One statement for the whole turn: unnest keeps the lines in the order
    // they were spoken, which is the order the transcript is read back in.
    await pool.query(
      `INSERT INTO chat_messages (session_id, role, content)
       SELECT $1, * FROM unnest($2::text[], $3::text[])`,
      [sessionId, lines.map((line) => line.role), lines.map((line) => line.content)]
    );

    res.status(201).json({ ok: true });
  })
);
