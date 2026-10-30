import fs from 'fs';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertMember, insertOffer } from '../../testing/db';

const describeDb = hasTestDatabase ? describe : describe.skip;
describeDb('Optional course add-ons', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let server: Server | undefined;
  let base: string, admin: string, viewer: string, member: string, stranger: string;
  let course: number, product: number, offer: number, addonProduct: number, memberId: number;
  let load: typeof import('../../services/courseAddons').loadCourseAddons;
  const endpoint = () => `/api/admin/courses/${course}/hub/add-ons`;
  async function call(url: string, method = 'GET', body?: unknown, token = admin) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() as any };
  }
  beforeAll(async () => {
    db = await createTestDatabase('course_addons');
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = 'course-addons-isolated-test-secret';
    process.env.STRIPE_SECRET_KEY = '';
    const { createApp } = await import('../../app');
    const { signToken } = await import('../../utils/jwt');
    const { hashToken } = await import('../../auth/tokens');
    const { signMemberAccessToken } = await import('../../auth/memberSession');
    load = (await import('../../services/courseAddons')).loadCourseAddons;
    for (const role of ['owner', 'support'] as const) {
      const email = `${role}-addons@example.invalid`;
      const id = (await db.client.query(`INSERT INTO admin_users(email,password_hash,name,role) VALUES($1,'unused','QA',$2) RETURNING id`, [email,role])).rows[0].id;
      const token = signToken({ sub: id, email, role });
      await db.client.query(`INSERT INTO admin_sessions(admin_user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [id,hashToken(token)]);
      if (role === 'owner') admin=token; else viewer=token;
    }
    memberId = await insertMember(db.client,'owner-addons@example.invalid');
    const other = await insertMember(db.client,'other-addons@example.invalid');
    member = signMemberAccessToken({ sub: memberId, email:'owner-addons@example.invalid' });
    stranger = signMemberAccessToken({ sub: other, email:'other-addons@example.invalid' });
    const root = await insertCourseProduct(db.client,'qa-addons-course'); course=root.courseId; product=root.productId;
    await db.client.query('UPDATE courses SET published=false WHERE id=$1',[course]);
    const mod = (await db.client.query(`INSERT INTO course_modules(course_id,title) VALUES($1,'Module') RETURNING id`,[course])).rows[0].id;
    await db.client.query(`INSERT INTO course_lessons(module_id,slug,title,body_md,published) VALUES($1,'owned-lesson','Owned lesson','Already paid core content',true)`,[mod]);
    await db.client.query(`INSERT INTO access_grants(member_id,product_id,source,status) VALUES($1,$2,'manual','active')`,[memberId,product]);
    const extra = await insertCourseProduct(db.client,'qa-addons-extra'); addonProduct=extra.productId;
    const extraMod = (await db.client.query(`INSERT INTO course_modules(course_id,title) VALUES($1,'Extra') RETURNING id`,[extra.courseId])).rows[0].id;
    await db.client.query(`INSERT INTO course_lessons(module_id,slug,title,body_md,published) VALUES($1,'extra-lesson','Extra lesson','Paid add-on',true)`,[extraMod]);
    offer=await insertOffer(db.client,'qa-addons-offer',[addonProduct]);
    server=createApp().listen(0);
    await new Promise<void>(resolve=>server!.once('listening',resolve));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if(server) await new Promise<void>(resolve=>server!.close(()=>resolve()));
    await (await import('../../db/pool')).pool.end();
    await db?.drop();
  });
  it('requires admin write permission; students cannot configure promotions',async()=>{
    expect((await call(endpoint(),'PUT',{offerId:offer},'')).status).toBe(403);
    expect((await call(endpoint(),'PUT',{offerId:offer},viewer)).status).toBe(403);
    expect((await call(endpoint(),'PUT',{offerId:offer},member)).status).toBe(401);
  });
  it('adds and edits one existing offer without modifying products, prices or grants',async()=>{
    const before=(await db.client.query('SELECT * FROM offers WHERE id=$1',[offer])).rows;
    expect((await call(endpoint(),'PUT',{offerId:offer,description:'Optional support',sort:4})).status).toBe(200);
    expect((await call(endpoint(),'PUT',{offerId:offer,description:'Updated support',sort:2})).status).toBe(200);
    const list=await call(endpoint());
    expect(list.body.configured).toHaveLength(1);
    expect(list.body.configured[0]).toMatchObject({offerId:offer,description:'Updated support',sort:2});
    expect((await db.client.query('SELECT * FROM offers WHERE id=$1',[offer])).rows).toEqual(before);
    expect((await db.client.query('SELECT * FROM access_grants WHERE member_id=$1',[memberId])).rows).toHaveLength(1);
    expect((await db.client.query('SELECT * FROM offer_products WHERE offer_id=$1',[offer])).rows).toHaveLength(1);
  });
  it('validates identifiers, text limits, order and published offer targets',async()=>{
    for(const body of [{offerId:0},{offerId:offer,description:'x'.repeat(301)},{offerId:offer,sort:-1},{offerId:offer,sort:1.2},{offerId:offer,href:'https://evil.invalid'}]) expect((await call(endpoint(),'PUT',body)).status).toBe(400);
    await db.client.query(`UPDATE offers SET status='draft' WHERE id=$1`,[offer]);
    expect((await call(endpoint(),'PUT',{offerId:offer})).status).toBe(400);
    expect(await load(course)).toEqual([]);
    await db.client.query(`UPDATE offers SET status='published' WHERE id=$1`,[offer]);
  });
  it('rejects offers without products and enforces the configured limit without blocking edits',async()=>{
    const empty=await insertOffer(db.client,'qa-addons-empty',[]);
    expect((await call(endpoint(),'PUT',{offerId:empty})).status).toBe(400);
    const extras:number[]=[];
    for(let index=0;index<12;index++) extras.push(await insertOffer(db.client,`qa-addon-${index}`,[addonProduct]));
    for(const id of extras.slice(0,11)) expect((await call(endpoint(),'PUT',{offerId:id})).status).toBe(200);
    expect((await call(endpoint(),'PUT',{offerId:extras[11]})).status).toBe(400);
    expect((await call(endpoint(),'PUT',{offerId:offer,description:'Still editable',sort:2})).status).toBe(200);
    await db.client.query('DELETE FROM course_addons WHERE offer_id=ANY($1::int[])',[extras]);
    expect((await call('/api/admin/courses/2147483647/hub/add-ons','PUT',{offerId:offer})).status).toBe(404);
  });
  it('only shows promotions after ownership checks; existing course access stays open',async()=>{
    const url='/api/member/library/p-qa-addons-course';
    expect((await call(url,'GET',undefined,stranger)).status).toBe(404);
    const owned=await call(url,'GET',undefined,member);
    expect(owned.status).toBe(200);
    expect(owned.body.course.addOns[0]).toMatchObject({offerId:offer,href:'/checkout/qa-addons-offer',available:true});
    expect(owned.body.course.modules[0].lessons[0].unlocked).toBe(true);
    expect((await call('/api/member/library/p-qa-addons-extra','GET',undefined,member)).status).toBe(404);
    expect((await db.client.query('SELECT published FROM courses WHERE id=$1',[course])).rows[0].published).toBe(false);
  });
  it('hides an add-on the member already holds, since checkout would still take the payment',async()=>{
    const url='/api/member/library/p-qa-addons-course';
    await db.client.query(`INSERT INTO access_grants(member_id,product_id,source,status) VALUES($1,$2,'manual','active')`,[memberId,addonProduct]);
    try {
      expect((await call(url,'GET',undefined,member)).body.course.addOns).toEqual([]);
      expect((await load(course)).map(item=>item.offerId)).toEqual([offer]);
    } finally { await db.client.query('DELETE FROM access_grants WHERE member_id=$1 AND product_id=$2',[memberId,addonProduct]); }
    expect((await call(url,'GET',undefined,member)).body.course.addOns[0]).toMatchObject({offerId:offer});
  });
  it('admin preview shows the same optional purchase links without grants',async()=>{
    const preview=await call(`/api/admin/courses/${course}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.course.addOns[0].href).toBe('/checkout/qa-addons-offer');
  });
  it('fails closed for archived offers, unpublished products and missing deliverables',async()=>{
    await db.client.query(`UPDATE offers SET status='archived' WHERE id=$1`,[offer]);
    expect(await load(course)).toEqual([]);
    await db.client.query(`UPDATE offers SET status='published' WHERE id=$1`,[offer]);
    await db.client.query(`UPDATE products SET status='draft' WHERE id=$1`,[addonProduct]);
    expect(await load(course)).toEqual([]);
    await db.client.query(`UPDATE products SET status='published' WHERE id=$1`,[addonProduct]);
    await db.client.query(`UPDATE course_lessons SET body_md='' WHERE slug='extra-lesson'`);
    expect((await load(course))[0]).toMatchObject({available:false,href:null});
    await db.client.query(`UPDATE course_lessons SET body_md='Ready again' WHERE slug='extra-lesson'`);
  });
  it('keeps the purchased course working if optional merchandising cannot load',async()=>{
    await db.client.query('ALTER TABLE course_addons RENAME TO course_addons_qa_hidden');
    try {
      const owned=await call('/api/member/library/p-qa-addons-course','GET',undefined,member);
      expect(owned.status).toBe(200); expect(owned.body.course.addOns).toEqual([]);
      expect(owned.body.course.modules[0].lessons[0].unlocked).toBe(true);
    } finally { await db.client.query('ALTER TABLE course_addons_qa_hidden RENAME TO course_addons'); }
  });
  it('removes a promotion without removing course access or its offer',async()=>{
    expect((await call(`${endpoint()}/${offer}`,'DELETE')).status).toBe(204);
    expect(await load(course)).toEqual([]);
    expect((await db.client.query('SELECT id FROM offers WHERE id=$1',[offer])).rowCount).toBe(1);
    expect((await db.client.query('SELECT id FROM access_grants WHERE member_id=$1',[memberId])).rowCount).toBe(1);
  });
  it('migration seeds only the two verified identities and preserves edits on re-run',async()=>{
    await db.client.query('BEGIN');
    await db.client.query('CREATE TEMP TABLE courses (id integer PRIMARY KEY, slug text, title text, published boolean)');
    await db.client.query('CREATE TEMP TABLE offers (id integer PRIMARY KEY, slug text, title text, status text, pricing_type text, amount_cents integer)');
    await db.client.query('CREATE TEMP TABLE course_addons (LIKE public.course_addons INCLUDING ALL)');
    await db.client.query(`INSERT INTO courses(id,slug,title,published) VALUES(52,'the-boss-move','Boss Move',false)`);
    await db.client.query(`INSERT INTO offers(id,slug,title,status,pricing_type,amount_cents) VALUES(21,'private-practice-protection-pack','Pack','published','one_time',9700),(40,'the-lounge','Lounge','published','one_time',199700)`);
    const sql=fs.readFileSync(path.join(__dirname,'../../db/migrations/170_course_addons.sql'),'utf8');
    await db.client.query(sql);
    expect((await db.client.query('SELECT offer_id FROM course_addons WHERE course_id=52 ORDER BY sort')).rows).toEqual([{offer_id:21},{offer_id:40}]);
    await db.client.query(`UPDATE course_addons SET description='Owner edit' WHERE course_id=52 AND offer_id=21`);
    const before=(await db.client.query('SELECT * FROM course_addons WHERE course_id=52 ORDER BY sort')).rows;
    await db.client.query(sql);
    expect((await db.client.query('SELECT * FROM course_addons WHERE course_id=52 ORDER BY sort')).rows).toEqual(before);
    expect((await db.client.query('SELECT published FROM courses WHERE id=52')).rows[0].published).toBe(false);
    expect((await db.client.query('SELECT amount_cents FROM offers WHERE id=40')).rows[0].amount_cents).toBe(199700);
    await db.client.query('ROLLBACK');
  });
});
