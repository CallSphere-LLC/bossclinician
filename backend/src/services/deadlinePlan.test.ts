import { describe,it,expect } from "vitest";
import { deadlinePlan } from "./deadlinePlan";
describe("deadline deposit schedules",()=>{
  it.each(["2026-10-21","2026-11-08","2026-11-09","2026-12-31","2027-01-31"])("collects exactly $5500 by June 8 for %s", date=>{
    const p=deadlinePlan(550000,50000,"2027-06-08",new Date(date+"T12:00:00Z"));
    expect(p.schedule[0].amountCents).toBe(50000);
    expect(p.schedule.reduce((a,b)=>a+b.amountCents,0)).toBe(550000);
    expect(p.schedule.at(-1)!.dueAt.slice(0,10)<= "2027-06-08").toBe(true);
    expect(p.schedule.every(x=>Number.isSafeInteger(x.amountCents))).toBe(true);
  });
  it("includes June only for enrollment anniversaries on or before the eighth",()=>{
    expect(deadlinePlan(550000,50000,"2027-06-08",new Date("2026-11-08T12:00:00Z")).installmentCount).toBe(8);
    expect(deadlinePlan(550000,50000,"2027-06-08",new Date("2026-11-09T12:00:00Z")).installmentCount).toBe(7);
  });
  it("refuses a schedule after its deadline",()=>expect(()=>deadlinePlan(550000,50000,"2027-06-08",new Date("2027-06-09"))).toThrow());
});
