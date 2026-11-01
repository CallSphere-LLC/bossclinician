import { describe, expect, it, vi } from "vitest";

vi.mock("../db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../email/mailer", () => ({ sendMail: vi.fn() }));

import { enrollmentTermLines, printedMoment } from "./checkoutAgreementRecords";
import type { EnrollmentTerms } from "./checkoutRequirements";

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
