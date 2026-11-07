import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest } from "../../utils/httpError";
import { recordAdminAction } from "../../services/adminAudit";

/**
 * Marketing → Studio — mounted at /api/admin/marketing-studio.
 *
 * The owner's content-planning board. The screen holds its entire working
 * state as one JSON document (`{settings, posts, savedIdeas, legacy, hookEdits,
 * customHooks}`) plus an optional `recovery` snapshot, and this router stores
 * both in the single row of `marketing_studio_state` (migration 194).
 *
 * Saves are optimistic: a PUT names the `version` it was based on, and only
 * lands when that is still the stored version. A tab left open over the
 * weekend therefore cannot wipe out the work saved from another one — it gets
 * a 409 carrying the server's copy and decides what to do with it.
 *
 * The body can be far larger than the site's 2 MB JSON limit (a year of posts
 * with drafts), so app.ts mounts a path-scoped parser for this route ahead of
 * the global one. MAX_BODY_LIMIT is that limit.
 */
export const adminMarketingStudioRouter = Router();

export const MAX_BODY_LIMIT = "15mb";

/**
 * The shape the server insists on. Only the three keys every screen version
 * reads are checked; everything else in the document (`legacy`, `hookEdits`,
 * `customHooks` and whatever the screen adds next) is kept as sent.
 */
const plainObject = z.record(z.string(), z.unknown());

export const studioStateSchema = z.looseObject({
  settings: plainObject,
  posts: z.array(z.unknown()),
  savedIdeas: z.array(z.unknown()),
});

export const saveStudioSchema = z.object({
  state: studioStateSchema,
  version: z.number().int().min(0).max(2_147_483_647),
  recovery: plainObject.nullable().optional(),
});

export type SaveStudioInput = z.infer<typeof saveStudioSchema>;

interface StateRow {
  state: Record<string, unknown>;
  recovery: Record<string, unknown> | null;
  version: number;
  updated_at: Date | string;
}

const iso = (value: Date | string): string => new Date(value).toISOString();

adminMarketingStudioRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query<StateRow>(
      `SELECT state, recovery, version, updated_at FROM marketing_studio_state WHERE id = 1`
    );
    const row = rows[0];
    res.json({
      state: row ? row.state : null,
      recovery: row ? row.recovery : null,
      version: row ? row.version : 0,
      updatedAt: row ? iso(row.updated_at) : null,
    });
  })
);

adminMarketingStudioRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = saveStudioSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest("Invalid studio state", parsed.error.issues);
    const { state, version } = parsed.data;

    // `recovery` absent → keep what is stored; present (object or null) → set it.
    const setRecovery = parsed.data.recovery !== undefined;
    const recovery = setRecovery && parsed.data.recovery !== null ? JSON.stringify(parsed.data.recovery) : null;
    const updatedBy = (req.user?.email ?? (req.user?.sub != null ? String(req.user.sub) : "")).slice(0, 320) || null;
    const stateJson = JSON.stringify(state);

    let saved = await pool.query<{ version: number; updated_at: Date | string }>(
      `UPDATE marketing_studio_state
          SET state = $1::jsonb,
              recovery = CASE WHEN $2::boolean THEN $3::jsonb ELSE recovery END,
              version = version + 1,
              updated_at = now(),
              updated_by = $4
        WHERE id = 1 AND version = $5
        RETURNING version, updated_at`,
      [stateJson, setRecovery, recovery, updatedBy, version]
    );

    // The very first save: there is no row yet, and only a client that has never
    // seen one (version 0) may create it. A concurrent first save loses the
    // ON CONFLICT race and falls through to the 409 below like any stale save.
    if (!saved.rows[0] && version === 0) {
      saved = await pool.query<{ version: number; updated_at: Date | string }>(
        `INSERT INTO marketing_studio_state (id, state, recovery, version, updated_at, updated_by)
         VALUES (1, $1::jsonb, $2::jsonb, 1, now(), $3)
         ON CONFLICT (id) DO NOTHING
         RETURNING version, updated_at`,
        [stateJson, recovery, updatedBy]
      );
    }

    const row = saved.rows[0];
    if (!row) {
      const current = await pool.query<StateRow>(
        `SELECT state, recovery, version, updated_at FROM marketing_studio_state WHERE id = 1`
      );
      res.status(409).json({
        error: "conflict",
        code: "version_conflict",
        state: current.rows[0]?.state ?? null,
        version: current.rows[0]?.version ?? 0,
      });
      return;
    }

    // Who saved and when — never the document itself, which can run to
    // megabytes and is the owner's private planning, not an audited record.
    await recordAdminAction({
      req,
      action: "marketing_studio.save",
      entityType: "marketing_studio_state",
      entityId: 1,
      after: { version: row.version, recoveryChanged: setRecovery },
    });

    res.json({ version: row.version, updatedAt: iso(row.updated_at) });
  })
);
