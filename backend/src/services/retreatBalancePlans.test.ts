import { describe, expect, it } from "vitest";
import {
  RETREAT_EMAIL_SIGNATURE,
  addMonthsToDate,
  buildAuthorizationText,
  buildBalanceCompletedEmail,
  buildBalancePaymentFailedEmail,
  buildBalanceReceiptEmail,
  buildCardProblemEmail,
  buildRefundOwnerNote,
  cardLabel,
  greetingFor,
  retreatEmailHtml,
  retreatEmailText,
  buildOwnerNotice,
  buildRequestEmail,
  buildSchedule,
  cardFailureOf,
  currentLinkedPlan,
  deriveState,
  describeSteppedPayments,
  effectiveFirstCharge,
  installmentAmounts,
  planAmountsFromUnpaid,
  planTotalCents,
  scheduleCarriesStepUp,
  stepUpAlertDue,
  stepUpCountOf,
  stepUpPhases,
  guestCardMessage,
  isIsoDate,
  longDate,
  pacificDate,
  pacificToday,
  paidHereCents,
  projectSchedule,
  termsFingerprint,
  validatePlanInput,
  type LinkedPlan,
} from "./retreatBalancePlans";

/**
 * The pure parts of retreat balance plans: no database, no Stripe. These are
 * the rules a guest's consent and the owner's numbers rest on.
 */

const EM_DASH = "—";

function linkedPlan(overrides: Partial<LinkedPlan> & { paid?: number; unpaid?: number; amount?: number }): LinkedPlan {
  const amount = overrides.amount ?? 50000;
  const installments = [];
  let sequence = 1;
  for (let n = 0; n < (overrides.paid ?? 0); n += 1, sequence += 1) {
    installments.push({
      sequence,
      amount_cents: amount,
      due_at: new Date(Date.UTC(2027, n, 5, 20)),
      paid_at: new Date(Date.UTC(2027, n, 5, 20)),
      status: "paid",
    });
  }
  for (let n = 0; n < (overrides.unpaid ?? 0); n += 1, sequence += 1) {
    installments.push({
      sequence,
      amount_cents: amount,
      due_at: new Date(Date.UTC(2027, sequence - 1, 5, 20)),
      paid_at: null,
      status: "scheduled",
    });
  }
  return {
    id: overrides.id ?? 1,
    status: overrides.status ?? "active",
    stripe_subscription_id: overrides.stripe_subscription_id ?? "sub_1",
    created_at: overrides.created_at ?? new Date("2027-01-05T20:00:00Z"),
    installments: overrides.installments ?? installments,
  };
}

