import crypto from "crypto";
import { pool } from "../db/pool";
import { renderMarkdown, renderTokens, sendEmail } from "../email/provider";
import { PRIORITY, enqueueMany } from "../jobs/queue";
import { MAILABLE_CONTACT_SQL } from "./audience";
import { listSegmentContactIds } from "./segments";

/**
 * Broadcasts: one email, one audience, sent once.
 *
 * The audience is resolved to contacts and nothing else. The legacy campaign
 * `audience` strings ("all_subscribers", "leads") still work, because campaigns
 * created before Phase 4 carry them, but they are resolved *through* the
 * contact each silo now points at — so somebody who is a lead and a subscriber
 * and a member gets one email rather than three, and the unsubscribe they
 * clicked last month is honoured whichever list they came in on.
 *
 * Fan-out goes through the queue at bulk priority. The previous implementation
 * looped over the recipient list inside a detached promise in the request
 * handler; a deploy halfway through a five thousand recipient send simply lost
 * the rest, with no record of who had been reached.
 */

export interface Recipient {
  contactId: number;
  email: string;
  name: string;
  firstName: string;
}

interface CampaignRow {
  id: number;
  name: string;
  subject: string;
  subject_b: string;
  ab_split_percent: number;
  body_md: string;
  plain_text: string;
  audience: string;
  segment_id: number | null;
  include_tag_ids: number[];
  exclude_segment_ids: number[];
  exclude_tag_ids: number[];
  status: string;
  topic: string;
  from_name: string;
  from_email: string;
  scheduled_at: Date | null;
}

const CAMPAIGN_COLUMNS = `id, name, subject, subject_b, ab_split_percent, body_md, plain_text,
  audience, segment_id, include_tag_ids, exclude_segment_ids, exclude_tag_ids,
  status, topic, from_name, from_email, scheduled_at`;

/* ------------------------------------------------------------- the audience */

/**
 * The legacy audience keys, expressed against contacts.
 *
 * Each is a membership test on the silo, joined back to the one contact row
 * that silo points at. `all_contacts` is the new default for anything created
 * from now on.
 */
const AUDIENCE_PREDICATES: Record<string, string> = {
  all_contacts: "TRUE",
  // "Everyone on my email list" is the MAILABLE test and nothing more.
  //
  // It used to additionally require a row in `subscribers`, a table written
  // only by the public newsletter form and one legacy automation action. A
  // contact who arrived through a purchase, an import, an enquiry or the
  // admin's own "add someone" was therefore not on the email list as far as
  // this predicate was concerned — and since every audience is already
  // narrowed by MAILABLE, the join could only ever remove people who had
  // consented. On this site it removed all of them: `subscribers` is empty,
  // so the send refused with "Nobody in that audience can be emailed right
  // now" and the composer promised "0 people will get this".
  all_subscribers: "TRUE",
  all_members:
    "EXISTS (SELECT 1 FROM members m WHERE m.contact_id = c.id AND m.status = 'active')",
  leads: "EXISTS (SELECT 1 FROM leads l WHERE l.contact_id = c.id)",
  community: `EXISTS (SELECT 1 FROM members m
                        JOIN community_memberships cm ON cm.member_id = m.id
                       WHERE m.contact_id = c.id)`,
  customers: "c.order_count > 0",
};

/**
 * The predicate for an audience key, or null when nobody recognises it.
 *
 * `null` rather than a default, because the default it used to carry was
 * `all_subscribers` — so a campaign whose `audience` column held anything this
 * map does not name went to the whole list rather than failing. The column is
 * written through a permissive CRUD route, which is exactly where an unexpected
 * value comes from. Own-property lookup for the same reason: `audience` set to
 * `"toString"` would otherwise resolve to a function and be interpolated into
 * the WHERE clause.
 */
export function audiencePredicate(audience: string): string | null {
  return Object.prototype.hasOwnProperty.call(AUDIENCE_PREDICATES, audience)
    ? AUDIENCE_PREDICATES[audience]
    : null;
}

