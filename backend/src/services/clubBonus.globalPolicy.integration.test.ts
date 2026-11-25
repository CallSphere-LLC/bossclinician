import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";
const delivery = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../email/provider", async original => ({
  ...await original<typeof import("../email/provider")>(), sendEmail: delivery.send,
}));
(hasTestDatabase ? describe : describe.skip)("Club reminders share the global sales policy", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: typeof import("../db/pool").pool;
  let bonus: typeof import("./clubBonus");
  let serial = 0;
  const now = new Date("2031-03-10T09:05:00-07:00");
  beforeAll(async () => {
    db = await createTestDatabase("club_global"); process.env.DATABASE_URL = db.url;
    pool = (await import("../db/pool")).pool; bonus = await import("./clubBonus");
    await db.client.query("UPDATE email_sequences SET status='active' WHERE slug='club-bonus-reminders'");
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });
  beforeEach(async () => {
    await db.client.query("DELETE FROM club_bonus_windows");
    delivery.send.mockReset().mockResolvedValue({outcome:"sent",messageId:null,providerMessageId:"fixture",suppressedReason:""});
  });
  async function reader() {
    const email=`club-global-${++serial}@simulator.amazonses.com`;
    const id=(await db.client.query("INSERT INTO contacts(email,first_name,email_marketing_status) VALUES($1,'Reader','subscribed') RETURNING id",[email])).rows[0].id;
    const window=(await db.client.query(`INSERT INTO club_bonus_windows(email,contact_id,first_registered_at,deadline_at,rule)
      VALUES($1,$2,'2031-03-01T09:00:00-08:00','2031-03-15T23:59:59.999-07:00','first_registration') RETURNING id`,[email,id])).rows[0].id;
    return {id,window};
  }
  async function active(id:number,family:string,position=1,start=0,status="active") {
    const seq=(await db.client.query(`INSERT INTO email_sequences(name,slug,status,sales_family,sales_start_position)
      VALUES('Fixture',$1,'active',$2,$3) RETURNING id`,[`fixture-global-${++serial}`,family,start])).rows[0].id;
    await db.client.query("INSERT INTO sequence_subscriptions(sequence_id,contact_id,status,position) VALUES($1,$2,$3,$4)",[seq,id,status,position]);
  }
  async function marker(id:number) { return (await db.client.query("SELECT last_sales_sent_at FROM quiz_followup_state WHERE contact_id=$1",[id])).rows[0]?.last_sales_sent_at ?? null; }
  it("skips C1 while a different genuine sales nurture is active", async () => {
    const p=await reader(); await active(p.id,"hiring");
    await bonus.runClubBonusTick(now);
    expect(delivery.send).not.toHaveBeenCalled(); expect(await marker(p.id)).toBeNull();
    expect((await db.client.query("SELECT outcome FROM club_bonus_reminder_sends WHERE window_id=$1",[p.window])).rows[0].outcome).toBe("skipped: another sales sequence");
  });
  it("does not mistake a pending requested result or the Club nurture for competing sales", async () => {
    const p=await reader(); await active(p.id,"legacy_quiz",1,2); await active(p.id,"club");
    await bonus.runClubBonusTick(now); expect(delivery.send).toHaveBeenCalledTimes(1);
    expect((await marker(p.id)).toISOString()).toBe(now.toISOString());
  });
  it("treats a paused genuine sales nurture as competing", async () => {
    const p=await reader(); await active(p.id,"masterclass",2,0,"paused");
    await bonus.runClubBonusTick(now); expect(delivery.send).not.toHaveBeenCalled();
  });
  it("respects a same-day or recent previous-day global promotion", async () => {
    for(const at of ["2031-03-10T08:00:00-07:00","2031-03-09T20:00:00-07:00"]) {
      await db.client.query("DELETE FROM club_bonus_windows"); const p=await reader();
      await db.client.query("INSERT INTO quiz_followup_state(contact_id,last_sales_sent_at) VALUES($1,$2)",[p.id,at]);
      await bonus.runClubBonusTick(now); expect(delivery.send).not.toHaveBeenCalled();
      expect((await marker(p.id)).toISOString()).toBe(new Date(at).toISOString());
    }
  });
  it("permits an old marker and stamps the successful reminder exactly once", async () => {
    const p=await reader(); await db.client.query("INSERT INTO quiz_followup_state(contact_id,last_sales_sent_at) VALUES($1,'2031-03-08T09:00:00-07:00')",[p.id]);
    await bonus.runClubBonusTick(now); await bonus.runClubBonusTick(now);
    expect(delivery.send).toHaveBeenCalledTimes(1); expect((await marker(p.id)).toISOString()).toBe(now.toISOString());
  });
  it("does not stamp a suppressed or failed delivery", async () => {
    const p=await reader(); delivery.send.mockResolvedValueOnce({outcome:"suppressed",messageId:null,providerMessageId:"",suppressedReason:"fixture"});
    await bonus.runClubBonusTick(now); expect(await marker(p.id)).toBeNull();
    await db.client.query("DELETE FROM club_bonus_windows");const q=await reader();delivery.send.mockRejectedValueOnce(new Error("fixture transport failure"));
    expect((await bonus.runClubBonusTick(now)).sent).toBe(0);expect(await marker(q.id)).toBeNull();
  });
  it("holds the shared contact lock across send and marker commit", async () => {
    const p=await reader();let release!:()=>void;let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});
    delivery.send.mockImplementationOnce(async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});return {outcome:"sent",messageId:null,providerMessageId:"",suppressedReason:""};});
    const originalDeadline=(await db.client.query("SELECT first_registered_at,deadline_at FROM club_bonus_windows WHERE id=$1",[p.window])).rows[0];
    const run=bonus.runClubBonusTick(now);await started;
    // Simulate another genuine sales sender becoming due during the C1 send.
    // Both actual sender implementations must serialize on the contact lock.
    const seq=(await db.client.query("INSERT INTO email_sequences(name,slug,status,topic,sales_family) VALUES('Concurrent sales','concurrent-sales','active','marketing','hiring') RETURNING id")).rows[0].id;
    await db.client.query("INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,body_md,enabled) VALUES($1,1,0,'Sales','A sales message',true)",[seq]);
    const sub=(await db.client.query("INSERT INTO sequence_subscriptions(sequence_id,contact_id,status,position,next_send_at) VALUES($1,$2,'active',1,$3) RETURNING id",[seq,p.id,now])).rows[0].id;
    const sendDueEmail=(await import("./sequences")).sendDueEmail;
    const competingSend=sendDueEmail(Number(sub),now);
    const other=await pool.connect();
    try { await other.query("BEGIN");expect((await other.query("SELECT pg_try_advisory_xact_lock(236,$1) ok",[p.id])).rows[0].ok).toBe(false); }
    finally { await other.query("ROLLBACK");other.release();release();await run; }
    expect((await competingSend).detail).toBe("one sales email per day");
    expect(delivery.send).toHaveBeenCalledTimes(1);
    expect((await marker(p.id)).toISOString()).toBe(now.toISOString());
    expect((await db.client.query("SELECT first_registered_at,deadline_at FROM club_bonus_windows WHERE id=$1",[p.window])).rows[0]).toEqual(originalDeadline);
  });
});
