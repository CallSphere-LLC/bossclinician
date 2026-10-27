import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { createTestDatabase, hasTestDatabase } from "../testing/db";
const sendEmail=vi.hoisted(()=>vi.fn(async (_input: Record<string,unknown>)=>({outcome:"sent",messageId:1})));
vi.mock("../email/provider",async importOriginal=>({...await importOriginal<typeof import("../email/provider")>(),sendEmail}));
const describeDb = hasTestDatabase ? describe : describe.skip;
const old="https://bossclinician.callsphere.site";
const site="https://www.bossclinician.com";
const migration=fs.readFileSync(path.join(__dirname,"../db/migrations/162_canonical_email_links.sql"),"utf8");
describeDb("canonical email link migration and replay (isolated database)", () => {
  let db:Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async()=>{db=await createTestDatabase("bc192_email_links");process.env.DATABASE_URL=db.url;process.env.PUBLIC_SITE_URL=old;},60000);
  afterAll(async()=>{await (await import("../db/pool")).pool.end();await db?.drop();});
  it("repairs original CWC pass/fail template bodies from migration 104",async()=>{
    const original=fs.readFileSync(path.join(__dirname,"../db/migrations/104_lesson_assessments.sql"),"utf8");
    const templates=[...original.matchAll(/\$au\$(\{.*?\})\$au\$::jsonb/gs)].map(m=>JSON.parse(m[1])).filter(x=>typeof x.bodyMd==='string' && x.bodyMd.includes('/credential-with-confidence-quiz'));
    expect(templates).toHaveLength(2);
    const a=(await db.client.query(`INSERT INTO automations(name,status,trigger_type) VALUES('ZZ original CWC bodies','active','assessment_passed') RETURNING id`)).rows[0].id;
    for(const config of templates)await db.client.query(`INSERT INTO automation_actions(automation_id,action_type,config) VALUES($1,'send_email',$2)`,[a,JSON.stringify(config)]);
    await db.client.query(migration);
    const rows=(await db.client.query(`SELECT config->>'bodyMd' AS body FROM automation_actions WHERE automation_id=$1`,[a])).rows;
    expect(rows).toHaveLength(2);
    for(const r of rows){expect(r.body).toContain(site+"/library/credential-with-confidence/lessons/credential-with-confidence-quiz");expect(r.body).not.toContain(old);}
  });
  it("changes only exact body URL tokens, preserves state/config/recipients, and is idempotent",async()=>{
    const a=(await db.client.query(`INSERT INTO automations(name,status,trigger_type) VALUES('ZZ BC192','paused','assessment_passed') RETURNING id`)).rows[0].id;
    const body=`[Course](${old}/library?token=a%2B%2F%3D#saved) <a href="http://bossclinician.callsphere.site:80/account/certificates">Get</a> ${old}.evil.test/a https://external.test/?next=${old}/library mailto:help@bossclinician.callsphere.site https://user@bossclinician.callsphere.site/a https://bossclinician.callsphere.site:80/a`;
    const expected=body.replace(`[Course](${old}/library`, `[Course](${site}/library`).replace("http://bossclinician.callsphere.site:80/account", site+"/account");
    const config={bodyMd:body,subject:"ZZ unchanged",fromEmail:"qa@example.test",custom:{url:old+"/keep"},topic:"product"};
    const id=(await db.client.query(`INSERT INTO automation_actions(automation_id,action_type,config) VALUES($1,'send_email',$2) RETURNING id`,[a,JSON.stringify(config)])).rows[0].id;
    const other=(await db.client.query(`INSERT INTO automation_actions(automation_id,action_type,config) VALUES($1,'fire_webhook',$2) RETURNING id`,[a,JSON.stringify(config)])).rows[0].id;
    await db.client.query(`INSERT INTO email_templates(key,name,subject,body_md,enabled) VALUES('zz_bc192','ZZ template','ZZ subject',$1,false)`,[body]);
    await db.client.query(migration);
    const read=async()=>({action:(await db.client.query(`SELECT config FROM automation_actions WHERE id=$1`,[id])).rows[0].config,other:(await db.client.query(`SELECT config FROM automation_actions WHERE id=$1`,[other])).rows[0].config,state:(await db.client.query(`SELECT status,run_count FROM automations WHERE id=$1`,[a])).rows[0],template:(await db.client.query(`SELECT subject,body_md,enabled FROM email_templates WHERE key='zz_bc192'`)).rows[0]});
    const once=await read();expect(once.action).toEqual({...config,bodyMd:expected});expect(once.other).toEqual(config);expect(once.state).toEqual({status:"paused",run_count:0});expect(once.template).toEqual({subject:"ZZ subject",body_md:expected,enabled:false});
    await db.client.query(migration);expect(await read()).toEqual(once);
  });
  it("canonicalizes future/queued automation bodies after token merge and deduplicates event replay without delivery",async()=>{
    const {runAutomation}=await import("../automations/engineV2");
    const contact=(await db.client.query(`INSERT INTO contacts(email) VALUES('bc192@example.test') RETURNING id`)).rows[0].id;
    const a=(await db.client.query(`INSERT INTO automations(name,status,trigger_type) VALUES('ZZ runtime CWC','active','assessment_passed') RETURNING id`)).rows[0].id;
    const config={subject:'Result {{firstName}}',bodyMd:'[Saved result]({{lessonUrl}}) '+old+'/account/certificates',topic:'product'};
    await db.client.query(`INSERT INTO automation_actions(automation_id,action_type,config) VALUES($1,'send_email',$2)`,[a,JSON.stringify(config)]);
    const input={automationId:a,context:{trigger:'assessment_passed' as const,contactId:contact,email:'bc192@example.test',name:'QA Member',subjectId:null,facts:{lessonUrl:old+'/library/course/lessons/quiz?opaque=a%2B'},eventKey:'bc192-safe-replay'}};
    expect((await runAutomation(input)).status).toBe('success');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent=sendEmail.mock.calls[0][0];expect(sent.text).toBe(`[Saved result](${site}/library/course/lessons/quiz?opaque=a%2B) ${site}/account/certificates`);
    expect(sent.html).not.toContain(old);expect(sent.subject).toBe('Result QA');
    expect((await runAutomation(input)).status).toBe('skipped');expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it("normalizes stored email overrides after merge while preserving disabled fallback behavior",async()=>{
    const {storedTemplate}=await import('../email/templateStore');
    await db.client.query(`INSERT INTO email_templates(key,name,subject,body_md,enabled) VALUES('zz_bc192_runtime','ZZ runtime','Hello {{firstName}}',$1,true)`,['[Certificate]('+old+'/account/certificates) {{lessonUrl}}']);
    const rendered=await storedTemplate('zz_bc192_runtime',{firstName:'QA',lessonUrl:old+'/library/cwc'});
    expect(rendered?.text).toBe('[Certificate]('+site+'/account/certificates) '+site+'/library/cwc');
    expect(rendered?.html).not.toContain(old);
    await db.client.query(`UPDATE email_templates SET enabled=false WHERE key='zz_bc192_runtime'`);
    expect(await storedTemplate('zz_bc192_runtime',{})).toBeNull();
  });
});
