import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember, insertOffer } from "../testing/db";

const suite = hasTestDatabase ? describe : describe.skip;
const migration = (name: string) => fs.readFileSync(path.join(__dirname, "../db/migrations", name), "utf8");

suite("owner-approved Lounge and Boardroom activation", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    db = await createTestDatabase("owner_activation");
    await db.client.query("UPDATE offers SET slug='seed-' || id || '-' || slug WHERE slug IN ('the-lounge','the-lounge-vip','the-boss-boardroom')");
  });
  afterAll(async () => { await db?.drop(); });

  it("activates recurring Lounge choices without altering existing grants and matches each price to consent", async () => {
    const p = await insertCourseProduct(db.client, "activation-lounge");
    const ids: number[] = [];
    for (const [slug, amount] of [["the-lounge", 19700], ["the-lounge-vip", 34700]] as const) {
      const id = await insertOffer(db.client, slug, [p.productId]); ids.push(id);
      await db.client.query("UPDATE offers SET plan_access_open_ended=true WHERE id=$1", [id]);
      await db.client.query("INSERT INTO offer_pricing_options (offer_id,label,pricing_type,amount_cents,interval,interval_count,installment_count) VALUES ($1,'legacy','payment_plan',$2,'month',1,6)", [id, amount]);
    }
    const member = await insertMember(db.client, "historical@activation.invalid");
    await db.client.query("INSERT INTO access_grants (member_id,product_id,offer_id,source,status,expires_at) VALUES ($1,$2,$3,'manual','active',null)", [member,p.productId,ids[0]]);
    const before = (await db.client.query("SELECT * FROM access_grants WHERE member_id=$1", [member])).rows;
    const sql = migration("192_lounge_owner_approved_activation.sql");
    await db.client.query(sql); await db.client.query(sql);
    const options = (await db.client.query("SELECT p.*,o.slug FROM offer_pricing_options p JOIN offers o ON o.id=p.offer_id WHERE o.id=ANY($1) ORDER BY o.id,p.sort", [ids])).rows;
    expect(options).toHaveLength(4);
    for (const id of ids) {
      const monthly = options.find(p => p.offer_id===id && p.pricing_type==="subscription");
      expect(monthly.minimum_months).toBe(6); expect(monthly.installment_count).toBeNull();
      const r = (await db.client.query("SELECT * FROM offer_checkout_requirements WHERE offer_id=$1", [id])).rows[0];
      expect(r.term_months).toBe(12); expect(r.refund_window_days).toBe(7);
      expect(r.acknowledgments.find((a: any) => a.appliesTo==="subscription").text).toContain(`at $${monthly.amount_cents/100} until canceled`);
      expect((await db.client.query("SELECT plan_access_open_ended FROM offers WHERE id=$1", [id])).rows[0].plan_access_open_ended).toBe(false);
    }
    expect((await db.client.query("SELECT * FROM access_grants WHERE member_id=$1", [member])).rows).toEqual(before);
  });

  it("changes only future Boardroom delivery and removes release delays without publishing drafts", async () => {
    const course = await insertCourseProduct(db.client,"the-board-room");
    await db.client.query("UPDATE products SET slug='the-board-room' WHERE id=$1", [course.productId]);
    const coaching = (await db.client.query("INSERT INTO coaching_offers (slug,title) VALUES ('legacy-consulting','Legacy consulting') RETURNING id")).rows[0].id;
    const old = (await db.client.query("INSERT INTO products (slug,title,kind,status,coaching_offer_id) VALUES ('the-boss-boardroom','Legacy consulting','coaching','published',$1) RETURNING id", [coaching])).rows[0].id;
    const offer = await insertOffer(db.client,"the-boss-boardroom",[old]);
    const member = await insertMember(db.client,"old-boardroom@activation.invalid");
    await db.client.query("INSERT INTO access_grants (member_id,product_id,offer_id,source,status) VALUES ($1,$2,$3,'purchase','active')",[member,old,offer]);
    const moduleId = (await db.client.query("INSERT INTO course_modules (course_id,title,drip_days) VALUES ($1,'Module',14) RETURNING id",[course.courseId])).rows[0].id;
    await db.client.query("INSERT INTO course_lessons (module_id,title,slug,published,drip_days,requires_previous_lesson) VALUES ($1,'Ready','ready',true,30,true), ($1,'Unreleased','draft',false,30,true)",[moduleId]);
    const sql=migration("193_boardroom_course_delivery.sql"); await db.client.query(sql); await db.client.query(sql);
    expect((await db.client.query("SELECT product_id FROM offer_products WHERE offer_id=$1",[offer])).rows).toEqual([{product_id:course.productId}]);
    expect((await db.client.query("SELECT status FROM access_grants WHERE member_id=$1 AND product_id=$2",[member,old])).rows).toEqual([{status:"active"}]);
    const lessons=(await db.client.query("SELECT slug,published,drip_days,requires_previous_lesson FROM course_lessons WHERE module_id=$1 ORDER BY slug",[moduleId])).rows;
    expect(lessons).toEqual([{slug:"draft",published:false,drip_days:30,requires_previous_lesson:true},{slug:"ready",published:true,drip_days:null,requires_previous_lesson:false}]);
    expect((await db.client.query("SELECT drip_days FROM course_modules WHERE id=$1",[moduleId])).rows[0].drip_days).toBeNull();
  });
});
