import { describe, expect, it } from "vitest";
import {
  EMPTY_BALANCE_PLAN_FORM,
  addMonthsClamped,
  centsToDollarInput,
  checkBalancePlan,
  countPaymentDatesByDeadline,
  daysBetween,
  dollarInputProblem,
  fitToDeadline,
  formFromPlan,
  formatLongDate,
  formatMoney,
  formatShortDate,
  isEditableState,
  isIsoDate,
  isSteppedPlan,
  isoDay,
  paidProgress,
  parseDollarsToCents,
  planChip,
  planSentence,
  planTotalCents,
  projectSchedule,
  sameForm,
  suggestInstallmentCount,
  todayInPacific,
  type BalancePlanForm,
} from "./retreatBalancePlanRules";

const form = (over: Partial<BalancePlanForm> = {}): BalancePlanForm => ({
  ...EMPTY_BALANCE_PLAN_FORM,
  agreedTotal: "5,000",
  priorPaid: "2,000",
  installment: "600",
  installmentCount: "5",
  firstChargeOn: "2027-01-15",
  finalDueOn: "2027-06-01",
  ...over,
});

describe("reading dollar amounts", () => {
  it("reads plain, comma and decimal amounts as cents", () => {
    expect(parseDollarsToCents("1,500")).toBe(150000);
    expect(parseDollarsToCents("1500.00")).toBe(150000);
    expect(parseDollarsToCents("1500")).toBe(150000);
    expect(parseDollarsToCents(" $1,500.5 ")).toBe(150050);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents(".75")).toBe(75);
    expect(parseDollarsToCents("12.")).toBe(1200);
    expect(parseDollarsToCents("23,456.78")).toBe(2345678);
  });

  it("takes amounts up to $100,000, the same cap as the server, and nothing above it", () => {
    expect(parseDollarsToCents("100,000")).toBe(10000000);
    expect(parseDollarsToCents("100,000.00")).toBe(10000000);
    expect(parseDollarsToCents("100,000.01")).toBeNull();
    expect(parseDollarsToCents("123,456.78")).toBeNull();
    expect(parseDollarsToCents("1,000,000")).toBeNull();
    expect(dollarInputProblem("100,000")).toBe("");
    expect(dollarInputProblem("100,000.01")).toMatch(/too large.*\$100,000\.00/);
    expect(dollarInputProblem("1,000,000")).toMatch(/too large/);
  });

  it("does not lose a cent to floating point", () => {
    expect(parseDollarsToCents("1.15")).toBe(115);
    expect(parseDollarsToCents("19.99")).toBe(1999);
    expect(parseDollarsToCents("4.35")).toBe(435);
    expect(parseDollarsToCents("1005.10")).toBe(100510);
  });

  it("refuses negatives, bad grouping, extra decimals and words", () => {
    expect(parseDollarsToCents("-50")).toBeNull();
    expect(parseDollarsToCents("$-50")).toBeNull();
    expect(parseDollarsToCents("1,50")).toBeNull();
    expect(parseDollarsToCents("15,00.00")).toBeNull();
    expect(parseDollarsToCents("10.999")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("1e3")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("   ")).toBeNull();
    expect(parseDollarsToCents(".")).toBeNull();
    expect(parseDollarsToCents("$")).toBeNull();
    expect(parseDollarsToCents("99999999999")).toBeNull();
  });

  it("explains what is wrong with a box, and stays quiet for empty or good ones", () => {
    expect(dollarInputProblem("")).toBe("");
    expect(dollarInputProblem("1,500")).toBe("");
    expect(dollarInputProblem("-50")).toMatch(/minus/);
    expect(dollarInputProblem("$-50")).toMatch(/minus/);
    expect(dollarInputProblem("10.999")).toMatch(/dollars and cents/);
    expect(dollarInputProblem("99999999999")).toMatch(/too large/);
    expect(dollarInputProblem("lots")).toMatch(/dollar amount/);
  });

  it("formats cents for a box and for display", () => {
    expect(centsToDollarInput(150000)).toBe("1,500.00");
    expect(centsToDollarInput(50)).toBe("0.50");
    expect(parseDollarsToCents(centsToDollarInput(2345678))).toBe(2345678);
    expect(formatMoney(150000)).toBe("$1,500.00");
    expect(formatMoney(60000, "USD")).toBe("$600.00");
    expect(planSentence(5, 60000)).toBe("5 payments of $600.00 = $3,000.00");
    expect(planSentence(1, 60000)).toBe("1 payment of $600.00 = $600.00");
  });
});

