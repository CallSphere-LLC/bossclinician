import {describe,it,expect,vi} from "vitest";
const api=vi.hoisted(()=>({subscriptions:{retrieve:vi.fn()},subscriptionSchedules:{retrieve:vi.fn(),create:vi.fn(),update:vi.fn()}}));
vi.mock("../stripe/client",()=>({stripe:()=>api}));
import {ensureDeadlineStripeSchedule} from "./deadlineStripe";
describe("finite Stripe schedule",()=>{
  it("retains the anniversary, applies the rounded final charge, and cancels",async()=>{
    const anchor=Date.parse("2026-10-21T12:00:00Z")/1000;
    api.subscriptions.retrieve.mockResolvedValue({id:"sub_test",status:"active",billing_cycle_anchor:anchor,schedule:null,items:{data:[{price:{id:"price_test",product:"prod_test",currency:"usd"}}]}});
    api.subscriptionSchedules.create.mockResolvedValue({id:"sched_test",current_phase:{start_date:anchor},metadata:{}});
    await ensureDeadlineStripeSchedule("sub_test",4,{installment_count:8,amount_cents:71428,final_installment_cents:71432,balance_due_by:"2027-06-08"});
    const params=api.subscriptionSchedules.update.mock.calls[0][1];
    expect(params.end_behavior).toBe("cancel");
    expect(params.proration_behavior).toBe("none");
    expect(new Date(params.phases[1].start_date*1000).toISOString()).toBe("2027-05-21T12:00:00.000Z");
    expect(params.phases[1].items[0].price_data.unit_amount).toBe(71432);
    api.subscriptions.retrieve.mockResolvedValue({...await api.subscriptions.retrieve(),schedule:"sched_test"});
    api.subscriptionSchedules.retrieve.mockResolvedValue({id:"sched_test",metadata:{bossDeadlineOrder:"4"}});
    await ensureDeadlineStripeSchedule("sub_test",4,{installment_count:8,amount_cents:71428,final_installment_cents:71432,balance_due_by:"2027-06-08"});
    expect(api.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
  });
});