/**
 * The mailability filter every audience is narrowed by.
 *
 * Duplicated deliberately with the check inside `sendEmail`: that one is the
 * guarantee, this one is so a broadcast to a list of four thousand does not
 * queue four thousand jobs in order to suppress most of them, and so the
 * recipient count the admin sees is the number of people who will actually get
 * it.
 *
 * It lives in `services/audience.ts` now because the dashboard, the analytics
 * tile, the audience report and the Subscribers screen have to answer the same
 * question and used to answer it four other ways.
 */
const MAILABLE = MAILABLE_CONTACT_SQL;

/**
 * Everybody a campaign would be sent to right now.
 *
 * A segment wins over the legacy audience string when both are set: a campaign
 * that has been pointed at a segment has been edited more recently than the
 * default it was created with.
 */
export interface CampaignAudienceConfig {
  audience: string;
  segment_id: number | null;
  include_tag_ids?: number[];
  exclude_segment_ids?: number[];
  exclude_tag_ids?: number[];
}

export async function resolveAudience(campaign: CampaignAudienceConfig): Promise<Recipient[]> {
  let recipients: Recipient[];
  if (campaign.segment_id !== null) {
    const segment = await pool.query<{ definition: unknown }>(
      `SELECT definition FROM segments WHERE id = $1`,
      [campaign.segment_id]
    );
    const definition = segment.rows[0]?.definition;
    if (definition === undefined) return [];

    // Only the ids come from the segment service; the address, the name and the
    // mailability test are read here, because a segment answers "who matches"
    // and a broadcast additionally has to ask "and may we still email them".
    const ids = await listSegmentContactIds(definition);
    if (ids.length === 0) return [];

    const res = await pool.query<{
      id: number;
      email: string;
      name: string;
      first_name: string;
    }>(
      `SELECT c.id, c.email, c.name, c.first_name
         FROM contacts c
        WHERE c.id = ANY($1::int[]) AND ${MAILABLE}`,
      [ids]
    );
    recipients = res.rows.map(toRecipient);
  } else if ((campaign.include_tag_ids ?? []).length > 0) {
    const res = await pool.query<{ id: number; email: string; name: string; first_name: string }>(
      `SELECT c.id, c.email, c.name, c.first_name
         FROM contacts c
        WHERE ${MAILABLE}
          AND EXISTS (
            SELECT 1 FROM contact_tags ct
             WHERE ct.contact_id = c.id AND ct.tag_id = ANY($1::int[])
          )`,
      [campaign.include_tag_ids],
    );
    recipients = res.rows.map(toRecipient);
  } else {
    const predicate = audiencePredicate(campaign.audience);
    if (predicate === null) return [];
    const res = await pool.query<{ id: number; email: string; name: string; first_name: string }>(
      `SELECT c.id, c.email, c.name, c.first_name
         FROM contacts c
        WHERE ${MAILABLE} AND (${predicate})`,
    );
    recipients = res.rows.map(toRecipient);
  }

  const excluded = new Set<number>();
  const excludedTags = campaign.exclude_tag_ids ?? [];
  if (excludedTags.length > 0) {
    const tagged = await pool.query<{ contact_id: number }>(
      `SELECT DISTINCT contact_id FROM contact_tags WHERE tag_id = ANY($1::int[])`,
      [excludedTags],
    );
    for (const row of tagged.rows) excluded.add(row.contact_id);
  }
  const excludedSegments = campaign.exclude_segment_ids ?? [];
  if (excludedSegments.length > 0) {
    const segments = await pool.query<{ definition: unknown }>(
      `SELECT definition FROM segments WHERE id = ANY($1::int[])`,
      [excludedSegments],
    );
    for (const segment of segments.rows) {
      for (const id of await listSegmentContactIds(segment.definition)) excluded.add(id);
    }
  }

  return recipients.filter((recipient) => !excluded.has(recipient.contactId));
}