describe("dates", () => {
  it("adds months and clamps to the end of a shorter month", () => {
    expect(addMonthsClamped("2027-01-15", 1)).toBe("2027-02-15");
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2027-01-31", 3)).toBe("2027-04-30");
    expect(addMonthsClamped("2027-08-31", 1)).toBe("2027-09-30");
    expect(addMonthsClamped("2027-11-30", 2)).toBe("2028-01-30");
    expect(addMonthsClamped("2027-12-31", 1)).toBe("2028-01-31");
    expect(addMonthsClamped("2027-03-10", 0)).toBe("2027-03-10");
    expect(addMonthsClamped("not a date", 1)).toBe("");
  });

  it("knows a real calendar day from a made-up one", () => {
    expect(isIsoDate("2027-02-28")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2027-13-01")).toBe(false);
    expect(isIsoDate("2027-04-31")).toBe(false);
    expect(isIsoDate("2027-01-05T00:00:00.000Z")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isoDay("2027-01-05T00:00:00.000Z")).toBe("2027-01-05");
    expect(isoDay(null)).toBe("");
  });

  it("formats dates without a time-zone shift", () => {
    expect(formatLongDate("2027-01-05")).toBe("January 5, 2027");
    expect(formatShortDate("2027-01-05")).toBe("Jan 5, 2027");
    expect(formatShortDate("2027-12-31")).toBe("Dec 31, 2027");
    expect(formatLongDate("")).toBe("");
  });

  it("uses the Pacific date for today", () => {
    // 06:30 UTC on 1 March is still 28 February in California.
    expect(todayInPacific(new Date("2027-03-01T06:30:00Z"))).toBe("2027-02-28");
    expect(todayInPacific(new Date("2027-03-01T20:00:00Z"))).toBe("2027-03-01");
  });
});

describe("projected payment dates", () => {
  it("is one payment a month from the first charge date", () => {
    expect(projectSchedule("2027-01-15", 3, 60000)).toEqual([
      { sequence: 1, amountCents: 60000, dueDate: "2027-01-15" },
      { sequence: 2, amountCents: 60000, dueDate: "2027-02-15" },
      { sequence: 3, amountCents: 60000, dueDate: "2027-03-15" },
    ]);
  });

  it("clamps at month end but returns to the original day afterwards", () => {
    expect(projectSchedule("2027-01-31", 5, 100).map((p) => p.dueDate)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
    expect(projectSchedule("2027-12-30", 3, 100).map((p) => p.dueDate)).toEqual(["2027-12-30", "2028-01-30", "2028-02-29"]);
  });

  it("gives nothing for a bad date or count", () => {
    expect(projectSchedule("", 3, 100)).toEqual([]);
    expect(projectSchedule("2027-02-30", 3, 100)).toEqual([]);
    expect(projectSchedule("2027-01-15", 0, 100)).toEqual([]);
    expect(projectSchedule("2027-01-15", 37, 100)).toEqual([]);
    expect(projectSchedule("2027-01-15", 2.5, 100)).toEqual([]);
  });
});

describe("suggesting the number of payments", () => {
  it("offers the count when the balance divides evenly", () => {
    expect(suggestInstallmentCount(300000, 60000)).toBe(5);
    expect(suggestInstallmentCount(60000, 60000)).toBe(1);
    expect(suggestInstallmentCount(360000, 10000)).toBe(36);
  });

  it("offers nothing when it does not divide, or the answer is out of range", () => {
    expect(suggestInstallmentCount(300000, 70000)).toBeNull();
    expect(suggestInstallmentCount(370000, 10000)).toBeNull();
    expect(suggestInstallmentCount(0, 60000)).toBeNull();
    expect(suggestInstallmentCount(-100, 100)).toBeNull();
    expect(suggestInstallmentCount(300000, 0)).toBeNull();
    expect(suggestInstallmentCount(null, 60000)).toBeNull();
    expect(suggestInstallmentCount(300000, null)).toBeNull();
  });
});

describe("checking a plan before it is saved", () => {
  it("accepts numbers that agree and builds the body to send", () => {
    const check = checkBalancePlan(form({ discount: "500", discountNote: "  Early bird  ", isTest: true }));
    expect(check.valid).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.balanceCents).toBe(300000);
    expect(check.plannedTotalCents).toBe(300000);
    expect(check.lastPaymentDate).toBe("2027-05-15");
    expect(check.schedule).toHaveLength(5);
    expect(check.input).toEqual({
      agreedTotalCents: 500000,
      discountCents: 50000,
      discountNote: "Early bird",
      priorPaidCents: 200000,
      installmentCents: 60000,
      installmentCount: 5,
      stepUpCents: 0,
      stepUpCount: 0,
      firstChargeOn: "2027-01-15",
      finalDueOn: "2027-06-01",
      isTest: true,
    });
  });

  it("treats empty discount, paid-before and deadline as none", () => {
    const check = checkBalancePlan(form({ priorPaid: "", installment: "1000", finalDueOn: "" }));
    expect(check.valid).toBe(true);
    expect(check.input?.priorPaidCents).toBe(0);
    expect(check.input?.discountCents).toBe(0);
    expect(check.input?.finalDueOn).toBeNull();
  });

  it("does not take the discount off again", () => {
    expect(checkBalancePlan(form({ discount: "1,000" })).balanceCents).toBe(300000);
  });

  it("blocks a plan whose payments do not add up to the balance", () => {
    const short = checkBalancePlan(form({ installmentCount: "4" }));
    expect(short.valid).toBe(false);
    expect(short.input).toBeNull();
    expect(short.problems.join(" ")).toMatch(/\$3,000\.00.*4 payments of \$600\.00.*\$2,400\.00.*\$600\.00 short/);

    const over = checkBalancePlan(form({ installmentCount: "6", finalDueOn: "" }));
    expect(over.valid).toBe(false);
    expect(over.problems.join(" ")).toMatch(/too much/);
  });

  it("blocks a last payment after the final deadline, and allows it on the day", () => {
    const late = checkBalancePlan(form({ finalDueOn: "2027-05-14" }));
    expect(late.valid).toBe(false);
    expect(late.problems.join(" ")).toMatch(/May 15, 2027.*after the final payment deadline of May 14, 2027/);
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-15" })).valid).toBe(true);
  });

  it("uses the clamped month-end date for the deadline check", () => {
    const base = { agreedTotal: "200", priorPaid: "0", installment: "100", installmentCount: "2", firstChargeOn: "2027-01-31" };
    expect(checkBalancePlan(form({ ...base, finalDueOn: "2027-02-28" })).valid).toBe(true);
    expect(checkBalancePlan(form({ ...base, finalDueOn: "2027-02-27" })).valid).toBe(false);
  });

  it("names the boxes still to fill in without calling them errors", () => {
    const check = checkBalancePlan({ ...EMPTY_BALANCE_PLAN_FORM });
    expect(check.valid).toBe(false);
    expect(check.missing).toEqual(["Agreed retreat price", "Monthly payment", "Number of payments", "First charge date"]);
    expect(check.fieldErrors).toEqual({});
    expect(check.problems).toEqual([]);
    expect(check.balanceCents).toBeNull();
    expect(check.schedule).toEqual([]);
  });

  it("puts a readable error on the box that is wrong", () => {
    const check = checkBalancePlan(form({ agreedTotal: "-5000", installment: "0", installmentCount: "2.5", priorPaid: "two grand" }));
    expect(check.valid).toBe(false);
    expect(check.fieldErrors.agreedTotal).toMatch(/minus/);
    expect(check.fieldErrors.installment).toMatch(/more than 0/);
    expect(check.fieldErrors.installmentCount).toMatch(/whole number from 1 to 36/);
    expect(check.fieldErrors.priorPaid).toMatch(/dollar amount/);
    expect(checkBalancePlan(form({ installmentCount: "0" })).fieldErrors.installmentCount).toBeTruthy();
    expect(checkBalancePlan(form({ installmentCount: "37" })).fieldErrors.installmentCount).toBeTruthy();
    expect(checkBalancePlan(form({ firstChargeOn: "2027-02-30" })).fieldErrors.firstChargeOn).toBeTruthy();
  });

  it("blocks a plan with nothing left to pay or more paid than the price", () => {
    expect(checkBalancePlan(form({ priorPaid: "5,000" })).problems.join(" ")).toMatch(/nothing left to pay/);
    const overpaid = checkBalancePlan(form({ priorPaid: "6,000" }));
    expect(overpaid.valid).toBe(false);
    expect(overpaid.problems.join(" ")).toMatch(/more than the agreed price/);
    expect(overpaid.suggestedCount).toBeNull();
  });

  it("offers the count that clears the balance", () => {
    expect(checkBalancePlan(form({ installmentCount: "" })).suggestedCount).toBe(5);
    expect(checkBalancePlan(form({ installmentCount: "4" })).suggestedCount).toBe(5);
    expect(checkBalancePlan(form({ installment: "700" })).suggestedCount).toBeNull();
  });

  it("warns, without blocking, when the first charge date has passed", () => {
    const past = checkBalancePlan(form(), { today: "2027-01-16" });
    expect(past.valid).toBe(true);
    expect(past.warnings.join(" ")).toMatch(/already passed/);
    expect(past.startsLate).toBe(true);
    // The dates shown are counted from today, the earliest they can really happen.
    expect(past.schedule.map((p) => p.dueDate)).toEqual(["2027-01-16", "2027-02-16", "2027-03-16", "2027-04-16", "2027-05-16"]);
    expect(past.lastPaymentDate).toBe("2027-05-16");
    expect(past.warnings).toHaveLength(1);
    expect(past.problems).toEqual([]);

    expect(checkBalancePlan(form(), { today: "2027-01-15" }).startsLate).toBe(false);
    expect(checkBalancePlan(form(), { today: "2027-01-15" }).warnings).toEqual([]);
    expect(checkBalancePlan(form()).warnings).toEqual([]);
  });

  it("checks the deadline from the later of the first charge date and today, as the server does", () => {
    // On the typed date the last payment (May 15) meets the deadline, but the
    // date has passed: counted from today it lands on May 16, and the server
    // would refuse the save. So it blocks here too.
    const tight = checkBalancePlan(form({ finalDueOn: "2027-05-15" }), { today: "2027-01-16" });
    expect(tight.valid).toBe(false);
    expect(tight.input).toBeNull();
    expect(tight.lastPaymentDate).toBe("2027-05-16");
    expect(tight.problems).toHaveLength(1);
    expect(tight.problems[0]).toMatch(/counted from today.*May 16, 2027.*after the final payment deadline of May 15, 2027/);
    // Only the "already passed" note is left as a warning.
    expect(tight.warnings).toHaveLength(1);
    expect(tight.warnings[0]).toMatch(/already passed/);

    // The deadline on the real last day is fine, and so is the day itself as today.
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-16" }), { today: "2027-01-16" }).valid).toBe(true);
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-15" }), { today: "2027-01-15" }).valid).toBe(true);
    // A first charge date still ahead is counted from itself, whatever today is.
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-15" }), { today: "2026-11-23" }).valid).toBe(true);
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-14" }), { today: "2026-11-23" }).valid).toBe(false);
  });

  it("takes money already collected on this site off the balance", () => {
    const check = checkBalancePlan(form({ installmentCount: "3" }), { paidHereCents: 120000 });
    expect(check.balanceCents).toBe(180000);
    expect(check.valid).toBe(true);
  });
});

describe("larger last payments", () => {
  // Sharon: $2,800 = 4 x $400 + 2 x $600, charged on the 12th, due by June 8.
  const sharon = (over: Partial<BalancePlanForm> = {}): BalancePlanForm => ({
    ...EMPTY_BALANCE_PLAN_FORM,
    agreedTotal: "2,800",
    priorPaid: "0",
    installment: "400",
    installmentCount: "6",
    stepUp: true,
    stepUpAmount: "600",
    stepUpCount: "2",
    firstChargeOn: "2026-12-12",
    finalDueOn: "2027-06-08",
    ...over,
  });

  it("adds up as regular x (count - N) + larger x N", () => {
    expect(planTotalCents(6, 40000, 60000, 2)).toBe(280000);
    expect(planTotalCents(6, 25000, 50000, 2)).toBe(200000);
    expect(planTotalCents(5, 60000)).toBe(300000);
    expect(planTotalCents(5, 60000, 0, 0)).toBe(300000);
    expect(isSteppedPlan(6, 60000, 2)).toBe(true);
    expect(isSteppedPlan(6, 60000, 5)).toBe(true);
    // At least one regular payment first, and both numbers or neither.
    expect(isSteppedPlan(6, 60000, 6)).toBe(false);
    expect(isSteppedPlan(6, 60000, 0)).toBe(false);
    expect(isSteppedPlan(6, 0, 2)).toBe(false);
    expect(isSteppedPlan(6, undefined, undefined)).toBe(false);
    expect(isSteppedPlan(6, null, null)).toBe(false);
  });

  it("says the plan in the owner's words", () => {
    expect(planSentence(6, 40000, "usd", 60000, 2)).toBe("4 payments of $400.00, then 2 payments of $600.00 = $2,800.00");
    expect(planSentence(6, 25000, "usd", 50000, 2)).toBe("4 payments of $250.00, then 2 payments of $500.00 = $2,000.00");
    expect(planSentence(2, 40000, "usd", 60000, 1)).toBe("1 payment of $400.00, then 1 payment of $600.00 = $1,000.00");
    // Numbers that do not make a stepped plan read as equal payments.
    expect(planSentence(2, 40000, "usd", 60000, 2)).toBe("2 payments of $400.00 = $800.00");
    expect(planSentence(5, 60000, "usd", 0, 0)).toBe("5 payments of $600.00 = $3,000.00");
  });

  it("gives the last payments their own amount on their own dates", () => {
    expect(projectSchedule("2026-12-12", 6, 40000, 60000, 2)).toEqual([
      { sequence: 1, amountCents: 40000, dueDate: "2026-12-12" },
      { sequence: 2, amountCents: 40000, dueDate: "2027-01-12" },
      { sequence: 3, amountCents: 40000, dueDate: "2027-02-12" },
      { sequence: 4, amountCents: 40000, dueDate: "2027-03-12" },
      { sequence: 5, amountCents: 60000, dueDate: "2027-04-12" },
      { sequence: 6, amountCents: 60000, dueDate: "2027-05-12" },
    ]);
    expect(projectSchedule("2026-12-12", 3, 40000, 0, 0).map((p) => p.amountCents)).toEqual([40000, 40000, 40000]);
    expect(projectSchedule("2026-12-12", 3, 40000, 60000, 3).map((p) => p.amountCents)).toEqual([40000, 40000, 40000]);
  });

  it("accepts a plan whose two amounts clear the balance, and sends both numbers", () => {
    const check = checkBalancePlan(sharon(), { today: "2026-11-23" });
    expect(check.valid).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.fieldErrors).toEqual({});
    expect(check.balanceCents).toBe(280000);
    expect(check.plannedTotalCents).toBe(280000);
    expect(check.stepUp).toBe(true);
    expect(check.stepUpReady).toBe(true);
    expect(check.stepUpCents).toBe(60000);
    expect(check.stepUpCount).toBe(2);
    expect(check.schedule.map((p) => p.amountCents)).toEqual([40000, 40000, 40000, 40000, 60000, 60000]);
    expect(check.firstPaymentDate).toBe("2026-12-12");
    expect(check.lastPaymentDate).toBe("2027-05-12");
    expect(check.input).toEqual({
      agreedTotalCents: 280000,
      discountCents: 0,
      discountNote: "",
      priorPaidCents: 0,
      installmentCents: 40000,
      installmentCount: 6,
      stepUpCents: 60000,
      stepUpCount: 2,
      firstChargeOn: "2026-12-12",
      finalDueOn: "2027-06-08",
      isTest: false,
    });
  });

  it("sends 0 and 0 when the box is not ticked, whatever is left in the hidden boxes", () => {
    const check = checkBalancePlan(form({ stepUp: false, stepUpAmount: "not a number", stepUpCount: "99" }));
    expect(check.valid).toBe(true);
    expect(check.fieldErrors).toEqual({});
    expect(check.stepUp).toBe(false);
    expect(check.input?.stepUpCents).toBe(0);
    expect(check.input?.stepUpCount).toBe(0);
    expect(check.schedule.map((p) => p.amountCents)).toEqual([60000, 60000, 60000, 60000, 60000]);
  });

  it("blocks amounts that do not clear the balance, and says the numbers", () => {
    const short = checkBalancePlan(sharon({ stepUpAmount: "500" }));
    expect(short.valid).toBe(false);
    expect(short.input).toBeNull();
    expect(short.problems.join(" ")).toMatch(/\$2,800\.00.*4 payments of \$400\.00 and 2 payments of \$500\.00 come to \$2,600\.00.*\$200\.00 short/);
    const over = checkBalancePlan(sharon({ stepUpCount: "3" }));
    expect(over.valid).toBe(false);
    expect(over.problems.join(" ")).toMatch(/3 payments of \$400\.00 and 3 payments of \$600\.00 come to \$3,000\.00.*\$200\.00 too much/);
    // The plain plan no longer passes for this balance either: 6 x $400 is $2,400.
    expect(checkBalancePlan(sharon({ stepUp: false })).valid).toBe(false);
  });

  it("needs the larger amount to be more than the monthly payment", () => {
    for (const amount of ["400", "399.99", "100"]) {
      const check = checkBalancePlan(sharon({ stepUpAmount: amount }));
      expect(check.valid).toBe(false);
      expect(check.fieldErrors.stepUpAmount).toMatch(/more than the monthly payment of \$400\.00/);
      // The half-right plan is not also called "short".
      expect(check.problems).toEqual([]);
      expect(check.plannedTotalCents).toBeNull();
    }
    expect(checkBalancePlan(sharon({ stepUpAmount: "0" })).fieldErrors.stepUpAmount).toMatch(/more than 0/);
    expect(checkBalancePlan(sharon({ stepUpAmount: "-600" })).fieldErrors.stepUpAmount).toMatch(/minus/);
    expect(checkBalancePlan(sharon({ stepUpAmount: "400.01", stepUpCount: "1" })).fieldErrors.stepUpAmount).toBeUndefined();
  });

  it("needs at least one regular payment before the larger ones", () => {
    expect(checkBalancePlan(sharon({ stepUpCount: "6" })).fieldErrors.stepUpCount).toMatch(/whole number from 1 to 5/);
    expect(checkBalancePlan(sharon({ stepUpCount: "7" })).fieldErrors.stepUpCount).toMatch(/whole number from 1 to 5/);
    expect(checkBalancePlan(sharon({ stepUpCount: "0" })).fieldErrors.stepUpCount).toMatch(/whole number from 1 to 5/);
    expect(checkBalancePlan(sharon({ stepUpCount: "2.5" })).fieldErrors.stepUpCount).toMatch(/whole number from 1 to 5/);
    expect(checkBalancePlan(sharon({ stepUpCount: "two" })).valid).toBe(false);
    expect(checkBalancePlan(sharon({ installmentCount: "2", stepUpCount: "2" })).fieldErrors.stepUpCount).toMatch(/Enter 1/);
    expect(checkBalancePlan(sharon({ installmentCount: "1", stepUpCount: "1" })).fieldErrors.stepUpCount).toMatch(/1 payment cannot/);
    expect(checkBalancePlan(sharon({ stepUpCount: "5" })).fieldErrors.stepUpCount).toBeUndefined();
  });

  it("asks for both boxes once the box is ticked, and holds the dates list back until then", () => {
    const check = checkBalancePlan(sharon({ stepUpAmount: "", stepUpCount: "" }));
    expect(check.valid).toBe(false);
    expect(check.input).toBeNull();
    expect(check.missing).toEqual(["Larger payment amount", "How many of the last payments"]);
    expect(check.fieldErrors).toEqual({});
    expect(check.problems).toEqual([]);
    expect(check.stepUpReady).toBe(false);
    expect(check.plannedTotalCents).toBeNull();
    expect(check.schedule).toEqual([]);
    // The dates do not depend on the amounts, so the deadline is still checked.
    expect(check.lastPaymentDate).toBe("2027-05-12");
    expect(checkBalancePlan(sharon({ stepUpAmount: "", stepUpCount: "", finalDueOn: "2027-05-11" })).problems.join(" ")).toMatch(/after the final payment deadline/);
  });

  it("still checks the deadline from the later of the first charge date and today", () => {
    expect(checkBalancePlan(sharon(), { today: "2027-01-08" }).valid).toBe(true);
    const late = checkBalancePlan(sharon(), { today: "2027-01-09" });
    expect(late.valid).toBe(false);
    expect(late.lastPaymentDate).toBe("2027-06-09");
    expect(late.problems.join(" ")).toMatch(/counted from today.*June 9, 2027.*after the final payment deadline of June 8, 2027/);
  });

  it("suggests the number of payments with the same equation", () => {
    expect(suggestInstallmentCount(280000, 40000, 60000, 2)).toBe(6);
    expect(suggestInstallmentCount(200000, 25000, 50000, 2)).toBe(6);
    expect(suggestInstallmentCount(100000, 40000, 60000, 1)).toBe(2);
    expect(suggestInstallmentCount(280000, 40000, 70000, 2)).toBeNull();
    // Nothing would be left for a regular payment.
    expect(suggestInstallmentCount(120000, 40000, 60000, 2)).toBeNull();
    // Not larger than the regular amount.
    expect(suggestInstallmentCount(280000, 40000, 40000, 2)).toBeNull();
    expect(suggestInstallmentCount(280000, 40000, 60000, 0)).toBeNull();
    // More than 36 payments in all.
    expect(suggestInstallmentCount(1480000, 40000, 60000, 2)).toBe(36);
    expect(suggestInstallmentCount(1520000, 40000, 60000, 2)).toBeNull();

    expect(checkBalancePlan(sharon()).suggestedCount).toBe(6);
    expect(checkBalancePlan(sharon({ installmentCount: "5" })).suggestedCount).toBe(6);
    expect(checkBalancePlan(sharon({ installmentCount: "" })).suggestedCount).toBe(6);
    // Too many larger payments for the count typed so far: the suggestion still finds the count that works.
    const tooMany = checkBalancePlan(sharon({ installmentCount: "2" }));
    expect(tooMany.fieldErrors.stepUpCount).toBeTruthy();
    expect(tooMany.suggestedCount).toBe(6);
    expect(tooMany.typedStepUpCents).toBe(60000);
    expect(tooMany.typedStepUpCount).toBe(2);
    expect(checkBalancePlan(sharon({ stepUpAmount: "700" })).suggestedCount).toBeNull();
    expect(checkBalancePlan(sharon({ stepUpAmount: "" })).suggestedCount).toBeNull();
    // Unticked, the plain rule is used: $2,800 at $400 is 7 payments.
    expect(checkBalancePlan(sharon({ stepUp: false })).suggestedCount).toBe(7);
  });
});