describe("Pacific dates", () => {
  it("uses the Pacific calendar date, not UTC", () => {
    // 06:30 UTC on 2 March is still 1 March in Los Angeles (PST, UTC-8).
    expect(pacificDate(new Date("2027-03-02T06:30:00Z"))).toBe("2027-03-01");
    expect(pacificToday(new Date("2027-03-02T08:00:00Z"))).toBe("2027-03-02");
  });

  it("follows daylight saving time", () => {
    // 06:30 UTC on 2 July is 23:30 on 1 July (PDT, UTC-7).
    expect(pacificDate(new Date("2027-07-02T06:30:00Z"))).toBe("2027-07-01");
    expect(pacificDate(new Date("2027-07-02T07:00:00Z"))).toBe("2027-07-02");
  });

  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2027-02-28")).toBe(true);
    expect(isIsoDate("2027-02-30")).toBe(false);
    expect(isIsoDate("2027-2-3")).toBe(false);
    expect(isIsoDate(20270203)).toBe(false);
  });

  it("adds months and clamps to the month's last day", () => {
    expect(addMonthsToDate("2027-01-15", 1)).toBe("2027-02-15");
    expect(addMonthsToDate("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsToDate("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsToDate("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonthsToDate("2026-12-05", 1)).toBe("2027-01-05");
    expect(addMonthsToDate("2027-06-08", 0)).toBe("2027-06-08");
  });

  it("writes a date the way a guest reads it", () => {
    expect(longDate("2027-01-05")).toBe("January 5, 2027");
  });
});

describe("schedule projection", () => {
  it("starts on the first charge date when it is still ahead", () => {
    const rows = projectSchedule({ firstChargeOn: "2026-12-05", today: "2026-11-23", installmentCents: 50000, installmentCount: 4 });
    expect(rows.map((row) => row.dueDate)).toEqual(["2026-12-05", "2027-01-05", "2027-02-05", "2027-03-05"]);
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
    expect(rows.every((row) => row.amountCents === 50000 && row.status === "scheduled")).toBe(true);
  });

  it("starts today when the first charge date has passed", () => {
    expect(effectiveFirstCharge("2026-11-01", "2026-11-23")).toBe("2026-11-23");
    expect(effectiveFirstCharge("2026-11-23", "2026-11-23")).toBe("2026-11-23");
    const rows = projectSchedule({ firstChargeOn: "2026-11-01", today: "2026-11-23", installmentCents: 70000, installmentCount: 2 });
    expect(rows.map((row) => row.dueDate)).toEqual(["2026-11-23", "2026-12-23"]);
  });

  it("projects exactly the number of payments, including a single one", () => {
    const one = projectSchedule({ firstChargeOn: "2027-01-10", today: "2026-11-23", installmentCents: 120000, installmentCount: 1 });
    expect(one).toEqual([{ sequence: 1, amountCents: 120000, dueDate: "2027-01-10", status: "scheduled" }]);
    const total = projectSchedule({ firstChargeOn: "2027-01-31", today: "2026-11-23", installmentCents: 33300, installmentCount: 5 });
    expect(total).toHaveLength(5);
    expect(total.reduce((sum, row) => sum + row.amountCents, 0)).toBe(166500);
    expect(total[1].dueDate).toBe("2027-02-28");
  });

  it("gives the last payments their larger amount, row by row", () => {
    const sharon = { installmentCents: 40000, installmentCount: 6, stepUpCents: 60000, stepUpCount: 2 };
    const rows = projectSchedule({ firstChargeOn: "2026-12-12", today: "2026-11-23", ...sharon });
    expect(rows.map((row) => row.amountCents)).toEqual([40000, 40000, 40000, 40000, 60000, 60000]);
    expect(rows.map((row) => row.dueDate)).toEqual(["2026-12-12", "2027-01-12", "2027-02-12", "2027-03-12", "2027-04-12", "2027-05-12"]);
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(280000);
    expect(installmentAmounts(sharon)).toEqual([40000, 40000, 40000, 40000, 60000, 60000]);
    expect(planTotalCents(sharon)).toBe(280000);
    // Only the first payment regular: the second is already a larger one.
    expect(installmentAmounts({ installmentCents: 10000, installmentCount: 3, stepUpCents: 25000, stepUpCount: 2 })).toEqual([10000, 25000, 25000]);
  });

  it("treats a missing or half-filled step-up as no step-up", () => {
    expect(installmentAmounts({ installmentCents: 50000, installmentCount: 3 })).toEqual([50000, 50000, 50000]);
    expect(installmentAmounts({ installmentCents: 50000, installmentCount: 3, stepUpCents: 0, stepUpCount: 0 })).toEqual([50000, 50000, 50000]);
    expect(installmentAmounts({ installmentCents: 50000, installmentCount: 3, stepUpCents: 90000, stepUpCount: 0 })).toEqual([50000, 50000, 50000]);
    expect(stepUpCountOf({ installmentCents: 50000, installmentCount: 3, stepUpCents: 0, stepUpCount: 2 })).toBe(0);
    expect(planTotalCents({ installmentCents: 50000, installmentCount: 3 })).toBe(150000);
  });

  it("words a stepped plan in one phrase, singular where it is one payment", () => {
    expect(describeSteppedPayments({ installmentCents: 40000, installmentCount: 6, stepUpCents: 60000, stepUpCount: 2 }, "usd")).toBe(
      "4 payments of $400.00, then 2 payments of $600.00",
    );
    expect(describeSteppedPayments({ installmentCents: 40000, installmentCount: 2, stepUpCents: 60000, stepUpCount: 1 }, "usd")).toBe(
      "1 payment of $400.00, then 1 payment of $600.00",
    );
  });
});

describe("reopening after a default", () => {
  it("keeps one amount as a plain plan", () => {
    expect(planAmountsFromUnpaid([50000, 50000, 50000])).toEqual({ installmentCents: 50000, installmentCount: 3, stepUpCents: 0, stepUpCount: 0 });
    // Only the larger payments were left: they become the regular amount.
    expect(planAmountsFromUnpaid([60000, 60000])).toEqual({ installmentCents: 60000, installmentCount: 2, stepUpCents: 0, stepUpCount: 0 });
    expect(planAmountsFromUnpaid([60000])).toEqual({ installmentCents: 60000, installmentCount: 1, stepUpCents: 0, stepUpCount: 0 });
  });

  it("keeps a lower then a higher amount as a stepped plan", () => {
    const rebuilt = planAmountsFromUnpaid([40000, 40000, 40000, 60000, 60000]);
    expect(rebuilt).toEqual({ installmentCents: 40000, installmentCount: 5, stepUpCents: 60000, stepUpCount: 2 });
    expect(planAmountsFromUnpaid([40000, 60000, 60000])).toEqual({ installmentCents: 40000, installmentCount: 3, stepUpCents: 60000, stepUpCount: 2 });
  });

  it("always satisfies the table's rules when it answers", () => {
    for (const unpaid of [[40000, 60000], [40000, 40000, 60000], [25000, 25000, 25000, 25000, 50000, 50000], [70000]]) {
      const rebuilt = planAmountsFromUnpaid(unpaid);
      expect(rebuilt).not.toBeNull();
      if (!rebuilt) continue;
      // The balance equation, with the unpaid rows as the balance.
      expect(planTotalCents(rebuilt)).toBe(unpaid.reduce((sum, amount) => sum + amount, 0));
      expect(installmentAmounts(rebuilt)).toEqual(unpaid);
      expect(rebuilt.stepUpCount).toBeLessThan(rebuilt.installmentCount);
      expect(rebuilt.stepUpCount === 0).toBe(rebuilt.stepUpCents === 0);
      if (rebuilt.stepUpCount > 0) expect(rebuilt.stepUpCents).toBeGreaterThan(rebuilt.installmentCents);
    }
  });

  it("answers null for rows that are not such a plan, so the owner gets a draft", () => {
    expect(planAmountsFromUnpaid([])).toBeNull();
    expect(planAmountsFromUnpaid([40000, 50000, 60000])).toBeNull();
    expect(planAmountsFromUnpaid([60000, 40000])).toBeNull();
    expect(planAmountsFromUnpaid([40000, 60000, 40000])).toBeNull();
    expect(planAmountsFromUnpaid([40000, 0])).toBeNull();
    expect(planAmountsFromUnpaid(new Array(37).fill(10000))).toBeNull();
  });
});

describe("the Stripe phases of a stepped plan", () => {
  // First charge (the billing anchor) on 12 December 2026 at 18:00 UTC.
  const anchor = Date.UTC(2026, 11, 12, 18, 0, 0) / 1000;
  const unix = (isoText: string) => Date.parse(isoText) / 1000;
  const sharon = { installmentCents: 40000, installmentCount: 6, stepUpCents: 60000, stepUpCount: 2 };

  it("puts the regular phase first and the larger phase on the last payments", () => {
    const planned = stepUpPhases({ ...sharon, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: anchor + 60 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { regular, stepUp, stepStart, end } = planned.phases;
    expect(regular).toEqual({ start: anchor, end: unix("2027-04-12T18:00:00Z"), unitAmount: 40000, payments: 4 });
    expect(stepUp).toEqual({ start: unix("2027-04-12T18:00:00Z"), end: unix("2027-06-12T18:00:00Z"), unitAmount: 60000, payments: 2 });
    expect(stepStart).toBe(regular.end);
    expect(end).toBe(stepUp.end);
    // The money the two phases bill is the plan's total, and nothing bills after the end.
    expect(regular.payments * regular.unitAmount + stepUp.payments * stepUp.unitAmount).toBe(planTotalCents(sharon));
    expect(regular.payments + stepUp.payments).toBe(sharon.installmentCount);
  });

  it("ends one month after the last payment, where a further payment would have been raised", () => {
    const planned = stepUpPhases({ ...sharon, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: anchor });
    if (!planned.ok) throw new Error("expected phases");
    // Payments fall on the anchor + 0..5 months; the end is anchor + 6 months.
    expect(new Date(planned.phases.end * 1000).toISOString()).toBe("2027-06-12T18:00:00.000Z");
  });

  it("clamps to the month's last day the way Stripe bills an anchor on the 31st", () => {
    const january = Date.UTC(2027, 0, 31, 12, 0, 0) / 1000;
    const planned = stepUpPhases({ installmentCents: 10000, installmentCount: 3, stepUpCents: 20000, stepUpCount: 2, anchorUnix: january, phaseStartUnix: january, nowUnix: january });
    if (!planned.ok) throw new Error("expected phases");
    expect(new Date(planned.phases.stepStart * 1000).toISOString()).toBe("2027-02-28T12:00:00.000Z");
    expect(new Date(planned.phases.end * 1000).toISOString()).toBe("2027-04-30T12:00:00.000Z");
    expect(planned.phases.regular.payments).toBe(1);
    expect(planned.phases.stepUp.payments).toBe(2);
  });

  it("has nothing to install for a plan with equal payments or a single payment", () => {
    expect(stepUpPhases({ installmentCents: 50000, installmentCount: 4, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: anchor })).toEqual({ ok: false, reason: "not_stepped" });
    expect(stepUpPhases({ installmentCents: 50000, installmentCount: 1, stepUpCents: 0, stepUpCount: 0, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: anchor })).toEqual({ ok: false, reason: "not_stepped" });
    // Never a plan with no regular payment, whatever a row says.
    expect(stepUpPhases({ installmentCents: 50000, installmentCount: 1, stepUpCents: 90000, stepUpCount: 1, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: anchor }).ok).toBe(false);
  });

  it("refuses once the first larger payment's date has arrived, and still says where the boundaries are", () => {
    const stepStart = unix("2027-04-12T18:00:00Z");
    const before = stepUpPhases({ ...sharon, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: stepStart - 1 });
    expect(before.ok).toBe(true);
    const at = stepUpPhases({ ...sharon, anchorUnix: anchor, phaseStartUnix: anchor, nowUnix: stepStart });
    expect(at).toEqual({ ok: false, reason: "too_late", stepStart, end: unix("2027-06-12T18:00:00Z") });
  });

  it("recognises the schedule only when it cancels at the end on the expected boundaries", () => {
    const expected = { stepStart: unix("2027-04-12T18:00:00Z"), end: unix("2027-06-12T18:00:00Z") };
    const phases = [
      { start_date: anchor, end_date: expected.stepStart },
      { start_date: expected.stepStart, end_date: expected.end },
    ];
    expect(scheduleCarriesStepUp({ end_behavior: "cancel", status: "active", phases }, expected)).toBe(true);
    // What `from_subscription` gives before the phases are written: one phase, released at its end.
    expect(scheduleCarriesStepUp({ end_behavior: "release", status: "active", phases: [{ start_date: anchor, end_date: anchor + 2_678_400 }] }, expected)).toBe(false);
    expect(scheduleCarriesStepUp({ end_behavior: "release", status: "active", phases }, expected)).toBe(false);
    expect(scheduleCarriesStepUp({ end_behavior: "cancel", status: "canceled", phases }, expected)).toBe(false);
    expect(scheduleCarriesStepUp({ end_behavior: "cancel", status: "active", phases: [phases[0], { start_date: expected.stepStart, end_date: expected.end + 1 }] }, expected)).toBe(false);
    expect(scheduleCarriesStepUp({ end_behavior: "cancel", status: "active", phases: [{ start_date: anchor, end_date: expected.stepStart + 5 }, phases[1]] }, expected)).toBe(false);
    expect(scheduleCarriesStepUp({ end_behavior: "cancel", status: "active", phases: [] }, expected)).toBe(false);
  });

  it("alerts on the first failure, then daily, and every run from three days before the first larger payment", () => {
    const due = new Date("2027-04-12T18:00:00Z");
    const hour = 3_600_000;
    const now = new Date("2026-12-12T19:00:00Z");
    expect(stepUpAlertDue({ now, lastAlertedAt: null, firstStepUpDueAt: due })).toBe(true);
    expect(stepUpAlertDue({ now, lastAlertedAt: new Date(now.getTime() - hour), firstStepUpDueAt: due })).toBe(false);
    expect(stepUpAlertDue({ now, lastAlertedAt: new Date(now.getTime() - 23 * hour), firstStepUpDueAt: due })).toBe(false);
    expect(stepUpAlertDue({ now, lastAlertedAt: new Date(now.getTime() - 24 * hour), firstStepUpDueAt: due })).toBe(true);
    const close = new Date(due.getTime() - 3 * 24 * hour);
    expect(stepUpAlertDue({ now: close, lastAlertedAt: new Date(close.getTime() - hour), firstStepUpDueAt: due })).toBe(true);
    expect(stepUpAlertDue({ now: new Date(close.getTime() - hour), lastAlertedAt: new Date(close.getTime() - 2 * hour), firstStepUpDueAt: due })).toBe(false);
    expect(stepUpAlertDue({ now: new Date(due.getTime() + hour), lastAlertedAt: new Date(due.getTime()), firstStepUpDueAt: due })).toBe(true);
    expect(stepUpAlertDue({ now, lastAlertedAt: new Date(now.getTime() - hour), firstStepUpDueAt: null })).toBe(false);
  });
});

describe("authorization text", () => {
  const base = { retreatTitle: "Bali 2027", installmentCents: 50000, installmentCount: 4, currency: "usd", today: "2026-11-23" };

  it("states the amount, the count, the total and both end dates", () => {
    const text = buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05" });
    expect(text).toContain("4 monthly payments of $500.00");
    expect(text).toContain("$2,000.00 in total");
    expect(text).toContain("my balance for Bali 2027");
    expect(text).toContain("charged automatically on December 5, 2026");
    expect(text).toContain("the last on March 5, 2027");
    expect(text).not.toContain("today");
  });

  it("says the first payment is charged today when it is due", () => {
    const text = buildAuthorizationText({ ...base, firstChargeOn: "2026-11-01" });
    expect(text).toContain("The first payment is charged today, November 23, 2026");
    expect(text).toContain("the last on February 23, 2027");
  });

  it("words a single payment as a single payment", () => {
    const text = buildAuthorizationText({ ...base, installmentCount: 1, installmentCents: 200000, firstChargeOn: "2027-01-10" });
    expect(text).toContain("one payment of $2,000.00");
    expect(text).toContain("January 10, 2027");
    expect(text).toContain("No other charge will be made");
    expect(text).not.toContain("monthly");
  });

  it("never uses an em dash", () => {
    expect(buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05" })).not.toContain(EM_DASH);
    expect(buildAuthorizationText({ ...base, installmentCount: 1, firstChargeOn: "2026-11-01" })).not.toContain(EM_DASH);
  });

  it("keeps the sentence of a plan with equal payments exactly as it was", () => {
    const expected =
      "I authorize Boss Clinician to charge the card I am adding for 4 monthly payments of $500.00, $2,000.00 in total, " +
      "toward my balance for Bali 2027. The first payment is charged automatically on December 5, 2026, and the last on March 5, 2027. " +
      "Each payment is charged automatically on its date, and the charges stop once $2,000.00 has been paid.";
    expect(buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05" })).toBe(expected);
    // The step-up fields at zero (how every existing plan is stored) change nothing.
    expect(buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05", stepUpCents: 0, stepUpCount: 0 })).toBe(expected);
    expect(termsFingerprint(buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05", stepUpCents: 0, stepUpCount: 0 }))).toBe(termsFingerprint(expected));
  });

  it("words a stepped plan with both amounts, the true total and both end dates", () => {
    const text = buildAuthorizationText({
      retreatTitle: "FlourisHealer Bali 2027",
      installmentCents: 40000,
      installmentCount: 6,
      stepUpCents: 60000,
      stepUpCount: 2,
      currency: "usd",
      firstChargeOn: "2026-12-12",
      today: "2026-11-23",
    });
    expect(text).toBe(
      "I authorize Boss Clinician to charge the card I am adding for 6 monthly payments toward my balance for FlourisHealer Bali 2027: " +
        "4 payments of $400.00, then 2 payments of $600.00, $2,800.00 in total. " +
        "The first payment is charged on December 12, 2026, and the last on May 12, 2027. " +
        "Each payment is charged automatically on its date, and the charges stop once $2,800.00 has been paid.",
    );
    expect(text).not.toContain(EM_DASH);
  });

  it("says a stepped plan's first payment is charged today when it is due", () => {
    const text = buildAuthorizationText({
      ...base,
      installmentCents: 25000,
      installmentCount: 6,
      stepUpCents: 50000,
      stepUpCount: 2,
      firstChargeOn: "2026-11-01",
    });
    expect(text).toContain("4 payments of $250.00, then 2 payments of $500.00, $2,000.00 in total.");
    expect(text).toContain("The first payment is charged today, November 23, 2026, and the last on April 23, 2027.");
    expect(text).toContain("the charges stop once $2,000.00 has been paid.");
  });

  it("gives a stepped plan a different fingerprint from the same plan without the step", () => {
    const plain = buildAuthorizationText({ ...base, installmentCount: 6, firstChargeOn: "2026-12-05" });
    const stepped = buildAuthorizationText({ ...base, installmentCount: 6, stepUpCents: 60000, stepUpCount: 2, firstChargeOn: "2026-12-05" });
    const larger = buildAuthorizationText({ ...base, installmentCount: 6, stepUpCents: 60001, stepUpCount: 2, firstChargeOn: "2026-12-05" });
    const more = buildAuthorizationText({ ...base, installmentCount: 6, stepUpCents: 60000, stepUpCount: 3, firstChargeOn: "2026-12-05" });
    const prints = [plain, stepped, larger, more].map(termsFingerprint);
    expect(new Set(prints).size).toBe(4);
  });

  it("fingerprints the exact sentence", () => {
    const a = buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05" });
    const b = buildAuthorizationText({ ...base, firstChargeOn: "2026-12-05", installmentCents: 50001 });
    expect(termsFingerprint(a)).toBe(termsFingerprint(a));
    expect(termsFingerprint(a)).not.toBe(termsFingerprint(b));
    expect(termsFingerprint(a)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("plan validation", () => {
  const good = {
    agreedTotalCents: 550000,
    discountCents: 0,
    discountNote: "",
    priorPaidCents: 350000,
    installmentCents: 50000,
    installmentCount: 4,
    firstChargeOn: "2026-12-05",
    finalDueOn: "2027-06-08",
    isTest: false,
  };
  const context = { carriedPaidCents: 0, today: "2026-11-23" };

  it("accepts a balance that divides evenly", () => {
    const result = validatePlanInput(good, context);
    expect(result.ok).toBe(true);
    // A plan saved without the step-up fields has none: 0 and 0.
    if (result.ok) expect(result.value).toEqual({ ...good, stepUpCents: 0, stepUpCount: 0 });
  });

  // Sharon: $2,800 still to pay = 4 x $400 + 2 x $600, December to May.
  const sharon = {
    ...good,
    agreedTotalCents: 630000,
    priorPaidCents: 350000,
    installmentCents: 40000,
    installmentCount: 6,
    stepUpCents: 60000,
    stepUpCount: 2,
    firstChargeOn: "2026-12-12",
    finalDueOn: "2027-06-08",
  };

  it("accepts larger last payments that clear the balance exactly", () => {
    const result = validatePlanInput(sharon, context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stepUpCents).toBe(60000);
      expect(result.value.stepUpCount).toBe(2);
      expect(result.value.installmentCents).toBe(40000);
      expect(result.value.installmentCount).toBe(6);
    }
    // Norma: $2,000 = 4 x $250 + 2 x $500.
    expect(
      validatePlanInput(
        { ...sharon, agreedTotalCents: 200000, priorPaidCents: 0, installmentCents: 25000, stepUpCents: 50000, firstChargeOn: "2026-12-21" },
        context,
      ).ok,
    ).toBe(true);
  });

  it("refuses a step-up count that leaves no regular payment", () => {
    for (const stepUpCount of [6, 7]) {
      const result = validatePlanInput({ ...sharon, stepUpCount }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(`The number of larger payments (${stepUpCount}) must be less than the number of payments (6)`);
      }
    }
    // So a single payment can never be stepped.
    const single = validatePlanInput({ ...sharon, installmentCount: 1, installmentCents: 280000, stepUpCents: 300000, stepUpCount: 1 }, context);
    expect(single.ok).toBe(false);
    if (!single.ok) expect(single.error).toContain("must be less than the number of payments (1)");
  });

  it("refuses a larger payment that is not larger", () => {
    for (const stepUpCents of [40000, 39999]) {
      const result = validatePlanInput({ ...sharon, stepUpCents }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("must be more than the regular monthly payment ($400.00)");
    }
  });

  it("refuses a stepped balance that does not add up, and says the numbers", () => {
    const result = validatePlanInput({ ...sharon, stepUpCents: 80000 }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("The balance ($2,800.00) must equal the regular payments plus the larger ones.");
      expect(result.error).toContain("$400.00 x 4 plus $800.00 x 2 is $3,200.00.");
    }
    // The unstepped sentence is not used for a stepped plan, and the other way round.
    const plain = validatePlanInput({ ...sharon, stepUpCents: 0, stepUpCount: 0 }, context);
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.error).toContain("$400.00 x 6 is $2,400.00");
  });

  it("refuses half a step-up: an amount with no count, or a count with no amount", () => {
    for (const half of [{ stepUpCents: 60000, stepUpCount: 0 }, { stepUpCents: 0, stepUpCount: 2 }]) {
      const result = validatePlanInput({ ...sharon, ...half }, context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("enter both the larger payment amount and how many");
    }
    expect(validatePlanInput({ ...sharon, stepUpCount: 1.5 }, context).ok).toBe(false);
    expect(validatePlanInput({ ...sharon, stepUpCents: -1 }, context).ok).toBe(false);
    const over = validatePlanInput({ ...sharon, stepUpCents: 10_000_001 }, context);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain("$100,000.00 or less");
  });

  it("measures a stepped plan's last payment against the final due date", () => {
    // 12 Dec + 5 months = 12 May 2027.
    expect(validatePlanInput({ ...sharon, finalDueOn: "2027-05-12" }, context).ok).toBe(true);
    const late = validatePlanInput({ ...sharon, finalDueOn: "2027-05-11" }, context);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toContain("May 12, 2027");
  });

  it("counts what was already collected here for a stepped plan too", () => {
    // $400 collected by an earlier subscription: 3 x $400 + 2 x $600 remains.
    expect(validatePlanInput({ ...sharon, installmentCount: 5 }, { ...context, carriedPaidCents: 40000 }).ok).toBe(true);
    expect(validatePlanInput(sharon, { ...context, carriedPaidCents: 40000 }).ok).toBe(false);
  });

  it("refuses a balance that is not the monthly amount times the count", () => {
    const result = validatePlanInput({ ...good, installmentCents: 49999 }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("$2,000.00");
      expect(result.error).toContain("$499.99 x 4 is $1,999.96");
    }
  });

  it("counts what earlier subscriptions of the plan already collected", () => {
    // $2,000 was owed, $500 has since been collected here: 3 x $500 remains.
    expect(validatePlanInput({ ...good, installmentCount: 3 }, { ...context, carriedPaidCents: 50000 }).ok).toBe(true);
    expect(validatePlanInput(good, { ...context, carriedPaidCents: 50000 }).ok).toBe(false);
  });

  it("refuses a last payment after the final due date", () => {
    const result = validatePlanInput({ ...good, finalDueOn: "2027-02-28" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("March 5, 2027");
  });

  it("measures the last payment from today when the first charge date has passed", () => {
    // From 23 Nov: 23 Nov, 23 Dec, 23 Jan, 23 Feb.
    expect(validatePlanInput({ ...good, firstChargeOn: "2026-11-01", finalDueOn: "2027-02-23" }, context).ok).toBe(true);
    expect(validatePlanInput({ ...good, firstChargeOn: "2026-11-01", finalDueOn: "2027-02-22" }, context).ok).toBe(false);
  });

  it("allows no final due date", () => {
    const result = validatePlanInput({ ...good, finalDueOn: null }, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.finalDueOn).toBeNull();
  });

  it("refuses nothing left to charge, bad dates, fractions and out-of-range counts", () => {
    expect(validatePlanInput({ ...good, priorPaidCents: 550000 }, context).ok).toBe(false);
    expect(validatePlanInput({ ...good, firstChargeOn: "2026-13-01" }, context).ok).toBe(false);
    expect(validatePlanInput({ ...good, finalDueOn: "soon" }, context).ok).toBe(false);
    expect(validatePlanInput({ ...good, installmentCents: 500.5 }, context).ok).toBe(false);
    expect(validatePlanInput({ ...good, installmentCount: 0 }, context).ok).toBe(false);
    expect(validatePlanInput({ ...good, installmentCount: 37 }, context).ok).toBe(false);
    expect(validatePlanInput({ ...good, installmentCents: "50000" }, context).ok).toBe(false);
    expect(validatePlanInput(null, context).ok).toBe(false);
  });

  it("names the cap when an amount is over $100,000, and allows the cap itself", () => {
    const over = validatePlanInput({ ...good, agreedTotalCents: 10_000_001 }, context);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toBe("Each amount must be $100,000.00 or less. Please check for extra digits.");
    const paidBefore = validatePlanInput({ ...good, priorPaidCents: 100_000_000 }, context);
    expect(paidBefore.ok).toBe(false);
    if (!paidBefore.ok) expect(paidBefore.error).toContain("$100,000.00 or less");
    expect(
      validatePlanInput({ ...good, agreedTotalCents: 10_000_000, priorPaidCents: 0, installmentCents: 2_500_000 }, context).ok,
    ).toBe(true);
  });

  it("accepts a single payment of the whole balance", () => {
    expect(validatePlanInput({ ...good, installmentCents: 200000, installmentCount: 1 }, context).ok).toBe(true);
  });
});

describe("state derivation", () => {
  it("passes stored states through when not billing", () => {
    for (const status of ["draft", "open", "card_on_file", "completed", "canceled"] as const) {
      expect(deriveState(status, null)).toBe(status);
      expect(deriveState(status, "past_due")).toBe(status);
    }
  });

  it("derives past_due and completed from the linked payment plan", () => {
    expect(deriveState("billing", null)).toBe("billing");
    expect(deriveState("billing", "active")).toBe("billing");
    expect(deriveState("billing", "past_due")).toBe("past_due");
    expect(deriveState("billing", "completed")).toBe("completed");
    expect(deriveState("billing", "canceled")).toBe("past_due");
  });

  it("treats only a plan created after the current authorisation as current", () => {
    const old = linkedPlan({ id: 1, status: "canceled", created_at: new Date("2027-01-05T20:00:00Z") });
    const fresh = linkedPlan({ id: 2, status: "active", created_at: new Date("2027-03-10T20:00:00Z") });
    expect(currentLinkedPlan({ authorized_at: new Date("2027-03-10T19:59:00Z") }, [old, fresh])?.id).toBe(2);
    expect(currentLinkedPlan({ authorized_at: new Date("2027-03-10T19:59:00Z") }, [old])).toBeNull();
    expect(currentLinkedPlan({ authorized_at: null }, [old, fresh])).toBeNull();
    expect(currentLinkedPlan({ authorized_at: new Date("2027-01-05T19:00:00Z") }, [old])?.id).toBe(1);
  });
});

describe("schedule and paid-here totals", () => {
  it("sums paid instalments across every linked plan", () => {
    const first = linkedPlan({ id: 1, status: "canceled", paid: 1, unpaid: 3 });
    const second = linkedPlan({ id: 2, paid: 2, unpaid: 1 });
    expect(paidHereCents([first, second])).toBe(150000);
    expect(paidHereCents([])).toBe(0);
  });

  it("shows the real instalments once billing", () => {
    const current = linkedPlan({ id: 1, paid: 1, unpaid: 2 });
    const rows = buildSchedule({
      status: "billing",
      linked: [current],
      current,
      firstChargeOn: "2027-01-05",
      installmentCents: 50000,
      installmentCount: 3,
      today: "2027-01-20",
    });
    expect(rows.map((row) => row.status)).toEqual(["paid", "scheduled", "scheduled"]);
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(rows[0].dueDate).toBe("2027-01-05");
  });

  it("projects from today before billing, after any payments already made", () => {
    const defaulted = linkedPlan({ id: 1, status: "canceled", paid: 1 });
    const rows = buildSchedule({
      status: "open",
      linked: [defaulted],
      current: null,
      firstChargeOn: "2027-01-05",
      installmentCents: 50000,
      installmentCount: 3,
      today: "2027-04-02",
    });
    expect(rows.map((row) => row.status)).toEqual(["paid", "scheduled", "scheduled", "scheduled"]);
    expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
    expect(rows.slice(1).map((row) => row.dueDate)).toEqual(["2027-04-02", "2027-05-02", "2027-06-02"]);
  });

  it("projects a stepped plan with each row's own amount before billing", () => {
    const rows = buildSchedule({
      status: "open",
      linked: [],
      current: null,
      firstChargeOn: "2026-12-12",
      installmentCents: 40000,
      installmentCount: 6,
      stepUpCents: 60000,
      stepUpCount: 2,
      today: "2026-11-23",
    });
    expect(rows.map((row) => row.amountCents)).toEqual([40000, 40000, 40000, 40000, 60000, 60000]);
    expect(rows[5].dueDate).toBe("2027-05-12");
  });

  it("shows a stepped plan's real instalments, larger amounts included, once billing", () => {
    const at = (month: number) => new Date(Date.UTC(2026, 11 + month, 12, 20));
    const current = linkedPlan({
      id: 1,
      installments: [40000, 40000, 40000, 40000, 60000, 60000].map((amount, n) => ({
        sequence: n + 1,
        amount_cents: amount,
        due_at: at(n),
        paid_at: n === 0 ? at(0) : null,
        status: n === 0 ? "paid" : "scheduled",
      })),
    });
    const rows = buildSchedule({
      status: "billing",
      linked: [current],
      current,
      firstChargeOn: "2026-12-12",
      installmentCents: 40000,
      installmentCount: 6,
      stepUpCents: 60000,
      stepUpCount: 2,
      today: "2026-12-20",
    });
    expect(rows.map((row) => row.amountCents)).toEqual([40000, 40000, 40000, 40000, 60000, 60000]);
    expect(rows.map((row) => row.status)).toEqual(["paid", "scheduled", "scheduled", "scheduled", "scheduled", "scheduled"]);
    expect(paidHereCents([current])).toBe(40000);
  });

  it("shows only what was paid on a cancelled plan", () => {
    const stopped = linkedPlan({ id: 1, status: "canceled", paid: 2, unpaid: 2 });
    const rows = buildSchedule({
      status: "canceled",
      linked: [stopped],
      current: null,
      firstChargeOn: "2027-01-05",
      installmentCents: 50000,
      installmentCount: 4,
      today: "2027-04-02",
    });
    expect(rows.map((row) => row.status)).toEqual(["paid", "paid"]);
  });
});

describe("card problems", () => {
  it("recognises card errors and nothing else", () => {
    expect(cardFailureOf({ type: "StripeCardError", code: "card_declined", decline_code: "insufficient_funds" })).toEqual({
      code: "card_declined",
      declineCode: "insufficient_funds",
    });
    expect(cardFailureOf({ rawType: "card_error", code: "expired_card" })?.code).toBe("expired_card");
    expect(cardFailureOf({ type: "StripeInvalidRequestError", code: "subscription_payment_intent_requires_action" })).not.toBeNull();
    expect(cardFailureOf({ type: "StripeInvalidRequestError", code: "resource_missing", param: "default_payment_method" })?.code).toBe("card_unavailable");
    expect(cardFailureOf({ type: "StripeInvalidRequestError", code: "resource_missing", param: "items[0][price_data][product]" })).toBeNull();
    expect(cardFailureOf({ type: "StripeConnectionError" })).toBeNull();
    expect(cardFailureOf({ type: "StripeAPIError", code: "" })).toBeNull();
    expect(cardFailureOf(new Error("socket hang up"))).toBeNull();
    expect(cardFailureOf(null)).toBeNull();
  });

  it("gives the guest a sentence of ours, never Stripe's", () => {
    expect(guestCardMessage("card_declined", "insufficient_funds")).toContain("insufficient funds");
    expect(guestCardMessage("expired_card")).toContain("expired");
    expect(guestCardMessage("authentication_required")).toContain("bank");
    expect(guestCardMessage("card_unavailable")).toContain("add your card again");
    expect(guestCardMessage("card_declined", "do_not_honor")).toBe("Your card was declined. Please check with your bank or add a different card.");
    expect(guestCardMessage("something_new")).toBe("Your card was declined. Please check with your bank or add a different card.");
  });
});

describe("emails", () => {
  it("builds the add-your-card request with every number and the deep link", () => {
    const email = buildRequestEmail({
      firstName: "Maya",
      retreatTitle: "Bali 2027",
      currency: "usd",
      agreedTotalCents: 550000,
      paidSoFarCents: 350000,
      remainingCents: 200000,
      installmentCents: 50000,
      installmentCount: 4,
      firstChargeDate: "2026-12-05",
      chargesWhenAdded: false,
      url: "https://www.bossclinician.com/retreats/dashboard/bali-2027/payments",
      supportEmail: "hello@example.com",
    });
    expect(email.subject).toBe("Add your card for your Bali 2027 balance");
    for (const piece of ["Hi Maya,", "$5,500.00", "$3,500.00", "$2,000.00", "4 monthly payments of $500.00", "December 5, 2026", "Stripe", "/retreats/dashboard/bali-2027/payments", "reply to this email"]) {
      expect(email.text).toContain(piece);
    }
    expect(email.html).toContain('href="https://www.bossclinician.com/retreats/dashboard/bali-2027/payments"');
    expect(`${email.subject}${email.text}${email.html}`).not.toContain(EM_DASH);
  });

  it("says the first payment is charged when the card is added, once the date has passed", () => {
    const email = buildRequestEmail({
      firstName: "",
      retreatTitle: "Bali 2027",
      currency: "usd",
      agreedTotalCents: 550000,
      paidSoFarCents: 430000,
      remainingCents: 120000,
      installmentCents: 120000,
      installmentCount: 1,
      firstChargeDate: "2026-11-23",
      chargesWhenAdded: true,
      url: "https://example.test/p",
      supportEmail: "",
    });
    expect(email.text).toContain("Hi there,");
    expect(email.text).toContain("one payment of $1,200.00");
    expect(email.text).toContain("charged when you add your card");
  });

  it("escapes names in HTML and keeps the card problem email free of em dashes", () => {
    const email = buildCardProblemEmail({
      firstName: "<b>Maya</b>",
      retreatTitle: "Bali 2027",
      problem: "Your card was declined. Please check with your bank or add a different card.",
      url: "https://example.test/p",
      supportEmail: "hello@example.com",
    });
    expect(email.html).toContain("&lt;b&gt;Maya&lt;/b&gt;");
    expect(email.text).toContain("Your card was declined.");
    expect(`${email.subject}${email.text}${email.html}`).not.toContain(EM_DASH);
  });

  it("tells the owner who and what schedule", () => {
    const notice = buildOwnerNotice({
      guestName: "Maya Lee",
      guestEmail: "maya@example.com",
      retreatTitle: "Bali 2027",
      currency: "usd",
      installmentCents: 50000,
      installmentCount: 4,
      firstChargeDate: "2026-12-05",
      lastChargeDate: "2027-03-05",
      card: "visa ending 4242",
    });
    expect(notice.subject).toBe("Card on file: Maya Lee (Bali 2027 balance)");
    expect(notice.text).toContain("Maya Lee (maya@example.com)");
    expect(notice.text).toContain("4 monthly payments of $500.00 ($2,000.00 in total), December 5, 2026 to March 5, 2027");
    expect(notice.text).toContain("visa ending 4242");
  });

  it("states both amounts of a stepped plan in the request and the owner notice", () => {
    const stepped = { installmentCents: 40000, installmentCount: 6, stepUpCents: 60000, stepUpCount: 2 };
    const email = buildRequestEmail({
      firstName: "Sharon",
      retreatTitle: "Bali 2027",
      currency: "usd",
      agreedTotalCents: 630000,
      paidSoFarCents: 350000,
      remainingCents: 280000,
      ...stepped,
      firstChargeDate: "2026-12-12",
      chargesWhenAdded: false,
      url: "https://example.test/p",
      supportEmail: "",
    });
    expect(email.text).toContain("Your plan: 6 monthly payments: 4 payments of $400.00, then 2 payments of $600.00");
    expect(email.html).toContain("4 payments of $400.00, then 2 payments of $600.00");
    expect(email.text).not.toContain("6 monthly payments of $400.00");
    expect(`${email.subject}${email.text}${email.html}`).not.toContain(EM_DASH);

    const notice = buildOwnerNotice({
      guestName: "Sharon Doe",
      guestEmail: "sharon@example.com",
      retreatTitle: "Bali 2027",
      currency: "usd",
      ...stepped,
      firstChargeDate: "2026-12-12",
      lastChargeDate: "2027-05-12",
      card: "visa ending 4242",
    });
    expect(notice.text).toContain(
      "6 monthly payments: 4 payments of $400.00, then 2 payments of $600.00 ($2,800.00 in total), December 12, 2026 to May 12, 2027",
    );
    expect(notice.text).not.toContain("$2,400.00");
    expect(`${notice.subject}${notice.text}${notice.html}`).not.toContain(EM_DASH);
  });
});

describe("the shared email frame", () => {
  const shell = {
    preheader: "Preview <line>",
    heading: "Payment received",
    greeting: greetingFor("Maya"),
    paragraphs: ["First paragraph.", "Second & last."],
    rows: [{ label: "Amount paid", value: "$5.00" }],
    button: { label: "View my retreat payments", url: "https://example.test/p?a=1&b=2" },
    footnote: "Keep this email.",
    supportEmail: "hello@example.com",
  };

  it("greets by first name and falls back to there", () => {
    expect(greetingFor(" Sagar ")).toBe("Hi Sagar,");
    expect(greetingFor("")).toBe("Hi there,");
  });

  it("is a complete, table-based document with the hidden preheader first", () => {
    const html = retreatEmailHtml(shell);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('data-bc-shell="1"');
    expect(html).toContain("max-width:600px");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
    expect(html.indexOf("display:none")).toBeLessThan(html.indexOf("<table"));
    expect(html).toContain("Preview &lt;line&gt;");
    expect(html).toContain("Second &amp; last.");
    expect(html).toContain('href="https://example.test/p?a=1&amp;b=2"');
    expect(html).toContain('bgcolor="#b8913f"');
    expect(html).toContain("border-radius:6px");
    expect(html).toContain("#2a1a3e");
    expect(html).toContain("#f6f1ea");
    expect(html).toContain("Georgia");
  });

  it("signs with the logo, the assistant, Yvette and the support line", () => {
    const html = retreatEmailHtml(shell);
    expect(html).toMatch(/<img src="https?:\/\/[^"]+\/images\/boss-clinician-logo\.png" width="120" alt="Boss Clinician" style="display:block;border:0">/);
    expect(html).toContain("Boss Clinician AI Assistant");
    expect(html).toContain("On behalf of Yvette Howard, LCSW");
    expect(html).toContain('<a href="https://www.bossclinician.com"');
    expect(html).toContain("Questions? Reply to this email or write to");
    expect(html).toContain("mailto:hello@example.com");
    expect(html).toContain("You are receiving this because of your FlourisHealer retreat booking with Boss Clinician.");
    expect(html).not.toContain(EM_DASH);
  });

  it("carries the same information in the text part and ends with the signature", () => {
    const text = retreatEmailText(shell);
    for (const piece of ["Hi Maya,", "First paragraph.", "Second & last.", "Amount paid: $5.00", "View my retreat payments: https://example.test/p?a=1&b=2", "Keep this email.", "Questions? Reply to this email or write to hello@example.com."]) {
      expect(text).toContain(piece);
    }
    expect(RETREAT_EMAIL_SIGNATURE).toBe("Boss Clinician AI Assistant, on behalf of Yvette Howard, LCSW");
    expect(text.endsWith(RETREAT_EMAIL_SIGNATURE)).toBe(true);
    expect(text).not.toContain(EM_DASH);
  });

  it("gives the owner the same frame without the guest's lines", () => {
    const html = retreatEmailHtml({ ...shell, variant: "owner" });
    const text = retreatEmailText({ ...shell, variant: "owner" });
    expect(html).not.toContain("FlourisHealer");
    expect(html).not.toContain("Questions?");
    expect(text).not.toContain("Questions?");
    expect(text.endsWith(RETREAT_EMAIL_SIGNATURE)).toBe(true);
  });

  it("frames every guest email", () => {
    const request = buildRequestEmail({
      firstName: "Maya", retreatTitle: "Bali 2027", currency: "usd", agreedTotalCents: 550000, paidSoFarCents: 350000,
      remainingCents: 200000, installmentCents: 50000, installmentCount: 4, firstChargeDate: "2026-12-05",
      chargesWhenAdded: false, url: "https://example.test/p", supportEmail: "",
    });
    const problem = buildCardProblemEmail({ firstName: "Maya", retreatTitle: "Bali 2027", problem: "Declined.", url: "https://example.test/p", supportEmail: "" });
    for (const email of [request, problem]) {
      expect(email.html).toContain('data-bc-shell="1"');
      expect(email.html).toContain("Boss Clinician AI Assistant");
      expect(email.text.endsWith(RETREAT_EMAIL_SIGNATURE)).toBe(true);
    }
  });
});

describe("balance payment receipt", () => {
  const base = {
    firstName: "Sagar",
    retreatTitle: "Bali 2027",
    currency: "usd",
    amountCents: 500,
    sequence: 1,
    installmentCount: 2,
    paidSoFarCents: 500,
    remainingCents: 500,
    next: { date: "2026-12-23", amountCents: 500 },
    card: "Visa ending 4242",
    url: "https://www.bossclinician.com/retreats/dashboard/bali-2027/payments",
    supportEmail: "hello@example.com",
  };

  it("reads like a retreat receipt, with no order number and no library", () => {
    const email = buildBalanceReceiptEmail(base);
    expect(email.subject).toBe("Your retreat payment receipt: $5.00");
    for (const piece of [
      "Hi Sagar,",
      "Bali 2027: balance payment 1 of 2",
      "  Retreat: Bali 2027",
      "  Payment: 1 of 2",
      "  Amount paid: $5.00",
      "  Paid so far: $5.00",
      "  Balance remaining: $5.00",
      "  Next payment: December 23, 2026 ($5.00)",
      "  Card: Visa ending 4242",
      "$5.00 remains on your balance, and your next payment of $5.00 is scheduled for December 23, 2026.",
      "View my retreat payments: https://www.bossclinician.com/retreats/dashboard/bali-2027/payments",
    ]) {
      expect(email.text).toContain(piece);
    }
    expect(email.html).toContain("Payment received");
    expect(email.html).toContain('href="https://www.bossclinician.com/retreats/dashboard/bali-2027/payments"');
    const all = `${email.subject}${email.text}${email.html}`;
    expect(all).not.toContain(EM_DASH);
    expect(all).not.toMatch(/order #/i);
    expect(all).not.toContain("/library");
  });

  it("shows the next payment's own amount when it is a larger one", () => {
    // Payment 4 of Sharon's plan: $400 paid now, the next one is the first $600.
    const email = buildBalanceReceiptEmail({
      ...base,
      amountCents: 40000,
      sequence: 4,
      installmentCount: 6,
      paidSoFarCents: 510000,
      remainingCents: 120000,
      next: { date: "2027-04-12", amountCents: 60000 },
    });
    expect(email.text).toContain("  Payment: 4 of 6");
    expect(email.text).toContain("  Amount paid: $400.00");
    expect(email.text).toContain("  Next payment: April 12, 2027 ($600.00)");
    expect(email.text).toContain("your next payment of $600.00 is scheduled for April 12, 2027");
  });

  it("says the balance is paid in full on the last payment", () => {
    const email = buildBalanceReceiptEmail({ ...base, sequence: 2, paidSoFarCents: 1000, remainingCents: 0, next: null });
    expect(email.text).toContain("Your balance is now paid in full.");
    expect(email.text).toContain("  Next payment: None. Your balance is paid in full.");
    expect(email.text).toContain("  Balance remaining: $0.00");
  });

  it("says none scheduled when money is owed but nothing will be charged (a cancelled plan)", () => {
    const email = buildBalanceReceiptEmail({ ...base, next: null, card: "" });
    expect(email.text).toContain("  Next payment: None scheduled");
    expect(email.text).toContain("No further payment is scheduled at the moment.");
    expect(email.text).not.toContain("paid in full");
    expect(email.text).not.toContain("Card:");
  });

  it("labels the card", () => {
    expect(cardLabel("visa", "4242")).toBe("Visa ending 4242");
    expect(cardLabel("", "4242")).toBe("Card ending 4242");
    expect(cardLabel("visa", null)).toBe("");
  });
});

describe("other balance emails", () => {
  it("says paid in full with thanks, the dashboard link and no library", () => {
    const email = buildBalanceCompletedEmail({
      firstName: "Maya", retreatTitle: "Bali 2027", currency: "usd", totalPaidCents: 550000,
      url: "https://www.bossclinician.com/retreats/dashboard/bali-2027", supportEmail: "",
    });
    expect(email.subject).toBe("Your Bali 2027 balance is paid in full");
    expect(email.text).toContain("Your balance for Bali 2027 is paid in full");
    expect(email.text).toContain("Thank you");
    expect(email.text).toContain("  Total paid: $5,500.00");
    expect(email.html).toContain('href="https://www.bossclinician.com/retreats/dashboard/bali-2027"');
    const all = `${email.subject}${email.text}${email.html}`;
    expect(all).not.toContain("yours to keep");
    expect(all).not.toContain("/library");
    expect(all).not.toContain(EM_DASH);
  });

  it("calls a declined instalment a retreat balance payment and links to billing", () => {
    const input = {
      firstName: "Maya", retreatTitle: "Bali 2027", currency: "usd", amountCents: 50000, attempt: 2,
      nextAttemptDate: "2026-12-01", url: "https://www.bossclinician.com/account/billing", supportEmail: "",
    };
    const email = buildBalancePaymentFailedEmail(input);
    expect(email.subject).toBe("Your retreat balance payment did not go through");
    expect(email.text).toContain("Your retreat balance payment of $500.00 for Bali 2027 was declined (attempt 2).");
    expect(email.text).toContain("We will try again on December 1, 2026.");
    expect(email.text).toContain("Update my card: https://www.bossclinician.com/account/billing");
    const last = buildBalancePaymentFailedEmail({ ...input, attempt: 1, nextAttemptDate: null });
    expect(last.subject).toBe("Action needed: your retreat balance payment of $500.00");
    expect(last.text).toContain("This was the last automatic attempt");
    expect(last.text).not.toContain("(attempt");
    const all = `${email.subject}${email.text}${email.html}${last.subject}${last.text}${last.html}`;
    expect(all).not.toContain("your subscription");
    expect(all).not.toContain(EM_DASH);
  });

  it("tells the owner a balance payment was refunded and the schedule was left alone", () => {
    const note = buildRefundOwnerNote({
      guestName: "Maya Lee", guestEmail: "maya@example.com", retreatTitle: "Bali 2027", currency: "usd",
      refundedCents: 500, chargeId: "ch_1", recorded: true, isTest: false,
    });
    expect(note.subject).toBe("Retreat balance payment refunded: $5.00 (Bali 2027)");
    expect(note.text).toContain("Guest: Maya Lee (maya@example.com)");
    expect(note.text).toContain("Stripe charge: ch_1");
    expect(note.text).toContain("recorded in the payments ledger");
    expect(note.text).toContain("was not changed automatically");
    const failed = buildRefundOwnerNote({
      guestName: "", guestEmail: "maya@example.com", retreatTitle: "Bali 2027", currency: "usd",
      refundedCents: 500, chargeId: "ch_1", recorded: false, isTest: true,
    });
    expect(failed.text).toContain("could NOT be recorded");
    expect(failed.text).toContain("(test plan)");
    expect(`${note.text}${failed.text}`).not.toContain(EM_DASH);
  });
});