function toRecipient(row: {
  id: number;
  email: string;
  name: string;
  first_name: string;
}): Recipient {
  return {
    contactId: row.id,
    email: row.email,
    name: row.name,
    firstName: row.first_name,
  };
}

/** How many people a campaign would reach, without building the list. */
export async function audienceSize(campaign: CampaignAudienceConfig): Promise<number> {
  return (await resolveAudience(campaign)).length;
}

/* -------------------------------------------------------------- the A/B split */

/**
 * Which subject line an address gets.
 *
 * Deterministic on the address rather than random, so a resend, a retry or a
 * report re-run puts the same person in the same arm. A random assignment made
 * at send time cannot be reproduced, and an experiment whose arms move is not
 * an experiment.
 */
export function variantFor(email: string, splitPercent: number): "a" | "b" {
  if (splitPercent <= 0) return "a";
  const digest = crypto.createHash("sha256").update(email.toLowerCase()).digest();
  return digest.readUInt16BE(0) % 100 < splitPercent ? "b" : "a";
}

/* --------------------------------------------------------------- the send */

export interface StartResult {
  recipients: number;
  queued: number;
}

/**
 * A refusal the person sending can act on, as opposed to a fault.
 *
 * The distinction exists because the admin console shows any short 400 verbatim
 * (frontend/src/pages/admin/ui/friendly.ts), which was turning a raw Postgres
 * message — "duplicate key value violates unique constraint …" — into a
 * sentence presented to Yvette as though she had filled a form in wrong. Only
 * the four sentences below are hers to fix; anything else is ours.
 */
export class BroadcastRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BroadcastRefusal";
  }
}

/**
 * Turns a campaign into one queued job per recipient.
 *
 * Recipient rows are written before any job is queued, so a crash between the
 * two leaves a visible, resumable list rather than a campaign that says
 * "sending" with nothing behind it.
 *
 * `sending` is claimed first because it is also the lock: it is what stops a
 * second click, or the scheduled tick arriving on top of a manual send, from
 * fanning the same campaign out twice. Everything after that claim is wrapped,
 * because a failure past that point used to leave the campaign reading "Sending
 * now" forever — `/send` refuses a campaign in that state, and the finish sweep
 * only closes one whose sends have all left, so there was no way back to it from
 * any screen. On a failure it goes to `failed`, which is a state the Send button
 * is offered from again.
 */
