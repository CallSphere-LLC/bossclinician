import type { Pool } from "pg";
import { badRequest } from "../utils/httpError";

type Database = Pick<Pool, "query">;

/** Persist an accepted subscription and its optional conversion atomically.
 * The ledger is unique per subscriber and published opt-in step. It contains
 * no email, name, IP, or payment data. Legacy browser counters are not used.
 */
export async function saveAcceptedSubscription(
  db: Database,
  input: { email: string; source: string; funnelStepId?: number },
): Promise<{ id: number; prior_source: string | null }> {
  const result = await db.query<{ id: number; prior_source: string | null }>(
    `WITH eligible_step AS MATERIALIZED (
       SELECT s.id FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id
        WHERE s.id = $3::int AND s.step_type = 'opt_in' AND f.published = true
          AND $2::text = 'funnel:' || f.slug
        FOR SHARE OF s, f
     ), prior AS MATERIALIZED (
       SELECT source FROM subscribers WHERE email = $1
     ), saved AS (
       INSERT INTO subscribers (email, source)
       SELECT $1, $2 WHERE $3::int IS NULL OR EXISTS (SELECT 1 FROM eligible_step)
       ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source
       RETURNING id
     ), conversion AS (
       INSERT INTO funnel_subscription_conversions (step_id, subscriber_id)
       SELECT e.id, s.id FROM eligible_step e CROSS JOIN saved s
       ON CONFLICT (step_id, subscriber_id) DO NOTHING
     )
     SELECT s.id, (SELECT source FROM prior) AS prior_source FROM saved s`,
    [input.email.trim().toLowerCase(), input.source, input.funnelStepId ?? null],
  );
  if (!result.rows[0]) throw badRequest("This sign-up page is no longer available. Please reload it.");
  return result.rows[0];
}
