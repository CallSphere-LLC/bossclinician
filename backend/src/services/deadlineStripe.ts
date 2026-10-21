import type Stripe from "stripe";
import { stripe } from "../stripe/client";
import { addInterval } from "./pricing";

/** Install the finite, rounded contract after the deposit has succeeded.
 * Provider idempotency plus a schedule marker makes webhook replay harmless. */
export async function ensureDeadlineStripeSchedule(subscriptionId:string, orderId:number, contract:{installment_count:number;amount_cents:number;final_installment_cents:number;balance_due_by:string}) {
  const api = stripe();
  const sub = await api.subscriptions.retrieve(subscriptionId);
  if (sub.status === "canceled") return;
  const existing = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  const schedule = existing ? await api.subscriptionSchedules.retrieve(existing) : await api.subscriptionSchedules.create({from_subscription:sub.id},{idempotencyKey:`deadline-schedule-${orderId}`});
  if (schedule.metadata?.bossDeadlineOrder === String(orderId)) return;
  const item = sub.items.data[0];
  if (sub.items.data.length !== 1 || !item) throw new Error("Unexpected items on deadline payment plan");
  const product = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  const anchor = new Date(sub.billing_cycle_anchor*1000);
  const finalStart = Math.floor(addInterval(anchor,"month",contract.installment_count-1).getTime()/1000);
  const end = Math.floor(addInterval(anchor,"month",contract.installment_count).getTime()/1000);
  if (new Date(finalStart*1000).toISOString().slice(0,10)>contract.balance_due_by.slice(0,10)) throw new Error("Payment plan exceeds its payoff deadline");
  const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] = [
    {start_date:schedule.current_phase!.start_date,end_date:finalStart,items:[{price:item.price.id,quantity:1}],proration_behavior:"none"},
    {start_date:finalStart,end_date:end,items:[{price_data:{currency:item.price.currency,product,unit_amount:contract.final_installment_cents,recurring:{interval:"month",interval_count:1}},quantity:1}],proration_behavior:"none"},
  ];
  await api.subscriptionSchedules.update(schedule.id,{end_behavior:"cancel",phases,proration_behavior:"none",metadata:{bossDeadlineOrder:String(orderId)}},{idempotencyKey:`deadline-phases-${orderId}`});
}
