import { pool } from "../db/pool";
import { env } from "../config/env";
import { buildMergeValues } from "../email/mergeValues";
import { mergeLinks, preheaderHtml, renderMarkdown, renderTokens } from "../email/provider";
import { enrollContact } from "./sequences";
import { ALUMNI_SEQUENCE_SLUG } from "./retreatAlumniEmails";
import {
  anchoredSendAt,
  missingRetreatTokens,
  parseDateText,
  parseRetreatSkipRules,
  retreatMergeValues,
} from "./retreatAnchor";

/**
 * Post-retreat alumni sequence (sheet row 249, migration 220): who is enrolled,
 * when, and the owner's preview.
 *
 * Enrolment is a sweep, not a purchase trigger, because the emails are about
 * the retreat having happened: from a retreat's end date until its Day +21
 * email (plus the 3-day grace), every guest holding active, unrefunded access
 * to the retreat's product is put into the one reusable alumni sequence, timed
 * from THAT retreat. Each (retreat, guest) is enrolled at most once, ever.
 *
 * Off until switched on: enrollContact refuses a draft sequence, and the job
 * row that runs this sweep ships disabled.
 */

/** Enrol from the end date until this many days after it (Day +21 and its grace). */
export const ENROL_WINDOW_DAYS = 24;

export interface AlumniGuest {
  contactId: number;
  email: string;
  firstName: string;
  marketingStatus: string;
  offerId: number | null;
  orderId: number | null;
}

/**
 * Guests of a retreat: an active, unexpired grant to the product the retreat's
 * room offers sell (retreats.booking_product_id; Bali: product 70 — falling
 * back to the dashboard product when a retreat has no separate booking product),
 * whose order (when there is one) is not refunded. Members are matched to their
 * contact by link or by address, as the rest of the engine does. One row per
 * contact; the most recent grant supplies the purchase stamp, so a refund of
 * that purchase ends the run (migration 197 logic).
 */
export async function retreatGuests(retreatId: number): Promise<AlumniGuest[]> {
  const res = await pool.query<{
    contact_id: number;
    email: string;
    first_name: string;
    email_marketing_status: string;
    offer_id: number | null;
    order_id: number | null;
  }>(
    `SELECT DISTINCT ON (ct.id)
            ct.id AS contact_id, ct.email::text AS email, ct.first_name,
            ct.email_marketing_status, g.offer_id, o.id AS order_id
       FROM retreats r
       JOIN access_grants g ON g.product_id = COALESCE(r.booking_product_id, r.product_id)
       JOIN members m ON m.id = g.member_id
       JOIN LATERAL (
         SELECT c.id, c.email, c.first_name, c.email_marketing_status
           FROM contacts c
          WHERE c.id = m.contact_id OR lower(c.email::text) = lower(m.email::text)
          ORDER BY (c.id = m.contact_id) DESC, c.id
          LIMIT 1
       ) ct ON true
       LEFT JOIN orders o ON o.id = g.order_id
      WHERE r.id = $1
        AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND NOT COALESCE(
              o.status = 'refunded'
              OR (o.refunded_cents > 0 AND o.refunded_cents >= GREATEST(o.total_cents, o.amount_cents)),
              false)
      ORDER BY ct.id, g.granted_at DESC NULLS LAST, g.id DESC`,
    [retreatId]
  );
  return res.rows.map((r) => ({
    contactId: r.contact_id,
    email: r.email,
    firstName: r.first_name ?? "",
    marketingStatus: r.email_marketing_status ?? "",
    offerId: r.offer_id,
    orderId: r.order_id,
  }));
}

async function alumniSequence(): Promise<{ id: number; status: string; send_at_minute: number | null } | null> {
  const res = await pool.query<{ id: number; status: string; send_at_minute: number | null }>(
    `SELECT id, status, send_at_minute FROM email_sequences WHERE slug = $1`,
    [ALUMNI_SEQUENCE_SLUG]
  );
  return res.rows[0] ?? null;
}

export interface EnrolSweepResult {
  enrolled: number;
  retreats: number;
  detail: string;
}

