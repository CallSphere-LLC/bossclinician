import { describe, expect, it } from "vitest";
import {
  REMINDER_DAYS_BEFORE,
  REMINDER_GRACE_MINUTES,
  REMINDER_LOOKAHEAD_DAYS,
  bonusDeadlineFor,
  bonusDeadlineForRegistrations,
  bonusDeadlineMergeValues,
  dueReminder,
  formatBonusDeadline,
  isReminderDay,
  promotionConflict,
  reminderSlots,
  tooClose,
  unresolvedPlaceholders,
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

describe("reminders (revised 22 Nov round 2: 5 / 2 / 0 days)", () => {
  const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00")); // Dec 6

  it("puts C1 five days before, C2 two days before and C3 on the deadline date, at 9 a.m. Pacific", () => {
    expect(REMINDER_DAYS_BEFORE).toEqual({ C1: 5, C2: 2, C3: 0 });
    expect(reminderSlots(deadline).map((s) => [s.key, s.sendAt.toISOString()])).toEqual([
      ["C1", "2026-12-01T17:00:00.000Z"],
      ["C2", "2026-12-04T17:00:00.000Z"],
      ["C3", "2026-12-06T17:00:00.000Z"],
    ]);
  });

  it("keeps 9 a.m. local across the 14 March 2027 spring-forward change", () => {
    const spring = bonusDeadlineFor(new Date("2027-02-28T10:00:00-08:00")); // Mar 14 (PDT)
    expect(reminderSlots(spring).map((s) => s.sendAt.toISOString())).toEqual([
      "2027-03-09T17:00:00.000Z", // 9 a.m. PST
      "2027-03-12T17:00:00.000Z", // 9 a.m. PST
      "2027-03-14T16:00:00.000Z", // 9 a.m. PDT, the change day itself
    ]);
    // A deadline two days later puts C2 on the change day.
    const after = bonusDeadlineFor(new Date("2027-03-02T10:00:00-08:00")); // Mar 16
    expect(reminderSlots(after).map((s) => s.sendAt.toISOString())).toEqual([
      "2027-03-11T17:00:00.000Z", // 9 a.m. PST
      "2027-03-14T16:00:00.000Z", // 9 a.m. PDT, the change day
      "2027-03-16T16:00:00.000Z",
    ]);
  });

  it("keeps 9 a.m. local across the 1 November 2026 fall-back change", () => {
    const fall = bonusDeadlineFor(new Date("2026-10-20T10:00:00-07:00")); // Nov 3 (PST)
    expect(fall.toISOString()).toBe("2026-11-04T07:59:59.999Z");
    expect(reminderSlots(fall).map((s) => s.sendAt.toISOString())).toEqual([
      "2026-10-29T16:00:00.000Z", // 9 a.m. PDT
      "2026-11-01T17:00:00.000Z", // 9 a.m. PST on the change day
      "2026-11-03T17:00:00.000Z", // 9 a.m. PST
    ]);
  });

  it("selects the reminder due now, and none before 9 a.m. or after the grace period", () => {
    expect(dueReminder(deadline, new Date("2026-12-01T09:05:00-08:00"))?.key).toBe("C1");
    expect(dueReminder(deadline, new Date("2026-12-01T08:59:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-01T16:00:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-03T09:05:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-04T09:05:00-08:00"))?.key).toBe("C2");
    expect(dueReminder(deadline, new Date("2026-12-05T09:05:00-08:00"))).toBeNull();
    expect(dueReminder(deadline, new Date("2026-12-06T09:00:00-08:00"))?.key).toBe("C3");
  });

  it("never sends once the window has closed", () => {
    expect(dueReminder(deadline, new Date("2026-12-07T09:00:00-08:00"))).toBeNull();
    // Even inside C3's grace, a closed window sends nothing.
    expect(dueReminder(deadline, new Date("2026-12-06T23:00:00-08:00"), 24 * 60)?.key).toBe("C3");
    expect(dueReminder(deadline, new Date("2026-12-07T00:00:00-08:00"), 24 * 60)).toBeNull();
  });

  it("C3 always lands on the deadline's displayed calendar date, before expiry", () => {
    for (const registered of ["2026-11-22T14:00:00-08:00", "2027-02-28T10:00:00-08:00", "2026-10-20T10:00:00-07:00"]) {
      const d = bonusDeadlineFor(new Date(registered));
      const c3 = reminderSlots(d).find((s) => s.key === "C3")!;
      expect(formatBonusDeadline(c3.sendAt)).toBe(formatBonusDeadline(d));
      expect(c3.sendAt.getTime() + REMINDER_GRACE_MINUTES * 60_000).toBeLessThan(d.getTime());
    }
  });

  it("marks only the C1, C2 and C3 days as reminder days", () => {
    const days = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-04", "2026-12-05", "2026-12-06", "2026-12-07"].map(
      (d) => isReminderDay(deadline, new Date(`${d}T09:00:00-08:00`))
    );
    expect(days).toEqual([false, true, false, true, false, true, false]);
  });

  it("looks far enough ahead for C1", () => {
    expect(REMINDER_LOOKAHEAD_DAYS).toBeGreaterThan(5);
  });
});