export async function startBroadcast(
  campaignId: number,
  options: { expectedStatus?: string } = {},
): Promise<StartResult> {
  const campaignRes = await pool.query<CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM email_campaigns WHERE id = $1`,
    [campaignId]
  );
  const campaign = campaignRes.rows[0];
  if (!campaign) throw new BroadcastRefusal("No such campaign");
  if (campaign.status === "sending") throw new BroadcastRefusal("This email is already going out");
  if (campaign.status === "sent") throw new BroadcastRefusal("This email has already been sent");
  if (!campaign.subject.trim()) {
    throw new BroadcastRefusal("Add a subject line before sending");
  }

  const recipients = await resolveAudience(campaign);
  if (recipients.length === 0) {
    throw new BroadcastRefusal("Nobody in that audience can be emailed right now");
  }

  const claimed = await pool.query(
    `UPDATE email_campaigns
        SET status = 'sending', recipient_count = $2, updated_at = now()
      WHERE id = $1
        AND ($3::text IS NULL OR status = $3)
        AND status NOT IN ('sending', 'sent')`,
    [campaignId, recipients.length, options.expectedStatus ?? null]
  );
  if ((claimed.rowCount ?? 0) === 0) {
    throw new BroadcastRefusal("This email's sending state changed; refresh before trying again");
  }

  try {
    const BATCH = 500;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const slice = recipients.slice(i, i + BATCH);
      const values: unknown[] = [];
      const tuples = slice.map((recipient, index) => {
        const base = index * 4;
        values.push(
          campaignId,
          recipient.email,
          recipient.contactId,
          variantFor(recipient.email, campaign.ab_split_percent)
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      });

      await pool.query(
        `INSERT INTO email_sends (campaign_id, email, contact_id, variant)
         VALUES ${tuples.join(", ")}
         ON CONFLICT (campaign_id, email) DO NOTHING`,
        values
      );
    }

    // Read back rather than collect the ids the INSERTs returned. A campaign
    // that failed part-way through and is being sent again already has rows
    // from the first attempt, and `ON CONFLICT DO NOTHING` returns nothing for
    // those — so the people it reached on paper but never queued a job for
    // would be skipped for good. Anyone already sent to is no longer `queued`,
    // and the per-send dedupe key collapses a job that is still pending.
    const pending = await pool.query<{ id: number }>(
      `SELECT id FROM email_sends WHERE campaign_id = $1 AND status = 'queued' ORDER BY id`,
      [campaignId]
    );
    const sendIds = pending.rows.map((row) => row.id);

    const queued = await enqueueMany(
      sendIds.map((sendId) => ({
        kind: "broadcast.sendOne",
        payload: { campaignId, sendId },
        priority: PRIORITY.bulk,
        dedupeKey: `broadcast-send:${sendId}`,
      }))
    );

    return { recipients: recipients.length, queued };
  } catch (err) {
    // Back to a state she can press Send from. The recipient rows that did land
    // keep their `broadcast-send:<id>` dedupe keys, so a retry re-queues the
    // ones that were missed and cannot double-send the ones that were not.
    await pool
      .query(`UPDATE email_campaigns SET status = 'failed', updated_at = now() WHERE id = $1`, [
        campaignId,
      ])
      .catch(() => undefined);
    throw err;
  }
}

export type BroadcastSendOutcome = "sent" | "suppressed" | "skipped";

/** Sends one recipient's copy and records the outcome against both tables. */
export async function sendBroadcastOne(input: {
  campaignId: number;
  sendId: number;
}): Promise<{ outcome: BroadcastSendOutcome }> {
  const sendRes = await pool.query<{
    id: number;
    email: string;
    contact_id: number | null;
    variant: string;
    status: string;
  }>(
    `SELECT id, email, contact_id, variant, status
       FROM email_sends WHERE id = $1 AND campaign_id = $2`,
    [input.sendId, input.campaignId]
  );
  const send = sendRes.rows[0];
  if (!send || send.status !== "queued") return { outcome: "skipped" };

  const campaignRes = await pool.query<CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM email_campaigns WHERE id = $1`,
    [input.campaignId]
  );
  const campaign = campaignRes.rows[0];
  if (!campaign) return { outcome: "skipped" };

  const contactRes = await pool.query<{ name: string; first_name: string }>(
    `SELECT name, first_name FROM contacts WHERE id = $1`,
    [send.contact_id]
  );
  const contact = contactRes.rows[0];

  const values = {
    firstName: contact?.first_name || contact?.name?.split(" ")[0] || "there",
    name: contact?.name || send.email,
    email: send.email,
  };

  // A/B is on the subject line only, and falls back to the A subject when the
  // B one was left blank — an experiment with an empty arm is a campaign that
  // sends half its audience an email with no subject.
  const subject =
    send.variant === "b" && campaign.subject_b.trim() ? campaign.subject_b : campaign.subject;

  const body = renderTokens(campaign.body_md, values);

  try {
    const result = await sendEmail({
      to: send.email,
      subject: renderTokens(subject, values),
      text: campaign.plain_text ? renderTokens(campaign.plain_text, values) : body,
      html: renderMarkdown(body),
      contactId: send.contact_id,
      sourceType: "broadcast",
      sourceId: campaign.id,
      topic: campaign.topic,
      fromName: campaign.from_name,
      fromEmail: campaign.from_email,
    });

    if (result.outcome === "suppressed") {
      await pool.query(
        `UPDATE email_sends SET status = 'failed', error = $2, message_id = $3 WHERE id = $1`,
        [send.id, result.suppressedReason.slice(0, 300), result.messageId]
      );
      return { outcome: "suppressed" };
    }

    await pool.query(
      `UPDATE email_sends SET status = 'sent', sent_at = now(), message_id = $2, error = ''
        WHERE id = $1`,
      [send.id, result.messageId]
    );
    await pool.query(
      `UPDATE email_campaigns SET delivered_count = delivered_count + 1, updated_at = now()
        WHERE id = $1`,
      [campaign.id]
    );
    return { outcome: "sent" };
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await pool.query(`UPDATE email_sends SET status = 'failed', error = $2 WHERE id = $1`, [
      send.id,
      detail,
    ]);
    await pool.query(
      `UPDATE email_campaigns SET failed_count = failed_count + 1, updated_at = now() WHERE id = $1`,
      [campaign.id]
    );
    throw err;
  }
}

