import { pool } from "../../db/pool";
import type { VoiceSurface } from "./contract";
import type { VoiceCaller } from "./sessionStore";

/**
 * Where the first-run walkthrough got to.
 *
 * Server-side because the point of it is that it follows the person: a member
 * who was shown three pages of their portal on a laptop at lunchtime does not
 * get shown them again on their phone that evening. The browser keeps a mirror
 * for anonymous visitors, but this is the copy that decides.
 *
 * `completed` covers two different endings on purpose — finished it, and said
 * no thanks. Both mean "never offer this again", and addendum 1 is explicit
 * that a declined offer is remembered. An offer that keeps coming back is the
 * thing it was written to prevent.
 */

/** The wire shape, matching `TourProgress` in the browser contract. */
export type TourProgress = {
  surface: VoiceSurface;
  index: number;
  completed: boolean;
  /** Unix milliseconds, as the contract says — not an ISO string. */
  updatedAt: number;
};

/**
 * Which column identifies this caller, and the value to match on.
 *
 * Returned as a discriminated little record rather than three branches inlined
 * at every query, because the three partial unique indexes in migration 067
 * have to be named in the ON CONFLICT clause and getting the pair out of step
 * is how an upsert silently becomes an insert that accumulates rows.
 */
type ProgressOwner = { column: "member_id" | "admin_user_id" | "visitor_id"; value: number | string };

function ownerOf(caller: VoiceCaller): ProgressOwner | null {
  if (caller.identity.audience === "admin") {
    return { column: "admin_user_id", value: caller.identity.adminUserId };
  }
  if (caller.identity.audience === "member") {
    return { column: "member_id", value: caller.identity.memberId };
  }
  // A visitor with no cookie cannot be remembered at all. The route mints one
  // before it gets here, so this is the "cookies refused" case: the walkthrough
  // still runs, it just restarts on the next visit.
  return caller.visitorId === null ? null : { column: "visitor_id", value: caller.visitorId };
}

function toProgress(row: {
  surface: string;
  stop_index: number;
  completed: boolean;
  updated_at: Date | string;
}): TourProgress {
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  return {
    surface: row.surface as VoiceSurface,
    index: row.stop_index,
    completed: row.completed,
    updatedAt: updatedAt.getTime(),
  };
}

/** What this person has seen of this surface's walkthrough, or null for "never started". */
export async function readTourProgress(
  surface: VoiceSurface,
  caller: VoiceCaller
): Promise<TourProgress | null> {
  const owner = ownerOf(caller);
  if (owner === null) return null;

  const res = await pool.query(
    `SELECT surface, stop_index, completed, updated_at
       FROM voice_tour_progress
      WHERE surface = $1 AND ${owner.column} = $2`,
    [surface, owner.value]
  );
  const row = res.rows[0];
  return row ? toProgress(row) : null;
}

/**
 * Advances (or finishes) the walkthrough.
 *
 * The upsert names the partial index's predicate as well as its columns,
 * because a partial unique index only arbitrates a conflict when the statement
 * says which one it means.
 *
 * `completed` is latched: once a walkthrough has been finished or declined, a
 * later write cannot un-finish it. A dropped call that resumes mid-tour sends
 * `completed: false` for the stop it is on, and without the latch that would
 * re-open an offer the person had already turned down.
 */
export async function saveTourProgress(
  surface: VoiceSurface,
  caller: VoiceCaller,
  update: { index: number; completed: boolean }
): Promise<TourProgress | null> {
  const owner = ownerOf(caller);
  if (owner === null) return null;

  const index = Math.max(0, Math.trunc(update.index));
  const res = await pool.query(
    `INSERT INTO voice_tour_progress (surface, ${owner.column}, stop_index, completed, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (surface, ${owner.column}) WHERE ${owner.column} IS NOT NULL
     DO UPDATE SET stop_index = EXCLUDED.stop_index,
                   completed = voice_tour_progress.completed OR EXCLUDED.completed,
                   updated_at = now()
     RETURNING surface, stop_index, completed, updated_at`,
    [surface, owner.value, index, update.completed]
  );
  const row = res.rows[0];
  return row ? toProgress(row) : null;
}
