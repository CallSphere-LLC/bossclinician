import { Router } from "express";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { can } from "../../services/permissions";
import { notFound } from "../../utils/httpError";

/** Visitor conversations with the AI widget. Mounted at /admin/chats. */
export const adminChatsRouter = Router();

export interface ChatSessionSummary {
  id: string;
  startedAt: string;
  meta: Record<string, unknown>;
  messageCount: number;
  lastMessageAt: string | null;
  preview: string | null;
}

/**
 * The session row itself. `ChatSessionSummary`'s other three fields are
 * aggregates the list query computes — they are not columns, so the detail
 * endpoint cannot honestly claim them.
 */
export type ChatSessionRow = Pick<ChatSessionSummary, "id" | "startedAt" | "meta">;

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
}

/** How much of the opening question the inbox list shows before it truncates. */
const PREVIEW_CHARS = 140;

adminChatsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // One pass over the join rather than a per-session preview query: the
    // opening question is the first element of the user-only content array,
    // which array_agg(... ) FILTER gives us alongside the count and last-seen
    // aggregates.
    const result = await pool.query(
      `SELECT s.id,
              s.started_at,
              s.meta,
              COUNT(m.id)::int  AS message_count,
              MAX(m.created_at) AS last_message_at,
              LEFT(
                (ARRAY_AGG(m.content ORDER BY m.created_at, m.id)
                   FILTER (WHERE m.role = 'user'))[1],
                $1::int
              ) AS preview
       FROM chat_sessions s
       LEFT JOIN chat_messages m ON m.session_id = s.id
       WHERE ($2::boolean OR COALESCE(s.meta->>'surface', 'public') NOT IN ('admin', 'member'))
       GROUP BY s.id
       ORDER BY s.started_at DESC
       LIMIT 200`,
      [PREVIEW_CHARS, can(req.user?.role ?? "", "admins.view")],
    );
    res.json(rowsToCamel<ChatSessionSummary>(result.rows));
  }),
);

adminChatsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await pool.query("SELECT * FROM chat_sessions WHERE id = $1 AND ($2::boolean OR COALESCE(meta->>'surface', 'public') NOT IN ('admin', 'member'))", [req.params.id, can(req.user?.role ?? "", "admins.view")]);
    if (session.rowCount === 0) throw notFound("Conversation not found");

    // id breaks ties: a question and its reply can land in the same timestamp
    // tick, and a transcript rendered out of order is worse than useless.
    const messages = await pool.query(
      "SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at, id",
      [req.params.id],
    );

    res.json({
      session: rowToCamel<ChatSessionRow>(session.rows[0]),
      messages: rowsToCamel<ChatMessage>(messages.rows),
    });
  }),
);

adminChatsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    // chat_messages cascades on the session FK, so this is the whole delete.
    const result = await pool.query("DELETE FROM chat_sessions WHERE id = $1 AND ($2::boolean OR COALESCE(meta->>'surface', 'public') NOT IN ('admin', 'member'))", [req.params.id, can(req.user?.role ?? "", "admins.view")]);
    if (result.rowCount === 0) throw notFound("Conversation not found");
    res.json({ ok: true });
  }),
);
