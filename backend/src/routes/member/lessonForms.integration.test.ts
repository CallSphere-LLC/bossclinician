import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, hasTestDatabase, insertMember, insertCourseProduct } from "../../testing/db";

vi.mock("../../email/mailer", () => ({ sendMail: vi.fn() }));
const migration = fs.readFileSync(path.join(__dirname, "../../db/migrations/169_boss_move_intake_survey.sql"), "utf8");
const slug = "boss-move-intake-survey";
const welcomeSlug = "start-here-welcome-to-the-boss-clinician-club-program";
const sourceFields = [
  {
    "key": "email",
    "label": "Email",
    "type": "email",
    "required": true
  },
  {
    "key": "name",
    "label": "First and Last Name",
    "type": "text",
    "required": true
  },
  {
    "key": "practice_stage",
    "label": "What stage are you currently at in the process of starting your private practice?\nChoose as many as you like",
    "type": "checkboxes",
    "required": true,
    "options": [
      "I am brand new and have not seen any private pay clients yet",
      "I have a few clients but nothing consistent yet",
      "I am currently on a platform (Grow, Rula, Talkspace) and want to build independently",
      "I am rebuilding after leaving agency or W2 clinical work",
      "I have a practice but it is not where I want it to be yet"
    ]
  },
  {
    "key": "support",
    "label": "Which area do you feel you need the most support with?Choose as many as you like",
    "type": "checkboxes",
    "required": true,
    "options": [
      "Building a solid business foundation from the start",
      "Getting consistent clients without depending on platforms",
      "Pricing my services so I actually make real money",
      "Developing my marketing and visibility strategy",
      "Building the CEO mindset to run this like a business",
      "Creating systems so I am not doing everything manually"
    ]
  },
  {
    "key": "confidence",
    "label": "How do you currently rate your confidence in managing the business aspects of your practice?",
    "type": "radio",
    "required": true,
    "options": [
      "Very Confident",
      "Somewhat Confident",
      "Neutral",
      "Somewhat unconfident",
      "Very unconfident"
    ]
  },
  {
    "key": "enrollment_reason",
    "label": "What is your primary reason for enrolling in the Boss Clinician Club?",
    "type": "textarea",
    "required": true
  },
  {
    "key": "success_six_months",
    "label": "What does success look like for you 6 months from now?",
    "type": "textarea",
    "required": true
  }
];
const originalBody = "Owner introduction\n\n**[Have you have filled out your Intake Survey](https://forms.gle/BvNoceZw3Bn66ufRA)?**\n\nhttps://forms.gle/BvNoceZw3Bn66ufRA\n\n[Community](/community)\nOwner's newer note.";
const valid = {
  practice_stage: [sourceFields[2].options![0], sourceFields[2].options![2]],
  support: [sourceFields[3].options![1], sourceFields[3].options![3]],
  confidence: "Neutral", enrollment_reason: "Synthetic intake test", success_six_months: "Synthetic success",
};

