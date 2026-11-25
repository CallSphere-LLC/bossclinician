import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertMember, insertCourseProduct, insertOffer } from "../testing/db";
const transport=vi.hoisted(()=>({n:0}));
const sendMail=vi.hoisted(()=>vi.fn(async()=>({messageId:`fixture-${++transport.n}`,response:"250 Ok"})));
vi.mock("nodemailer",()=>({default:{createTransport:()=>({sendMail})}}));
const sendEmail=vi.hoisted(()=>vi.fn(async()=>({outcome:"sent",messageId:1,providerMessageId:"fixture",suppressedReason:""})));
vi.mock("../email/provider",async original=>({...await original<typeof import("../email/provider")>(),sendEmail}));
(hasTestDatabase?describe:describe.skip)("completion-anchored quiz followups",()=>{
 let db:Awaited<ReturnType<typeof createTestDatabase>>;
 let route:typeof import("./quizFollowups").routeQuizFollowup;
 let send:typeof import("./sequences").sendDueEmail;
 beforeAll(async()=>{db=await createTestDatabase("quiz236");process.env.DATABASE_URL=db.url;route=(await import("./quizFollowups")).routeQuizFollowup;send=(await import("./sequences")).sendDueEmail;},60000);
 afterAll(async()=>{await(await import("../db/pool")).pool.end();await db?.drop();});
 async function contact(status="subscribed"){return (await db.client.query("INSERT INTO contacts(email,email_marketing_status) VALUES($1,$2) RETURNING id",[`quiz${Date.now()}-${Math.random()}@simulator.amazonses.com`,status])).rows[0].id as number;}
 async function subs(id:number){return(await db.client.query("SELECT s.*,q.slug FROM sequence_subscriptions s JOIN email_sequences q ON q.id=s.sequence_id WHERE contact_id=$1 ORDER BY s.id",[id])).rows;}
 it("migration creates 21 exact timed emails, leaves videos disabled, enrolls nobody, and preserves owner edits on replay",async()=>{
  expect((await db.client.query("SELECT count(*)::int n FROM sequence_emails e JOIN email_sequences q ON q.id=e.sequence_id WHERE q.completion_anchored")).rows[0].n).toBe(21);
  expect((await db.client.query("SELECT count(*)::int n FROM sequence_emails e JOIN email_sequences q ON q.id=e.sequence_id WHERE q.completion_anchored AND NOT e.enabled")).rows[0].n).toBe(3);
  expect((await db.client.query("SELECT count(*)::int n FROM quiz_followup_state")).rows[0].n).toBe(0);
  await db.client.query("UPDATE sequence_emails SET preview_text='Owner preview' WHERE sequence_id=(SELECT id FROM email_sequences WHERE slug='quiz-hiring-ready') AND position=1");
  await db.client.query(fs.readFileSync(path.join(__dirname,"../db/migrations/236_quiz_followup_sequences.sql"),"utf8"));
  expect((await db.client.query("SELECT preview_text FROM sequence_emails WHERE sequence_id=(SELECT id FROM email_sequences WHERE slug='quiz-hiring-ready') AND position=1")).rows[0].preview_text).toBe("Owner preview");
 });
 it("does not enroll absent consent or infer an unknown stage",async()=>{
  for(const status of ["never_subscribed","opted_out","bounced","complained"]){const id=await contact(status);await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"});expect(await subs(id)).toHaveLength(0);}
  const id=await contact();await route(id,"hiring-quiz-ready",{marketing_consent:false});expect(await subs(id)).toHaveLength(0);expect((await db.client.query("SELECT review_reason FROM quiz_followup_state WHERE contact_id=$1",[id])).rows[0].review_reason).toContain("Confirm");
 });
 it("anchors day 1/3 to completion despite a late day-1 send, and never restarts on retake",async()=>{
  const id=await contact();const anchor=new Date("2026-11-01T12:00:00Z");await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"},anchor);
  let rows=await subs(id);expect(rows[0].next_send_at.toISOString()).toBe("2026-11-02T12:00:00.000Z");
  await send(Number(rows[0].id),new Date("2026-11-03T12:00:00Z"));rows=await subs(id);expect(rows[0].position).toBe(2);expect(rows[0].next_send_at.toISOString()).toBe("2026-11-04T12:00:00.000Z");
  await route(id,"hiring-quiz-not-yet",{marketing_consent:false,practice_stage:"first_hire"},new Date("2026-12-01T12:00:00Z"));rows=await subs(id);expect(rows).toHaveLength(1);expect(rows[0].entered_at.toISOString()).toBe(anchor.toISOString());
 });
 it("switches between completed tools once and stops mismatched mail for confirmed no-launch/waiting stages",async()=>{
  const id=await contact();await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"});await route(id,"boss-assessment",{marketing_consent:false,practice_stage:"existing_team"});
  let rows=await subs(id);expect(rows.filter(r=>r.status==="active").map(r=>r.slug)).toEqual(["quiz-assessment-followup"]);
  await route(id,"boss-assessment",{marketing_consent:false,practice_stage:"not_launched"});expect((await subs(id)).filter(r=>r.status==="active")).toHaveLength(0);
  const waiting=await contact();await route(waiting,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"});await route(waiting,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"existing_team"});expect((await subs(waiting)).filter(r=>r.status==="active")).toHaveLength(0);
 });
 it("serializes concurrent submissions to one active sales sequence",async()=>{
  const id=await contact();await Promise.all([route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"}),route(id,"boss-assessment",{marketing_consent:false,practice_stage:"existing_team"})]);expect((await subs(id)).filter(r=>r.status==="active")).toHaveLength(1);
 });
 it("skips the gated video while retaining day-eight absolute timing and limits daily promotions",async()=>{
  const id=await contact();await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"},new Date("2026-11-01T12:00:00Z"));
  let row=(await subs(id))[0];await send(Number(row.id),new Date("2026-11-02T12:00:00Z"));
  const calls=sendEmail.mock.calls.length;
  await db.client.query("UPDATE sequence_subscriptions SET next_send_at='2026-11-02T13:00:00Z' WHERE id=$1",[row.id]);
  await send(Number(row.id),new Date("2026-11-02T13:00:00Z"));expect(sendEmail.mock.calls.length).toBe(calls);
  await send(Number(row.id),new Date("2026-11-04T12:00:00Z"));row=(await subs(id))[0];expect(row.position).toBe(4);expect(row.next_send_at.toISOString()).toBe("2026-11-09T12:00:00.000Z");
 });
 it("checks application exits again at send-time instead of relying on events",async()=>{
  const id=await contact();await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"},new Date("2026-11-01T12:00:00Z"));
  const row=(await subs(id))[0];const form=(await db.client.query("INSERT INTO forms(name,slug) VALUES('Fixture application','fixture-application') RETURNING id")).rows[0].id;
  await db.client.query("INSERT INTO sequence_exclude_forms(sequence_id,form_id) VALUES($1,$2)",[row.sequence_id,form]);
  await db.client.query("INSERT INTO form_submissions(form_id,contact_id) VALUES($1,$2)",[form,id]);
  const calls=sendEmail.mock.calls.length;await send(Number(row.id),new Date("2026-11-02T12:00:00Z"));expect(sendEmail.mock.calls.length).toBe(calls);expect((await subs(id))[0].status).toBe("exited");
 });

 it("exits for an already-owned promoted offer without another purchase event",async()=>{
  const id=await contact();await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"},new Date("2026-11-01T12:00:00Z"));const row=(await subs(id))[0];
  const email=(await db.client.query("SELECT email FROM contacts WHERE id=$1",[id])).rows[0].email;
  const member=await insertMember(db.client,email);const product=await insertCourseProduct(db.client,"fixture-boardroom");const offer=await insertOffer(db.client,"fixture-boardroom",[product.productId]);
  await db.client.query("INSERT INTO sequence_exclude_offers(sequence_id,offer_id) VALUES($1,$2)",[row.sequence_id,offer]);
  await db.client.query("INSERT INTO access_grants(member_id,product_id,offer_id) VALUES($1,$2,$3)",[member,product.productId,offer]);
  const calls=sendEmail.mock.calls.length;await send(Number(row.id),new Date("2026-11-02T12:00:00Z"));expect(sendEmail.mock.calls.length).toBe(calls);expect((await subs(id))[0].status).toBe("exited");
 });

 it("delivers a legacy requested result without replacing the selected sales nurture",async()=>{
  const id=await contact();await route(id,"hiring-quiz-ready",{marketing_consent:false,practice_stage:"first_hire"},new Date("2026-11-01T12:00:00Z"));
  const q=(await db.client.query("INSERT INTO email_sequences(name,slug,status,sales_family,sales_start_position) VALUES('Fixture quiz','fixture-quiz','active','legacy_quiz',2) RETURNING id")).rows[0].id;
  await db.client.query("INSERT INTO sequence_emails(sequence_id,position,delay_minutes,subject,body_md,enabled) VALUES($1,1,0,'Requested result','Your result',true),($1,2,2880,'Sales','An offer',true)",[q]);
  const sub=(await db.client.query("INSERT INTO sequence_subscriptions(sequence_id,contact_id,status,position,next_send_at) VALUES($1,$2,'active',1,'2026-11-01T12:00:00Z') RETURNING id",[q,id])).rows[0].id;
  const calls=sendMail.mock.calls.length;await send(Number(sub),new Date("2026-11-01T12:00:00Z"));expect(sendMail.mock.calls.length).toBe(calls+1);
  const rows=await subs(id);expect(rows.find(r=>r.id===sub).status).toBe("exited");expect(rows.filter(r=>r.status==='active').map(r=>r.slug)).toEqual(["quiz-hiring-ready"]);
 });

 it("preserves requested H0 delivery for a nonmarketing contact through the existing single-owner automation",async()=>{
  const id=await contact("never_subscribed");
  const {sendHiringQuizResults}=await import("./hiringQuizResults");
  const email=(await db.client.query("SELECT email FROM contacts WHERE id=$1",[id])).rows[0].email;
  // The seed has exact production H0 automations and source wording.
  expect(await sendHiringQuizResults({formSlug:"hiring-quiz-ready",email,contactId:id,submissionId:1})).toBe(true);
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining("write down what you want this hire")}));
  expect((await db.client.query("SELECT status FROM email_messages WHERE contact_id=$1 AND topic='hiring_quiz_result'",[id])).rows[0].status).toBe("sent");
  expect((await db.client.query("SELECT status FROM automations WHERE name='Hiring quiz result email — Ready'")).rows[0].status).toBe("active");
 });

 it("uses one durable automation action for H0 and does not send again on event replay",async()=>{
  const id=await contact("never_subscribed");const email=(await db.client.query("SELECT email FROM contacts WHERE id=$1",[id])).rows[0].email;
  const form=(await db.client.query("SELECT id FROM forms WHERE slug='hiring-quiz-ready'")).rows[0].id;
  const {fireTrigger}=await import("../automations/engineV2");
  const calls=sendMail.mock.calls.length;
  const event={eventKey:"form-submitted:9001001",contactId:id,email,subjectId:form};
  await fireTrigger("form_submitted",event,{rethrow:true});await fireTrigger("form_submitted",event,{rethrow:true});
  expect(sendMail.mock.calls.length).toBe(calls+1);
 });

 it("records a non-opt-in legacy requested result as sent, with no later marketing delivery",async()=>{
  const id=await contact("never_subscribed");
  const q=(await db.client.query("SELECT id FROM email_sequences WHERE slug='fixture-quiz'")).rows[0].id;
  const sub=(await db.client.query("INSERT INTO sequence_subscriptions(sequence_id,contact_id,status,position,next_send_at) VALUES($1,$2,'active',1,'2026-11-01T12:00:00Z') RETURNING id",[q,id])).rows[0].id;
  await send(Number(sub),new Date("2026-11-01T12:00:00Z"));
  expect((await db.client.query("SELECT status FROM email_messages WHERE contact_id=$1 AND topic='legacy_quiz_result'",[id])).rows[0].status).toBe("sent");
  const calls=sendMail.mock.calls.length;await send(Number(sub),new Date("2026-11-04T12:00:00Z"));expect(sendMail.mock.calls.length).toBe(calls);expect((await subs(id))[0].status).toBe("exited");
 });

 it("does not enroll a cached old form without explicit new marketing fields",async()=>{
  const id=await contact();await route(id,"hiring-quiz-ready",{practice_stage:"first_hire"});expect(await subs(id)).toHaveLength(0);
 });

 it("queues a newly enrolled immediate legacy result after its transaction commits",async()=>{
  const id=await contact("never_subscribed");const q=(await db.client.query("SELECT id FROM email_sequences WHERE slug='fixture-quiz'")).rows[0].id;
  const {enrollContact}=await import("./sequences");const result=await enrollContact(q,id);
  expect(result.outcome).toBe("enrolled");
  expect((await enrollContact(q,id)).outcome).toBe("already_enrolled");
  expect((await db.client.query("SELECT count(*)::int n FROM jobs WHERE kind='sequence.sendEmail' AND payload->>'subscriptionId'=$1",[String(result.subscriptionId)])).rows[0].n).toBe(1);
 });

 it("queues nothing when enrollment rolls back",async()=>{
  const id=await contact();const q=(await db.client.query("SELECT id FROM email_sequences WHERE slug='fixture-quiz'")).rows[0].id;
  await db.client.query("CREATE FUNCTION fixture_reject_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejects enrollment'; END $$");
  await db.client.query(`CREATE TRIGGER fixture_reject_enrollment BEFORE INSERT ON sequence_subscriptions FOR EACH ROW WHEN (NEW.contact_id=${id}) EXECUTE FUNCTION fixture_reject_enrollment()`);
  const queuedBefore=(await db.client.query("SELECT count(*)::int n FROM jobs WHERE kind='sequence.sendEmail'")).rows[0].n;
  try {
   const {enrollContact}=await import("./sequences");await expect(enrollContact(q,id)).rejects.toThrow("fixture rejects enrollment");
   expect(await subs(id)).toHaveLength(0);
   expect((await db.client.query("SELECT count(*)::int n FROM jobs WHERE kind='sequence.sendEmail'")).rows[0].n).toBe(queuedBefore);
  } finally {await db.client.query("DROP TRIGGER fixture_reject_enrollment ON sequence_subscriptions; DROP FUNCTION fixture_reject_enrollment()");}
 });

});
