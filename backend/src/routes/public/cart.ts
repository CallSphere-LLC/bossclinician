import {Router} from "express";
import {z} from "zod";
import {rateLimit} from "express-rate-limit";
import {pool} from "../../db/pool";
import {optionalMember} from "../../middleware/memberAuth";
import {asyncHandler} from "../../utils/asyncHandler";
import {badRequest} from "../../utils/httpError";
import {priceCart,cartItemsSchema} from "../../services/cart";
import {addressSchema,totalToJson,billingToJson,toPricedOffer} from "./offers";
export const cartRouter=Router();
const limiter=rateLimit({windowMs:60000,max:120,standardHeaders:true,legacyHeaders:false});
cartRouter.get("/cart/catalog",limiter,asyncHandler(async(req,res)=>{
  const rows=await pool.query(`SELECT id,slug,title,description,thumbnail_url AS "thumbnailUrl",amount_cents AS "amountCents",currency FROM offers WHERE status='published' AND pricing_type IN ('one_time','free') ORDER BY title LIMIT 200`);
  res.json({offers:rows.rows});
}));
cartRouter.post("/cart/quote",limiter,optionalMember,asyncHandler(async(req,res)=>{
  const parsed=z.object({cartItems:cartItemsSchema,couponCode:z.string().max(64).optional(),address:addressSchema.optional()}).safeParse(req.body);
  if(!parsed.success)throw badRequest("Invalid cart",parsed.error.flatten());
  const body=parsed.data;
  const priced=await priceCart({items:body.cartItems,couponCode:body.couponCode,address:body.address,email:req.member?.email});
  const first=priced.groups[0].offer;
  res.json({...totalToJson(priced.total),offerSlug:first.slug,selectedPricingOptionId:first.pricing_option_id??null,billing:billingToJson(first,toPricedOffer(first)),taxRateBps:0,appliedBumpProductIds:[],coupon:priced.coupon,couponError:null});
}));
