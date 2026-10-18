import { pool } from "../db/pool";
import { hasCourseAccess } from "./access";
import { loadCourseForMember } from "./curriculum";

/**
 * What a member has entered into an interactive lesson tool (migration 119):
 * the Boss Move Exit Planner, the Practice Elevation dashboard, the Boardroom
 * CEO dashboard, the Practice Reset Snapshot.
 *
 * One JSON document per member per tool_key. The server does not interpret it
 * — the tool owns its shape — so what is checked here is only who may read or
 * write it and how large it may grow.
 */

/** The same shape course_lessons.tool_key's CHECK constraint enforces. */
const TOOL_KEY_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Ceiling on one saved document, measured as the JSON text the client sent. */
export const MAX_TOOL_STATE_BYTES = 256 * 1024;

/** A tool key off a URL, or null when it could not be one. */
export function cleanToolKey(raw: unknown): string | null {
  return typeof raw === "string" && raw.length <= 120 && TOOL_KEY_SHAPE.test(raw) ? raw : null;
}

/**
 * Why a document cannot be saved, or null when it can. A plain object only —
 * an array or a scalar is never what a tool writes — and no larger than
 * MAX_TOOL_STATE_BYTES once serialised.
 */
export function toolStateProblem(state: unknown): string | null {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return "Saved data must be an object.";
  }
  const size = Buffer.byteLength(JSON.stringify(state), "utf8");
  if (size > MAX_TOOL_STATE_BYTES) return "That is more than this tool can save. Please shorten some entries.";
  return null;
}

/**
 * Whether this member may use the tool: some published lesson carries the key,
 * they hold access to that lesson's course, and the lesson is open to them
 * (drip and "finish the previous lesson first" both respected) — the same test
 * the lesson read applies before it shows the tool at all.
 */
export async function mayUseTool(memberId: number, toolKey: string): Promise<boolean> {
  const lessons = await pool.query<{ id: number; course_id: number }>(
    `SELECT l.id, m.course_id
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
      WHERE l.tool_key = $1 AND l.published
      ORDER BY l.id`,
    [toolKey],
  );

  for (const lesson of lessons.rows) {
    if (!(await hasCourseAccess(memberId, lesson.course_id))) continue;
    const course = await loadCourseForMember(memberId, lesson.course_id);
    const view = course?.modules.flatMap((module) => module.lessons).find((entry) => entry.id === lesson.id);
    if (view?.unlocked) return true;
  }
  return false;
}

export interface StoredToolState {
  state: Record<string, unknown> | null;
  updatedAt: string | null;
}

export async function loadToolState(memberId: number, toolKey: string): Promise<StoredToolState> {
  const result = await pool.query<{ state: Record<string, unknown>; updated_at: Date }>(
    `SELECT state, updated_at FROM member_tool_state WHERE member_id = $1 AND tool_key = $2`,
    [memberId, toolKey],
  );
  const row = result.rows[0];
  return row
    ? { state: row.state, updatedAt: new Date(row.updated_at).toISOString() }
    : { state: null, updatedAt: null };
}

export async function saveToolState(
  memberId: number,
  toolKey: string,
  state: Record<string, unknown>,
): Promise<{ updatedAt: string }> {
  const result = await pool.query<{ updated_at: Date }>(
    `INSERT INTO member_tool_state (member_id, tool_key, state)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (member_id, tool_key)
     DO UPDATE SET state = EXCLUDED.state, updated_at = now()
     RETURNING updated_at`,
    [memberId, toolKey, JSON.stringify(state)],
  );
  return { updatedAt: new Date(result.rows[0].updated_at).toISOString() };
}
