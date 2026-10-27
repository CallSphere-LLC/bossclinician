import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, hasTestDatabase, insertCourseProduct } from '../testing/db';
const sendEmail = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => ({outcome:'sent',messageId:1})));
vi.mock('../email/provider', async original => ({...await original<typeof import('../email/provider')>(),sendEmail}));
const migration=fs.readFileSync(path.join(__dirname,'../db/migrations/164_boss_move_pass_confirmation.sql'),'utf8');
const name='Boss Move Post Exam - pass confirmation (BC191)';
(hasTestDatabase ? describe : describe.skip)('Boss Move pass confirmation rollout',()=>{
  let db:Awaited<ReturnType<typeof createTestDatabase>>;
  let assessmentId:number,oldAttempt:number,newAttempt:number,automationId:number,contactId:number,importedId:number;
  let missingTargetCount:number;
  let events:typeof import('./domainEvents');
  beforeAll(async()=>{
    db=await createTestDatabase('bc191_pass_email');process.env.DATABASE_URL=db.url;
    missingTargetCount=Number((await db.client.query('SELECT count(*) FROM automations WHERE name=$1',[name])).rows[0].count);
    await db.client.query("UPDATE courses SET slug='zz-preexisting-boss-move' WHERE slug='the-boss-move'");
    await db.client.query("UPDATE assessments SET slug='zz-preexisting-boss-move-post-exam' WHERE slug='the-boss-move-post-exam'");
    const course=await insertCourseProduct(db.client,'the-boss-move');
    const moduleId=(await db.client.query("INSERT INTO course_modules(course_id,title) VALUES($1,'QA module') RETURNING id",[course.courseId])).rows[0].id;
    const lessonId=(await db.client.query("INSERT INTO course_lessons(module_id,slug,title,content_type,published) VALUES($1,'post-exam','QA exam','assessment',true) RETURNING id",[moduleId])).rows[0].id;
    assessmentId=(await db.client.query("INSERT INTO assessments(slug,title,kind,lesson_id,published,pass_mark,require_pass) VALUES('the-boss-move-post-exam','QA Post Exam','graded',$1,true,75,true) RETURNING id",[lessonId])).rows[0].id;
    contactId=(await db.client.query("INSERT INTO contacts(email) VALUES('bc191@example.invalid') RETURNING id")).rows[0].id;
    oldAttempt=Number((await db.client.query("INSERT INTO assessment_attempts(assessment_id,contact_id,email,responses,score,max_score,percent,passed) VALUES($1,$2,'bc191@example.invalid','[]',1,1,100,true) RETURNING id",[assessmentId,contactId])).rows[0].id);
    importedId=(await db.client.query("INSERT INTO automations(name,status,trigger_type,trigger_config) VALUES('QA imported sequence','paused','assessment_passed','{\"assessmentId\":-1}') RETURNING id")).rows[0].id;
    await db.client.query("INSERT INTO automation_actions(automation_id,action_type,config) VALUES($1,'subscribe_sequence','{\"sequenceId\":483}')",[importedId]);
    await db.client.query(migration);
    automationId=(await db.client.query('SELECT id FROM automations WHERE name=$1',[name])).rows[0].id;
    events=await import('./domainEvents');
  },60000);
  afterAll(async()=>{await (await import('../db/pool')).pool.end();await db?.drop();});
  async function dispatch(type:'assessment_passed'|'assessment_completed',key:string,subjectId:number,facts:Record<string,string|number|boolean|null>){
    const event=await events.publishDomainEvent(type,{eventKey:'bc191:'+key,contactId,email:'bc191@example.invalid',name:'QA Member',subjectId,facts});
    await events.dispatchDomainEvent({eventId:event.id});return event;
  }
  it('no-ops without exact course/exam and creates one narrowly scoped email action when present',async()=>{
    expect(missingTargetCount).toBe(0);
    const a=(await db.client.query('SELECT status,trigger_type,trigger_config FROM automations WHERE id=$1',[automationId])).rows[0];
    expect(a).toEqual({status:'active',trigger_type:'assessment_passed',trigger_config:{assessmentId,minimumAttemptId:oldAttempt+1}});
    expect((await db.client.query('SELECT action_type FROM automation_actions WHERE automation_id=$1',[automationId])).rows).toEqual([{action_type:'send_email'}]);
    expect((await db.client.query('SELECT status,trigger_config FROM automations WHERE id=$1',[importedId])).rows[0]).toEqual({status:'paused',trigger_config:{assessmentId:-1}});
  });
  it('sends nothing for historical/missing attempts, wrong assessment, failure or survey completion',async()=>{
    await dispatch('assessment_passed','old',assessmentId,{attemptId:oldAttempt,passed:true});
    await dispatch('assessment_passed','missing',assessmentId,{passed:true});
    await dispatch('assessment_passed','other',assessmentId+1,{attemptId:oldAttempt+1,passed:true});
    await dispatch('assessment_passed','false-pass',assessmentId,{attemptId:oldAttempt+1,passed:false});
    await dispatch('assessment_completed','failed',assessmentId,{attemptId:oldAttempt+1,passed:false});
    await dispatch('assessment_completed','survey',assessmentId+1,{attemptId:oldAttempt+1,passed:false});
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('confirms a new pass without course completion or a certificate and deduplicates replay',async()=>{
    newAttempt=Number((await db.client.query("INSERT INTO assessment_attempts(assessment_id,contact_id,email,responses,score,max_score,percent,passed) VALUES($1,$2,'bc191@example.invalid','[]',1,1,100,true) RETURNING id",[assessmentId,contactId])).rows[0].id);
    const event=await dispatch('assessment_passed','new',assessmentId,{attemptId:newAttempt,passed:true});
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({subject:'You passed The Boss Move Post Exam'});
    expect(sendEmail.mock.calls[0][0].text).toContain('https://www.bossclinician.com/library/the-boss-move/lessons/post-exam');
    expect(sendEmail.mock.calls[0][0].text).toContain('certificate is issued separately');
    expect((await db.client.query('SELECT count(*)::int AS n FROM certificates')).rows[0].n).toBe(0);
    await events.dispatchDomainEvent({eventId:event.id});
    const {fireTrigger}=await import('../automations/engineV2');
    await fireTrigger('assessment_passed',{eventKey:'bc191:new',contactId,email:'bc191@example.invalid',subjectId:assessmentId,facts:{attemptId:newAttempt,passed:true}},{rethrow:true});
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it('migration replay retains its original cutoff and later owner pause/content edits',async()=>{
    await db.client.query("UPDATE automations SET status='paused' WHERE id=$1",[automationId]);
    await db.client.query("UPDATE automation_actions SET config=jsonb_set(config,'{subject}','\"Owner edit\"') WHERE automation_id=$1",[automationId]);
    await db.client.query(migration);
    const rows=(await db.client.query('SELECT id,status,trigger_config FROM automations WHERE name=$1',[name])).rows;
    expect(rows).toEqual([{id:automationId,status:'paused',trigger_config:{assessmentId,minimumAttemptId:oldAttempt+1}}]);
    expect((await db.client.query("SELECT config->>'subject' AS subject FROM automation_actions WHERE automation_id=$1",[automationId])).rows).toEqual([{subject:'Owner edit'}]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
