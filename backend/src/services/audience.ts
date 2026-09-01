import { pool } from "../db/pool";

/**
 * One definition of "on the email list", for every screen that counts it.
 *
 * Before this module the same question had five different answers. The
 * dashboard, the analytics tile, the audience report, the Subscribers screen
 * and the campaign estimator each carried their own copy, and four of them
 * counted rows in `subscribers` — a table only the public newsletter form and
 * one legacy automation action ever write to. Contacts who arrived any other
 * way (a purchase, an import, an enquiry, the admin's own "add someone") were
 * absent from it, so five real contacts read as zero subscribers and the
 * campaign composer told the owner "0 people will get this".
 *
 * That was not only a display bug. `resolveAudience` narrowed by the same
 * membership test, so `startBroadcast` found nobody and refused the send. A
 * broadcast to the whole list could not go out at all.
 *
 * The predicate is written against a `contacts` row aliased `c`, so it drops
 * into a larger query unchanged.
 */
export const MAILABLE_CONTACT_SQL = `c.email <> ''
  AND c.email_marketing_status IN ('subscribed', 'unconfirmed')
  AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email = c.email)`;

/**
 * The same test as a scalar subquery, for the totals rows that select several
 * counts at once.
 *
 * It carries its own `FROM contacts c`, so the alias is local to the subquery
 * and cannot collide with an enclosing query that also uses `c`.
 */
export const MAILABLE_CONTACT_COUNT_SQL = `(SELECT COUNT(*)::int FROM contacts c WHERE ${MAILABLE_CONTACT_SQL})`;

/**
 * A day-by-day count of people who became mailable, for the 30-day trend
 * charts.
 *
 * Keyed on `opted_in_at` where it is known and `created_at` otherwise: consent
 * is the honest date, but it has only been captured on newer write paths, and
 * falling back to the row's birthday is better than dropping the contact out of
 * the series entirely.
 */
export const MAILABLE_CONTACT_SERIES_SQL = `SELECT COALESCE(c.opted_in_at, c.created_at)::date AS day,
          COUNT(*)::int AS c
     FROM contacts c
    WHERE ${MAILABLE_CONTACT_SQL}
      AND COALESCE(c.opted_in_at, c.created_at) >= CURRENT_DATE - INTERVAL '29 days'
    GROUP BY 1`;

/** How many people are on the email list right now. */
export async function mailableContactCount(): Promise<number> {
  const res = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM contacts c WHERE ${MAILABLE_CONTACT_SQL}`
  );
  return res.rows[0]?.count ?? 0;
}
