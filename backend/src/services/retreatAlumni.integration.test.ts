import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";
import { ALUMNI_EMAILS } from "./retreatAlumniEmails";

/**
 * Sheet row 249 (migration 220) against a real database: the alumni sequence
 * ships as a draft with its enrolment job off; once switched on, the sweep
 * enrols each paid, unrefunded guest exactly once, timed from the retreat's
 * end date. Migration 225 (Yvette's round-2 item 6) revises Email 4 and ships
 * it switched off; a guest granted access by hand is enrolled only after the
 * retreat ends. The mailer is mocked; nothing leaves the machine.
 */
vi.mock("../email/mailer", () => ({
  sendMailStrict: vi.fn(async () => ({ messageId: "ZZ-alumni" })),
}));

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("post-retreat alumni sequence (migration 220)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let appPool: typeof import("../db/pool").pool;
  let alumni: typeof import("./retreatAlumni");
  let anchor: typeof import("./retreatAnchor");
  let sequenceId: number;
  let retreatId: number;
  let endDate: string;
  let paidContact: number;
  let refundedContact: number;
  let dashboardProductId: number;

  async function guest(label: string, orderStatus: "paid" | "refunded", productId: number): Promise<number> {
    const email = `sagar+zz-alumni-${label}@callsphere.ai`;
    const c = await db.client.query(
      `INSERT INTO contacts (email, name, first_name, email_marketing_status)
       VALUES ($1, 'ZZ Guest', 'ZZ', 'subscribed') RETURNING id`,
      [email]
    );
    const m = await db.client.query(`INSERT INTO members (email, contact_id) VALUES ($1, $2) RETURNING id`, [
      email,
      c.rows[0].id,
    ]);
    const o = await db.client.query(
      `INSERT INTO orders (email, amount_cents, total_cents, refunded_cents, status)
       VALUES ($1, 450000, 450000, $2, $3) RETURNING id`,
      [email, orderStatus === "refunded" ? 450000 : 0, orderStatus]
    );
    await db.client.query(
      `INSERT INTO access_grants (member_id, product_id, order_id, status, source)
       VALUES ($1, $2, $3, 'active', 'purchase')`,
      [m.rows[0].id, productId, o.rows[0].id]
    );
    return c.rows[0].id as number;
  }

  beforeAll(async () => {
    db = await createTestDatabase("retreat_alumni");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "zz-retreat-alumni-test";
    appPool = (await import("../db/pool")).pool;
    alumni = await import("./retreatAlumni");
    anchor = await import("./retreatAnchor");
    sequenceId = (await db.client.query(`SELECT id FROM email_sequences WHERE slug = 'retreat-alumni'`)).rows[0].id;

    const booking = await db.client.query(
      `INSERT INTO products (slug, title, kind, status) VALUES ('zz-alumni-booking', 'ZZ booking', 'access_group', 'published') RETURNING id`
    );
    const dashboard = await db.client.query(
      `INSERT INTO products (slug, title, kind, status) VALUES ('zz-alumni-dashboard', 'ZZ dashboard', 'access_group', 'published') RETURNING id`
    );
    // Ended yesterday, Pacific time.
    const r = await db.client.query(
      `INSERT INTO retreats (slug, title, start_date, end_date, timezone, product_id, booking_product_id, published)
       VALUES ('zz-alumni', 'ZZ Retreat',
               (now() AT TIME ZONE 'America/Los_Angeles')::date - 6,
               (now() AT TIME ZONE 'America/Los_Angeles')::date - 1,
               'America/Los_Angeles', $1, $2, true)
       RETURNING id, end_date::text AS end_date`,
      [dashboard.rows[0].id, booking.rows[0].id]
    );
    retreatId = r.rows[0].id;
    endDate = r.rows[0].end_date;
    dashboardProductId = dashboard.rows[0].id;
    paidContact = await guest("paid", "paid", booking.rows[0].id);
    refundedContact = await guest("refunded", "refunded", booking.rows[0].id);
  }, 60000);

  afterAll(async () => {
    await appPool?.end();
    await db?.drop();
  });

  it("ships the sequence as a draft, its enrolment job off, timed from the retreat end", async () => {
    const seq = (await db.client.query(`SELECT status, anchor_kind, send_at_minute, timezone FROM email_sequences WHERE id = $1`, [sequenceId])).rows[0];
    expect(seq).toMatchObject({ status: "draft", anchor_kind: "retreat_end", send_at_minute: 540, timezone: "America/Los_Angeles" });
    const job = (await db.client.query(`SELECT enabled, kind FROM job_schedules WHERE name = 'retreat-alumni-enrol'`)).rows[0];
    expect(job).toEqual({ enabled: false, kind: "retreatAlumni.enrol" });
    const emails = (
      await db.client.query(`SELECT anchor_offset_days, topic FROM sequence_emails WHERE sequence_id = $1 ORDER BY position`, [sequenceId])
    ).rows;
    expect(emails.map((e) => e.anchor_offset_days)).toEqual([3, 7, 14, 21]);
    expect(emails.map((e) => e.topic)).toEqual(["", "", "marketing", "marketing"]);
  });

  it("stores exactly the approved copy after migration 225, with Email 4 switched off", async () => {
    const rows = (
      await db.client.query(
        `SELECT position, anchor_offset_days, subject, preview_text, body_md, topic, skip_rules, enabled
           FROM sequence_emails WHERE sequence_id = $1 ORDER BY position`,
        [sequenceId]
      )
    ).rows;
    expect(
      rows.map((r) => ({
        position: r.position,
        offsetDays: r.anchor_offset_days,
        subject: r.subject,
        previewText: r.preview_text,
        bodyMd: r.body_md,
        topic: r.topic,
        skipRules: r.skip_rules,
        enabled: r.enabled,
      }))
    ).toEqual(ALUMNI_EMAILS.map((e) => ({ ...e })));
    expect(rows.map((r) => r.enabled)).toEqual([true, true, true, false]);
    for (const r of rows) expect(`${r.subject} ${r.preview_text} ${r.body_md}`).not.toMatch(/first[- ]access/i);
    const intro = (await db.client.query(`SELECT settings->'joinUsAgain'->>'intro' AS intro FROM retreats WHERE slug = 'bali-2027'`)).rows[0]?.intro;
    if (intro !== undefined && intro !== null) expect(intro).not.toMatch(/first[- ]access/i);
  });

  it("re-running migration 225 changes nothing and never switches a re-enabled Email 4 off again", async () => {
    await db.client.query(`UPDATE sequence_emails SET enabled = true WHERE sequence_id = $1 AND position = 4`, [sequenceId]);
    const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/225_retreat_alumni_round2.sql"), "utf8");
    await db.client.query(sql);
    const e4 = (await db.client.query(`SELECT enabled, body_md FROM sequence_emails WHERE sequence_id = $1 AND position = 4`, [sequenceId])).rows[0];
    expect(e4.enabled).toBe(true);
    expect(e4.body_md).toBe(ALUMNI_EMAILS[3].bodyMd);
    await db.client.query(`UPDATE sequence_emails SET enabled = false WHERE sequence_id = $1 AND position = 4`, [sequenceId]);
  });

  it("enrols nobody while the sequence is a draft", async () => {
    const result = await alumni.enrolRetreatAlumni(new Date());
    expect(result.enrolled).toBe(0);
    expect((await db.client.query(`SELECT count(*)::int n FROM sequence_subscriptions WHERE sequence_id = $1`, [sequenceId])).rows[0].n).toBe(0);
  });

  it("once on, enrols the paid guest once, timed Day +3 from the end date; never the refunded one", async () => {
    await db.client.query(`UPDATE email_sequences SET status = 'active' WHERE id = $1`, [sequenceId]);

    const first = await alumni.enrolRetreatAlumni(new Date());
    expect(first.enrolled).toBe(1);
    const sub = (
      await db.client.query(`SELECT contact_id, position, next_send_at, anchor_retreat_id, source_order_id FROM sequence_subscriptions WHERE sequence_id = $1`, [sequenceId])
    ).rows;
    expect(sub).toHaveLength(1);
    expect(sub[0].contact_id).toBe(paidContact);
    expect(sub[0].position).toBe(1);
    expect(sub[0].anchor_retreat_id).toBe(retreatId);
    expect(sub[0].source_order_id).not.toBeNull();
    expect(new Date(sub[0].next_send_at).toISOString()).toBe(
      anchor.anchoredSendAt(endDate, 3, 540, "America/Los_Angeles").toISOString()
    );

    const second = await alumni.enrolRetreatAlumni(new Date());
    expect(second.enrolled).toBe(0);
    expect(
      (await db.client.query(`SELECT count(*)::int n FROM sequence_subscriptions WHERE contact_id = $1`, [refundedContact])).rows[0].n
    ).toBe(0);
  });

  it("a later manual dashboard grant keeps the paid booking's order stamp, and never revives a refunded booking", async () => {
    for (const contactId of [paidContact, refundedContact]) {
      const m = (await db.client.query(`SELECT id FROM members WHERE contact_id = $1`, [contactId])).rows[0];
      await db.client.query(
        `INSERT INTO access_grants (member_id, product_id, status, source, granted_at)
         VALUES ($1, $2, 'active', 'manual', now() + interval '1 minute')`,
        [m.id, dashboardProductId]
      );
    }
    const guests = await alumni.retreatGuests(retreatId);
    const paid = guests.find((g) => g.contactId === paidContact);
    expect(paid?.orderId).not.toBeNull();
    expect(guests.some((g) => g.contactId === refundedContact)).toBe(false);
  });

  it("a guest granted dashboard access by hand is enrolled only after her retreat ends, at Day +3", async () => {
    // A second retreat that has not ended yet; its guest holds ONLY the
    // dashboard product, granted manually by an admin (no order).
    const product = await db.client.query(
      `INSERT INTO products (slug, title, kind, status) VALUES ('zz-alumni-manual', 'ZZ manual', 'access_group', 'published') RETURNING id`
    );
    const r = await db.client.query(
      `INSERT INTO retreats (slug, title, start_date, end_date, timezone, product_id, published)
       VALUES ('zz-alumni-later', 'ZZ Later',
               (now() AT TIME ZONE 'America/Los_Angeles')::date + 10,
               (now() AT TIME ZONE 'America/Los_Angeles')::date + 15,
               'America/Los_Angeles', $1, true)
       RETURNING id`,
      [product.rows[0].id]
    );
    const laterId = r.rows[0].id as number;
    const email = "sagar+zz-alumni-manual@callsphere.ai";
    const c = await db.client.query(
      `INSERT INTO contacts (email, name, first_name, email_marketing_status) VALUES ($1, 'ZZ Manual', 'ZZ', 'subscribed') RETURNING id`,
      [email]
    );
    const m = await db.client.query(`INSERT INTO members (email, contact_id) VALUES ($1, $2) RETURNING id`, [email, c.rows[0].id]);
    await db.client.query(
      `INSERT INTO access_grants (member_id, product_id, status, source) VALUES ($1, $2, 'active', 'manual')`,
      [m.rows[0].id, product.rows[0].id]
    );
    const subsOf = async () =>
      (await db.client.query(`SELECT next_send_at, anchor_retreat_id FROM sequence_subscriptions WHERE contact_id = $1`, [c.rows[0].id])).rows;
    const mailCount = async () =>
      (await db.client.query(`SELECT count(*)::int n FROM email_messages WHERE to_email = $1`, [email])).rows[0].n;

    // She is a guest, but the retreat has not ended: nothing now.
    expect((await alumni.retreatGuests(laterId)).map((g) => g.contactId)).toEqual([c.rows[0].id]);
    await alumni.enrolRetreatAlumni(new Date());
    expect(await subsOf()).toHaveLength(0);
    expect(await mailCount()).toBe(0);

    // The retreat ends (dates moved so it ended yesterday): enrolled, first email Day +3, nothing sent yet.
    const ended = await db.client.query(
      `UPDATE retreats SET start_date = (now() AT TIME ZONE 'America/Los_Angeles')::date - 6,
                           end_date = (now() AT TIME ZONE 'America/Los_Angeles')::date - 1
        WHERE id = $1 RETURNING end_date::text AS end_date`,
      [laterId]
    );
    await alumni.enrolRetreatAlumni(new Date());
    const subs = await subsOf();
    expect(subs).toHaveLength(1);
    expect(subs[0].anchor_retreat_id).toBe(laterId);
    expect(new Date(subs[0].next_send_at).toISOString()).toBe(
      anchor.anchoredSendAt(ended.rows[0].end_date, 3, 540, "America/Los_Angeles").toISOString()
    );
    expect(await mailCount()).toBe(0);
  });

  it("preview lists the four send dates, links Email 4 to /upcoming-retreats and shows it switched off", async () => {
    const preview = await alumni.alumniPreview("zz-alumni");
    expect(preview?.emails.map((e) => e.position)).toEqual([1, 2, 3, 4]);
    expect(preview?.emails.map((e) => e.enabled)).toEqual([true, true, true, false]);
    expect(preview?.emails[3].blockedUntilSet).toEqual([]);
    expect(preview?.emails[3].html).toContain("/upcoming-retreats");
    expect(preview?.emails[3].html).toContain("Explore upcoming retreats");
    expect(preview?.emails[0].html).toContain("/retreats/dashboard/zz-alumni/memories");
    expect(preview?.emails[0].html).toContain("Hey Alex,");
    expect(preview?.gaps.some((g) => /Email 4 is switched off/.test(g))).toBe(true);
    for (const e of preview?.emails ?? []) expect(e.html).not.toMatch(/\{\{|Jasmine|first[- ]access/i);
  });

  it("re-running the migration changes nothing", async () => {
    const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/220_retreat_alumni_sequence.sql"), "utf8");
    await db.client.query(sql);
    expect((await db.client.query(`SELECT count(*)::int n FROM sequence_emails WHERE sequence_id = $1`, [sequenceId])).rows[0].n).toBe(4);
    expect((await db.client.query(`SELECT status FROM email_sequences WHERE id = $1`, [sequenceId])).rows[0].status).toBe("active");
  });
});
