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
  effectiveFirstCharge,
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
    if (result.ok) expect(result.value).toEqual(good);
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
