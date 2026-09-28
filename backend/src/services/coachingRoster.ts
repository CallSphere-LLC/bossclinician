import { pool } from "../db/pool";

/**
 * The coaching roster: everyone she coaches, one row per person, with each
 * program they're in — Kajabi's "Clients" list on a coaching product.
 *
 * There is no roster table, so "client" is assembled from the two records that
 * tie a person to her coaching:
 *
 *   1. An access grant on a coaching product (`products.kind = 'coaching'`).
 *      That is what a purchase or a "grant offer" hands out, via
 *      grantOfferAccess, and it is the only record of somebody who has BOUGHT a
 *      package and not booked anything yet — the person the old session-only
 *      list could never show. Revoked grants (a refund, access taken away) are
 *      left out; expired ones stay, marked as ended, because they were a client.
 *   2. A booked session, whoever booked it. Admin-booked sessions carry no
 *      grant and no credit at all, so a session is enough on its own.
 *
 * `coaching_credits` is deliberately NOT a source of membership. It is written
 * lazily, the first time a member opens their coaching page, so a buyer who
 * hasn't looked yet has a grant and no credit. It is read only for how many
 * sessions a package holds, because one row per paid order is what knows that
 * somebody bought the package twice.
 *
 * A person is keyed on their contact when one can be found and on the member
 * otherwise. The member's own contact wins over the one written on a session,
 * so a grant (which only knows the member) and a session (which may know both)
 * land on the same row even if the two ever disagree.
 *
 * "Used" counts sessions that weren't cancelled, no-shows included — the hour
 * was held and the package paid for it. It is counted from the sessions rather
 * than read from `coaching_credits.sessions_used`, which only the member's own
 * booking flow moves; a session she books for them from the admin never
 * touches it.
 */
