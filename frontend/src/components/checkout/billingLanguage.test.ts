
import {it,expect} from "vitest";
import {describeBilling} from "./billingLanguage";
import {pricePreview,priceSummary} from "@/lib/adminCommerceApi";
it("states the deposit and remaining monthly commitment without calling all payments equal", () => {
 const words=describeBilling({billing:{pricingType:"payment_plan",interval:"month",intervalCount:1,installmentCount:6,trialDays:0,installmentCents:100000,depositCents:50000,planTotalCents:550000,minAmountCents:null},amountCents:100000,currency:"usd",coupon:null});
 expect(words.commitment).toContain("$500.00 deposit today");
 expect(words.commitment).toContain("5 payments of $1,000.00 monthly");
 expect(words.detail).toContain("$5,500.00 in total");
});
it("shows the same deposit contract in the offer editor",()=>{
 const offer={pricingType:"payment_plan" as const,amountCents:100000,depositCents:50000,minAmountCents:0,interval:"month" as const,intervalCount:1,installmentCount:6,trialDays:0};
 expect(priceSummary(offer)).toContain("5 payments of $1,000");
 expect(pricePreview(offer)).toContain("Total: $5,500");
});
