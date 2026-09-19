import { pool } from "../db/pool";

/**
 * The owner's Conversations inbox — `chat_sessions` / `chat_messages`, read by
 * the admin page at /admin/conversations (routes/admin/chats.ts).
 *
 * This is one table pair with three writers, which is why it is a function
 * rather than three copies of the same two statements:
 *
 *  - the typed chat widget (`POST /api/chat`),
 *  - the old voice widget, which posts each finished spoken turn after the fact
 *    (`POST /api/chat/transcript`) because that audio never passes through this
 *    server,
 *  - and the concierge's text transport (`POST /api/voice/chat`).
 *
 * The concierge keeps its own record too, in `voice_sessions` — that one exists
 * to audit a session: who it was, what surface, what was approved, where the
 * audio is. This one exists so Yvette can read her visitors' conversations in
 * the place she already reads them. Writing only the first would have quietly
 * emptied a screen she uses today, which is not a thing a new feature is
 * allowed to do.
 */

export type InboxLine = { role: "user" | "assistant"; content: string };

/**
 * Appends one exchange, opening the conversation if this is its first.
 *
 * `meta` is MERGED rather than assigned, because a session can be both typed
 * and spoken and the flags are how the inbox tells the modes apart — assigning
 * would mean whichever turn came last decided what the whole conversation was.
 */
export async function recordInboxTurn(input: {
  /** Shared with the concierge's own `voice_sessions.id`, so one conversation has one name. */
  sessionId: string;
  lines: InboxLine[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO chat_sessions (id, meta) VALUES ($1, $2::jsonb)
     ON CONFLICT (id) DO UPDATE SET meta = chat_sessions.meta || $2::jsonb`,
    [input.sessionId, JSON.stringify(input.meta ?? {})]
  );

  if (input.lines.length === 0) return;

  // One statement for the whole exchange: unnest keeps the lines in the order
  // they were said, which is the order the transcript is read back in.
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content)
     SELECT $1, * FROM unnest($2::text[], $3::text[])`,
    [
      input.sessionId,
      input.lines.map((line) => line.role),
      input.lines.map((line) => line.content),
    ]
  );
}
