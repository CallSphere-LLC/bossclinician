import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../testing/db";
const describeDb=hasTestDatabase?describe:describe.skip;
describeDb("lesson assessments (integration)",()=>{
 let db:Awaited<ReturnType<typeof createTestDatabase>>;
 let server:ReturnType<express.Express["listen"]>;
 let base:string,token:string,stranger:string;
 let memberId:number;
 let curriculum:typeof import("./curriculum");
 beforeAll(async()=>{
  db=await createTestDatabase("lesson_assessments");process.env.DATABASE_URL=db.url;process.env.JWT_SECRET="ZZ-assessment-secret";
  const {assessmentsPublicRouter}=await import("../routes/public/assessmentsPublic");
  const {adminAssessmentsRouter}=await import("../routes/admin/assessments");
  const {memberProgressRouter}=await import("../routes/member/progress");
  const {requireMember}=await import("../middleware/memberAuth");
  const {errorHandler}=await import("../middleware/errorHandler");
  const {signMemberAccessToken}=await import("../auth/memberSession");
  curriculum=await import("./curriculum");
  memberId=await insertMember(db.client,"sagar+zz-lesson-member@callsphere.ai");
  const strangerId=await insertMember(db.client,"sagar+zz-lesson-stranger@callsphere.ai");
  token=signMemberAccessToken({sub:memberId,email:"sagar+zz-lesson-member@callsphere.ai"});
  stranger=signMemberAccessToken({sub:strangerId,email:"sagar+zz-lesson-stranger@callsphere.ai"});
  const app=express();app.use(express.json());app.use("/api",assessmentsPublicRouter);app.use("/admin",adminAssessmentsRouter);app.use("/api/member",requireMember,memberProgressRouter);app.use(errorHandler);
  server=app.listen(0);await new Promise(resolve=>server.once("listening",resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 },60000);
 afterAll(async()=>{await new Promise<void>(resolve=>server?.close(()=>resolve()));await (await import("../db/pool")).pool.end();await db?.drop();});
 async function call(path:string,method="GET",data?:unknown,auth=token){const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${auth}`}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,body:await response.json() as any};}
 async function setup(kind="graded",requirePass=true){
  const slug=`zz-${kind}-${requirePass}`;const product=await insertCourseProduct(db.client,slug);
  const module=(await db.client.query(`INSERT INTO course_modules(course_id,title) VALUES($1,'ZZ Module') RETURNING id`,[product.courseId])).rows[0].id;
  const lessons=(await db.client.query(`INSERT INTO course_lessons(module_id,slug,title,content_type,published,sort,requires_previous_lesson) VALUES($1,'assessment','ZZ assessment','assessment',true,0,false),($1,'next','ZZ next','text',true,1,true) RETURNING id`,[module])).rows;
  const {grantAccess}=await import("./access");await grantAccess({memberId,productId:product.productId,source:"manual"});
  const assessment=await call("/admin","POST",{title:slug,kind,lessonId:lessons[0].id,published:true,requireEmail:false,requirePass,passMark:kind==="graded"?70:null,passMessage:"ZZ Well done",failMessage:"ZZ Review and retry"});expect(assessment.status).toBe(201);
  const question=await call(`/admin/${assessment.body.id}/questions`,"POST",{prompt:"ZZ Choose correct",kind:"single",required:true});
  const yes=await call(`/admin/questions/${question.body.id}/answers`,"POST",{label:"ZZ correct",isCorrect:true});
  const no=await call(`/admin/questions/${question.body.id}/answers`,"POST",{label:"ZZ wrong",isCorrect:false});
  expect(yes.status).toBe(201);expect(no.status).toBe(201);
  return {product,lessonId:lessons[0].id,nextLessonId:lessons[1].id,assessment:assessment.body,questionId:question.body.id,yes:yes.body.id,no:no.body.id};
 }
 it("records fail then pass, enforces ownership and completion gating, persists member/admin results and both automation events",async()=>{
  const c=await setup();await db.client.query(`UPDATE course_lessons SET requires_previous_lesson=false WHERE id=$1`,[c.nextLessonId]);const path=`/api/assessments/${c.assessment.slug}`;
  expect((await call(path,"GET",undefined,"")).status).toBe(403);
  expect((await call(path,"GET",undefined,stranger)).status).toBe(404);
  expect((await call(`/api/member/lessons/${c.nextLessonId}/complete`,"POST",{})).status).toBe(403);
  const editor=await call(`/admin/${c.assessment.id}`);expect(editor.body).toMatchObject({courseId:c.product.courseId,lessonPublished:true});
  const definition=await call(path);expect(definition.status).toBe(200);expect(JSON.stringify(definition.body)).not.toContain("isCorrect");
  expect((await call(`/api/member/lessons/${c.lessonId}/complete`,"POST",{})).status).toBe(403);
  await db.client.query(`UPDATE assessments SET published=false WHERE id=$1`,[c.assessment.id]);
  expect((await call(`/api/member/lessons/${c.lessonId}/complete`,"POST",{})).status).toBe(403);
  await db.client.query(`UPDATE assessments SET published=true WHERE id=$1`,[c.assessment.id]);
  const failed=await call(path+"/submit","POST",{responses:[{questionId:c.questionId,answerIds:[c.no]}],elapsedMs:3000});
  expect(failed.status).toBe(201);expect(failed.body).toMatchObject({passed:false,message:"ZZ Review and retry"});
  expect((await curriculum.loadCourseForMember(memberId,c.product.courseId))?.modules[0].lessons[1].unlocked).toBe(false);
  expect((await call(`/api/member/lessons/${c.lessonId}/complete`,"POST",{})).status).toBe(403);
  const passed=await call(path+"/submit","POST",{responses:[{questionId:c.questionId,answerIds:[c.yes]}],elapsedMs:3000});expect(passed.body).toMatchObject({passed:true,percent:100,message:"ZZ Well done"});
  expect((await curriculum.loadCourseForMember(memberId,c.product.courseId))?.modules[0].lessons[1].unlocked).toBe(true);
  const history=await call(path+"/my-results");expect(history.body).toHaveLength(2);expect(history.body[0].passed).toBe(true);
  const attempts=await call(`/admin/${c.assessment.id}/attempts`);expect(attempts.body).toHaveLength(2);expect(attempts.body[0].memberId).toBe(memberId);expect(attempts.body[0].responses[0].answerIds).toEqual([c.yes]);
  const events=(await db.client.query(`SELECT event_type,count(*)::int AS n FROM domain_events WHERE subject_id=$1 GROUP BY event_type`,[c.assessment.id])).rows;
  expect(events).toEqual(expect.arrayContaining([{event_type:"assessment_completed",n:2},{event_type:"assessment_passed",n:1}]));
 });
 it("allows submission without a pass when configured, and survey responses have no pass mark",async()=>{
  const c=await setup("graded",false);const path=`/api/assessments/${c.assessment.slug}`;
  expect((await call(path+"/submit","POST",{responses:[{questionId:c.questionId,answerIds:[c.no]}],elapsedMs:3000})).body.passed).toBe(false);
  expect((await curriculum.loadCourseForMember(memberId,c.product.courseId))?.modules[0].lessons[1].unlocked).toBe(true);
  const survey=await setup("survey",false);const surveyPath=`/api/assessments/${survey.assessment.slug}`;
  const responses:any[]=[{questionId:survey.questionId,answerIds:[survey.yes]}];
  for(const kind of ["multiple","scale","text"]){
   const question=await call(`/admin/${survey.assessment.id}/questions`,"POST",{prompt:`ZZ ${kind}`,kind,required:true});
   if(kind==="text")responses.push({questionId:question.body.id,text:"ZZ response"});
   else {const answer=await call(`/admin/questions/${question.body.id}/answers`,"POST",{label:"ZZ option"});responses.push({questionId:question.body.id,answerIds:[answer.body.id]});}
  }
  expect((await call(`/admin/${survey.assessment.id}`,"PATCH",{passMark:80,requirePass:true})).status).toBe(200);
  const definition=await call(surveyPath);expect(definition.body.passMark).toBeNull();expect(definition.body.requirePass).toBe(false);expect(definition.body.questions.map((q:any)=>q.kind)).toEqual(["single","multiple","scale","text"]);
  const submitted=await call(surveyPath+"/submit","POST",{responses,elapsedMs:3000});expect(submitted.status).toBe(201);expect(submitted.body.passed).toBeNull();
  expect((await call(surveyPath+"/my-results")).body[0].responses).toHaveLength(4);
  expect((await curriculum.loadCourseForMember(memberId,survey.product.courseId))?.modules[0].lessons[1].unlocked).toBe(true);
  expect((await db.client.query(`SELECT count(*)::int AS n FROM domain_events WHERE subject_id=$1 AND event_type='assessment_passed'`,[survey.assessment.id])).rows[0].n).toBe(0);
 });
});