export const COACHING_ROSTER_SQL = `
WITH entries AS (
  SELECT COALESCE(m.contact_id, s.contact_id) AS contact_id,
         s.member_id,
         s.offer_id,
         NULL::timestamptz AS granted_at,
         NULL::boolean     AS grant_live,
         s.status,
         s.scheduled_at,
         COALESCE(s.booked_at, s.created_at) AS booked_at
    FROM coaching_sessions s
    LEFT JOIN members m ON m.id = s.member_id
   WHERE s.member_id IS NOT NULL OR s.contact_id IS NOT NULL
  UNION ALL
  SELECT m.contact_id,
         g.member_id,
         p.coaching_offer_id,
         g.granted_at,
         g.status = 'active' AND (g.expires_at IS NULL OR g.expires_at > now()),
         NULL, NULL, NULL
    FROM access_grants g
    JOIN products p ON p.id = g.product_id AND p.kind = 'coaching'
    JOIN members m  ON m.id = g.member_id
   WHERE g.status <> 'revoked'
     AND m.status <> 'deleted'
),
keyed AS (
  SELECT CASE WHEN contact_id IS NOT NULL THEN 'c' || contact_id ELSE 'm' || member_id END AS person_key,
         *
    FROM entries
),
per_program AS (
  SELECT person_key,
         offer_id,
         COUNT(granted_at)                                            AS grants,
         MIN(granted_at)                                              AS granted_at,
         bool_or(grant_live)                                          AS grant_live,
         COUNT(*) FILTER (WHERE status IS NOT NULL AND status <> 'cancelled') AS sessions_used,
         MIN(scheduled_at) FILTER (WHERE status = 'scheduled' AND scheduled_at > now()) AS next_session_at,
         MAX(scheduled_at) FILTER (WHERE status IN ('scheduled', 'completed') AND scheduled_at <= now()) AS last_session_at,
         MIN(booked_at)                                               AS first_booked_at
    FROM keyed
   GROUP BY person_key, offer_id
),
credit_totals AS (
  SELECT CASE WHEN m.contact_id IS NOT NULL THEN 'c' || m.contact_id ELSE 'm' || c.member_id END AS person_key,
         c.coaching_offer_id AS offer_id,
         SUM(c.sessions_total)::int AS sessions_total
    FROM coaching_credits c
    JOIN members m ON m.id = c.member_id
   WHERE c.coaching_offer_id IS NOT NULL
   GROUP BY 1, 2
),
people AS (
  SELECT person_key,
         MAX(contact_id) AS contact_id,
         MAX(member_id)  AS member_id
    FROM keyed
   GROUP BY person_key
)
SELECT pe.person_key AS key,
       pe.contact_id,
       pe.member_id,
       COALESCE(NULLIF(m.name, ''), NULLIF(c.name, ''),
                NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), '') AS name,
       COALESCE(c.email::text, m.email::text, '') AS email,
       MIN(COALESCE(pp.granted_at, pp.first_booked_at)) AS joined_at,
       json_agg(
         json_build_object(
           'offerId',          pp.offer_id,
           'title',            o.title,
           'access',           CASE WHEN pp.grant_live THEN 'active'
                                    WHEN pp.grants > 0 THEN 'ended'
                                    ELSE 'sessions' END,
           'joinedAt',         COALESCE(pp.granted_at, pp.first_booked_at),
           'sessionsUsed',     pp.sessions_used,
           'sessionsIncluded', CASE WHEN o.id IS NULL THEN NULL
                                    WHEN ct.sessions_total IS NOT NULL THEN ct.sessions_total
                                    WHEN pp.grants > 0 THEN GREATEST(o.session_count, 0)
                                    END,
           'openEnded',        o.id IS NOT NULL AND o.session_count <= 0
                               AND (pp.grants > 0 OR ct.sessions_total IS NOT NULL),
           'nextSessionAt',    pp.next_session_at,
           'lastSessionAt',    pp.last_session_at
         )
         ORDER BY COALESCE(pp.granted_at, pp.first_booked_at), pp.offer_id
       ) AS programs
  FROM people pe
  JOIN per_program pp       ON pp.person_key = pe.person_key
  LEFT JOIN coaching_offers o ON o.id = pp.offer_id
  LEFT JOIN credit_totals ct  ON ct.person_key = pp.person_key AND ct.offer_id = pp.offer_id
  LEFT JOIN contacts c        ON c.id = pe.contact_id
  LEFT JOIN members m         ON m.id = pe.member_id
 GROUP BY pe.person_key, pe.contact_id, pe.member_id, m.name, m.email, c.name, c.first_name, c.last_name, c.email
 ORDER BY joined_at DESC NULLS LAST, name
`;

/** One program a client is in, as the roster reports it. */
export interface CoachingRosterProgram {
  /** Null for sessions booked without a program. */
  offerId: number | null;
  title: string | null;
  /**
   * `active` — a live grant (bought or given); `ended` — the grant expired;
   * `sessions` — no package at all, only sessions she booked for them.
   */
  access: "active" | "ended" | "sessions";
  joinedAt: string | null;
  sessionsUsed: number;
  /** How many sessions the package holds; null when there's no package behind it. */
  sessionsIncluded: number | null;
  /** The package has no session limit (session count 0). */
  openEnded: boolean;
  nextSessionAt: string | null;
  lastSessionAt: string | null;
}

export interface CoachingRosterClient {
  key: string;
  contactId: number | null;
  memberId: number | null;
  name: string;
  email: string;
  joinedAt: string | null;
  programs: CoachingRosterProgram[];
}

export async function listCoachingRoster(): Promise<CoachingRosterClient[]> {
  const result = await pool.query<{
    key: string;
    contact_id: number | null;
    member_id: number | null;
    name: string;
    email: string;
    joined_at: Date | null;
    programs: CoachingRosterProgram[];
  }>(COACHING_ROSTER_SQL);
  return result.rows.map((row) => ({
    key: row.key,
    contactId: row.contact_id,
    memberId: row.member_id,
    name: row.name,
    email: row.email,
    joinedAt: row.joined_at ? row.joined_at.toISOString() : null,
    programs: row.programs,
  }));
}