describe("the deadline fields in C1-C3", () => {
  it("renders date, time and zone from the saved deadline, in Pacific", () => {
    const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00"));
    expect(bonusDeadlineMergeValues(deadline)).toEqual({
      bonus_deadline_date: "December 6, 2026",
      bonus_deadline_time: "11:59 p.m.",
      bonus_deadline_timezone: "Pacific Time",
    });
    // The same date the Club page and checkout show ("December 6 at 11:59 p.m. Pacific Time").
    expect(bonusDeadlineMergeValues(deadline).bonus_deadline_date.startsWith(formatBonusDeadline(deadline))).toBe(true);
  });

  it("is correct on both sides of a daylight-saving change", () => {
    expect(bonusDeadlineMergeValues(bonusDeadlineFor(new Date("2027-02-28T10:00:00-08:00")))).toMatchObject({
      bonus_deadline_date: "March 14, 2027",
      bonus_deadline_time: "11:59 p.m.",
    });
    expect(bonusDeadlineMergeValues(bonusDeadlineFor(new Date("2026-10-20T10:00:00-07:00")))).toMatchObject({
      bonus_deadline_date: "November 3, 2026",
      bonus_deadline_time: "11:59 p.m.",
    });
    expect(bonusDeadlineMergeValues(bonusDeadlineFor(new Date("2026-12-25T09:00:00-08:00"))).bonus_deadline_date).toBe(
      "January 8, 2027"
    );
  });

  it("is blank for an unreadable date (so the guard blocks the send)", () => {
    expect(bonusDeadlineMergeValues(new Date(Number.NaN)).bonus_deadline_date).toBe("");
  });
});

describe("unresolvedPlaceholders (the hard guard)", () => {
  const filled = {
    firstName: "Sam",
    bonus_deadline_date: "December 6, 2026",
    bonus_deadline_time: "11:59 p.m.",
    bonus_deadline_timezone: "Pacific Time",
    clubBonusToken: "abc.def",
  };
  const c1 = "Hey {{first_name}}, join by {{bonus_deadline_date}} at {{bonus_deadline_time}} {{bonus_deadline_timezone}}.";

  it("passes a fully filled reminder", () => {
    expect(unresolvedPlaceholders(["Subject", "Preview", c1], filled)).toEqual([]);
  });

  it("blocks a blank or missing deadline field (renderTokens would silently blank it)", () => {
    expect(unresolvedPlaceholders([c1], { ...filled, bonus_deadline_date: "" })).toEqual([
      "{{bonus_deadline_date}} has no value",
    ]);
    const without: Record<string, string> = { ...filled };
    delete without.bonus_deadline_timezone;
    expect(unresolvedPlaceholders([c1], without)).toEqual(["{{bonus_deadline_timezone}} has no value"]);
  });

  it("blocks an unknown token, a broken brace, a doc placeholder and an internal note", () => {
    expect(unresolvedPlaceholders(["{{enrollment_close}}"], filled)).toEqual(["{{enrollment_close}} has no value"]);
    expect(unresolvedPlaceholders(["Join by {{bonus_deadline_date}"], filled)).toEqual(["malformed {{ }} token"]);
    expect(unresolvedPlaceholders(["Enrollment closes [ENROLLMENT_CLOSE_DATE]"], filled)).toEqual([
      "placeholder [ENROLLMENT_CLOSE_DATE]",
    ]);
    expect(unresolvedPlaceholders(["<p>Send: Five days before the deadline.</p>"], filled)).toEqual([
      'internal note "Send:"',
    ]);
  });
});

