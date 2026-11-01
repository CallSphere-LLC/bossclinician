import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../db/pool", () => ({ pool: { query, connect: vi.fn() } }));

import { enforceCheckoutRequirements, enrollmentTermsFor, parseAcknowledgments, requirementsAreOn, resolveBuyerTimeZone, type RequirementSettings } from "./checkoutRequirements";
import type { OfferRow } from "../routes/public/offers";

const SETTINGS: RequirementSettings = {
  acknowledgments: [],
  invitationRequired: false,
  programTerm: "6 months",
  termMonths: 6,
  includedBenefits: "",
  refundTerms: "As agreed",
  refundWindowDays: 14,
  obligationsNote: "",
};

const offer = (overrides: Partial<OfferRow> = {}): OfferRow =>
  ({
    id: 39,
    title: "The Club",
    slug: "the-club",
    currency: "usd",
    pricing_type: "payment_plan",
    amount_cents: 39700,
    deposit_cents: 0,
    min_amount_cents: 0,
    interval: "month",
    interval_count: 1,
    installment_count: 6,
    trial_days: 0,
    require_terms: false,
    terms_url: "",
    ...overrides,
  }) as OfferRow;

/** Answers the two reads loadOfferRequirements makes. */
function configured(input: { acknowledgments?: unknown[]; invitationRequired?: boolean; contracts?: Array<{ id: number; title: string; pdf_sha256: string }> }) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM offer_checkout_requirements")) {
      return {
        rows: [{ acknowledgments: input.acknowledgments ?? [], invitation_required: input.invitationRequired ?? false, program_term: "6 months", term_months: 6, included_benefits: "", refund_terms: "As agreed", refund_window_days: 14, obligations_note: "" }],
      };
    }
    if (sql.includes("FROM offer_contracts")) return { rows: input.contracts ?? [] };
    return { rows: [] };
  });
}

const BOX = { key: "a", version: 2, text: "I agree", linkLabel: "", linkUrl: "/terms", active: true };
const CONTRACT = { id: 5, title: "Agreement", pdf_sha256: "f".repeat(64) };
const base = { offer: offer(), email: "buyer@example.test", memberId: null };

beforeEach(() => {
  query.mockReset();
});

describe("enrollmentTermsFor", () => {
  it("states the whole contract of a payment plan", () => {
    const terms = enrollmentTermsFor(offer(), SETTINGS);
    expect(terms.totalInvestmentCents).toBe(238200);
    expect(terms.dueTodayCents).toBe(39700);
    expect(terms.remainingPayments).toBe(5);
    expect(terms.remainingCents).toBe(198500);
    expect(terms.paymentArrangement).toBe("6 payments totaling $2,382.00: $397.00 today, then $397.00 every month");
    expect(terms.remainingObligations).toBe("5 more payments after today, $1,985.00 in total.");
  });

  it("states pay in full with nothing remaining", () => {
    const terms = enrollmentTermsFor(offer({ pricing_type: "one_time", amount_cents: 199700, installment_count: null, interval: null }), SETTINGS);
    expect(terms.totalInvestment).toBe("$1,997.00");
    expect(terms.remainingPayments).toBe(0);
    expect(terms.remainingObligations).toBe("Nothing further after this payment.");
  });

  it("does not claim a total for an open-ended subscription", () => {
    const terms = enrollmentTermsFor(offer({ pricing_type: "subscription", amount_cents: 19700, installment_count: null }), SETTINGS);
    expect(terms.totalInvestmentCents).toBeNull();
    expect(terms.remainingObligations).toBe("Renews at $197.00 every month until cancelled.");
  });
});

describe("parseAcknowledgments", () => {
  it("drops malformed entries and never treats a missing flag as live", () => {
    const parsed = parseAcknowledgments([{ key: "x", text: "Words" }, { text: "no key" }, "junk", { key: "y", text: " " }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].active).toBe(false);
    expect(requirementsAreOn({ settings: { ...SETTINGS, acknowledgments: parsed }, contracts: [] })).toBe(false);
  });
});