/* --------------------------------------------------------------- the tick */

/**
 * Starts scheduled campaigns, and closes off ones that have finished going out.
 *
 * The close-off half matters as much as the start: without it a campaign sits
 * on "sending" forever, and "did that email actually go?" is the first thing
 * anybody asks the morning after a launch.
 */
export async function tickBroadcasts(now: Date = new Date()): Promise<{
  started: number;
  finished: number;
}> {
  /*
   * Event-anchored campaigns are resolved HERE rather than at save time, which
   * is the whole point of them: "24 hours before the CEU" has to follow the
   * event if the event moves. Computing an absolute `scheduled_at` when the
   * campaign was written would silently send at the old time after a
   * reschedule, which is precisely the bug the brief describes event reminders
   * having.
   *
   * `anchor_offset_minutes` is signed — negative is before, positive is after —
   * so one column expresses both directions and the arithmetic is the same.
   */
  const due = await pool.query<{ id: number }>(
    `SELECT c.id
       FROM email_campaigns c
       LEFT JOIN events e ON e.id = c.anchor_event_id
      WHERE c.status = 'scheduled'
        AND (
          (c.anchor_kind = 'absolute'
             AND c.scheduled_at IS NOT NULL
             AND c.scheduled_at <= $1)
          OR
          (c.anchor_kind = 'event_start'
             AND e.starts_at IS NOT NULL
             AND e.published
             AND e.starts_at + make_interval(mins => c.anchor_offset_minutes) <= $1
             -- Not after the event has been and gone by more than a day: a
             -- campaign anchored to an event that happened last month must not
             -- fire the moment somebody re-publishes it.
             AND e.starts_at + make_interval(mins => c.anchor_offset_minutes) > $1::timestamptz - interval '1 day')
        )
      ORDER BY COALESCE(c.scheduled_at, e.starts_at)
      LIMIT 20`,
    [now]
  );

  let started = 0;
  for (const row of due.rows) {
    try {
      await startBroadcast(row.id, { expectedStatus: "scheduled" });
      started += 1;
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      // A scheduled campaign that cannot go out is marked failed rather than
      // retried forever: the reasons are all things a person has to fix.
      await pool.query(
        `UPDATE email_campaigns SET status = 'failed', updated_at = now()
          WHERE id = $1 AND status = 'scheduled'`,
        [row.id]
      );
      // eslint-disable-next-line no-console
      console.error(`[broadcasts] campaign ${row.id} could not start: ${detail}`);
    }
  }

  const finished = await pool.query(
    `UPDATE email_campaigns c
        SET status = 'sent', sent_at = COALESCE(c.sent_at, now()), updated_at = now()
      WHERE c.status = 'sending'
        AND NOT EXISTS (
          SELECT 1 FROM email_sends s WHERE s.campaign_id = c.id AND s.status = 'queued'
        )`
  );

  return { started, finished: finished.rowCount ?? 0 };
}