describe("a deadline that is only just met", () => {
  it("counts whole days between two dates", () => {
    expect(daysBetween("2027-05-12", "2027-06-08")).toBe(27);
    expect(daysBetween("2027-01-01", "2027-01-01")).toBe(0);
    expect(daysBetween("2027-03-01", "2027-02-28")).toBe(-1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("", "2027-01-01")).toBeNull();
    expect(daysBetween("2027-02-30", "2027-03-01")).toBeNull();
  });

  it("is flagged when the last payment is 31 days or fewer before the deadline", () => {
    // Last payment May 15, 2027.
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-15" })).deadlineIsClose).toBe(true);
    expect(checkBalancePlan(form({ finalDueOn: "2027-06-01" })).deadlineIsClose).toBe(true);
    expect(checkBalancePlan(form({ finalDueOn: "2027-06-15" })).deadlineIsClose).toBe(true);
    expect(checkBalancePlan(form({ finalDueOn: "2027-06-16" })).deadlineIsClose).toBe(false);
    // No deadline, or a deadline already missed (that one is an error instead).
    expect(checkBalancePlan(form({ finalDueOn: "" })).deadlineIsClose).toBe(false);
    expect(checkBalancePlan(form({ finalDueOn: "2027-05-14" })).deadlineIsClose).toBe(false);
  });

  it("names the day the payments are really counted from", () => {
    expect(checkBalancePlan(form()).firstPaymentDate).toBe("2027-01-15");
    expect(checkBalancePlan(form(), { today: "2027-01-20" }).firstPaymentDate).toBe("2027-01-20");
    expect(checkBalancePlan(form({ firstChargeOn: "" })).firstPaymentDate).toBe("");
  });
});

