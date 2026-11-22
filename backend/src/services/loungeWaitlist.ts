import { pool } from "../db/pool";
import { TIER_RULES, readSeatCounts } from "./loungeSeats";

/**
 * Lounge VIP waitlist notice (Yvette, 22 Nov 2026, item 3; migration 222):
 * "Notify the waitlist, but joining it does not reserve a seat." First come,
 * first served: everybody on the waitlist is told at once, nobody is held a
 * place, and the checkout stays open to anyone until the seat is taken.
 *
 * The job `loungeVip.waitlistNotify` (job_schedules 'lounge-vip-waitlist-notify',
 * every 10 minutes) watches the VIP seats:
 *
 *  - An OPENING starts when, after the six founding places have been used, fewer
 *    than six paid VIP members currently hold active VIP access. Checkout holds
 *    are deliberately ignored here, so a 30-minute hold that lapses does not
 *    look like a new opening and re-notify everybody.
 *  - It ends when all six seats are held again.
 *  - Once per opening, everybody tagged 'lounge-vip-waitlist' who is not a
 *    current VIP member is enrolled in the one-email sequence
 *    'lounge-vip-seat-open'. Its email carries {{lounge_vip_availability_block}},
 *    so it states availability as it is at the moment it is sent.
 *
 * SHIPS OFF: the sequence is 'draft', and enrollContact refuses a sequence that
 * is not 'active', so an opening is only recorded. The one toggle:
 *   UPDATE email_sequences SET status = 'active', updated_at = now() WHERE slug = 'lounge-vip-seat-open';
 * Switched on while a seat is still open, the next run notifies for that opening.
 */

type Queryable = { query: typeof pool.query };

export const WAITLIST_TAG_SLUG = "lounge-vip-waitlist";
export const SEAT_OPEN_SEQUENCE_SLUG = "lounge-vip-seat-open";
const LOCK = "lounge-vip-waitlist-notify";

/** Pure: is a VIP seat open for the waitlist right now? */
export function vipSeatOpen(counts: { foundingClaimed: number; activeSeats: number }): boolean {
  const rule = TIER_RULES.vip;
  if (rule.capacity === null) return false;
  // While founding places remain there is no waitlist to tell.
  if (counts.foundingClaimed < rule.foundingLimit) return false;
  return counts.activeSeats < rule.capacity;
}

export interface WaitlistTickResult {
  open: boolean;
  openingId: number | null;
  notified: number;
  reason: string;
}

export async function runLoungeVipWaitlistTick(
  enroll: (sequenceId: number, contactId: number) => Promise<{ outcome: string }> = defaultEnroll
): Promise<WaitlistTickResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One run at a time; a second worker simply finds nothing to do.
    const locked = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok`, [LOCK]);
    if (!locked.rows[0]?.ok) {
      await client.query("ROLLBACK");
      return { open: false, openingId: null, notified: 0, reason: "another run in progress" };
    }

    const counts = await readSeatCounts(client, "vip");
    const open = vipSeatOpen(counts);
    const current = await client.query<{ id: number; notified_at: Date | null }>(
      `SELECT id, notified_at FROM lounge_vip_openings WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`
    );
    let opening = current.rows[0] ?? null;

    if (!open) {
      if (opening) {
        await client.query(`UPDATE lounge_vip_openings SET closed_at = now() WHERE id = $1`, [opening.id]);
      }
      await client.query("COMMIT");
      return { open: false, openingId: null, notified: 0, reason: opening ? "seats full again" : "no seat open" };
    }

    if (!opening) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO lounge_vip_openings (active_seats) VALUES ($1) RETURNING id`,
        [counts.activeSeats]
      );
      opening = { id: inserted.rows[0].id, notified_at: null };
    }
    if (opening.notified_at) {
      await client.query("COMMIT");
      return { open: true, openingId: opening.id, notified: 0, reason: "already notified for this opening" };
    }

    const sequence = await client.query<{ id: number; status: string }>(
      `SELECT id, status FROM email_sequences WHERE slug = $1`,
      [SEAT_OPEN_SEQUENCE_SLUG]
    );
    const seq = sequence.rows[0];
    if (!seq || seq.status !== "active") {
      await client.query("COMMIT");
      return { open: true, openingId: opening.id, notified: 0, reason: "notice switched off" };
    }

    const waitlisted = await waitlistedContactIds(client);
    // Recorded first: if enrolment fails part-way, nobody is told twice.
    await client.query(
      `UPDATE lounge_vip_openings SET notified_at = now(), waitlisted = $2 WHERE id = $1`,
      [opening.id, waitlisted.length]
    );
    await client.query("COMMIT");

    let notified = 0;
    for (const contactId of waitlisted) {
      try {
        const result = await enroll(seq.id, contactId);
        if (result.outcome === "enrolled" || result.outcome === "reentered") notified += 1;
      } catch (error) {
        console.error("[lounge-waitlist] could not enrol", { contactId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await pool.query(`UPDATE lounge_vip_openings SET enrolled = $2 WHERE id = $1`, [opening.id, notified]);
    return { open: true, openingId: opening.id, notified, reason: "" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Waitlisted contacts who are not current VIP members. */
export async function waitlistedContactIds(db: Queryable): Promise<number[]> {
  const rows = await db.query<{ id: number }>(
    `SELECT DISTINCT c.id
       FROM contact_tags ct
       JOIN tags t ON t.id = ct.tag_id AND t.slug = $1
       JOIN contacts c ON c.id = ct.contact_id
      WHERE NOT EXISTS (
              SELECT 1 FROM access_grants g
                JOIN members m ON m.id = g.member_id
                JOIN offers o ON o.id = g.offer_id
               WHERE o.slug = ANY($2::text[])
                 AND (m.contact_id = c.id OR lower(m.email::text) = lower(c.email::text))
                 AND g.status = 'active' AND g.revoked_at IS NULL
                 AND (g.expires_at IS NULL OR g.expires_at > now()))
      ORDER BY c.id`,
    [WAITLIST_TAG_SLUG, [...TIER_RULES.vip.offerSlugs]]
  );
  return rows.rows.map((r) => Number(r.id));
}

async function defaultEnroll(sequenceId: number, contactId: number): Promise<{ outcome: string }> {
  const { enrollContact } = await import("./sequences");
  return enrollContact(sequenceId, contactId, { reason: "Lounge VIP seat opened (waitlist notice)" });
}
