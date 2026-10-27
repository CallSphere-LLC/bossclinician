import type { Server } from "http";
import type { AddressInfo } from "net";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember } from "../testing/db";

vi.mock("../email/mailer", () => ({ sendMail: vi.fn().mockResolvedValue({sent:false}) }));
const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb("189–191: certificate viewing, scoped exceptions and phase routes", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server, base: string, admin: string, support: string, token: string, otherToken: string, impersonation: string;
  let member: number, other: number, adminId: number;
  let sequence = 0;
  let curriculum: typeof import("./curriculum");
  let certificates: typeof import("./certificates");
  beforeAll(async () => {
    db = await createTestDatabase("watch189191");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = "watch189191-test-only";
    process.env.WORKER_ENABLED = "false";
    const { createApp } = await import("../app");
    const { signToken } = await import("../utils/jwt");
    const { hashToken } = await import("../auth/tokens");
    const { signMemberAccessToken } = await import("../auth/memberSession");
    curriculum = await import("./curriculum");
    certificates = await import("./certificates");
    for (const role of ["owner","support"] as const) {
      const email = `zz-watch-${role}@example.test`;
      const id = (await db.client.query("INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,'unused','Test',$2) RETURNING id", [email,role])).rows[0].id;
      const jwt = signToken({sub:id,email,role});
      await db.client.query("INSERT INTO admin_sessions(admin_user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id,hashToken(jwt)]);
      if (role === "owner") { admin = jwt; adminId = id; } else support = jwt;
    }
    member = await insertMember(db.client, "zz-watch-member@example.test");
    other = await insertMember(db.client, "zz-watch-other@example.test");
    token = signMemberAccessToken({sub:member,email:"zz-watch-member@example.test"});
    otherToken = signMemberAccessToken({sub:other,email:"zz-watch-other@example.test"});
    impersonation = signMemberAccessToken({sub:member,email:"zz-watch-member@example.test",impersonatedBy:adminId});
    server = createApp().listen(0);
    await new Promise(resolve => server.once("listening",resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()));
    await (await import("../db/pool")).pool.end();
    await db?.drop();
  });
  async function call(path: string, method="GET", body?: unknown, auth=token) {
    const response = await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(auth?{Authorization:`Bearer ${auth}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json() as any};
  }
  async function fixture(duration=100, enabled=true) {
    const slug = `zz-watch-${++sequence}`;
    const product = await insertCourseProduct(db.client,slug);
    const mod = (await db.client.query("INSERT INTO course_modules(course_id,title) VALUES($1,'Phase 1') RETURNING id",[product.courseId])).rows[0].id;
    // Deliberately mislabeled text: actual media, not the label, determines viewing.
    const lesson = (await db.client.query(`INSERT INTO course_lessons(module_id,slug,title,published,content_type,video_url,video_duration_seconds)
      VALUES($1,'video','First video',true,'text','https://example.test/video.mp4',$2) RETURNING id`,[mod,duration])).rows[0].id;
    const next = (await db.client.query("INSERT INTO course_lessons(module_id,slug,title,published,sort) VALUES($1,'next','Next lesson',true,1) RETURNING id",[mod])).rows[0].id;
    await db.client.query("INSERT INTO certificate_templates(course_id,title,enabled,ceu_credit_quarter_hours) VALUES($1,'Test certificate',$2,4)",[product.courseId,enabled]);
    const { grantAccess } = await import("./access");
    for (const id of [member,other]) await grantAccess({memberId:id,productId:product.productId,source:"manual"});
    return {...product,slug:`p-${slug}`,lesson,next,mod};
  }
  const complete = (id:number, auth=token) => call(`/api/member/lessons/${id}/complete`,"POST",{},auth);
  const exemption = (course:number,who=member,exempt=true,auth=admin,reason="Verified prior Kajabi viewing evidence") =>
    call(`/api/admin/courses/${course}/watch-exemptions/${who}`,"PUT",{exempt,reason},auth);

  it("requires viewing with flag false and enabled certificate, even mislabeled media and old completion ticks",async()=>{
    const f=await fixture();
    expect((await db.client.query("SELECT require_full_video FROM courses WHERE id=$1",[f.courseId])).rows[0].require_full_video).toBe(false);
    expect((await complete(f.lesson)).status).toBe(403);
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,completed_at) VALUES($1,$2,now())",[member,f.lesson]);
    expect((await complete(f.lesson)).status).toBe(403);
    const course=await curriculum.loadCourseForMember(member,f.courseId);
    expect(course!.modules[0].lessons[0]).toMatchObject({completed:false,fullWatch:{required:true}});
    expect(course!.modules[0].lessons[1].unlocked).toBe(false);
    expect((await curriculum.recomputeCourseProgress(member,f.courseId)).percent).toBe(0);
    const ping=await call(`/api/member/lessons/${f.lesson}/progress`,"POST",{positionSeconds:100,watchedPercent:100,playedToSeconds:100});
    expect(ping.status).toBe(200);
    expect(ping.body.completed).toBe(false);
    expect(ping.body.fullWatch.playedToSeconds).toBeLessThan(95);
    const status=await certificates.certificateStatus(member,f.courseId);
    expect(status).toMatchObject({eligible:false,nextRequiredLesson:{id:f.lesson},videosToFinish:[{lessonTitle:"First video"}]});
    expect(await certificates.issueCertificateIfEarned(member,f.courseId)).toBeNull();
  });
  it("uses 95% contiguous boundary, unknown duration 90%, and preserves noncertificate opt-out",async()=>{
    const f=await fixture();
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,max_position_seconds,watched_percent) VALUES($1,$2,94,100)",[member,f.lesson]);
    expect((await complete(f.lesson)).status).toBe(403);
    await db.client.query("UPDATE lesson_progress SET max_position_seconds=95 WHERE member_id=$1 AND lesson_id=$2",[member,f.lesson]);
    expect((await complete(f.lesson)).status).toBe(200);
    expect((await curriculum.loadCourseForMember(member,f.courseId))!.modules[0].lessons[1].unlocked).toBe(true);
    const unknown=await fixture(0);
    expect((await complete(unknown.lesson)).status).toBe(403);
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,watched_percent) VALUES($1,$2,89)",[member,unknown.lesson]);
    expect((await complete(unknown.lesson)).status).toBe(403);
    await db.client.query("UPDATE lesson_progress SET watched_percent=90 WHERE member_id=$1 AND lesson_id=$2",[member,unknown.lesson]);
    expect((await complete(unknown.lesson)).status).toBe(200);
    const ordinary=await fixture(100,false);
    expect((await complete(ordinary.lesson)).status).toBe(200);
    await db.client.query("UPDATE courses SET require_full_video=true WHERE id=$1",[ordinary.courseId]);
    expect((await complete(ordinary.lesson,otherToken)).status).toBe(403);
  });
  it("authorizes an individual exception, audits before/after atomically, isolates member/course, and never manufactures progress",async()=>{
    const f=await fixture(), second=await fixture();
    expect((await db.client.query("SELECT count(*)::int n FROM course_watch_exemptions")).rows[0].n).toBe(0);
    expect((await exemption(f.courseId,member,true,"")).status).toBe(403);
    expect((await exemption(f.courseId,member,true,token)).status).toBe(401);
    expect((await exemption(f.courseId,member,true,support)).status).toBe(403);
    expect((await exemption(f.courseId,member,true,admin,"short")).status).toBe(400);
    const outsider=await insertMember(db.client,"zz-watch-outsider@example.test");
    expect((await exemption(f.courseId,outsider)).status).toBe(404);
    expect((await call(`/api/admin/courses/${f.courseId}/watch-exemptions/${member}`,"PUT",{exempt:true,reason:"Verified evidence",memberId:other},admin)).status).toBe(400);
    expect((await exemption(f.courseId)).status).toBe(200);
    const counts=(await db.client.query("SELECT (SELECT count(*) FROM lesson_progress WHERE member_id=$1 AND lesson_id=$2)::int progress,(SELECT count(*) FROM certificates WHERE member_id=$1 AND course_id=$3)::int certificates",[member,f.lesson,f.courseId])).rows[0];
    expect(counts).toEqual({progress:0,certificates:0});
    expect((await curriculum.loadCourseForMember(member,f.courseId))!.modules[0].lessons[0].fullWatch.required).toBe(false);
    expect((await curriculum.loadCourseForMember(other,f.courseId))!.modules[0].lessons[0].fullWatch.required).toBe(true);
    expect((await curriculum.loadCourseForMember(member,second.courseId))!.modules[0].lessons[0].fullWatch.required).toBe(true);
    expect((await complete(f.lesson,impersonation)).status).toBe(403);
    expect((await complete(f.lesson)).status).toBe(200);
    expect((await complete(f.lesson,otherToken)).status).toBe(403);
    expect((await certificates.certificateStatus(member,f.courseId)).videosToFinish).toEqual([]);
    expect((await exemption(f.courseId,member,false)).status).toBe(200);
    expect((await complete(f.lesson)).status).toBe(403);
    const logs=(await db.client.query("SELECT action,admin_user_id,before_state,after_state FROM admin_audit_log WHERE entity_type='course_watch_exemption' AND entity_id=$1 ORDER BY id",[`${f.courseId}:${member}`])).rows;
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({action:"course.watch_exempt",admin_user_id:adminId,before_state:null,after_state:{member_id:member,course_id:f.courseId}});
    expect(logs[1].after_state.revoked_at).not.toBeNull();
    // Inject an audit failure only in this throwaway schema: no exemption may commit.
    await db.client.query("ALTER TABLE admin_audit_log ADD CONSTRAINT zz_reject_watch_audit CHECK(action <> 'course.watch_exempt') NOT VALID");
    expect((await exemption(second.courseId)).status).toBe(500);
    expect((await db.client.query("SELECT * FROM course_watch_exemptions WHERE course_id=$1",[second.courseId])).rows).toHaveLength(0);
    await db.client.query("ALTER TABLE admin_audit_log DROP CONSTRAINT zz_reject_watch_audit");
  });
  it("keeps all five duplicate phase lessons addressable with the correct check-in next, without unlocking them",async()=>{
    const f=await fixture(100,false);
    await db.client.query("DELETE FROM course_lessons WHERE module_id=$1",[f.mod]);
    const ids:number[]=[];
    for(let phase=1;phase<=5;phase++) {
      const mod=(await db.client.query("INSERT INTO course_modules(course_id,title,sort) VALUES($1,$2,$3) RETURNING id",[f.courseId,`Phase ${phase}`,phase])).rows[0].id;
      const lesson=(await db.client.query("INSERT INTO course_lessons(module_id,slug,title,published,requires_previous_lesson) VALUES($1,'mindset-mastery','Mindset Mastery',true,$2) RETURNING id",[mod,phase>1])).rows[0].id;
      ids.push(lesson);
      await db.client.query("INSERT INTO course_lessons(module_id,slug,title,published,sort) VALUES($1,$2,$3,true,1)",[mod,`check-in-${phase}`,`Check in ${phase}`]);
    }
    const outline=await curriculum.loadCourseForMember(member,f.courseId);
    const lessons=curriculum.flattenLessons(outline!.modules).filter(l=>ids.includes(l.id));
    expect(new Set(lessons.map(l=>l.slug)).size).toBe(5);
    expect(lessons[0].slug).toBe("mindset-mastery");
    for(let i=0;i<lessons.length;i++) {
      const result=await call(`/api/member/library/${f.slug}/lessons/${lessons[i].slug}`);
      expect(result.status).toBe(200);
      expect(result.body.lesson.id).toBe(ids[i]);
      expect(result.body.next.slug).toBe(`check-in-${i+1}`);
      expect(Boolean(result.body.lesson.locked)).toBe(i>0);
    }
    // Finish a phase prerequisite only in the fixture; phase2 now resolves to its own unlocked lesson.
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,completed_at) SELECT $1,l.id,now() FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE m.course_id=$2 AND m.sort=1 ON CONFLICT(member_id,lesson_id) DO UPDATE SET completed_at=now()",[member,f.courseId]);
    const phase2=await call(`/api/member/library/${f.slug}/lessons/${lessons[1].slug}`);
    expect(phase2.body.lesson).toMatchObject({id:ids[1],locked:false,moduleTitle:"Phase 2"});
    expect(phase2.body.next.slug).toBe("check-in-2");
    // A literal slug that resembles our generated suffix must remain addressable.
    await db.client.query("INSERT INTO course_lessons(module_id,slug,title,published,sort) VALUES($1,$2,'Reserved slug',true,99)",[f.mod,`mindset-mastery--lesson-${ids[1]}`]);
    const collision=curriculum.flattenLessons((await curriculum.loadCourseForMember(member,f.courseId))!.modules);
    expect(new Set(collision.map(l=>l.slug)).size).toBe(collision.length);
    const disambiguated=collision.find(l=>l.id===ids[1])!;
    expect(disambiguated.slug).toBe(`mindset-mastery--lesson-${ids[1]}-1`);
    expect((await call(`/api/member/library/${f.slug}/lessons/${disambiguated.slug}`)).body.lesson.id).toBe(ids[1]);
    await db.client.query("UPDATE course_lessons SET slug=$1 WHERE id=ANY($2::int[])",["a".repeat(200),ids]);
    const longSlugs=curriculum.flattenLessons((await curriculum.loadCourseForMember(member,f.courseId))!.modules).filter(l=>ids.includes(l.id));
    expect(longSlugs.every(l=>l.slug.length<=200)).toBe(true);
    expect((await call(`/api/member/library/${f.slug}/lessons/${longSlugs[1].slug}`)).body.lesson.id).toBe(ids[1]);
    const stranger=await insertMember(db.client,"zz-route-stranger@example.test");
    const {signMemberAccessToken}=await import("../auth/memberSession");
    expect((await call(`/api/member/library/${f.slug}/lessons/${lessons[1].slug}`,"GET",undefined,signMemberAccessToken({sub:stranger,email:"zz-route-stranger@example.test"}))).status).toBe(404);
  });
  it("keeps exam, survey and remaining lessons independent, including when prior viewing is exempt",async()=>{
    const f=await fixture();
    await db.client.query("UPDATE certificate_templates SET product_id=$2,course_id=NULL WHERE course_id=$1",[f.courseId,f.productId]);
    expect((await complete(f.lesson)).status).toBe(403); // Product-linked templates count too.
    await db.client.query("UPDATE course_lessons SET content_type='assessment',title='Post exam' WHERE id=$1",[f.next]);
    const evaluation=(await db.client.query("INSERT INTO course_lessons(module_id,slug,title,content_type,published,sort) VALUES($1,'evaluation','Evaluation','assessment',true,2) RETURNING id",[f.mod])).rows[0].id;
    const exam=(await db.client.query("INSERT INTO assessments(slug,title,kind,lesson_id,published,pass_mark,require_pass) VALUES($1,'Post exam','graded',$2,true,75,true) RETURNING id",[`exam-${f.courseId}`,f.next])).rows[0].id;
    const survey=(await db.client.query("INSERT INTO assessments(slug,title,kind,lesson_id,published) VALUES($1,'Evaluation','survey',$2,true) RETURNING id",[`evaluation-${f.courseId}`,evaluation])).rows[0].id;
    await db.client.query("INSERT INTO assessment_attempts(assessment_id,member_id,passed,percent,completed_at) VALUES($1,$3,true,100,now()),($2,$3,NULL,0,now())",[exam,survey,member]);
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,completed_at) VALUES($1,$2,now()),($1,$3,now())",[member,f.next,evaluation]);
    const pending=await certificates.certificateStatus(member,f.courseId);
    expect(pending).toMatchObject({eligible:false,lessonsRemaining:1,quizzesToPass:[],evaluationsToSubmit:[],nextRequiredLesson:{id:f.lesson}});
    expect(await certificates.issueCertificateIfEarned(member,f.courseId)).toBeNull();
    expect((await exemption(f.courseId)).status).toBe(200);
    expect((await certificates.certificateStatus(member,f.courseId)).eligible).toBe(false); // no fabricated tick
    // Explicit synthetic lesson completion: test eligibility only, never issue.
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,completed_at) VALUES($1,$2,now())",[member,f.lesson]);
    expect((await certificates.certificateStatus(member,f.courseId)).eligible).toBe(true);
    await db.client.query("UPDATE assessment_attempts SET passed=false,percent=50 WHERE member_id=$1 AND assessment_id=$2",[member,exam]);
    expect((await certificates.certificateStatus(member,f.courseId)).quizzesToPass).toHaveLength(1);
    await db.client.query("DELETE FROM assessment_attempts WHERE member_id=$1 AND assessment_id=$2",[member,survey]);
    expect((await certificates.certificateStatus(member,f.courseId)).evaluationsToSubmit).toEqual(["Evaluation"]);
    expect(await certificates.issueCertificateIfEarned(member,f.courseId)).toBeNull();
  });
  it("does not revoke or replace an already issued certificate when viewing policy is tightened",async()=>{
    const f=await fixture();
    await db.client.query("INSERT INTO certificates(member_id,course_id,verification_code,recipient_name,course_title,completed_at) VALUES($1,$2,'zz-existing-watch','Test','Historic',now())",[member,f.courseId]);
    expect((await certificates.certificateStatus(member,f.courseId)).issued).toBe(true);
    expect((await certificates.issueCertificateIfEarned(member,f.courseId))?.verification_code).toBe("zz-existing-watch");
    expect((await db.client.query("SELECT revoked_at FROM certificates WHERE verification_code='zz-existing-watch'")).rows[0].revoked_at).toBeNull();
    const {sendMail}=await import("../email/mailer");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
