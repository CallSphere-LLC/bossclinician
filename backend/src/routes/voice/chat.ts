import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, serviceUnavailable } from "../../utils/httpError";
import { voiceEnabled } from "../../config/env";
import { voiceChatLimiter } from "../../middleware/rateLimit";
import { recordInboxTurn, type InboxLine } from "../../services/conversationInbox";
import { resolveSurface } from "../../services/voice/contract";
import { conciergeInstructions } from "../../services/voice/liveConfig";
import { conciergeTurn } from "../../services/voice/liveSession";
import {
  MAX_CHAT_CONTENT_CHARS,
  MAX_CHAT_MESSAGES,
  admissibleTools,
  callerKey,
  claimSessionSlot,
  normalisePath,
} from "../../services/voice/policy";
import {
  ensureVoiceVisitorId,
  loadSessionForCaller,
  openSession,
} from "../../services/voice/sessionStore";
import { identityFromRequest } from "./session";

export const voiceChatRouter = Router();

export const messageSchema = z.union([
  z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_CHAT_CONTENT_CHARS),
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string().min(1).max(128),
    name: z.string().max(64),
    arguments: z.record(z.string(), z.json()).refine(
      (value) => JSON.stringify(value).length <= MAX_CHAT_CONTENT_CHARS,
      "Tool arguments are too large",
    ).optional(),
    content: z.string().max(MAX_CHAT_CONTENT_CHARS),
  }),
]);

const chatSchema = z.object({
  sessionId: z.string().min(1).max(128).nullable(),
  surface: z.enum(["public", "member", "admin"]),
  path: z.string().max(2048),
  messages: z.array(messageSchema).min(1).max(MAX_CHAT_MESSAGES),
  tools: z
    .array(
      z.object({
        name: z.string().max(64),
        description: z.string().max(16000),
        parameters: z.record(z.string(), z.unknown()),
      }),
    )
    .max(64),
});

/**
 * POST /api/voice/chat — the concierge, typed instead of spoken.
 *
 * The chat widget must do everything the microphone does (docs/VOICE-AGENT.md,
 * addendum 2): navigate, point, read the page, run the walkthrough. So this
 * route is not a reply generator. It runs ONE turn of the model and hands back
 * whatever tool calls it made, for the BROWSER to execute — because the tools
 * touch the DOM and the router, and neither of those is here. The browser
 * appends the results and calls again. The loop is the browser's; the model is
 * the server's, because the key is.
 *
 * The surface is re-decided from this request's own credentials, exactly as it
 * is for a voice session, and the tool descriptors the browser submitted are
 * then narrowed to what that surface actually owns. That second step is not
 * belt and braces: without it a patched bundle could describe
 * `run_approved_action` into a conversation a signed-out visitor is having, and
 * the model would cheerfully call it.
 */
