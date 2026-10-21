
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { createTestDatabase, hasTestDatabase, insertCourseProduct, insertOffer } from "../../testing/db";
const { provider } = vi.hoisted(() => ({provider: {
 products: {retrieve:vi.fn(async()=>({statement_descriptor:"BOSS CLINICIAN"})),update:vi.fn(async()=>({}))},
 customers: {create: vi.fn(async () => ({id:"cus_deposit_test"}))},
 prices: {create: vi.fn(async () => ({id:"price_deposit_test",product:"prod_deposit_test"})), retrieve: vi.fn(async () => ({id:"price_deposit_test", product:"prod_deposit_test"}))},
 subscriptions: {create: vi.fn(async () => ({id:"sub_deposit_test",latest_invoice:{confirmation_secret:{client_secret:"test_secret"}},pending_setup_intent:null}))},
 invoiceItems: {create:vi.fn(),del:vi.fn()}
}}));
vi.mock("../../stripe/client", () => ({stripe:()=>provider}));
(hasTestDatabase ? describe : describe.skip)("Deposit editor and scheduled checkout integration", () => {
 let db: Awaited<ReturnType<typeof createTestDatabase>>, server: ReturnType<express.Express["listen"]>, base:string, offerId:number, optionId:number;
 beforeAll(async () => {
  db=await createTestDatabase("deposit");
  process.env.DATABASE_URL=db.url;
  process.env.JWT_SECRET="deposit-test-secret";
  process.env.STRIPE_SECRET_KEY="sk_test_not_a_real_key";
  await db.client.query("INSERT INTO admin_users(id,email,password_hash,name,role) VALUES(1,'owner@deposit.test','unused','Owner','owner')");
  const {productId,courseId}=await insertCourseProduct(db.client,"deposit");
  const module=(await db.client.query("INSERT INTO course_modules(course_id,title) VALUES($1,'Training') RETURNING id",[courseId])).rows[0];
  await db.client.query("INSERT INTO course_lessons(module_id,title,body_md,published) VALUES($1,'Welcome','Test lesson content',true)",[module.id]);
  offerId=await insertOffer(db.client,"deposit-test",[productId],{amountCents:550000});
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:1,email:"owner@deposit.test",role:"owner"};next();});
  app.use("/admin",(await import("./offers")).adminOffersRouter);
  app.use("/api",(await import("../public/offers")).offersRouter);
  app.use("/api",(await import("../public/checkoutOffer")).checkoutOfferRouter);
  app.use((await import("../../middleware/errorHandler")).errorHandler);
  server=app.listen(0);base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
 },60000);
 afterAll(async()=>{if(server) await new Promise<void>(resolve=>server.close(()=>resolve()));await (await import("../../db/pool")).pool.end();if(db)await db.drop();});
 async function request(path:string,body?:unknown,method=body?"POST":"GET") {
  const res=await fetch(base+path,{method,headers:{"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const data: any=await res.json();return {status:res.status,data};
 }
 it("saves a deposit plus five monthly payments and reads the exact total",async()=>{
  const r=await request("/admin/"+offerId+"/pricing-options",{label:"Deposit + 5 monthly payments",pricingType:"payment_plan",amountCents:100000,depositCents:50000,interval:"month",installmentCount:6});
  expect(r.status,JSON.stringify(r.data)).toBe(201);optionId=r.data.id;
  const view=await request("/api/offers/deposit-test?option="+optionId);
  expect(view.status).toBe(200);
  expect(view.data.billing).toMatchObject({depositCents:50000,installmentCents:100000,installmentCount:6,planTotalCents:550000});
  expect(view.data.quote.totalCents).toBe(50000);
 });
 it("creates only the deposit invoice and freezes the purchased schedule",async()=>{
  const r=await request("/api/checkout/offer/deposit-test",{email:"buyer@deposit.test",pricingOptionId:optionId});
  expect(r.status,JSON.stringify(r.data)).toBe(201);
  expect(provider.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({items:[{price:"price_deposit_test"}],add_invoice_items:[{price_data:{currency:"usd",product:"prod_deposit_test",unit_amount:-50000},quantity:1}],cancel_at:expect.any(Number)}),expect.objectContaining({idempotencyKey:expect.stringContaining("offer-order-")}));
  const row=(await db.client.query("SELECT total_cents,billing_snapshot FROM orders WHERE email='buyer@deposit.test'")).rows[0];
  expect(row.total_cents).toBe(50000);expect(row.billing_snapshot).toMatchObject({amount_cents:100000,deposit_cents:50000,installment_count:6});
  await request("/admin/"+offerId+"/pricing-options/"+optionId,{amountCents:83400,installmentCount:7},"PUT");
  const unchanged=(await db.client.query("SELECT billing_snapshot FROM orders WHERE email='buyer@deposit.test'")).rows[0];
  expect(unchanged.billing_snapshot).toEqual(row.billing_snapshot);
 });
 it("rejects coupons without creating an order or provider subscription",async()=>{
  const before=(await db.client.query("SELECT count(*) FROM orders")).rows[0].count;
  const calls=provider.subscriptions.create.mock.calls.length;
  const r=await request("/api/checkout/offer/deposit-test",{email:"coupon@deposit.test",pricingOptionId:optionId,couponCode:"SAVE"});
  expect(r.status).toBe(400);
  expect((await db.client.query("SELECT count(*) FROM orders")).rows[0].count).toBe(before);
  expect(provider.subscriptions.create.mock.calls.length).toBe(calls);
 });
 it("enforces opening and closing dates on direct links and stale checkout submissions",async()=>{
  const future=new Date(Date.now()+86400000).toISOString();
  let r=await request("/admin/"+offerId+"/pricing-options/"+optionId,{salesStartAt:future},"PUT");expect(r.status).toBe(200);
  expect((await request("/api/offers/deposit-test?option="+optionId)).data.billing.pricingType).toBe("one_time");
  expect((await request("/api/checkout/offer/deposit-test",{email:"early@deposit.test",pricingOptionId:optionId})).status).toBe(400);
  const past=new Date(Date.now()-86400000).toISOString();
  r=await request("/admin/"+offerId+"/pricing-options/"+optionId,{salesStartAt:null,salesEndAt:past},"PUT");expect(r.status).toBe(200);
  expect((await request("/api/checkout/offer/deposit-test",{email:"late@deposit.test",pricingOptionId:optionId})).status).toBe(400);
  expect((await request("/api/offers/deposit-test")).data.billing.pricingType).toBe("one_time");
  expect((await request("/admin/"+offerId+"/pricing-options/"+optionId,{salesStartAt:future,salesEndAt:past},"PUT")).status).toBe(400);
 });
 it("preserves deposit and dates when duplicating an offer",async()=>{
  const r=await request("/admin/"+offerId+"/duplicate",{});
  expect(r.status,JSON.stringify(r.data)).toBe(201);
  const detail=await request("/admin/"+r.data.id);
  expect(detail.data.pricingOptions[0]).toMatchObject({depositCents:50000,amountCents:83400,installmentCount:7,salesEndAt:expect.any(String)});
 });
 it("supports a base deposit plan and refuses deposits on a one-time price",async()=>{
  expect((await request("/admin/"+offerId,{depositCents:50000},"PUT")).status).toBe(400);
  const r=await request("/admin/"+offerId,{pricingType:"payment_plan",amountCents:100000,depositCents:50000,interval:"month",installmentCount:6},"PUT");
  expect(r.status,JSON.stringify(r.data)).toBe(200);expect(r.data.depositCents).toBe(50000);
  expect((await request("/api/offers/deposit-test")).data.billing.planTotalCents).toBe(550000);
 });
});