describe("enforceCheckoutRequirements", () => {
  it("returns null when nothing is configured, so today's checkouts are untouched", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(enforceCheckoutRequirements(base)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("treats a saved box that is not live as nothing configured", async () => {
    configured({ acknowledgments: [{ ...BOX, active: false }] });
    await expect(enforceCheckoutRequirements(base)).resolves.toBeNull();
  });

  it("refuses an unticked live box and an out-of-date version", async () => {
    configured({ acknowledgments: [BOX] });
    await expect(enforceCheckoutRequirements(base)).rejects.toThrow(/tick each required box/);
    await expect(enforceCheckoutRequirements({ ...base, acknowledgments: [{ key: "a", version: 1 }] })).rejects.toThrow(/has just changed/);
  });

  it("snapshots the exact wording and version that was ticked", async () => {
    configured({ acknowledgments: [BOX] });
    const accepted = await enforceCheckoutRequirements({ ...base, acknowledgments: [{ key: "a", version: 2 }], ip: "1.2.3.4" });
    expect(accepted?.acknowledgments[0]).toMatchObject({ key: "a", version: 2, text: "I agree", linkUrl: "/terms", ip: "1.2.3.4" });
  });

  it("refuses payment without the required signature, and a gift with one", async () => {
    configured({ contracts: [CONTRACT] });
    await expect(enforceCheckoutRequirements(base)).rejects.toThrow(/review and sign Agreement/);
    await expect(
      enforceCheckoutRequirements({ ...base, giftRecipientEmail: "friend@example.test", signatures: [{ contractId: 5, typedName: "Pat Buyer" }] })
    ).rejects.toThrow(/gift/);
    const accepted = await enforceCheckoutRequirements({ ...base, signatures: [{ contractId: 5, typedName: "Pat Buyer" }] });
    expect(accepted?.signatures).toEqual([{ contract: { id: 5, title: "Agreement", pdfSha256: "f".repeat(64) }, typedName: "Pat Buyer" }]);
    expect(accepted?.terms.totalInvestmentCents).toBe(238200);
    expect(accepted?.terms.timeZone).toBe("America/Los_Angeles");
    const zoned = await enforceCheckoutRequirements({ ...base, buyerTimeZone: "America/New_York", signatures: [{ contractId: 5, typedName: "Pat Buyer" }] });
    expect(zoned?.terms.timeZone).toBe("America/New_York");
  });

  it("refuses an invitation-only offer without a usable invitation for this email", async () => {
    configured({ invitationRequired: true });
    await expect(enforceCheckoutRequirements(base)).rejects.toThrow(/by invitation/);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("offer_enrollment_invitations")) return { rows: [{ id: "9", offer_id: 39, email: "someone@example.test", full_name: "", offer_slug: "the-club" }] };
      if (sql.includes("FROM offer_checkout_requirements")) return { rows: [{ acknowledgments: [], invitation_required: true, program_term: "", term_months: null, included_benefits: "", refund_terms: "", refund_window_days: null, obligations_note: "" }] };
      return { rows: [] };
    });
    await expect(enforceCheckoutRequirements({ ...base, invitationToken: "t".repeat(30) })).rejects.toThrow(/invitation is for someone@example.test/);
    await expect(enforceCheckoutRequirements({ ...base, email: "someone@example.test", invitationToken: "t".repeat(30) })).resolves.toMatchObject({ invitationId: 9 });
  });
});

describe("resolveBuyerTimeZone", () => {
  it("keeps a real zone and falls back to Pacific for anything else", () => {
    expect(resolveBuyerTimeZone("Europe/London")).toBe("Europe/London");
    for (const bad of [undefined, null, 5, "", "Not/AZone", "+01:00", "America/New_York<script>", "x".repeat(65)]) {
      expect(resolveBuyerTimeZone(bad)).toBe("America/Los_Angeles");
    }
  });
});