/* ------------------------------------------- upon registration, per person */

/**
 * Sends an "upon registration" campaign to people as they register.
 *
 * Different in kind from every other campaign here, and worth saying why. A
 * broadcast goes out once, to a list, at one moment. "Upon registration for the
 * masterclass, plus two hours" is per person on their own clock — two people
 * who register a week apart get it a week apart — so it cannot be a single
 * send, and it never reaches a terminal "sent" state: it keeps going for as
 * long as people keep registering.
 *
 * Deduplication is on `email_messages`, which already records one row per
 * transactional or broadcast send with its source. That is why there is no
 * extra table: the send log IS the record of who has had it, and it survives
 * the campaign being edited.
 */
export async function tickRegistrationCampaigns(
  now: Date = new Date()
): Promise<{ sent: number }> {
  /*
   * Stamp the activation moment before doing anything else, and only ever
   * consider registrations from that moment on.
   *
   * Without this, switching on "two hours after they register" for an event
   * that already has five hundred registrants sends to all five hundred at
   * once, because every one of them registered more than two hours ago. That
   * is a mailing nobody asked for, going out under Yvette's name, and it
   * cannot be recalled. `sent_at` is the stamp — unused by this anchor kind
   * otherwise, since a per-person campaign never reaches a terminal "sent".
   *
   * The stamp happens in its own statement first, so the very tick that
   * activates a campaign sends to nobody. A first tick that both stamped and
   * sent would still catch the backlog it is meant to exclude.
   */
  await pool.query(
    `UPDATE email_campaigns
        SET sent_at = now(), updated_at = now()
      WHERE status = 'sending'
        AND anchor_kind = 'event_registration'
        AND anchor_event_id IS NOT NULL
        AND sent_at IS NULL`
  );

  const campaigns = await pool.query<{
    id: number;
    anchor_event_id: number;
    anchor_offset_minutes: number;
    sent_at: Date;
  }>(
    `SELECT id, anchor_event_id, anchor_offset_minutes, sent_at
       FROM email_campaigns
      WHERE status = 'sending'
        AND anchor_kind = 'event_registration'
        AND anchor_event_id IS NOT NULL
        AND sent_at IS NOT NULL
      LIMIT 10`
  );

  let sent = 0;
  for (const campaign of campaigns.rows) {
    /*
     * Claim first, send second.
     *
     * `email_sends` is UNIQUE on (campaign_id, email), so the insert IS the
     * deduplication: a registrant who already has a row is skipped by the
     * conflict, and RETURNING hands back only the rows this tick created. Two
     * overlapping ticks therefore cannot both send to the same person, which a
     * read-then-send would allow.
     *
     * A negative offset is meaningless here — you cannot send before somebody
     * registers — so GREATEST clamps it to zero.
     */
    const claimed = await pool.query<{ id: number }>(
      `INSERT INTO email_sends (campaign_id, email, contact_id, variant)
       SELECT $4, r.email, MIN(r.contact_id), 'a'
         FROM event_registrations r
        WHERE r.event_id = $1
          AND r.email <> ''
          -- Registered since this campaign was switched on. Everybody who was
          -- already on the list before that is deliberately left alone.
          AND r.created_at >= $5
          AND r.created_at + make_interval(mins => GREATEST(0, $2)) <= $3
        GROUP BY r.email
        LIMIT 200
       ON CONFLICT (campaign_id, email) DO NOTHING
       RETURNING id`,
      [
        campaign.anchor_event_id,
        campaign.anchor_offset_minutes,
        now,
        campaign.id,
        campaign.sent_at,
      ]
    );

    for (const row of claimed.rows) {
      try {
        await sendBroadcastOne({ campaignId: campaign.id, sendId: row.id });
        sent += 1;
      } catch (err) {
        // One bad address must not stop the rest; the send row records the
        // failure against that recipient either way.
        // eslint-disable-next-line no-console
        console.error(
          `[broadcasts] registration campaign ${campaign.id} could not send to a registrant:`,
          (err as Error).message
        );
      }
    }
  }

  return { sent };
}

