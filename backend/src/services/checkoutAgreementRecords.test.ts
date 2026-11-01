import { describe, expect, it, vi } from "vitest";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));

import { endOfDayInZone, enrollmentTermLines, printedMoment, printedRefundDeadline, withPaymentDates } from "./checkoutAgreementRecords";
import { enrollmentTermsFor, type EnrollmentTerms, type RequirementSettings } from "./checkoutRequirements";
import type { OfferRow } from "../routes/public/offers";

const DEADLINE = "2026-11-14T02:04:12.000Z";

describe("printedMoment", () => {
  it("shows the buyer's zone, the zone's name and the UTC instant, in characters a PDF font can draw", () => {
    const printed = printedMoment(DEADLINE, "America/Los_Angeles");
    expect(printed).toBe("November 13, 2026 at 6:04:12 PM PST (America/Los_Angeles); 2026-11-14 02:04:12 UTC");
    expect(printed).not.toMatch(/[  ]/);
  });

  it("reads a date in that zone even when UTC has moved on to the next day", () => {
    expect(printedMoment(DEADLINE, "America/New_York")).toContain("November 13, 2026 at 9:04:12 PM EST");
  });

  it("leaves a record with no zone, or an unusable one, in UTC", () => {
    expect(printedMoment(DEADLINE)).toBe("2026-11-14 02:04:12 UTC");
    expect(printedMoment(DEADLINE, "Not/AZone")).toBe("2026-11-14 02:04:12 UTC");
  });
});

describe("enrollmentTermLines", () => {
  it("prints the refund deadline in the zone captured at checkout", () => {
    const lines = new Map(enrollmentTermLines({ offerTitle: "The Club", refundDeadline: DEADLINE, timeZone: "America/Chicago" } as EnrollmentTerms));
    expect(lines.get("Refund deadline")).toBe("November 13, 2026 at 8:04:12 PM CST (America/Chicago); 2026-11-14 02:04:12 UTC");
  });
});

describe("the Club's end-of-day refund deadline", () => {
  const PACIFIC = "America/Los_Angeles";
  const club = { offerTitle: "The Club", refundWindowDays: 14, refundDeadlineTimeZone: PACIFIC, timeZone: "America/New_York" } as EnrollmentTerms;

  it.each([
    ["no clock change, standard time", "2026-12-01T20:00:00Z", "2026-12-16T07:59:59.999Z"],
    ["no clock change, daylight time", "2026-06-01T19:00:00Z", "2026-06-16T06:59:59.999Z"],
    ["crossing the end of daylight time", "2026-10-25T20:00:00Z", "2026-11-09T07:59:59.999Z"],
    ["crossing the start of daylight time", "2026-03-01T20:00:00Z", "2026-03-16T06:59:59.999Z"],
    ["paid late evening Pacific, already the next day in UTC", "2026-11-01T06:30:00Z", "2026-11-15T07:59:59.999Z"],
    ["paid just after midnight Pacific", "2026-12-01T08:00:30Z", "2026-12-16T07:59:59.999Z"],
    ["landing on the day the clocks go back", "2026-10-18T20:00:00Z", "2026-11-02T07:59:59.999Z"],
    ["landing on the day the clocks go forward", "2026-02-22T20:00:00Z", "2026-03-09T06:59:59.999Z"],
  ])("%s", (_name, paidAt, deadline) => {
    expect(endOfDayInZone(new Date(paidAt), PACIFIC, 14).toISOString()).toBe(deadline);
  });

  it("prints 11:59 p.m. Pacific Time, whatever zone the buyer was in", () => {
    const terms = withPaymentDates(club, new Date("2026-10-25T20:00:00Z"));
    expect(terms.refundDeadline).toBe("2026-11-09T07:59:59.999Z");
    expect(printedRefundDeadline(terms)).toBe("November 8, 2026 at 11:59 p.m. Pacific Time");
    expect(new Map(enrollmentTermLines(terms)).get("Refund deadline")).toBe("November 8, 2026 at 11:59 p.m. Pacific Time; 2026-11-09 07:59:59 UTC");
  });

  it("states the rule in the record before a payment fixes the date", () => {
    const offer = { id: 39, title: "The Club", currency: "usd", pricing_type: "one_time", amount_cents: 199700, interval_count: 1, trial_days: 0 } as OfferRow;
    const settings = { acknowledgments: [], invitationRequired: false, programTerm: "", termMonths: 6, includedBenefits: "", refundTerms: "", refundWindowDays: 14, refundDeadlineTimeZone: PACIFIC, obligationsNote: "" } as RequirementSettings;
    expect(enrollmentTermsFor(offer, settings).refundDeadlineRule).toBe("11:59 p.m. Pacific Time on the 14th calendar day after your enrollment date");
    expect(enrollmentTermsFor(offer, { ...settings, refundDeadlineTimeZone: null }).refundDeadlineRule).toBeUndefined();
  });

  it("leaves an offer without the rule at the instant of payment plus days, printed as before", () => {
    const lounge = { offerTitle: "The Lounge", refundWindowDays: 7, timeZone: "America/Chicago" } as EnrollmentTerms;
    const terms = withPaymentDates(lounge, new Date("2026-03-05T20:04:12Z"));
    expect(terms.refundDeadline).toBe("2026-03-12T20:04:12.000Z");
    expect(new Map(enrollmentTermLines(terms)).get("Refund deadline")).toBe(printedMoment("2026-03-12T20:04:12.000Z", "America/Chicago"));
  });

  it("falls back to the window rather than losing the record on a bad zone", () => {
    const terms = withPaymentDates({ ...club, refundDeadlineTimeZone: "Not/AZone" }, new Date("2026-03-05T20:04:12Z"));
    expect(terms.refundDeadline).toBe("2026-03-19T20:04:12.000Z");
  });

  it("sets no deadline when the offer has no window", () => {
    expect(withPaymentDates({ ...club, refundWindowDays: null }, new Date("2026-03-05T20:04:12Z")).refundDeadline).toBeUndefined();
  });
});