describe("promotionConflict (Club nurture vs C1-C3)", () => {
  // Registered 22 Nov (day 0), deadline 6 Dec. Nurture at 9 a.m. PT:
  // Email 7 day 8 (30 Nov), Email 8 day 9 (1 Dec), Email 9 day 10 (2 Dec),
  // Email 10 day 11 (3 Dec), Email 11 day 13 (5 Dec), R1 day 15 (7 Dec).
  // C1 1 Dec, C2 4 Dec, C3 6 Dec.
  const deadline = bonusDeadlineFor(new Date("2026-11-22T14:00:00-08:00"));
  const at = (d: string, t = "09:00"): Date => new Date(`${d}T${t}:00-08:00`);

  it("replaces Email 8 with C1 and Email 11 with C2 while they still go", () => {
    expect(promotionConflict(deadline, at("2026-12-01"), {}, "C1")).toBe("replaced by C1 bonus reminder");
    const c2Sent = { C1: { sentAt: at("2026-12-01", "09:02"), sent: true }, C2: { sentAt: at("2026-12-04", "09:01"), sent: true } };
    expect(promotionConflict(deadline, at("2026-12-05"), c2Sent, "C2")).toBe("replaced by C2 bonus reminder");
  });

  it("retains Email 7, Email 9, Email 10 and R1 (exactly a day from a reminder)", () => {
    const sent = {
      C1: { sentAt: at("2026-12-01", "09:03"), sent: true },
      C2: { sentAt: at("2026-12-04", "09:03"), sent: true },
      C3: { sentAt: at("2026-12-06", "09:03"), sent: true },
    };
    expect(promotionConflict(deadline, at("2026-11-30", "09:01"), {})).toBe(""); // Email 7
    expect(promotionConflict(deadline, at("2026-12-02", "09:01"), { C1: sent.C1 })).toBe(""); // Email 9
    expect(promotionConflict(deadline, at("2026-12-03", "09:01"), { C1: sent.C1 })).toBe(""); // Email 10
    expect(promotionConflict(deadline, at("2026-12-07", "09:01"), sent)).toBe(""); // R1 after expiry
  });

  it("suppresses an ordinary promotion on or within 24 hours of a reminder", () => {
    expect(promotionConflict(deadline, at("2026-12-04", "08:00"), {})).toBe("C2 bonus reminder within 24 hours");
    expect(promotionConflict(deadline, at("2026-12-06", "09:00"), {})).toBe("C3 bonus reminder within 24 hours");
    // C1 went late (2 p.m.); an email the next morning is less than 24 hours after it.
    expect(promotionConflict(deadline, at("2026-12-02", "09:00"), { C1: { sentAt: at("2026-12-01", "14:00"), sent: true } })).toBe(
      "C1 bonus reminder within 24 hours"
    );
  });

  it("sends Email 8 / Email 11 normally when the reminder will not go", () => {
    const missed = { C1: { sentAt: at("2026-12-01", "09:00"), sent: false } }; // suppressed / skipped
    expect(promotionConflict(deadline, at("2026-12-01", "09:30"), missed, "C1")).toBe("");
    // C2's slot long past and never sent (reminders were off then): Email 11 goes.
    expect(promotionConflict(deadline, at("2026-12-05"), {}, "C2")).toBe("");
  });

  it("treats a 9 a.m. next-day send as spaced despite tick jitter", () => {
    expect(tooClose(at("2026-12-01", "09:04"), at("2026-12-02", "09:00"))).toBe(false);
    expect(tooClose(at("2026-12-01", "09:00"), at("2026-12-01", "15:00"))).toBe(true);
    expect(tooClose(at("2026-12-01", "15:00"), at("2026-12-02", "09:00"))).toBe(true);
  });
});
