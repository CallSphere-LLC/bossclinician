import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { rowToCamel, rowsToCamel } from "../../utils/case";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { isExternalRef, isProtectedRef } from "../../services/signedUrls";

/**
 * The handouts and recordings attached to a coaching session.
 *
 * Mounted at /admin/coaching. The member side has read `coaching_session_files`
 * since migration 003 (routes/member/coaching.ts, `loadSessionFiles`) and this
 * is the half that writes it.
 *
 * A row never owns bytes. `url` holds a reference the media library produced,
 * and the member route only knows what to do with two sorts: one into the
 * protected directory, which it signs for the member the session belongs to,
 * and an absolute link on somebody else's host — a Zoom recording, a Google
 * Doc — which it hands over as it stands. A public `/uploads/...` path is
 * refused here for the same reason lesson downloads refuse it: a supervision
 * handout is as private as the session, and a path anyone can open is not.
 */
export const adminCoachingSessionFilesRouter = Router();

export interface CoachingSessionFile {
  id: number;
  sessionId: number;
  mediaId: number | null;
  title: string;
  url: string;
  createdAt: string;
}

export const sessionFileSchema = z.object({
  mediaId: z.number().int().positive().nullable().default(null),
  title: z.string().trim().max(300).default(""),
  url: z.string().trim().min(1).max(1000),
});

/** Whether the member route will be able to hand this reference to a member. */
export function isAttachableRef(reference: string): boolean {
  return isProtectedRef(reference) || isExternalRef(reference);
}

function positiveId(raw: string | undefined, message: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(message);
  return id;
}

adminCoachingSessionFilesRouter.get(
  "/sessions/:id/files",
  asyncHandler(async (req, res) => {
    const sessionId = positiveId(req.params.id, "Invalid session id");
    const result = await pool.query(
      `SELECT * FROM coaching_session_files WHERE session_id = $1 ORDER BY id`,
      [sessionId],
    );
    res.json(rowsToCamel<CoachingSessionFile>(result.rows));
  }),
);

adminCoachingSessionFilesRouter.post(
  "/sessions/:id/files",
  asyncHandler(async (req, res) => {
    const sessionId = positiveId(req.params.id, "Invalid session id");
    const parsed = sessionFileSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid file", parsed.error.flatten());
    if (!isAttachableRef(parsed.data.url)) {
      throw badRequest(
        "Upload session files for your client only, or paste a full link starting with https://.",
      );
    }
    const session = await pool.query(`SELECT 1 FROM coaching_sessions WHERE id = $1`, [sessionId]);
    if (session.rowCount === 0) throw notFound("Session not found");
    const file = await pool.query(
      `INSERT INTO coaching_session_files (session_id, media_id, title, url)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [sessionId, parsed.data.mediaId, parsed.data.title, parsed.data.url],
    );
    res.status(201).json(rowToCamel<CoachingSessionFile>(file.rows[0]));
  }),
);

adminCoachingSessionFilesRouter.delete(
  "/sessions/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const sessionId = positiveId(req.params.id, "Invalid session id");
    const fileId = positiveId(req.params.fileId, "Invalid file id");
    // The row only. The bytes stay in the media library, where she can still
    // find them and where another session may be pointing at the same file.
    const removed = await pool.query(
      `DELETE FROM coaching_session_files WHERE id = $1 AND session_id = $2`,
      [fileId, sessionId],
    );
    if (removed.rowCount === 0) throw notFound("File not found");
    res.status(204).end();
  }),
);