describe.skipIf(!hasTestDatabase)("Boss Move intake: migration and native member submission", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server | undefined, base: string;
  let a: number, b: number, stranger: number, courseId: number, moduleId: number, lessonId: number, formId: number;
  let tokenA: string, tokenB: string, tokenStranger: string, tokenViewAs: string;
  let originalLesson: Record<string, unknown>;
  let pool: (typeof import("../../db/pool"))["pool"] | undefined;

  async function call(method: string, token?: string, data?: unknown) {
    const response = await fetch(base + "/lesson-forms/" + slug + (method === "POST" ? "/submit" : ""), {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      ...(method === "POST" ? { body: JSON.stringify({ data }) } : {}),
    });
    return { status: response.status, body: await response.json() as { form: { fields: unknown[]; identityFields: unknown[] }; member: {name:string;email:string}; replies: unknown[] } };
  }
  beforeAll(async () => {
    db = await createTestDatabase("native_intake_200");
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET ??= "row200-scratch-only";
    process.env.WORKER_ENABLED = "false";
    expect((await db.client.query("SELECT id FROM forms WHERE slug=$1", [slug])).rowCount).toBe(0);
    await db.client.query("UPDATE courses SET slug='seeded-boss-move-for-test' WHERE slug='the-boss-move'");
    const course = await insertCourseProduct(db.client, "the-boss-move");
    courseId = course.courseId;
    moduleId = (await db.client.query("INSERT INTO course_modules(course_id,title,sort) VALUES($1,'Welcome',0) RETURNING id", [courseId])).rows[0].id;
    lessonId = (await db.client.query(`INSERT INTO course_lessons(module_id,title,slug,body_md,content_type,video_url,published,sort)
      VALUES($1,'Welcome',$2,$3,'video','https://example.invalid/preserved.mp4',true,0) RETURNING id`,
      [moduleId, welcomeSlug, originalBody])).rows[0].id;
    originalLesson = (await db.client.query("SELECT * FROM course_lessons WHERE id=$1", [lessonId])).rows[0];
    a = await insertMember(db.client, "row200-a@example.invalid", { name: "Intake Student A" });
    b = await insertMember(db.client, "row200-b@example.invalid", { name: "Intake Student B" });
    stranger = await insertMember(db.client, "row200-stranger@example.invalid");
    for (const id of [a,b]) await db.client.query("INSERT INTO access_grants(member_id,product_id,source,status) VALUES($1,$2,'manual','active')", [id,course.productId]);
    await db.client.query("INSERT INTO lesson_progress(member_id,lesson_id,completed_at) VALUES($1,$2,now())", [a,lessonId]);
    await db.client.query(migration);
    formId = (await db.client.query("SELECT id FROM forms WHERE slug=$1", [slug])).rows[0].id;
    const { signMemberAccessToken } = await import("../../auth/memberSession");
    tokenA = signMemberAccessToken({ sub:a, email:"row200-a@example.invalid" });
    tokenB = signMemberAccessToken({ sub:b, email:"row200-b@example.invalid" });
    tokenStranger = signMemberAccessToken({ sub:stranger, email:"row200-stranger@example.invalid" });
    tokenViewAs = signMemberAccessToken({ sub:a, email:"row200-a@example.invalid", impersonatedBy:999 });
    pool = (await import("../../db/pool")).pool;
    const { default: express } = await import("express");
    const { requireMember } = await import("../../middleware/memberAuth");
    const { errorHandler } = await import("../../middleware/errorHandler");
    const { memberLessonFormsRouter } = await import("./lessonForms");
    const app = express();
    app.use(express.json(), requireMember, memberLessonFormsRouter, errorHandler);
    server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  }, 60000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve,reject) => server!.close(err => err ? reject(err) : resolve()));
    if (pool) await pool.end();
    await db?.drop();
  });

  it("matches all seven source questions and exact choices; creates no public form/email/CE gate", async () => {
    const form = (await db.client.query("SELECT * FROM forms WHERE id=$1", [formId])).rows[0];
    expect(form).toMatchObject({ name:"Boss Clinician Intake Survey", description_md:"Intake Survey Questions for the Boss Clinician Club", fields:sourceFields, published:false,create_lead:false,notify_on_submit:false });
    const lesson = (await db.client.query("SELECT * FROM course_lessons WHERE id=$1", [lessonId])).rows[0];
    const { body_md: _body, tool_key: _tool, ...unchanged } = lesson;
    const { body_md: _beforeBody, tool_key: _beforeTool, ...before } = originalLesson;
    expect(unchanged).toEqual(before);
    expect(lesson.tool_key).toBe("form-" + slug);
    expect(lesson.body_md).toBe(originalBody.replace("](https://forms.gle/BvNoceZw3Bn66ufRA)", "](#lesson-form-"+slug+")").replace("\nhttps://forms.gle/BvNoceZw3Bn66ufRA\n", "\n"));
    expect((await db.client.query("SELECT id FROM course_lessons WHERE module_id=$1", [moduleId])).rowCount).toBe(1);
    expect((await db.client.query("SELECT completed_at FROM lesson_progress WHERE member_id=$1 AND lesson_id=$2", [a,lessonId])).rows[0].completed_at).toBeTruthy();
  });

  it("requires an entitled authenticated member and shows original readonly identity labels", async () => {
    expect((await call("GET")).status).toBe(401);
    expect((await call("GET",tokenStranger)).status).toBe(404);
    expect((await call("POST",tokenStranger,valid)).status).toBe(404);
    const result = await call("GET",tokenA);
    expect(result.status).toBe(200);
    expect(result.body.form.fields).toEqual(sourceFields.slice(2));
    expect(result.body.form.identityFields).toEqual(sourceFields.slice(0,2).map(({key,label,required}) => ({key,label,required})));
    expect(result.body.member).toEqual({name:"Intake Student A",email:"row200-a@example.invalid"});
    expect((await call("GET",tokenViewAs)).status).toBe(200);
    expect((await call("POST",tokenViewAs,valid)).status).toBe(403);
  });

  it.each([
    {}, {...valid, practice_stage:[]}, {...valid, support:["fabricated choice"]},
    {...valid,confidence:["Neutral"]}, {...valid,confidence:"fabricated"},
    {...valid,enrollment_reason:"   "}, {...valid,success_six_months:{text:"not a string"}},
  ])("rejects missing/invalid required answers %# without saving", async (answers) => {
    expect((await call("POST",tokenA,answers)).status).toBe(400);
    expect((await db.client.query("SELECT id FROM form_submissions WHERE form_id=$1", [formId])).rowCount).toBe(0);
  });

  it("stores native replies with server identity, isolates histories, and does not complete lessons/send email", async () => {
    const before = (await db.client.query("SELECT * FROM lesson_progress WHERE member_id=ANY($1) ORDER BY lesson_id", [[a,b]])).rows;
    expect((await call("POST",tokenA,{...valid,name:"Spoof",email:"spoof@example.invalid",memberId:b})).status).toBe(201);
    const rows = (await db.client.query("SELECT * FROM form_submissions WHERE form_id=$1", [formId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({member_id:a,email:"row200-a@example.invalid",data:{...valid,name:"Intake Student A",email:"row200-a@example.invalid"}});
    expect(rows[0].contact_id).toBeTruthy();
    expect((await call("GET",tokenA)).body.replies).toHaveLength(1);
    expect((await call("GET",tokenB)).body.replies).toEqual([]);
    expect((await call("GET",tokenViewAs)).body.replies).toHaveLength(1);
    expect((await db.client.query("SELECT * FROM lesson_progress WHERE member_id=ANY($1) ORDER BY lesson_id", [[a,b]])).rows).toEqual(before);
    expect((await db.client.query("SELECT id FROM assessment_attempts WHERE member_id=ANY($1)", [[a,b]])).rowCount).toBe(0);
    expect((await db.client.query("SELECT id FROM certificates WHERE member_id=ANY($1)", [[a,b]])).rowCount).toBe(0);
    const { sendMail } = await import("../../email/mailer");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("guides a missing-name account to profile instead of inventing an identity", async () => {
    await db.client.query("UPDATE members SET name='',first_name='',last_name='' WHERE id=$1", [b]);
    try {
      const get = await call("GET",tokenB);
      expect(get.body.member.name).toBe("");
      const post = await call("POST",tokenB,valid);
      expect(post.status).toBe(400);
      expect(JSON.stringify(post.body)).toContain("/account/profile");
      expect((await db.client.query("SELECT id FROM form_submissions WHERE member_id=$1", [b])).rowCount).toBe(0);
    } finally { await db.client.query("UPDATE members SET name='Intake Student B' WHERE id=$1", [b]); }
  });

  it("reruns without changing saved replies, owner form edits, or other welcome edits", async () => {
    await db.client.query("UPDATE forms SET name='Owner edited title', success_message='Owner edited confirmation', fields=jsonb_set(fields, '{6,helpText}', to_jsonb('Owner added help'::text)) WHERE id=$1", [formId]);
    await db.client.query("UPDATE course_lessons SET body_md=body_md || E'\\nMore owner content' WHERE id=$1", [lessonId]);
    const before = (await db.client.query("SELECT * FROM forms WHERE id=$1", [formId])).rows;
    const lessons = (await db.client.query("SELECT * FROM course_lessons WHERE id=$1", [lessonId])).rows;
    const replies = (await db.client.query("SELECT * FROM form_submissions WHERE form_id=$1", [formId])).rows;
    await db.client.query(migration);
    await db.client.query(migration);
    expect((await db.client.query("SELECT * FROM forms WHERE id=$1", [formId])).rows).toEqual(before);
    expect((await db.client.query("SELECT * FROM course_lessons WHERE id=$1", [lessonId])).rows).toEqual(lessons);
    expect((await db.client.query("SELECT * FROM form_submissions WHERE form_id=$1", [formId])).rows).toEqual(replies);
  });

  it("does not replace a different existing welcome tool", async () => {
    await db.client.query("BEGIN");
    try {
      await db.client.query("UPDATE course_lessons SET tool_key='living-business-plan' WHERE id=$1", [lessonId]);
      await expect(db.client.query(migration)).rejects.toThrow("already has another tool");
    } finally { await db.client.query("ROLLBACK"); }
  });


  it("refuses an unrelated preexisting form slug instead of silently attaching it", async () => {
    await db.client.query("BEGIN");
    try {
      await db.client.query("UPDATE course_lessons SET tool_key=NULL WHERE id=$1", [lessonId]);
      await expect(db.client.query(migration)).rejects.toThrow("already belongs to an unattached form");
    } finally { await db.client.query("ROLLBACK"); }
  });

  it("respects an unpublished welcome lesson on both read and submit", async () => {
    await db.client.query("UPDATE course_lessons SET published=false WHERE id=$1", [lessonId]);
    try {
      expect((await call("GET",tokenB)).status).toBe(404);
      expect((await call("POST",tokenB,valid)).status).toBe(404);
    } finally { await db.client.query("UPDATE course_lessons SET published=true WHERE id=$1", [lessonId]); }
  });

  it("does nothing when Boss Move is absent", async () => {
    await db.client.query("BEGIN");
    try {
      await db.client.query("UPDATE courses SET slug='absent-for-test' WHERE id=$1", [courseId]);
      const before = (await db.client.query("SELECT * FROM forms ORDER BY id")).rows;
      const lessons = (await db.client.query("SELECT * FROM course_lessons ORDER BY id")).rows;
      await db.client.query(migration);
      expect((await db.client.query("SELECT * FROM forms ORDER BY id")).rows).toEqual(before);
      expect((await db.client.query("SELECT * FROM course_lessons ORDER BY id")).rows).toEqual(lessons);
    } finally { await db.client.query("ROLLBACK"); }
  });
});