voiceChatRouter.post(
  "/chat",
  voiceChatLimiter,
  asyncHandler(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid chat request", parsed.error.flatten());

    if (!voiceEnabled()) {
      throw serviceUnavailable("The assistant is unavailable right now.");
    }

    const identity = await identityFromRequest(req, res);
    const surface = resolveSurface(parsed.data.surface, identity);
    const tools = admissibleTools(surface, parsed.data.tools);
    const path = normalisePath(parsed.data.path);

    // Minted for every turn, not just the first: it is how a signed-out
    // visitor's later messages are recognised as theirs.
    const visitorId = identity.audience === "anonymous" ? ensureVoiceVisitorId(req, res) : null;

    // A session id in the body is a claim, not a fact. It is checked against
    // this caller before it is reused, because a conversation's later turns are
    // appended to the row it names: without the check, anyone who guessed an id
    // could write into somebody else's transcript. An id that is not theirs is
    // treated as no id at all, and a fresh conversation is opened — there is
    // nothing useful to tell them, and a distinct refusal would confirm that
    // the session exists.
    let sessionId: string | null = null;
    if (parsed.data.sessionId) {
      const existing = await loadSessionForCaller(parsed.data.sessionId, { identity, visitorId });
      sessionId = existing?.id ?? null;
    }

    // A conversation with no row yet opens one now, and pays for it out of the
    // same hourly allowance a spoken call would. Typing is cheaper than
    // talking, but it is the same assistant doing the same work, and a budget
    // one transport can walk around is not a budget.
    if (!sessionId) {
      const slot = claimSessionSlot(callerKey(identity, { visitorId, ip: req.ip ?? "" }), surface);
      if (!slot.allowed) {
        res.setHeader("Retry-After", String(slot.retryAfterSeconds));
        res.status(429).json({
          error: "You have started a lot of conversations in the last hour. Try again shortly.",
        });
        return;
      }
      ({ sessionId } = await openSession({
        surface,
        identity,
        path,
        ip: req.ip ?? "",
        userAgent: req.get("user-agent") ?? "",
        visitorId,
        mode: "text",
      }));
    }

    const streaming = (req.get("accept") ?? "").includes("text/event-stream");
    const cancelled = new AbortController();
    const onClose = () => { if (!res.writableEnded) cancelled.abort(); };
    res.on("close", onClose);
    const emit = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    if (streaming) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      emit("session", { sessionId, surface });
    }

    const turn = await conciergeTurn({
      stream: streaming,
      signal: cancelled.signal,
      onDelta: streaming ? (text) => emit("delta", { text }) : undefined,
      surface,
      instructions:
        `${conciergeInstructions(surface)}\n\n` +
        `This person is typing rather than speaking, so you may use short lists ` +
        `where they help — but you still do the things rather than describing ` +
        `them. They are currently looking at ${path}; say what is on that page, ` +
        `not what you remember about it.`,
      messages: toModelInput(parsed.data.messages),
      tools,
    });

    if (!turn.ok) {
      res.removeListener("close", onClose);
      if (streaming) {
        emit("error", { error: turn.error });
        res.end();
      } else res.status(turn.status).json({ error: turn.error });
      return;
    }

    // The owner's Conversations inbox, which this transport must keep filling:
    // it is the screen she already reads her visitors' conversations on, and a
    // new concierge that writes only to its own table would empty it without
    // anybody having said it was being removed. Only what is NEW this turn is
    // appended — the request carries the whole conversation, and the browser
    // comes straight back with tool results, so a naive "write the messages"
    // would record the same exchange several times over.
    // The contacts inbox is for public visitor conversations. Member/account
    // and admin-operation replies belong only in the permission-gated voice log.
    if (surface === "public") {
      await recordInboxTurn({
        sessionId,
        lines: inboxLines(parsed.data.messages, turn.reply),
        meta: { concierge: true, surface },
      });
    }

    res.removeListener("close", onClose);
    if (streaming) {
      emit("done", { sessionId, surface, reply: turn.reply, toolCalls: turn.toolCalls });
      res.end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    // The surface the SERVER decided, so a signed-out person on an admin URL
    // can be told the concierge is the public one rather than left thinking it
    // has gone stupid.
    res.json({ sessionId, surface, reply: turn.reply, toolCalls: turn.toolCalls });
  }),
);

type ChatMessage = z.infer<typeof messageSchema>;

/**
 * What of this turn is new, and therefore belongs in the owner's inbox.
 *
 * One typed sentence is several requests: the browser sends the question, gets
 * tool calls back, runs them and calls again with the results. Only the first
 * of those calls ends with the person's own words, so that is the only one that
 * contributes a question — and every call may contribute a reply. The tool
 * traffic in between is the concierge's business, not the inbox's; Yvette wants
 * to read a conversation, not a call log.
 */
function inboxLines(messages: ChatMessage[], reply: string | null): InboxLine[] {
  const lines: InboxLine[] = [];
  const last = messages[messages.length - 1];
  if (last && last.role === "user") lines.push({ role: "user", content: last.content });
  if (reply) lines.push({ role: "assistant", content: reply });
  return lines;
}

/**
 * The conversation, in the shape the Responses API reads.
 *
 * A tool result cannot stand on its own there — the model has to see the call
 * that produced it — so each one is paired with the call it answers. The
 * original arguments must accompany the result. Inventing an empty call makes
 * the model forget which schema or record it already requested and can cause
 * repeated discovery instead of moving on to the approval step.
 */
export function toModelInput(messages: ChatMessage[]): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call",
        call_id: message.toolCallId,
        name: message.name,
        arguments: JSON.stringify(message.arguments ?? {}),
      });
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      });
    } else {
      input.push({ role: message.role, content: message.content });
    }
  }
  return input;
}
