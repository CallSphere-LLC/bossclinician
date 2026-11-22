import { describe, expect, it } from "vitest";
import {
  bonusDeadlineFor,
  bonusDeadlineForRegistrations,
  dueReminder,
  formatBonusDeadline,
  isReminderDay,
  reminderSlots,
  withinBonusWindow,
} from "./clubBonusDeadline";

/**
 * Yvette, 22 Nov 2026, item 3: "Give each subscriber until 11:59 p.m. Pacific
 * Time, 14 calendar days after their first registration for the Club training
 * ... someone registering on November 22 would have until December 6 at
 * 11:59 p.m. Pacific Time. ... Use the America/Los_Angeles time zone to account
 * for daylight saving time."
 */
describe("bonusDeadlineFor", () => {
  it("gives a November 22 registrant until December 6 at 11:59 p.m. Pacific", () => {
    const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00"));
    // 23:59:59.999 PST on 6 Dec = 07:59:59.999 UTC on 7 Dec.
    expect(deadline.toISOString()).toBe("2026-12-07T07:59:59.999Z");
    expect(formatBonusDeadline(deadline)).toBe("December 6");
  });

  it("counts the Pacific calendar day, however late in it the registration came", () => {
    // 11:30 p.m. PT on the 22nd is already the 23rd in UTC.
    expect(bonusDeadlineFor(new Date("2026-11-22T23:30:00-08:00")).toISOString()).toBe(
      "2026-12-07T07:59:59.999Z"
    );
    // Five past midnight PT on the 22nd.
    expect(bonusDeadlineFor(new Date("2026-11-22T00:05:00-08:00")).toISOString()).toBe(
      "2026-12-07T07:59:59.999Z"
    );
    // 12:30 a.m. PT on the 23rd is the next day's window.
    expect(bonusDeadlineFor(new Date("2026-11-23T00:30:00-08:00")).toISOString()).toBe(
      "2026-12-08T07:59:59.999Z"
    );
  });

  it("closes at 11:59 p.m. PDT when the window spans the 14 March 2027 change", () => {
    // Registered 28 Feb 2027 (PST, -08:00); the last day is 14 March, the day
    // the clocks go forward, so 23:59:59.999 is PDT (-07:00).
    const deadline = bonusDeadlineFor(new Date("2027-02-28T10:00:00-08:00"));
    expect(deadline.toISOString()).toBe("2027-03-15T06:59:59.999Z");
    expect(formatBonusDeadline(deadline)).toBe("March 14");
    // Not 14 × 24 hours: that would land at 11 a.m. PDT on 14 March.
    expect(deadline.getTime()).not.toBe(new Date("2027-02-28T10:00:00-08:00").getTime() + 14 * 86_400_000);
  });

  it("closes at 11:59 p.m. PST when the window spans the fall-back change", () => {
    expect(bonusDeadlineFor(new Date("2027-10-25T10:00:00-07:00")).toISOString()).toBe(
      "2027-11-09T07:59:59.999Z"
    );
  });

  it("crosses month and year ends", () => {
    expect(formatBonusDeadline(bonusDeadlineFor(new Date("2026-12-25T09:00:00-08:00")))).toBe("January 8");
  });
});

describe("re-registering", () => {
  it("never restarts the window: the first registration decides", () => {
    const first = new Date("2026-11-22T14:00:00-08:00");
    const again = new Date("2026-12-01T09:00:00-08:00");
    expect(bonusDeadlineForRegistrations([again, first])?.toISOString()).toBe(
      bonusDeadlineFor(first).toISOString()
    );
    expect(bonusDeadlineForRegistrations([first, again, new Date("2026-12-05T09:00:00-08:00")])?.toISOString()).toBe(
      "2026-12-07T07:59:59.999Z"
    );
  });

  it("has no deadline without a registration", () => {
    expect(bonusDeadlineForRegistrations([])).toBeNull();
  });
});

