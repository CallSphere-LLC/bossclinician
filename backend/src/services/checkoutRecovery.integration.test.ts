import { readFileSync } from "fs";
import { join } from "path";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";

// Only the external transport is replaced; real provider guards, SQL, queue,
// fulfillment and reporting execute against a throwaway migrated database.
const sent = vi.hoisted(() => ({ messages: [] as any[] }));
vi.mock("../email/mailer", () => ({sendMailStrict: vi.fn(async (mail: any) => {sent.messages.push(mail); return {messageId: `ZZ-mail-${sent.messages.length}`};})}));
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("checkout recovery (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let recovery: typeof import("./checkoutRecovery");
  let settings: typeof import("./settings");
  let fulfill: typeof import("./fulfillment");
  let appPool: typeof import("../db/pool").pool;
  let n = 0;
  async function cart(email = `sagar+zz-recovery-${++n}@callsphere.ai`) {
    const offer = await db.client.query(`INSERT INTO offers(title,slug,status,pricing_type,amount_cents) VALUES($1,$2,'published','one_time',2700) RETURNING id`, [`ZZ Recovery ${n}`, `zz-recovery-${n}`]);
    const row = await db.client.query(`INSERT INTO abandoned_checkouts(offer_id,email,first_name,amount_cents,created_at,updated_at) VALUES($1,$2,'ZZ',2700,now()-interval '2 hours',now()-interval '2 hours') RETURNING id`,[offer.rows[0].id,email]);
    return {id: row.rows[0].id, offerId: offer.rows[0].id,email};
  }
  async function order(c: Awaited<ReturnType<typeof cart>>) {
    const row = await db.client.query(`INSERT INTO orders(offer_id,email,amount_cents,total_cents,subtotal_cents,currency,status,billing_name,stripe_session_id) VALUES($1,$2,2700,2700,2700,'usd','pending','ZZ', $3) RETURNING id`,[c.offerId,c.email,`zz-${c.id}`]);
    return row.rows[0].id as number;
  }
  beforeAll(async () => {
    db = await createTestDatabase("checkout_recovery");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "zz-recovery-test-secret";
    process.env.SMTP_HOST = "email-smtp.us-east-1.amazonaws.com";
    process.env.SMTP_USER = "ZZ"; process.env.SMTP_PASS = "ZZ";
    process.env.SES_VERIFIED_DOMAINS = "bossclinician.callsphere.site";
    appPool = (await import("../db/pool")).pool;
    recovery = await import("./checkoutRecovery"); settings = await import("./settings"); fulfill = await import("./fulfillment");
    await db.client.query(`INSERT INTO settings(key,value) VALUES('marketing_email',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[JSON.stringify({fromName:"Yvette at Boss Clinician",fromEmail:"yvette@bossclinician.callsphere.site",address:"ZZ Test Address"})]);
  }, 60000);
  afterAll(async () => {await appPool?.end(); await db?.drop();});

  it("sends an editable reminder, attributes a followed link, fulfills and cancels every later reminder", async () => {
    const c = await cart();
    await settings.writeSetting("cart_recovery", {hours0:1,subject0:"ZZ Reminder for {offer}",body0:"Hi {name}, your download is waiting."});
    expect(await recovery.sweepAbandonedCheckouts()).toEqual({queued:1});
    const r:any = await recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0});
    expect(r.outcome).toBe("sent");
    const token = recovery.recoveryToken(r.reminderId);
    expect(await recovery.followRecoveryLink(token)).toBe(`zz-recovery-${n}`);
    expect(await recovery.followRecoveryLink(token+'x')).toBeNull();
    const msg = await db.client.query(`SELECT subject,status FROM email_messages WHERE id=$1`,[r.messageId]);
    expect(msg.rows[0].subject).toContain("ZZ Reminder for"); expect(msg.rows[0].status).toBe("sent");
    await db.client.query(`INSERT INTO jobs(kind,payload,status) VALUES('checkout.recoveryEmail',$1,'queued')`,[JSON.stringify({abandonedCheckoutId:c.id,step:1})]);
    const id = await order(c);
    expect((await fulfill.fulfillPayment({orderId:id,amountCents:2700,email:c.email})).fulfilled).toBe(true);
    const sendsBefore = sent.messages.length;
    const after:any = await recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:1});
    expect(after.skipped).toBeTruthy(); expect(sent.messages).toHaveLength(sendsBefore);
    const record = (await db.client.query(`SELECT recovered_order_id,recovered_reminder_id,stop_reason FROM abandoned_checkouts WHERE id=$1`,[c.id])).rows[0];
    expect(record).toEqual({recovered_order_id:id,recovered_reminder_id:r.reminderId,stop_reason:"purchased"});
    expect((await db.client.query(`SELECT count(*)::int AS n FROM jobs WHERE kind='checkout.recoveryEmail' AND status='queued' AND payload->>'abandonedCheckoutId'=$1`,[String(c.id)])).rows[0].n).toBe(0);
    const rollup = await import("./reports/rollup");
    await rollup.runRollup({from:"2020-01-01",to:"2030-01-01"});
    expect((await db.client.query(`SELECT sum(value_cents)::int AS cents FROM report_daily WHERE metric='cart_recovered' AND dimension=''`)).rows[0].cents).toBe(2700);
  });

  it("does not attribute an organic purchase to reminder revenue", async () => {
    const c = await cart(); const id = await order(c);
    await fulfill.fulfillPayment({orderId:id,amountCents:2700,email:c.email});
    expect((await db.client.query(`SELECT recovered_reminder_id,stop_reason FROM abandoned_checkouts WHERE id=$1`,[c.id])).rows[0]).toEqual({recovered_reminder_id:null,stop_reason:"purchased"});
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0}) as any).skipped).toBeTruthy();
  });

  it("honors suppression and contact unsubscribe without sending or consuming a sent step", async () => {
    for(const suppression of [true,false]) {
      const c = await cart();
      if(suppression) await db.client.query(`INSERT INTO email_suppressions(email,reason) VALUES($1,'bounce')`,[c.email]);
      else await db.client.query(`INSERT INTO contacts(email,name,email_marketing_status) VALUES($1,'ZZ','opted_out')`,[c.email]);
      const count = sent.messages.length;
      expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0}) as any).outcome).toBe("suppressed");
      expect(sent.messages).toHaveLength(count);
      expect((await db.client.query(`SELECT emails_sent,stopped_at FROM abandoned_checkouts WHERE id=$1`,[c.id])).rows[0].emails_sent).toBe(0);
    }
  });

  it("serializes duplicate sends and rechecks changed delays and recipients", async () => {
    const c = await cart();
    await settings.writeSetting("cart_recovery",{recipients:"sagar+zz-someone-else@callsphere.ai"});
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0}) as any).skipped).toBe("outside recipients");
    await settings.writeSetting("cart_recovery",{recipients:"",hours0:3});
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0}) as any).skipped).toBeTruthy();
    await settings.writeSetting("cart_recovery",{hours0:1});
    const before = sent.messages.length;
    const results:any[] = await Promise.all([recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0}),recovery.checkoutRecoveryEmail({abandonedCheckoutId:c.id,step:0})]);
    expect(results.filter(r=>r.outcome==='sent')).toHaveLength(1); expect(sent.messages).toHaveLength(before+1);
  });

  it("honours an offer's own setup: off sends nothing, custom uses its delay and copy", async () => {
    await settings.writeSetting("cart_recovery", {recipients: "", hours0: 1, subject0: "ZZ Global {offer}", body0: "ZZ global body"});
    const off = await cart();
    await db.client.query(`UPDATE offers SET recovery_enabled=false WHERE id=$1`, [off.offerId]);
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: off.id, step: 0}) as any).skipped).toBe("off for this offer");

    const custom = await cart();
    // The cart is two hours old; a custom first reminder at 3h is not due yet.
    await db.client.query(`UPDATE offers SET recovery_mode='custom', recovery_overrides=$2 WHERE id=$1`,
      [custom.offerId, JSON.stringify({hours0: 3, subject0: "ZZ Custom {offer}", body0: ""})]);
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: custom.id, step: 0}) as any).skipped).toBeTruthy();
    await db.client.query(`UPDATE offers SET recovery_overrides=$2 WHERE id=$1`,
      [custom.offerId, JSON.stringify({hours0: 0.5, subject0: "ZZ Custom {offer}", body0: ""})]);
    const r: any = await recovery.checkoutRecoveryEmail({abandonedCheckoutId: custom.id, step: 0});
    expect(r.outcome).toBe("sent");
    const msg = await db.client.query(`SELECT subject FROM email_messages WHERE id=$1`, [r.messageId]);
    expect(msg.rows[0].subject).toBe(`ZZ Custom ZZ Recovery ${n}`);
    // A blank custom body falls back to the site-wide copy.
    expect(sent.messages.at(-1).text).toContain("ZZ global body");
  });

  it("does not remind someone who bought just before the cart was captured", async () => {
    const c = await cart();
    const id = await order(c);
    await db.client.query(`UPDATE orders SET status='paid', created_at=now()-interval '3 hours' WHERE id=$1`, [id]);
    const before = sent.messages.length;
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: c.id, step: 0}) as any).skipped).toBe("already bought");
    expect(sent.messages).toHaveLength(before);
  });

  it("validates recipient addresses, ordered delays and blank copy", async () => {
    await expect(settings.writeSetting("cart_recovery",{recipients:"not-an-email"})).rejects.toThrow();
    await expect(settings.writeSetting("cart_recovery",{enabled1:true,hours1:0.5})).rejects.toThrow();
    await expect(settings.writeSetting("cart_recovery",{body0:""})).rejects.toThrow();
  });

  it("defaults to exactly one reminder, 6 hours after abandonment", async () => {
    const {recoveryDefinition: {defaults}} = await import("./checkoutRecoverySettings");
    expect([defaults.enabled0, defaults.enabled1, defaults.enabled2, defaults.enabled3]).toEqual([true, false, false, false]);
    expect(defaults.hours0).toBe(6);
  });

  it("sends one reminder per person in 24 hours across offers, and the waiting one afterwards", async () => {
    const email = "sagar+zz-recovery-person@callsphere.ai";
    await settings.writeSetting("cart_recovery", {recipients: email, hours0: 1});
    n++; const first = await cart(email);
    n++; const second = await cart(email);
    const r: any = await recovery.checkoutRecoveryEmail({abandonedCheckoutId: first.id, step: 0});
    expect(r.outcome).toBe("sent");
    const before = sent.messages.length;
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: second.id, step: 0}) as any).skipped).toContain("24 hours");
    expect(sent.messages).toHaveLength(before);
    expect((await db.client.query(`SELECT emails_sent,stopped_at FROM abandoned_checkouts WHERE id=$1`, [second.id])).rows[0]).toEqual({emails_sent: 0, stopped_at: null});
    expect(await recovery.sweepAbandonedCheckouts()).toEqual({queued: 0});
    await db.client.query(`UPDATE checkout_reminders SET sent_at=now()-interval '25 hours' WHERE id=$1`, [r.reminderId]);
    expect(await recovery.sweepAbandonedCheckouts()).toEqual({queued: 1});
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: second.id, step: 0}) as any).outcome).toBe("sent");
    await settings.writeSetting("cart_recovery", {recipients: ""});
  });

  it("lets only one of a person's carts through when both send at once", async () => {
    const email = "sagar+zz-recovery-together@callsphere.ai";
    n++; const first = await cart(email);
    n++; const second = await cart(email);
    const results: any[] = await Promise.all([first, second].map((c) => recovery.checkoutRecoveryEmail({abandonedCheckoutId: c.id, step: 0})));
    expect(results.filter((r) => r.outcome === "sent")).toHaveLength(1);
  });

  it("drops a reminder long past its time, until there is new checkout activity", async () => {
    const c = await cart();
    await settings.writeSetting("cart_recovery", {recipients: c.email, hours0: 1});
    await db.client.query(`UPDATE abandoned_checkouts SET updated_at=now()-interval '60 hours' WHERE id=$1`, [c.id]);
    expect(await recovery.sweepAbandonedCheckouts()).toEqual({queued: 0});
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: c.id, step: 0}) as any).skipped).toBeTruthy();
    await db.client.query(`UPDATE abandoned_checkouts SET updated_at=now()-interval '2 hours' WHERE id=$1`, [c.id]);
    expect((await recovery.checkoutRecoveryEmail({abandonedCheckoutId: c.id, step: 0}) as any).outcome).toBe("sent");
    await settings.writeSetting("cart_recovery", {recipients: ""});
  });

  it("migration 173 moves only the old timing, and closes unsent carts already past 6 hours", async () => {
    const sql = readFileSync(join(__dirname, "../db/migrations/173_checkout_reminder_one_at_6h.sql"), "utf8");
    const old = {enabled: true, recipients: "", enabled0: true, enabled1: true, enabled2: true, enabled3: true, hours0: 1, hours1: 6, hours2: 10, hours3: 24, subject0: "ZZ Kept"};
    const write = (value: unknown) => db.client.query(`INSERT INTO settings(key,value) VALUES('cart_recovery',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(value)]);
    const read = async () => (await db.client.query(`SELECT value FROM settings WHERE key='cart_recovery'`)).rows[0].value;

    const age = (id: number, hours: number, sentCount = 0) => db.client.query(`UPDATE abandoned_checkouts SET updated_at=now()-make_interval(hours => $2::int), emails_sent=$3 WHERE id=$1`, [id, hours, sentCount]);
    const pastDue = await cart(); await age(pastDue.id, 7);
    const young = await cart(); await age(young.id, 2);
    const midSequence = await cart(); await age(midSequence.id, 7, 1);
    const custom = await cart(); await age(custom.id, 7);
    await db.client.query(`UPDATE offers SET recovery_mode='custom' WHERE id=$1`, [custom.offerId]);

    await write(old);
    await db.client.query(sql);
    expect(await read()).toMatchObject({hours0: 6, enabled0: true, enabled1: false, enabled2: false, enabled3: false, subject0: "ZZ Kept"});
    const stopped = async (id: number) => (await db.client.query(`SELECT stop_reason FROM abandoned_checkouts WHERE id=$1`, [id])).rows[0].stop_reason;
    expect(await stopped(pastDue.id)).toBe("reminder_schedule_change");
    for (const c of [young, midSequence, custom]) expect(await stopped(c.id)).toBe("");

    const hers = {...old, hours0: 2};
    await write(hers);
    await db.client.query(sql);
    expect(await read()).toEqual(hers);
    settings.clearSettingsCache();
  });
});
