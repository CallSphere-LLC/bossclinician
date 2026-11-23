import { describe, expect, it } from "vitest";
import {
  EMPTY_BALANCE_PLAN_FORM,
  addMonthsClamped,
  centsToDollarInput,
  checkBalancePlan,
  dollarInputProblem,
  formFromPlan,
  formatLongDate,
  formatMoney,
  formatShortDate,
  isEditableState,
  isIsoDate,
  isoDay,
  paidProgress,
  parseDollarsToCents,
  planChip,
  planSentence,
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
    });
    expect(checkBalancePlan(filled).valid).toBe(true);
    expect(formFromPlan(null)).toEqual(EMPTY_BALANCE_PLAN_FORM);
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