describe("withinBonusWindow", () => {
  const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00"));

  it("counts 11:59 p.m. Pacific on the last day", () => {
    expect(withinBonusWindow(deadline, new Date("2026-12-06T23:59:00-08:00"))).toBe(true);
    expect(withinBonusWindow(deadline, new Date("2026-12-06T23:59:59.999-08:00"))).toBe(true);
  });

  it("does not count midnight", () => {
    expect(withinBonusWindow(deadline, new Date("2026-12-07T00:00:00-08:00"))).toBe(false);
  });

  it("uses Pacific, not the buyer's zone: 2:59 a.m. in New York on the 7th is still the 6th in LA", () => {
    expect(withinBonusWindow(deadline, new Date("2026-12-07T02:59:00-05:00"))).toBe(true);
    expect(withinBonusWindow(deadline, new Date("2026-12-07T03:00:00-05:00"))).toBe(false);
  });
});

describe("reminders", () => {
  const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00")); // Dec 6

  it("puts C1 three days before, C2 one day before and C3 on the final day, at 9 a.m. Pacific", () => {
    expect(reminderSlots(deadline).map((s) => [s.key, s.sendAt.toISOString()])).toEqual([
      ["C1", "2026-12-03T17:00:00.000Z"],
      ["C2", "2026-12-05T17:00:00.000Z"],
      ["C3", "2026-12-06T17:00:00.000Z"],
    ]);
  });

  it("keeps 9 a.m. local across a DST change", () => {
    const spring = bonusDeadlineFor(new Date("2027-02-28T10:00:00-08:00")); // Mar 14 (PDT)
    expect(reminderSlots(spring).map((s) => s.sendAt.toISOString())).toEqual([
      "2027-03-11T17:00:00.000Z", // 9 a.m. PST
      "2027-03-13T17:00:00.000Z", // 9 a.m. PST
      "2027-03-14T16:00:00.000Z", // 9 a.m. PDT
    ]);
  });

  it("selects the reminder due now, and none before 9 a.m. or after the grace period", () => {
    expect(dueReminder(deadline, new Date("2026-12-03T09:05:00-08:00"))?.key).toBe("C1");
    expect(dueReminder(deadline, new Date("2026-12-03T08:59:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-03T16:00:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-04T09:05:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-05T09:05:00-08:00"))?.key).toBe("C2");
    expect(dueReminder(deadline, new Date("2026-12-06T09:00:00-08:00"))?.key).toBe("C3");
  });

  it("never sends once the window has closed", () => {
    expect(dueReminder(deadline, new Date("2026-12-07T09:00:00-08:00"))).toBeNull();
    // Even inside C3's grace, a closed window sends nothing.
    expect(dueReminder(deadline, new Date("2026-12-06T23:00:00-08:00"), 24 * 60)?.key).toBe("C3");
    expect(dueReminder(deadline, new Date("2026-12-07T00:00:00-08:00"), 24 * 60)).toBeNull();
  });

  it("marks only the C1, C2 and C3 days as reminder days (for the Club sequence's skip)", () => {
    const days = ["2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07"].map((d) =>
      isReminderDay(deadline, new Date(`${d}T09:00:00-08:00`))
    );
    expect(days).toEqual([false, true, false, true, true, false]);
  });

  it("lands C1 and C2 on the days of the Club sequence's Emails 10 and 11 for a 9 a.m. rhythm", () => {
    // Registered day 0 (22 Nov): Email 10 goes day 11 (3 Dec), Email 11 day 13
    // (5 Dec) — exactly C1 and C2, which is why those are skipped when on.
    expect(isReminderDay(deadline, new Date("2026-12-03T09:00:00-08:00"))).toBe(true);
    expect(isReminderDay(deadline, new Date("2026-12-05T09:00:00-08:00"))).toBe(true);
    // R1 on day 15 (7 Dec) is not touched.
    expect(isReminderDay(deadline, new Date("2026-12-07T09:00:00-08:00"))).toBe(false);
  });
});