/** The hourly job `retreatAlumni.enrol`. Does nothing while the sequence is not active. */
export async function enrolRetreatAlumni(now: Date = new Date()): Promise<EnrolSweepResult> {
  const sequence = await alumniSequence();
  if (!sequence || sequence.status !== "active") {
    return { enrolled: 0, retreats: 0, detail: "alumni sequence is not active" };
  }

  // Ended (in the retreat's own zone) and still inside the Day +21 window;
  // product set; not switched off for this retreat.
  const retreats = await pool.query<{ id: number; slug: string }>(
    `SELECT r.id, r.slug
       FROM retreats r
       LEFT JOIN retreat_alumni_settings st ON st.retreat_id = r.id
      WHERE r.end_date IS NOT NULL
        AND COALESCE(r.booking_product_id, r.product_id) IS NOT NULL
        AND COALESCE(st.enabled, true)
        AND r.end_date <= ($1::timestamptz AT TIME ZONE COALESCE(NULLIF(r.timezone, ''), 'America/Los_Angeles'))::date
        AND r.end_date + $2::int >= ($1::timestamptz AT TIME ZONE COALESCE(NULLIF(r.timezone, ''), 'America/Los_Angeles'))::date
      ORDER BY r.end_date, r.id`,
    [now, ENROL_WINDOW_DAYS]
  );

  let enrolled = 0;
  for (const retreat of retreats.rows) {
    const guests = await retreatGuests(retreat.id);
    for (const guest of guests) {
      const seen = await pool.query(
        `SELECT 1 FROM retreat_alumni_enrolments WHERE retreat_id = $1 AND contact_id = $2`,
        [retreat.id, guest.contactId]
      );
      if ((seen.rowCount ?? 0) > 0) continue;

      let result: Awaited<ReturnType<typeof enrollContact>>;
      try {
        result = await enrollContact(sequence.id, guest.contactId, {
          reason: `attended retreat ${retreat.slug}`,
          now,
          anchorRetreatId: retreat.id,
          source: { offerId: guest.offerId, orderId: guest.orderId },
        });
      } catch (err) {
        // One bad row must not cost the other guests their enrolment.
        // eslint-disable-next-line no-console
        console.error(`[retreat-alumni] contact ${guest.contactId} not enrolled:`, err);
        continue;
      }
      // "already_enrolled" means a run for another retreat is still going; the
      // next sweep tries again. Only a real enrolment is recorded.
      if (result.outcome !== "enrolled") continue;
      await pool.query(
        `INSERT INTO retreat_alumni_enrolments
           (retreat_id, contact_id, sequence_id, subscription_id, source_offer_id, source_order_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (retreat_id, contact_id) DO NOTHING`,
        [
          retreat.id,
          guest.contactId,
          sequence.id,
          result.subscriptionId,
          guest.offerId,
          guest.orderId,
        ]
      );
      enrolled += 1;
    }
  }
  return { enrolled, retreats: retreats.rows.length, detail: "" };
}

/* ------------------------------------------------------------------ preview */

export interface AlumniPreview {
  retreat: { id: number; slug: string; title: string; endDate: string; timezone: string; productId: number | null };
  sequence: { id: number; status: string } | null;
  enrolJobEnabled: boolean;
  settings: { enabled: boolean; nextUrl: string; featuredRetreatId: number | null };
  emails: Array<{
    position: number;
    offsetDays: number | null;
    sendAt: string;
    sendAtLocal: string;
    subject: string;
    previewText: string;
    topic: string;
    skipWhen: string[];
    blockedUntilSet: string[];
    html: string;
  }>;
  guests: Array<AlumniGuest & { enrolled: boolean }>;
  gaps: string[];
}

function localLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

const SKIP_LABELS: Record<string, string> = {
  feedbackSubmitted: "guest already shared feedback",
  interestSet: "guest already shared interest",
  marketingOptedOut: "guest declined future invitations",
  bookedFeatured: "guest already booked the featured retreat",
};