describe("fitting a plan to the deadline", () => {
  const today = "2026-11-23";

  it("counts the monthly dates on or before the deadline", () => {
    expect(countPaymentDatesByDeadline("2026-12-12", "2027-06-08")).toBe(6);
    expect(countPaymentDatesByDeadline("2026-12-21", "2027-06-08")).toBe(6);
    expect(countPaymentDatesByDeadline("2026-12-12", "2027-06-12")).toBe(7);
    expect(countPaymentDatesByDeadline("2026-12-12", "2026-12-12")).toBe(1);
    expect(countPaymentDatesByDeadline("2026-12-12", "2026-12-11")).toBe(0);
    expect(countPaymentDatesByDeadline("2027-01-31", "2027-02-28")).toBe(2);
    expect(countPaymentDatesByDeadline("2026-12-12", "2099-01-01")).toBe(36);
    expect(countPaymentDatesByDeadline("", "2027-06-08")).toBe(0);
  });

  it("Sharon: $2,800 at $400 from December 12 becomes 4 x $400 then 2 x $600", () => {
    expect(fitToDeadline({ balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "stepped",
      count: 6,
      stepUpCount: 2,
      stepUpCents: 60000,
      datesThatFit: 6,
    });
  });

  it("Norma: $2,000 at $250 from December 21 becomes 4 x $250 then 2 x $500", () => {
    expect(fitToDeadline({ balanceCents: 200000, installmentCents: 25000, firstChargeOn: "2026-12-21", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "stepped",
      count: 6,
      stepUpCount: 2,
      stepUpCents: 50000,
      datesThatFit: 6,
    });
  });

  it("Raelara: $1,500 at $250 is 6 equal payments, with nothing made larger", () => {
    expect(fitToDeadline({ balanceCents: 150000, installmentCents: 25000, firstChargeOn: "2026-12-21", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "even",
      count: 6,
      datesThatFit: 6,
    });
    // Finishing early is fine too: 4 equal payments when 6 dates fit.
    expect(fitToDeadline({ balanceCents: 100000, installmentCents: 25000, firstChargeOn: "2026-12-21", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "even",
      count: 4,
      datesThatFit: 6,
    });
  });

  it("gives a plan that passes the check when it is put in the boxes", () => {
    const cases = [
      { balance: "2,800", regular: "400", balanceCents: 280000, regularCents: 40000, first: "2026-12-12" },
      { balance: "2,000", regular: "250", balanceCents: 200000, regularCents: 25000, first: "2026-12-21" },
      { balance: "1,400", regular: "250", balanceCents: 140000, regularCents: 25000, first: "2026-12-21" },
      { balance: "2,501", regular: "400", balanceCents: 250100, regularCents: 40000, first: "2026-12-12" },
    ];
    for (const c of cases) {
      const fit = fitToDeadline({ balanceCents: c.balanceCents, installmentCents: c.regularCents, firstChargeOn: c.first, finalDueOn: "2027-06-08", today });
      expect(fit?.kind).toBe("stepped");
      if (fit?.kind !== "stepped") continue;
      expect(planTotalCents(fit.count, c.regularCents, fit.stepUpCents, fit.stepUpCount)).toBe(c.balanceCents);
      const check = checkBalancePlan(
        {
          ...EMPTY_BALANCE_PLAN_FORM,
          agreedTotal: c.balance,
          installment: c.regular,
          installmentCount: String(fit.count),
          stepUp: true,
          stepUpAmount: centsToDollarInput(fit.stepUpCents),
          stepUpCount: String(fit.stepUpCount),
          firstChargeOn: c.first,
          finalDueOn: "2027-06-08",
        },
        { today },
      );
      expect(check.problems).toEqual([]);
      expect(check.valid).toBe(true);
    }
  });

  it("uses fewer payments when the regular amount would finish early but not evenly", () => {
    // $1,400 at $250: 6 dates fit, but 5 payments is the most that leaves the last ones larger.
    expect(fitToDeadline({ balanceCents: 140000, installmentCents: 25000, firstChargeOn: "2026-12-21", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "stepped",
      count: 5,
      stepUpCount: 2,
      stepUpCents: 32500,
      datesThatFit: 6,
    });
  });

  it("prefers a whole-dollar larger amount, and one larger payment only when nothing else works", () => {
    // $2,501 at $400 over 6 dates: 2, 3, 4 or 5 larger payments all need cents; 1 x $501 does not.
    expect(fitToDeadline({ balanceCents: 250100, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "stepped",
      count: 6,
      stepUpCount: 1,
      stepUpCents: 50100,
      datesThatFit: 6,
    });
    // Two dates only: the last payment is the larger one, to the cent when it has to be.
    expect(fitToDeadline({ balanceCents: 100000, installmentCents: 40000, firstChargeOn: "2027-05-01", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "stepped",
      count: 2,
      stepUpCount: 1,
      stepUpCents: 60000,
      datesThatFit: 2,
    });
    expect(fitToDeadline({ balanceCents: 100050, installmentCents: 40000, firstChargeOn: "2027-05-01", finalDueOn: "2027-06-08", today })).toEqual({
      kind: "stepped",
      count: 2,
      stepUpCount: 1,
      stepUpCents: 60050,
      datesThatFit: 2,
    });
  });

  it("counts from today when the first charge date has passed", () => {
    // From January 9 only 5 dates fit (the sixth would be June 9).
    expect(fitToDeadline({ balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08", today: "2027-01-09" })).toEqual({
      kind: "stepped",
      count: 5,
      stepUpCount: 2,
      stepUpCents: 80000,
      datesThatFit: 5,
    });
    // A first charge date still ahead is counted from itself.
    expect(fitToDeadline({ balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08", today: "2026-12-12" })?.kind).toBe("stepped");
    expect(fitToDeadline({ balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08" })).toEqual({
      kind: "stepped",
      count: 6,
      stepUpCount: 2,
      stepUpCents: 60000,
      datesThatFit: 6,
    });
  });

  it("says when the monthly payment has to change instead", () => {
    // One date fits: a single payment cannot be part regular, part larger.
    expect(fitToDeadline({ balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2027-06-01", finalDueOn: "2027-06-08", today })).toEqual({ kind: "raise", datesThatFit: 1 });
    // The larger amount would be over the $100,000 cap.
    expect(fitToDeadline({ balanceCents: 10000200, installmentCents: 100, firstChargeOn: "2027-05-01", finalDueOn: "2027-06-08", today })).toEqual({ kind: "raise", datesThatFit: 2 });
    expect(fitToDeadline({ balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2027-07-01", finalDueOn: "2027-06-08", today })).toEqual({ kind: "no-dates" });
    expect(fitToDeadline({ balanceCents: 30000, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08", today })).toEqual({ kind: "too-much", datesThatFit: 6 });
  });

  it("waits until every number and date is there", () => {
    const whole = { balanceCents: 280000, installmentCents: 40000, firstChargeOn: "2026-12-12", finalDueOn: "2027-06-08", today };
    expect(fitToDeadline({ ...whole, balanceCents: null })).toBeNull();
    expect(fitToDeadline({ ...whole, balanceCents: 0 })).toBeNull();
    expect(fitToDeadline({ ...whole, installmentCents: null })).toBeNull();
    expect(fitToDeadline({ ...whole, installmentCents: 0 })).toBeNull();
    expect(fitToDeadline({ ...whole, firstChargeOn: "" })).toBeNull();
    expect(fitToDeadline({ ...whole, finalDueOn: "" })).toBeNull();
    expect(fitToDeadline({ ...whole, finalDueOn: "2027-02-30" })).toBeNull();
  });
});

describe("the editor form", () => {
  const plan = {
    id: 1,
    retreatId: 2,
    memberId: 3,
    memberName: "Test Guest",
    memberEmail: "guest@example.com",
    agreedTotalCents: 500000,
    discountCents: 0,
    discountNote: "",
    priorPaidCents: 200000,
    installmentCents: 60000,
    installmentCount: 5,
    firstChargeOn: "2027-01-15T00:00:00.000Z",
    finalDueOn: null,
    currency: "usd",
    status: "draft" as const,
    state: "draft" as const,
    isTest: false,
    cardBrand: null,
    cardLast4: null,
    authorizedAt: null,
    authorizationText: "",
    cardAddedAt: null,
    billingStartedAt: null,
    ownerNotifiedAt: null,
    requestEmailSentAt: null,
    lastError: "",
    paidHereCents: 0,
    remainingCents: 300000,
    schedule: [],
    stripeSubscriptionId: null,
    createdAt: "2026-11-23T00:00:00Z",
    updatedAt: "2026-11-23T00:00:00Z",
  };

  it("fills the boxes from a saved plan, and that plan passes its own check", () => {
    const filled = formFromPlan(plan);
    expect(filled).toEqual({
      agreedTotal: "5,000.00",
      discount: "",
      discountNote: "",
      priorPaid: "2,000.00",
      installment: "600.00",
      installmentCount: "5",
      firstChargeOn: "2027-01-15",
      finalDueOn: "",
      isTest: false,
      stepUp: false,
      stepUpAmount: "",
      stepUpCount: "",
    });
    expect(checkBalancePlan(filled).valid).toBe(true);
    expect(formFromPlan(null)).toEqual(EMPTY_BALANCE_PLAN_FORM);
  });

  it("fills the larger last payments from a saved plan that has them", () => {
    const stepped = { ...plan, agreedTotalCents: 280000, priorPaidCents: 0, installmentCents: 40000, installmentCount: 6, stepUpCents: 60000, stepUpCount: 2, scheduleInstalledAt: null };
    const filled = formFromPlan(stepped);
    expect(filled.stepUp).toBe(true);
    expect(filled.stepUpAmount).toBe("600.00");
    expect(filled.stepUpCount).toBe("2");
    const check = checkBalancePlan(filled);
    expect(check.valid).toBe(true);
    expect(check.input?.stepUpCents).toBe(60000);
    expect(check.input?.stepUpCount).toBe(2);
    // A plan saved with 0 / 0 reads as a plain plan.
    expect(formFromPlan({ ...plan, stepUpCents: 0, stepUpCount: 0 }).stepUp).toBe(false);
  });

  it("ignores the hidden larger-payment boxes when deciding what is unsaved", () => {
    const saved = formFromPlan(plan);
    expect(sameForm(saved, { ...saved, stepUpAmount: "600", stepUpCount: "2" })).toBe(true);
    expect(sameForm(saved, { ...saved, stepUp: true, stepUpAmount: "600", stepUpCount: "2" })).toBe(false);
    const ticked = { ...saved, stepUp: true, stepUpAmount: "600.00", stepUpCount: "2" };
    expect(sameForm(ticked, { ...ticked, stepUpAmount: "$600" })).toBe(true);
    expect(sameForm(ticked, { ...ticked, stepUpAmount: "700" })).toBe(false);
    expect(sameForm(ticked, { ...ticked, stepUpCount: "3" })).toBe(false);
  });

  it("only counts a real change as unsaved", () => {
    const saved = formFromPlan(plan);
    expect(sameForm(saved, { ...saved, agreedTotal: "5000", priorPaid: "$2,000", discount: "0" })).toBe(true);
    expect(sameForm(saved, { ...saved, installment: "700" })).toBe(false);
    expect(sameForm(saved, { ...saved, isTest: true })).toBe(false);
    expect(sameForm(saved, { ...saved, finalDueOn: "2027-06-01" })).toBe(false);
    expect(sameForm(saved, { ...saved, priorPaid: "" })).toBe(false);
  });

  it("allows editing before a card is on file, and again once the plan is cancelled", () => {
    expect(isEditableState(null)).toBe(true);
    expect(isEditableState("draft")).toBe(true);
    expect(isEditableState("open")).toBe(true);
    expect(isEditableState("card_on_file")).toBe(false);
    expect(isEditableState("billing")).toBe(false);
    expect(isEditableState("past_due")).toBe(false);
    expect(isEditableState("completed")).toBe(false);
    // Saving a cancelled plan returns it to draft: that is how a new plan is set up.
    expect(isEditableState("canceled")).toBe(true);
  });
});

describe("the status chip in a guest's row", () => {
  const base = { firstChargeOn: "2027-01-05", installmentCount: 5, schedule: [] };
  const row = (sequence: number, status: "scheduled" | "paid" | "failed" | "skipped") => ({ sequence, amountCents: 60000, dueDate: "2027-01-05", status });

  it("names every state in the owner's words", () => {
    expect(planChip(null)).toEqual({ label: "No plan", tone: "neutral" });
    expect(planChip(undefined).label).toBe("No plan");
    expect(planChip({ ...base, state: "draft" }).label).toBe("Draft");
    expect(planChip({ ...base, state: "open" }).label).toBe("Waiting for card");
    expect(planChip({ ...base, state: "card_on_file" }).label).toBe("Card on file (first charge Jan 5, 2027)");
    expect(planChip({ ...base, state: "past_due" })).toEqual({ label: "Payment problem", tone: "red" });
    expect(planChip({ ...base, state: "completed" }).label).toBe("Paid in full");
    expect(planChip({ ...base, state: "canceled" }).label).toBe("Cancelled");
  });

  it("counts paid payments from the real schedule", () => {
    const schedule = [row(1, "paid"), row(2, "paid"), row(3, "failed"), row(4, "scheduled"), row(5, "scheduled")];
    expect(planChip({ ...base, state: "billing", schedule }).label).toBe("Charging monthly (2 of 5 paid)");
    expect(paidProgress({ installmentCount: 5, schedule })).toEqual({ paid: 2, count: 5 });
    expect(planChip({ ...base, state: "billing" }).label).toBe("Charging monthly (0 of 5 paid)");
  });
});