/* ------------------------------------------------------------ A/B decision */

/**
 * Picks the winning subject line and records it.
 *
 * Only once, and only with enough to go on. An A/B call made on four opens is
 * noise dressed up as a decision, so a campaign below the floor is left
 * undecided rather than given a winner that means nothing — and the screen says
 * "too early to call" instead of showing a coin toss as a result.
 *
 * Ties go to A. It is the subject the sender wrote first, and a tie means the
 * test found no difference worth acting on.
 */
export const AB_MINIMUM_PER_VARIANT = 20;

export async function decideAbWinner(
  campaignId: number
): Promise<{ winner: "a" | "b" | null; reason: string }> {
  const found = await pool.query<{
    subject_b: string | null;
    ab_split_percent: number;
    ab_winner: string | null;
    sent_a: number;
    opened_a: number;
    sent_b: number;
    opened_b: number;
  }>(
    `SELECT c.subject_b, c.ab_split_percent, c.ab_winner,
            COUNT(*) FILTER (WHERE s.variant = 'a')::int AS sent_a,
            COUNT(*) FILTER (WHERE s.variant = 'a' AND s.opened_at IS NOT NULL)::int AS opened_a,
            COUNT(*) FILTER (WHERE s.variant = 'b')::int AS sent_b,
            COUNT(*) FILTER (WHERE s.variant = 'b' AND s.opened_at IS NOT NULL)::int AS opened_b
       FROM email_campaigns c
       LEFT JOIN email_sends s ON s.campaign_id = c.id
      WHERE c.id = $1
      GROUP BY c.id, c.subject_b, c.ab_split_percent, c.ab_winner`,
    [campaignId]
  );
  const row = found.rows[0];
  if (!row) return { winner: null, reason: "That campaign no longer exists." };
  if (!row.subject_b) return { winner: null, reason: "This campaign only has one subject line." };
  if (row.ab_winner === "a" || row.ab_winner === "b") {
    return { winner: row.ab_winner, reason: "Already decided." };
  }
  if (row.sent_a < AB_MINIMUM_PER_VARIANT || row.sent_b < AB_MINIMUM_PER_VARIANT) {
    return {
      winner: null,
      reason: `Too early to call — each subject needs at least ${AB_MINIMUM_PER_VARIANT} sends.`,
    };
  }

  const rateA = row.opened_a / row.sent_a;
  const rateB = row.opened_b / row.sent_b;
  const winner: "a" | "b" = rateB > rateA ? "b" : "a";

  await pool.query(
    `UPDATE email_campaigns SET ab_winner = $2, ab_decided_at = now(), updated_at = now()
      WHERE id = $1 AND ab_winner IS NULL`,
    [campaignId, winner]
  );

  return {
    winner,
    reason:
      `Subject ${winner.toUpperCase()} won: ` +
      `${Math.round(rateA * 100)}% against ${Math.round(rateB * 100)}%.`,
  };
}

/**
 * Decides A/B winners for campaigns that have been out long enough.
 *
 * Four hours, because opens arrive over a working day and a decision made
 * twenty minutes after a send measures who happened to be at their desk. Only
 * campaigns with a second subject and no verdict yet are considered, so this is
 * a no-op on almost every tick.
 */
export async function sweepAbDecisions(): Promise<{ decided: number }> {
  const waiting = await pool.query<{ id: number }>(
    `SELECT id FROM email_campaigns
      WHERE subject_b IS NOT NULL AND subject_b <> ''
        AND ab_winner IS NULL
        AND sent_at IS NOT NULL
        AND sent_at < now() - interval '4 hours'
      LIMIT 20`
  );

  let decided = 0;
  for (const row of waiting.rows) {
    const result = await decideAbWinner(row.id);
    if (result.winner !== null) decided += 1;
  }
  return { decided };
}