/** Everything the owner needs to approve: dates, rendered emails, who would get them, what is missing. */
export async function alumniPreview(slug: string, sampleFirstName = "Jasmine"): Promise<AlumniPreview | null> {
  const r = await pool.query<{
    id: number;
    slug: string;
    title: string;
    end_date: string | null;
    timezone: string | null;
    product_id: number | null;
    dashboard_product_id: number | null;
    published: boolean | null;
  }>(
    `SELECT id, slug, title, end_date::text AS end_date, timezone,
            COALESCE(booking_product_id, product_id) AS product_id, product_id AS dashboard_product_id,
            published
       FROM retreats WHERE slug = $1`,
    [slug]
  );
  const row = r.rows[0];
  if (!row) return null;
  const timezone = row.timezone || "America/Los_Angeles";
  const gaps: string[] = [];
  if (!row.end_date || !parseDateText(row.end_date)) gaps.push("The retreat has no end date, so no email can be timed.");
  if (!row.product_id) gaps.push("The retreat has no booking product, so nobody can be enrolled.");
  if (row.published === false) {
    gaps.push("The retreat dashboard is not published: every email holds (and is skipped 3 days after its date) until it is, because the buttons open it.");
  }

  const sequence = await alumniSequence();
  if (!sequence) gaps.push("The alumni sequence (slug retreat-alumni) does not exist; migration 220 has not run.");
  else if (sequence.status !== "active") gaps.push(`The alumni sequence is '${sequence.status}': nothing is sent until it is switched on.`);

  const job = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM job_schedules WHERE name = 'retreat-alumni-enrol'`
  );
  const enrolJobEnabled = job.rows[0]?.enabled ?? false;
  if (!enrolJobEnabled) gaps.push("The hourly enrolment job (retreat-alumni-enrol) is disabled.");

  const st = await pool.query<{ enabled: boolean; next_url: string; featured_retreat_id: number | null }>(
    `SELECT enabled, next_url, featured_retreat_id FROM retreat_alumni_settings WHERE retreat_id = $1`,
    [row.id]
  );
  const settings = {
    enabled: st.rows[0]?.enabled ?? true,
    nextUrl: st.rows[0]?.next_url ?? "",
    featuredRetreatId: st.rows[0]?.featured_retreat_id ?? null,
  };
  if (!settings.enabled) gaps.push("Alumni emails are switched off for this retreat.");

  const values: Record<string, string> = {
    ...buildMergeValues({ email: "guest@example.com", firstName: sampleFirstName }, mergeLinks(null, { preview: true })),
    ...retreatMergeValues({ siteUrl: env.publicSiteUrl, slug: row.slug, title: row.title, nextUrl: settings.nextUrl }),
  };
  if (!values.retreatNextUrl) {
    gaps.push("Email 4's \"Explore what's next / join first access\" link is not set: Email 4 is held, and skipped if still unset 3 days after its date.");
  }
  if (!settings.featuredRetreatId) {
    gaps.push("No featured next retreat is set, so Email 4 cannot yet leave out guests who already booked it.");
  }

  const emailsRes = sequence
    ? await pool.query<{
        position: number;
        anchor_offset_days: number | null;
        subject: string;
        preview_text: string;
        body_md: string;
        topic: string | null;
        skip_rules: unknown;
      }>(
        `SELECT position, anchor_offset_days, subject, preview_text, body_md, topic, skip_rules
           FROM sequence_emails WHERE sequence_id = $1 AND enabled ORDER BY position`,
        [sequence.id]
      )
    : { rows: [] };

  const emails = emailsRes.rows.map((e) => {
    const sendAt =
      row.end_date && parseDateText(row.end_date)
        ? anchoredSendAt(row.end_date, e.anchor_offset_days ?? 0, sequence?.send_at_minute ?? null, timezone)
        : null;
    const rules = parseRetreatSkipRules(e.skip_rules);
    const body = renderTokens(e.body_md, values);
    return {
      position: e.position,
      offsetDays: e.anchor_offset_days,
      sendAt: sendAt ? sendAt.toISOString() : "",
      sendAtLocal: sendAt ? localLabel(sendAt, timezone) : "",
      subject: renderTokens(e.subject, values),
      previewText: renderTokens(e.preview_text ?? "", values),
      topic: e.topic ?? "",
      skipWhen: Object.entries(rules)
        .filter(([, on]) => on)
        .map(([key]) => SKIP_LABELS[key] ?? key),
      blockedUntilSet: missingRetreatTokens([e.subject, e.preview_text ?? "", e.body_md], values),
      html: preheaderHtml(renderTokens(e.preview_text ?? "", values)) + renderMarkdown(body),
    };
  });

  const enrolledRes = await pool.query<{ contact_id: number }>(
    `SELECT contact_id FROM retreat_alumni_enrolments WHERE retreat_id = $1`,
    [row.id]
  );
  const enrolledIds = new Set(enrolledRes.rows.map((x) => x.contact_id));
  const guests = row.product_id ? await retreatGuests(row.id) : [];
  for (const g of guests) {
    if (g.marketingStatus && !["subscribed", "unconfirmed"].includes(g.marketingStatus)) {
      gaps.push(`${g.email} is '${g.marketingStatus}': they will get none of the four emails.`);
    }
  }
  // Every button opens the private dashboard, which needs its own product grant.
  if (row.dashboard_product_id && guests.length > 0) {
    const access = await pool.query<{ contact_id: number }>(
      `SELECT DISTINCT c.id AS contact_id
         FROM access_grants g JOIN members m ON m.id = g.member_id
         JOIN contacts c ON c.id = m.contact_id OR lower(c.email::text) = lower(m.email::text)
        WHERE g.product_id = $1 AND g.status = 'active'
          AND (g.expires_at IS NULL OR g.expires_at > now())
          AND c.id = ANY($2::int[])`,
      [row.dashboard_product_id, guests.map((g) => g.contactId)]
    );
    const withAccess = new Set(access.rows.map((a) => a.contact_id));
    const without = guests.filter((g) => !withAccess.has(g.contactId)).length;
    if (without > 0) {
      gaps.push(`${without} of ${guests.length} guests do not have the retreat dashboard yet; the email buttons open it, so grant it before Day +3.`);
    }
  } else if (!row.dashboard_product_id) {
    gaps.push("The retreat has no dashboard product, so the email buttons have nothing to open.");
  }

  return {
    retreat: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      endDate: row.end_date ?? "",
      timezone,
      productId: row.product_id,
    },
    sequence: sequence ? { id: sequence.id, status: sequence.status } : null,
    enrolJobEnabled,
    settings,
    emails,
    guests: guests.map((g) => ({ ...g, enrolled: enrolledIds.has(g.contactId) })),
    gaps,
  };
}

/** Owner settings for one retreat's alumni emails. */
export async function saveAlumniSettings(
  slug: string,
  input: { nextUrl?: string; featuredRetreatSlug?: string | null; enabled?: boolean }
): Promise<boolean> {
  const r = await pool.query<{ id: number }>(`SELECT id FROM retreats WHERE slug = $1`, [slug]);
  const retreat = r.rows[0];
  if (!retreat) return false;
  let featuredId: number | null | undefined;
  if (input.featuredRetreatSlug === null || input.featuredRetreatSlug === "") featuredId = null;
  else if (input.featuredRetreatSlug !== undefined) {
    const f = await pool.query<{ id: number }>(`SELECT id FROM retreats WHERE slug = $1`, [input.featuredRetreatSlug]);
    if (!f.rows[0]) throw new Error("No retreat with that slug to feature");
    featuredId = f.rows[0].id;
  }
  await pool.query(
    `INSERT INTO retreat_alumni_settings (retreat_id, enabled, next_url, featured_retreat_id)
     VALUES ($1, COALESCE($2, true), COALESCE($3, ''), $4)
     ON CONFLICT (retreat_id) DO UPDATE
       SET enabled = COALESCE($2, retreat_alumni_settings.enabled),
           next_url = COALESCE($3, retreat_alumni_settings.next_url),
           featured_retreat_id = CASE WHEN $5 THEN $4 ELSE retreat_alumni_settings.featured_retreat_id END,
           updated_at = now()`,
    [
      retreat.id,
      input.enabled ?? null,
      input.nextUrl === undefined ? null : input.nextUrl.trim(),
      featuredId ?? null,
      featuredId !== undefined,
    ]
  );
  return true;
}
