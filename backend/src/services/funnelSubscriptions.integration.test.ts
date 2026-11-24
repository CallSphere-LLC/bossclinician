import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createTestDatabase, hasTestDatabase } from "../testing/db";
import { saveAcceptedSubscription } from "./funnelSubscriptions";

const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("accepted funnel subscriptions (integration)", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: Pool;
  let step: number;
  let draft: number;
  beforeAll(async () => {
    db = await createTestDatabase("funnel_conversions");
    pool = new Pool({ connectionString: db.url });
    const f = await db.client.query(`INSERT INTO funnels (name,slug,published) VALUES ('Conversion test','conversion-test',true),('Draft','conversion-draft',false) RETURNING id`);
    step = (await db.client.query(`INSERT INTO funnel_steps (funnel_id,name,step_type) VALUES ($1,'Opt in','opt_in') RETURNING id`, [f.rows[0].id])).rows[0].id;
    draft = (await db.client.query(`INSERT INTO funnel_steps (funnel_id,name,step_type) VALUES ($1,'Draft opt in','opt_in') RETURNING id`, [f.rows[1].id])).rows[0].id;
  });
  afterAll(async () => { await pool?.end(); await db?.drop(); });
  const save = (email: string, funnelStepId = step, source = "funnel:conversion-test") => saveAcceptedSubscription(pool, { email, source, funnelStepId });
  const count = async () => Number((await db.client.query(`SELECT count(*) n FROM funnel_subscription_conversions WHERE step_id=$1`, [step])).rows[0].n);

  it("deduplicates concurrent replays, case variants and later returns", async () => {
    await Promise.all([save("once@example.com"), save("ONCE@example.com"), save("once@example.com")]);
    await save("once@example.com");
    expect(await count()).toBe(1);
    expect((await db.client.query(`SELECT count(*)::int n FROM subscribers WHERE lower(email)='once@example.com'`)).rows[0].n).toBe(1);
  });
  it("counts different accepted subscribers independently", async () => {
    const before = await count(); await save("second@example.com"); await save("third@example.com");
    expect(await count()).toBe(before + 2);
  });
  it("rejects source mismatch, unpublished and non-opt-in steps without recording a subscriber", async () => {
    const before = await count();
    await expect(save("invalid-source@example.com", step, "funnel:wrong")).rejects.toMatchObject({ status: 400 });
    await expect(save("draft@example.com", draft, "funnel:conversion-draft")).rejects.toMatchObject({ status: 400 });
    await db.client.query(`UPDATE funnels SET published=true WHERE id=(SELECT funnel_id FROM funnel_steps WHERE id=$1)`, [draft]);
    await db.client.query(`UPDATE funnel_steps SET step_type='offer' WHERE id=$1`, [draft]);
    await expect(save("offer@example.com", draft, "funnel:conversion-draft")).rejects.toMatchObject({ status: 400 });
    expect(await count()).toBe(before);
    expect((await db.client.query(`SELECT count(*)::int n FROM subscribers WHERE email=ANY($1::text[])`, [["invalid-source@example.com","draft@example.com","offer@example.com"]])).rows[0].n).toBe(0);
  });
  it("keeps legacy browser totals separate from completed subscriptions", async () => {
    const before = await count();
    await db.client.query(`UPDATE funnel_steps SET conversions=999 WHERE id=$1`, [step]);
    expect(await count()).toBe(before);
    expect((await db.client.query(`SELECT conversions FROM funnel_steps WHERE id=$1`, [step])).rows[0].conversions).toBe(999);
  });
  it("keeps ordinary subscriptions compatible without counting a conversion", async () => {
    const before = await count(); await saveAcceptedSubscription(pool, { email: "ordinary@example.com", source: "footer" });
    expect(await count()).toBe(before);
  });
  it("rolls back the subscription if recording its conversion fails", async () => {
    const before = await count();
    await db.client.query(`CREATE FUNCTION fail_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced conversion failure'; END $$; CREATE TRIGGER conversion_failure BEFORE INSERT ON funnel_subscription_conversions FOR EACH ROW EXECUTE FUNCTION fail_conversion();`);
    try { await expect(save("rollback@example.com")).rejects.toThrow("forced conversion failure"); }
    finally { await db.client.query(`DROP TRIGGER conversion_failure ON funnel_subscription_conversions; DROP FUNCTION fail_conversion();`); }
    expect(await count()).toBe(before);
    expect((await db.client.query(`SELECT count(*)::int n FROM subscribers WHERE email='rollback@example.com'`)).rows[0].n).toBe(0);
  });
});
