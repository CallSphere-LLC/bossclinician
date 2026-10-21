import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct } from "../testing/db";

const sent = vi.hoisted(() => ({ messages: [] as any[] }));
vi.mock("../email/mailer", () => ({
  sendMailStrict: vi.fn(async (mail: any) => {
    sent.messages.push(mail);
    return { messageId: "ZZ-practice-prep-" + sent.messages.length };
  }),
}));
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("Practice Prep to Club sequence", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let appPool: typeof import("../db/pool").pool;
  let sequences: typeof import("./sequences");
  let automation: typeof import("../automations/engineV2");
  let sequenceId: number, formId: number, offerId: number;
  let serial = 0;
  async function contact(status = "subscribed") {
    const email = "sagar+zz-prep-" + (++serial) + "@callsphere.ai";
    const r = await db.client.query(
      "INSERT INTO contacts(email,name,first_name,email_marketing_status) VALUES($1,'ZZ Learner','ZZ',$2) RETURNING id",
      [email, status],
    );
    return { id: r.rows[0].id as number, email };
  }
  async function signup(c: {id: number;email: string}, subjectId = formId) {
    await automation.fireTrigger("form_submitted", {
      contactId: c.id, email: c.email, name: "ZZ Learner",
      subjectId, source: "form", eventKey: "zz-prep:" + c.id + ":" + subjectId,
    }, {rethrow: true});
  }
  async function subscription(c: {id:number}) {
    return (await db.client.query(
      "SELECT * FROM sequence_subscriptions WHERE sequence_id=$1 AND contact_id=$2",
      [sequenceId,c.id],
    )).rows[0];
  }
  beforeAll(async () => {
    db = await createTestDatabase("practice_prep");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "zz-practice-prep-test";
    process.env.SMTP_HOST = "email-smtp.us-east-1.amazonaws.com";
    process.env.SMTP_USER = "ZZ"; process.env.SMTP_PASS = "ZZ";
    process.env.SES_VERIFIED_DOMAINS = "bossclinician.callsphere.site";
    appPool = (await import("../db/pool")).pool;
    sequences = await import("./sequences");
    automation = await import("../automations/engineV2");
    sequenceId = (await db.client.query("SELECT id FROM email_sequences WHERE slug='practice-prep-to-the-club'")).rows[0].id;
    formId = (await db.client.query("SELECT id FROM forms WHERE slug='practicepreptraining'")).rows[0].id;
    offerId = (await db.client.query("SELECT id FROM offers WHERE slug='the-club'")).rows[0].id;
    await db.client.query(
      "INSERT INTO settings(key,value) VALUES('marketing_email',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
      [JSON.stringify({fromName:"Yvette at Boss Clinician",fromEmail:"yvette@bossclinician.callsphere.site",address:"ZZ Test Address"})],
    );
    expect((await db.client.query("SELECT status FROM email_sequences WHERE id=$1",[sequenceId])).rows[0].status).toBe("draft");
    expect((await db.client.query("SELECT status FROM automations WHERE name='Practice Prep Training → The Club'")).rows[0].status).toBe("paused");
    await db.client.query("UPDATE email_sequences SET status='active' WHERE id=$1",[sequenceId]);
    await db.client.query("UPDATE automations SET status='active' WHERE name='Practice Prep Training → The Club'");
    // Exercise only the new enrollment automation; the existing immediate
    // access email has separate coverage and must not obscure send assertions.
    await db.client.query("UPDATE automations SET status='paused' WHERE name <> 'Practice Prep Training → The Club'");
  }, 60000);
  afterAll(async () => { await appPool?.end(); await db?.drop(); });

  it("does not backfill contacts, survives reruns and keeps owner edits", async () => {
    expect((await db.client.query("SELECT count(*)::int n FROM sequence_subscriptions WHERE sequence_id=$1",[sequenceId])).rows[0].n).toBe(0);
    const migration=fs.readFileSync(path.join(__dirname,"../db/migrations/137_practice_prep_club_sequence.sql"),"utf8");
    await db.client.query("UPDATE sequence_emails SET preview_text='Owner edit' WHERE sequence_id=$1 AND position=1",[sequenceId]);
    await db.client.query(migration);
    const emails=(await db.client.query("SELECT position,delay_minutes,preview_text FROM sequence_emails WHERE sequence_id=$1 ORDER BY position",[sequenceId])).rows;
    expect(emails.map(r=>r.delay_minutes)).toEqual([1440,1440,2880,2880,2880]);
    expect(emails[0].preview_text).toBe("Owner edit");
    expect((await db.client.query("SELECT count(*)::int n FROM automations WHERE name='Practice Prep Training → The Club'")).rows[0].n).toBe(1);
  });
  it("enrolls only the correct form and repeated submissions keep one run", async () => {
    const c=await contact();
    await signup(c,formId+10000);
    expect(await subscription(c)).toBeUndefined();
    await signup(c);
    const first=await subscription(c);
    expect(first.status).toBe("active");
    expect(new Date(first.next_send_at).getTime()-Date.now()).toBeGreaterThan(23*3600000);
    await signup(c);
    expect((await subscription(c)).id).toBe(first.id);
    expect((await sequences.enrollContact(sequenceId,c.id)).outcome).toBe("already_enrolled");
  });
  it("sends a due follow-up through the real provider guards and schedules the next", async () => {
    const c=await contact(); await signup(c); const sub=await subscription(c);
    await db.client.query("UPDATE sequence_subscriptions SET next_send_at=now()-interval '1 minute' WHERE id=$1",[sub.id]);
    const before=sent.messages.length;
    const result=await sequences.sendDueEmail(Number(sub.id));
    expect(result.outcome).toBe("sent");
    expect(sent.messages.length).toBe(before+1);
    expect((await subscription(c)).position).toBe(2);
    expect(sent.messages.at(-1).subject).toBe("Your next step after Practice Prep");
  });
  it("honors opt-outs without transmitting a message", async () => {
    const c=await contact("opted_out"); await signup(c); const sub=await subscription(c);
    await db.client.query("UPDATE sequence_subscriptions SET next_send_at=now()-interval '1 minute' WHERE id=$1",[sub.id]);
    const before=sent.messages.length;
    expect((await sequences.sendDueEmail(Number(sub.id))).outcome).toBe("suppressed");
    expect(sent.messages.length).toBe(before);
  });
  it("stops on Club purchase, not unrelated purchases, and does not restart", async () => {
    const c=await contact(); await signup(c); const sub=await subscription(c);
    expect(await sequences.exitContactOnPurchase(c.id,"another purchase",offerId+10000)).toBe(0);
    expect(await sequences.exitContactOnPurchase(c.id,"Club purchased",offerId)).toBe(1);
    expect((await sequences.sendDueEmail(Number(sub.id))).outcome).toBe("not_due");
    expect((await sequences.enrollContact(sequenceId,c.id)).outcome).toBe("blocked");
  });
  it("excludes existing Club members at signup", async () => {
    const c=await contact();
    const member=(await db.client.query("INSERT INTO members(email,name,contact_id) VALUES($1,'ZZ Existing Member',$2) RETURNING id",[c.email,c.id])).rows[0].id;
    const product=await insertCourseProduct(db.client,"zz-existing-club");
    await db.client.query("INSERT INTO access_grants(member_id,offer_id,product_id,status) VALUES($1,$2,$3,'active')",[member,offerId,product.productId]);
    await signup(c);
    expect(await subscription(c)).toBeUndefined();
  });
});
