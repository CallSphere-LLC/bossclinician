import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember, insertOrder } from "../testing/db";

/**
 * The Club's Ramp-Up Rate bonus end to end on a real database (Yvette, 22 Nov
 * 2026 round 2, items 1-2; migrations 215 + 221): a timely purchase gets the
 * bonus delivered, a late one does not, a buyer who never registered does
 * not, a test account never does; re-registering never moves the deadline;
 * C1-C3 go once, with the saved date, stop after purchase, never after the
 * deadline and never with an unfilled field; the Club nurture's Email 8 gives
 * way to C1. Needs TEST_DATABASE_URL (scripts/test-integration.sh).
 */
const sent = vi.hoisted(() => ({ messages: [] as any[] }));
vi.mock("../email/mailer", () => ({
  sendMailStrict: vi.fn(async (mail: any) => {
    sent.messages.push(mail);
    return { messageId: "ZZ-club-bonus-" + sent.messages.length };
  }),
  sendMail: vi.fn(async (mail: any) => {
    sent.messages.push(mail);
    return { sent: true };
  }),
}));
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("Club bonus (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: typeof import("../db/pool").pool;
  let bonus: typeof import("./clubBonus");
  let fulfillment: typeof import("./fulfillment");
  let formId = 0;
  let clubOfferId = 0;
  let rampUpProductId = 0;
  let serial = 0;

  async function person(at: Date | null, opts: { email?: string; status?: string } = {}) {
    const email = opts.email ?? `sagar+zz-cb-${++serial}@callsphere.ai`;
    const c = await db.client.query(
      `INSERT INTO contacts (email, name, first_name, email_marketing_status)
       VALUES ($1, 'ZZ Reader', 'ZZ', $2) RETURNING id`,
      [email, opts.status ?? "subscribed"]
    );
    const contactId = c.rows[0].id as number;
    if (at) {
      await db.client.query(
        `INSERT INTO form_submissions (form_id, email, contact_id, created_at) VALUES ($1, $2, $3, $4)`,
        [formId, email, contactId, at]
      );
    }
    return { email, contactId };
  }

  async function buyClub(email: string, orderedAt: Date) {
    const memberId = await insertMember(db.client, email);
    const orderId = await insertOrder(db.client, { offerId: clubOfferId, memberId, email, totalCents: 200 });
    await db.client.query(`UPDATE orders SET created_at = $2 WHERE id = $1`, [orderId, orderedAt]);
    await fulfillment.fulfillPayment({ orderId, amountCents: 200 });
    const decided = await db.client.query(`SELECT included, reason FROM club_bonus_orders WHERE order_id = $1`, [orderId]);
    const granted = await db.client.query(
      `SELECT 1 FROM access_grants WHERE member_id = $1 AND product_id = $2 AND status = 'active'`,
      [memberId, rampUpProductId]
    );
    return { orderId, memberId, decision: decided.rows[0], hasRampUp: (granted.rowCount ?? 0) > 0 };
  }

  const days = (n: number) => n * 86_400_000;

  beforeAll(async () => {
    db = await createTestDatabase("club_bonus");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "zz-club-bonus-test";
    process.env.SMTP_HOST = "email-smtp.us-east-1.amazonaws.com";
    process.env.SMTP_USER = "ZZ";
    process.env.SMTP_PASS = "ZZ";
    process.env.SES_VERIFIED_DOMAINS = "bossclinician.callsphere.site";
    pool = (await import("../db/pool")).pool;
    bonus = await import("./clubBonus");
    fulfillment = await import("./fulfillment");

    formId = (await db.client.query(`SELECT id FROM forms WHERE slug = 'practicepreptraining'`)).rows[0].id;
    clubOfferId = (await db.client.query(`SELECT id FROM offers WHERE slug = 'the-club'`)).rows[0].id;
    const ramp = await db.client.query(`SELECT id FROM products WHERE slug = 'ramp-up-rate-formula'`);
    rampUpProductId = ramp.rows[0]?.id ?? (await insertCourseProduct(db.client, "ramp-up-rate-formula")).productId;
    // insertCourseProduct prefixes the slug with "p-"; production's product is exactly "ramp-up-rate-formula".
    await db.client.query(`UPDATE products SET slug = 'ramp-up-rate-formula' WHERE id = $1`, [rampUpProductId]);
    await db.client.query(
      `INSERT INTO settings (key, value) VALUES ('marketing_email', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ fromName: "Yvette at Boss Clinician", fromEmail: "yvette@bossclinician.callsphere.site", address: "ZZ Test Address" })]
    );
    // Current migration chain retains the internal test addresses but migration
    // 229 restores the real opted-out registrant without extending her window.
    const settings = (await db.client.query(`SELECT value FROM settings WHERE key = 'club_bonus'`)).rows[0].value;
    expect(settings.excludedEmails).toEqual(
      expect.arrayContaining(["yvette@bossclinician.com", "yhowardlcsw@gmail.com", "sagar+pp1107@callsphere.ai"])
    );
    expect(settings.excludedEmails).not.toContain("murosn@nv.ccsd.net");
    expect(settings.legacyPendingGetsBonus).toBe(false);
    expect((await db.client.query(`SELECT status FROM email_sequences WHERE slug = 'club-bonus-reminders'`)).rows[0].status).toBe(
      "draft"
    );
    // Everything below registers "after go-live".
    await db.client.query(
      `UPDATE settings SET value = value || '{"goLiveAt": "2026-01-01T00:00:00.000Z"}'::jsonb WHERE key = 'club_bonus'`
    );
    bonus.resetClubBonusCache();
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("delivers the bonus for a timely purchase and not for a late one", async () => {
    const now = Date.now();
    const timely = await person(new Date(now - days(3)));
    const late = await person(new Date(now - days(20)));
    const a = await buyClub(timely.email, new Date(now));
    const b = await buyClub(late.email, new Date(now));
    expect(a.decision).toMatchObject({ included: true, reason: "within_window" });
    expect(a.hasRampUp).toBe(true);
    expect(b.decision).toMatchObject({ included: false, reason: "expired" });
    expect(b.hasRampUp).toBe(false);
  });

  it("does not give the bonus automatically to a buyer who never registered", async () => {
    const stranger = await person(null);
    const r = await buyClub(stranger.email, new Date());
    expect(r.decision).toMatchObject({ included: false, reason: "not_registered" });
    expect(r.hasRampUp).toBe(false);
  });

  it("never gives a test account the bonus, even inside its 14 days", async () => {
    const t = await person(new Date(Date.now() - days(1)), { email: "sagar+pp1107@callsphere.ai" });
    const window = await bonus.ensureWindow(pool, t.email);
    expect(window?.rule).toBe("test_excluded");
    expect(window?.deadlineAt).toBeNull();
    const r = await buyClub(t.email, new Date());
    expect(r.decision).toMatchObject({ included: false, reason: "test_account" });
    expect(r.hasRampUp).toBe(false);

    // An internal contact is a test account too.
    const internal = await person(new Date(Date.now() - days(1)));
    await db.client.query(`UPDATE contacts SET is_internal = true WHERE id = $1`, [internal.contactId]);
    const i = await buyClub(internal.email, new Date());
    expect(i.decision).toMatchObject({ included: false, reason: "test_account" });
    expect(i.hasRampUp).toBe(false);
    expect(await bonus.clubBonusParticipantCount(pool)).toBe(
      Number((await db.client.query(`SELECT count(*) FROM club_bonus_windows`)).rows[0].count) - 2
    );
  });

  it("keeps the first registration's deadline when somebody registers again", async () => {
    const first = new Date(Date.now() - days(10));
    const p = await person(first);
    const before = await bonus.ensureWindow(pool, p.email);
    await db.client.query(`INSERT INTO form_submissions (form_id, email, contact_id) VALUES ($1, $2, $3)`, [
      formId,
      p.email,
      p.contactId,
    ]);
    await bonus.syncWindows(pool);
    const after = await bonus.ensureWindow(pool, p.email);
    expect(after?.id).toBe(before?.id);
    expect(after?.deadlineAt?.toISOString()).toBe(before?.deadlineAt?.toISOString());
  });

  describe("C1-C3", () => {
    // Registered 9 a.m. PT on 1 March 2031 (future dates, so "now" in the
    // dispatcher is never behind the real clock): deadline 15 March 11:59 p.m.
    // PDT; C1 10 March, C2 13 March, C3 15 March, 9 a.m. Pacific.
    const registered = new Date("2031-03-01T09:00:00-08:00");
    const c1 = new Date("2031-03-10T09:05:00-07:00");
    const c2 = new Date("2031-03-13T09:05:00-07:00");
    const c3 = new Date("2031-03-15T09:05:00-07:00");
    let reader: { email: string; contactId: number };
    let buyer: { email: string; contactId: number };
    let tester: { email: string; contactId: number };

    beforeAll(async () => {
      reader = await person(registered);
      buyer = await person(registered);
      tester = await person(registered, { email: "murosn@nv.ccsd.net" });
      await bonus.syncWindows(pool);
      await db.client.query(`UPDATE email_sequences SET status = 'active' WHERE slug = 'club-bonus-reminders'`);
    });

    afterAll(async () => {
      await db.client.query(`UPDATE email_sequences SET status = 'draft' WHERE slug = 'club-bonus-reminders'`);
    });

    const to = (email: string) => sent.messages.filter((m) => String(m.to).toLowerCase().includes(email.toLowerCase()));

    it("sends C1 once, with the saved deadline, to real participants only", async () => {
      await bonus.runClubBonusTick(c1);
      await bonus.runClubBonusTick(new Date(c1.getTime() + 5 * 60_000));
      const mine = to(reader.email);
      expect(mine).toHaveLength(1);
      expect(mine[0].subject).toBe("Your Ramp-Up Rate bonus window ends in five days");
      expect(mine[0].html).toContain("Join The Club by March 15, 2031 at 11:59 p.m. Pacific Time");
      expect(mine[0].html).toContain("Hey ZZ,");
      expect(`${mine[0].subject}${mine[0].html}${mine[0].text ?? ""}`).not.toMatch(/\{\{|bonus_deadline_|first_name/);
      expect(mine[0].html).toMatch(/club\?b=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      expect(to(tester.email)).toHaveLength(0);
    });

    it("gives way: the Club nurture's Email 8 is replaced by C1, Email 9 the next day still goes", async () => {
      expect(await bonus.clubBonusReminderDaySkip(pool, reader.contactId, reader.email, new Date("2031-03-10T09:00:00-07:00"), "C1")).toBe(
        "replaced by C1 bonus reminder"
      );
      expect(await bonus.clubBonusReminderDaySkip(pool, reader.contactId, reader.email, new Date("2031-03-11T09:01:00-07:00"))).toBe("");
      // A test account's nurture is never touched.
      expect(await bonus.clubBonusReminderDaySkip(pool, tester.contactId, tester.email, new Date("2031-03-10T09:00:00-07:00"), "C1")).toBe(
        ""
      );
    });

    it("stops after purchase", async () => {
      const r = await buyClub(buyer.email, new Date());
      expect(r.decision).toMatchObject({ included: true });
      await bonus.runClubBonusTick(c2);
      expect(to(buyer.email).filter((m) => m.subject === "Two days left to join The Club with your bonus")).toHaveLength(0);
      expect(to(reader.email).filter((m) => m.subject === "Two days left to join The Club with your bonus")).toHaveLength(1);
    });

    it("never sends an unfilled field: a broken C3 is blocked, not sent", async () => {
      const seq = (await db.client.query(`SELECT id FROM email_sequences WHERE slug = 'club-bonus-reminders'`)).rows[0].id;
      await db.client.query(
        `UPDATE sequence_emails SET body_md = body_md || '<p>Closes {{enrollment_close_date}}</p>' WHERE sequence_id = $1 AND position = 3`,
        [seq]
      );
      const before = sent.messages.length;
      await bonus.runClubBonusTick(c3);
      expect(sent.messages.length).toBe(before);
      const ledger = await db.client.query(
        `SELECT s.outcome FROM club_bonus_reminder_sends s JOIN club_bonus_windows w ON w.id = s.window_id
          WHERE w.email = $1 AND s.reminder = 'C3'`,
        [reader.email]
      );
      expect(ledger.rows[0].outcome).toMatch(/^blocked: \{\{enrollment_close_date\}\} has no value/);
    });

    it("never sends after the deadline", async () => {
      const before = sent.messages.length;
      await bonus.runClubBonusTick(new Date("2031-03-16T09:05:00-07:00"));
      expect(sent.messages.length).toBe(before);
    });
  });
});
