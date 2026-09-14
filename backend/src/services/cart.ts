import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";
import { assertOfferDeliverable } from "./downloadReadiness";
import { badRequest, notFound } from "../utils/httpError";
import { validateCoupon, type ValidatedCoupon } from "./coupons";
import { computeOrderTotal, couponDiscountCents, taxCents, type OrderTotal } from "./pricing";
import { loadPublishedOffer, selectOfferPricing, loadOfferBumps, selectBumps, toPricedOffer, resolveTaxRateBps, submittedTaxAddress, parseCustomFields, type BillingAddress, type OfferRow } from "../routes/public/offers";

export const cartItemsSchema = z.array(z.object({
  slug:z.string().trim().min(1).max(200), pricingOptionId:z.number().int().positive().nullable().optional(),
  bumpProductIds:z.array(z.number().int().positive()).max(20).optional(),
})).min(1).max(20).refine(items=>new Set(items.map(i=>i.slug)).size===items.length,"Each offer can appear only once in a cart");
export type CartItem = z.infer<typeof cartItemsSchema>[number];
type DB = Pick<PoolClient,"query">;
export interface CartGroup {offer:OfferRow; total:OrderTotal; taxRateBps:number;}
export interface CartInput {
  items:CartItem[]; couponCode?:string; email?:string|null; address?:BillingAddress; lock?:boolean;
  checkout?: {phone?:string; acceptedTerms?:boolean; customFields?:Record<string,string>; giftRecipientEmail?:string};
}
export async function priceCart(input:CartInput, db:DB=pool):Promise<{total:OrderTotal;coupon:ValidatedCoupon|null;groups:CartGroup[]}> {
  cartItemsSchema.parse(input.items);
  const groups:CartGroup[]=[];
  let currency:string|undefined;
  for(const item of input.items) {
    const base = await loadPublishedOffer(item.slug,db);
    if(!base) throw notFound("An item in your cart is no longer available. Remove it and try again.");
    const offer = await selectOfferPricing(base,item.pricingOptionId,db);
    await assertOfferDeliverable(offer.id,item.bumpProductIds??[],db);
    if(!["one_time","free"].includes(offer.pricing_type)) throw badRequest(`${offer.title} needs its own checkout. Carts combine one-time purchases.`);
    if(currency && currency!==offer.currency) throw badRequest("All items in a cart must use the same currency.");
    currency=offer.currency;
    if(input.checkout) {
      const form=input.checkout;
      if(offer.require_terms && !form.acceptedTerms) throw badRequest(`Accept the terms for ${offer.title}.`);
      if(offer.collect_phone && !form.phone?.trim()) throw badRequest(`${offer.title} requires a phone number.`);
      if(offer.collect_address && (!input.address?.line1 || !input.address.country)) throw badRequest(`${offer.title} requires a billing address.`);
      if(form.giftRecipientEmail && !offer.allow_gifting) throw badRequest(`${offer.title} cannot be sent as a gift.`);
      for(const field of parseCustomFields(offer.custom_fields)) {
        const value=String(form.customFields?.[`${offer.id}:${field.key}`]??"").trim();
        if(field.required && (!value || (field.type==='checkbox' && value!=='Yes'))) throw badRequest(`${offer.title}: ${field.label} is required.`);
        if(value && field.options.length && !field.options.includes(value)) throw badRequest(`${offer.title}: select an available ${field.label}.`);
      }
    }
    const bumps=selectBumps(await loadOfferBumps(offer.id,db),item.bumpProductIds??[]);
    if(new Set(item.bumpProductIds??[]).size!==bumps.length) throw badRequest(`An add-on for ${offer.title} is no longer available.`);
    const rate=await resolveTaxRateBps(offer,submittedTaxAddress(offer,input.address));
    const total=computeOrderTotal({offer:toPricedOffer(offer),bumps});
    total.lines=total.lines.map(line=>({...line,offerId:offer.id}));
    groups.push({offer,total,taxRateBps:rate});
  }
  const included = await db.query<{product_id:number}>(`SELECT DISTINCT product_id FROM offer_products WHERE offer_id=ANY($1::int[])`,[groups.map(g=>g.offer.id)]);
  const purchasedProducts=new Set(included.rows.map(row=>row.product_id));
  const chosenBumps=new Set<number>();
  for(const group of groups) for(const line of group.total.lines) if(line.kind==='bump' && line.productId) {
    if(purchasedProducts.has(line.productId)||chosenBumps.has(line.productId)) throw badRequest(`${line.title} is already included in your cart. Remove that add-on.`);
    chosenBumps.add(line.productId);
  }
  let coupon:ValidatedCoupon|null=null;
  const eligible=new Set<number>();
  let error="That discount code cannot be used with this cart.";
  if(input.couponCode) {
    for(const group of groups) {
      const result=await validateCoupon(input.couponCode,group.offer.id,input.email,{client:db,lock:input.lock});
      if(result.ok) {coupon=result.coupon; eligible.add(group.offer.id);}
      else error=result.reason;
    }
    if(!coupon) throw badRequest(error);
  }
  const eligibleSubtotal=groups.filter(g=>eligible.has(g.offer.id)).reduce((sum,g)=>sum+g.total.subtotalCents,0);
  let remainingDiscount=couponDiscountCents(eligibleSubtotal,coupon), remainingBase=eligibleSubtotal;
  for(const group of groups) {
    const t=group.total;
    const discount=eligible.has(group.offer.id) && remainingBase>0 ? Math.min(t.subtotalCents,Math.round(remainingDiscount*t.subtotalCents/remainingBase)) : 0;
    if(eligible.has(group.offer.id)) {remainingBase-=t.subtotalCents;remainingDiscount-=discount;}
    t.discountCents=discount;t.taxableCents=t.subtotalCents-discount;t.taxCents=taxCents(t.taxableCents,group.taxRateBps);t.totalCents=t.taxableCents+t.taxCents;
  }
  const total:OrderTotal={lines:groups.flatMap(g=>g.total.lines),currency:currency??"usd",subtotalCents:0,discountCents:0,taxableCents:0,taxCents:0,totalCents:0};
  for(const group of groups) for(const key of ["subtotalCents","discountCents","taxableCents","taxCents","totalCents"] as const) total[key]+=group.total[key];
  if(total.totalCents>99_999_999) throw badRequest("This cart exceeds the maximum payment amount.");
  return {total,coupon,groups};
}
