import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {createTestDatabase,hasTestDatabase} from "../testing/db";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type {Server} from "http";
const stripeMock=vi.hoisted(()=>({paymentIntents:{create:vi.fn(async(_params:any,_options:any)=>({id:"pi_ZZ_cart",client_secret:"pi_ZZ_cart_secret",status:"requires_payment_method"}))},customers:{create:vi.fn(async()=>({id:"cus_ZZ_cart"}))}}));
vi.mock("../stripe/client",()=>({stripe:()=>stripeMock}));
vi.mock("./purchaseDelivery",()=>({deliverPurchase:vi.fn(async()=>{}),notifyOwnerOfSale:vi.fn()}));
const describeDb=hasTestDatabase?describe:describe.skip;
describeDb("multi-offer cart (integration)",()=>{
 let db:Awaited<ReturnType<typeof createTestDatabase>>,server:Server,origin:string;
 let service:typeof import("./cart"),fulfillment:typeof import("./fulfillment");
 let n=0;
 const storage=fs.mkdtempSync(path.join(os.tmpdir(),'zz-cart-files-'));
 async function offer(amount=2700,extra:Record<string,unknown>={}) {
  const slug=`zz-cart-${++n}`;
  const p=await db.client.query(`INSERT INTO products(title,slug,kind,status) VALUES($1,$2,'download','published') RETURNING id`,[`ZZ ${slug}`,slug]);
  await db.client.query(`INSERT INTO product_files(product_id,title,storage_path,filename,mime,size_bytes) VALUES($1,'ZZ Cart Guide','protected:abcdef1234567890.txt','guide.txt','text/plain',14)`,[p.rows[0].id]);
  const o=await db.client.query(`INSERT INTO offers(title,slug,status,pricing_type,amount_cents,allow_gifting) VALUES($1,$2,'published','one_time',$3,true) RETURNING id`,[`ZZ ${slug}`,slug,amount]);
  const id=o.rows[0].id;
  await db.client.query(`INSERT INTO offer_products(offer_id,product_id) VALUES($1,$2)`,[id,p.rows[0].id]);
  for(const [key,value] of Object.entries(extra)) {if(!['currency','collect_phone','custom_fields','require_terms','collect_tax'].includes(key))throw Error('test column');await db.client.query(`UPDATE offers SET ${key}=$2 WHERE id=$1`,[id,key==='custom_fields'?JSON.stringify(value):value]);}
  return {id,slug,productId:p.rows[0].id,pricingOptionId:null};
 }
 async function post(path:string,body:any){const r=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};}
 beforeAll(async()=>{
  process.env.PROTECTED_UPLOAD_DIR=storage;
  fs.writeFileSync(path.join(storage,'abcdef1234567890.txt'),'ZZ Cart Guide\n');
  db=await createTestDatabase('cart');process.env.DATABASE_URL=db.url;process.env.JWT_SECRET='ZZ-cart-test';process.env.STRIPE_SECRET_KEY='sk_test_ZZ_no_real_calls';
  service=await import('./cart');fulfillment=await import('./fulfillment');
  const app=express();app.use(express.json());app.use((await import('../routes/public/cart')).cartRouter);app.use((await import('../routes/public/checkoutOffer')).checkoutOfferRouter);
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??error.statusCode??400).json({error:error.message}));
  server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',()=>resolve()));origin=`http://127.0.0.1:${(server.address() as any).port}`;
 },60000);
 afterAll(async()=>{await new Promise<void>(resolve=>server?.close(()=>resolve()));await (await import('../db/pool')).pool.end();await db?.drop();fs.rmSync(storage,{recursive:true,force:true});});
 it('prices three offers on the server, applies a fixed code once, opens one intent and grants all products',async()=>{
  const a=await offer(2700),b=await offer(4700),c=await offer(9700);const items=[a,b,c].map(o=>({slug:o.slug,pricingOptionId:null}));
  await db.client.query(`INSERT INTO coupons(code,amount_off_cents,currency,scope) VALUES('ZZCART10',1000,'usd','global')`);
  const q=await post('/cart/quote',{cartItems:items,couponCode:'ZZCART10',totalCents:1});
  expect(q.status).toBe(200);expect(q.body.subtotalCents).toBe(17100);expect(q.body.discountCents).toBe(1000);expect(q.body.totalCents).toBe(16100);
  const checkout=await post(`/checkout/offer/${a.slug}`,{email:'sagar+zz-cart-paid@callsphere.ai',name:'ZZ Cart',pricingOptionId:null,cartItems:items,couponCode:'ZZCART10',totalCents:1});
  expect(checkout.status).toBe(201);expect(checkout.body.totalCents).toBe(16100);expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);expect(stripeMock.paymentIntents.create.mock.calls[0][0]).toMatchObject({amount:16100,automatic_payment_methods:{enabled:true}});
  const result=await fulfillment.fulfillPayment({orderId:checkout.body.orderId,amountCents:16100,email:'sagar+zz-cart-paid@callsphere.ai'});
  expect(result.grantedProductIds.sort()).toEqual([a.productId,b.productId,c.productId].sort());
  const row=await db.client.query(`SELECT sum(total_cents)::int AS total,count(*)::int AS count FROM order_offer_totals WHERE order_id=$1`,[checkout.body.orderId]);expect(row.rows[0]).toEqual({total:16100,count:3});
 });
 it('settles a three-item 100%-discount gift checkout without any Stripe call and grants recipient plus bump',async()=>{
  const a=await offer(),b=await offer(),c=await offer(),bump=await offer(500);
  await db.client.query(`INSERT INTO offer_bumps(offer_id,product_id,title,amount_cents) VALUES($1,$2,'ZZ Bonus',500)`,[a.id,bump.productId]);
  await db.client.query(`INSERT INTO coupons(code,percent_off,scope) VALUES('ZZCARTFREE',100,'global')`);
  const before=stripeMock.paymentIntents.create.mock.calls.length;
  const items=[{slug:a.slug,pricingOptionId:null,bumpProductIds:[bump.productId]},{slug:b.slug,pricingOptionId:null},{slug:c.slug,pricingOptionId:null}];
  const out=await post(`/checkout/offer/${a.slug}`,{email:'sagar+zz-cart-giver@callsphere.ai',name:'ZZ Giver',giftRecipientEmail:'sagar+zz-cart-recipient@callsphere.ai',giftMessage:'ZZ Enjoy',pricingOptionId:null,cartItems:items,couponCode:'ZZCARTFREE'});
  expect(out.status).toBe(201);expect(out.body.status).toBe('paid');expect(out.body.requiresPayment).toBe(false);expect(stripeMock.paymentIntents.create.mock.calls.length).toBe(before);
  const grants=await db.client.query(`SELECT m.email::text,g.product_id FROM access_grants g JOIN members m ON m.id=g.member_id WHERE g.order_id=$1`,[out.body.orderId]);expect(grants.rows).toHaveLength(4);expect(grants.rows.every(r=>r.email==='sagar+zz-cart-recipient@callsphere.ai')).toBe(true);
  const bonus=await offer(0);
  await db.client.query(`INSERT INTO offer_upsells(offer_id,step,upsell_offer_id) VALUES($1,1,$2)`,[a.id,bonus.id]);
  const upsellBody={parentOrderId:out.body.orderId,orderToken:out.body.orderToken};
  const upsell=await post(`/checkout/offer/${a.slug}/upsell/1`,upsellBody);
  expect(upsell.status).toBe(200);expect(upsell.body.status).toBe('paid');
  const repeated=await post(`/checkout/offer/${a.slug}/upsell/1`,upsellBody);
  expect(repeated.body.orderId).toBe(upsell.body.orderId);
  const bonusGrants=await db.client.query(`SELECT m.email::text,g.product_id FROM access_grants g JOIN members m ON m.id=g.member_id WHERE g.order_id=$1`,[upsell.body.orderId]);
  expect(bonusGrants.rows).toEqual([{email:'sagar+zz-cart-recipient@callsphere.ai',product_id:bonus.productId}]);
  expect(stripeMock.paymentIntents.create.mock.calls.length).toBe(before);
 });
 it('applies offer-scoped discounts only to eligible offers and rejects mixed currency or duplicate selections',async()=>{
  const a=await offer(2700),b=await offer(4700),c=await offer(3000,{currency:'eur'});
  const cp=await db.client.query(`INSERT INTO coupons(code,percent_off,scope) VALUES('ZZSCOPED',50,'offers') RETURNING id`);await db.client.query(`INSERT INTO coupon_offers(coupon_id,offer_id) VALUES($1,$2)`,[cp.rows[0].id,a.id]);
  const q=await service.priceCart({items:[a,b],couponCode:'ZZSCOPED'});expect(q.total.discountCents).toBe(1350);
  await expect(service.priceCart({items:[a,c]})).rejects.toThrow('same currency');await expect(service.priceCart({items:[a,a]})).rejects.toThrow();
 });
 it('enforces per-item custom fields, phone and terms and refuses an already-included bump',async()=>{
  const a=await offer(),b=await offer(2700,{collect_phone:true,require_terms:true,custom_fields:[{key:'license',label:'License',type:'text',required:true,options:[]}]});
  const items=[a,b];
  await expect(service.priceCart({items,checkout:{}})).rejects.toThrow();
  await expect(service.priceCart({items,checkout:{phone:'123',acceptedTerms:true,customFields:{}}})).rejects.toThrow('License');
  expect((await service.priceCart({items,checkout:{phone:'123',acceptedTerms:true,customFields:{[`${b.id}:license`]:'ZZ123'}}})).total.totalCents).toBe(5400);
  await db.client.query(`INSERT INTO offer_bumps(offer_id,product_id,title,amount_cents) VALUES($1,$2,'ZZ Included',500)`,[a.id,b.productId]);
  await expect(service.priceCart({items:[{...a,bumpProductIds:[b.productId]},b]})).rejects.toThrow('already included');
 });
 it('allocates recovery by offer without counting a whole cart more than once',async()=>{
  const a=await offer(2700),b=await offer(4700);const email='sagar+zz-cart-recovery@callsphere.ai';
  const checkout=await post(`/checkout/offer/${a.slug}`,{email,name:'ZZ',pricingOptionId:null,cartItems:[a,b],couponCode:'ZZCART10'});expect(checkout.status).toBe(201);
  for(const o of [a,b]){const cart=await db.client.query(`INSERT INTO abandoned_checkouts(offer_id,email,amount_cents) VALUES($1,$2, $3) RETURNING id`,[o.id,email,2700]);await db.client.query(`INSERT INTO checkout_reminders(abandoned_checkout_id,step,sent_at,clicked_at) VALUES($1,0,now(),now())`,[cart.rows[0].id]);}
  await fulfillment.fulfillPayment({orderId:checkout.body.orderId,amountCents:6400,email});
  const rollup=await import('./reports/rollup');await rollup.runRollup({from:'2020-01-01',to:'2030-01-01'});
  expect((await db.client.query(`SELECT sum(value_cents)::int AS total FROM report_daily WHERE metric='cart_recovered' AND dimension=''`)).rows[0].total).toBe(6400);
 });
});
