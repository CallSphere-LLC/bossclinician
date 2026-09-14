import { describe, it, expect } from "vitest";
import {
  REMINDER_CHOICES,
  describeRecurrence,
  describeReminderOffset,
  describeStart,
} from "./eventsApi";

/**
 * The repeat rule in words, held to the same assertions as the server's
 * `describeRecurrence` in `services/events.test.ts`, so the create dialog's
 * preview and the saved event never name two different rules.
 */
describe("describeRecurrence", () => {
  it("matches the server's wording", () => {
    expect(describeRecurrence({ freq: "weekly", interval: 1, until: null, count: 6 })).toBe(
      "Every week, 6 sessions",
    );
    expect(describeRecurrence({ freq: "weekly", interval: 2, until: "2026-10-31", count: null })).toBe(
      "Every 2 weeks until October 31, 2026",
    );
    expect(describeRecurrence({ freq: "daily", interval: 1, until: null, count: 1 })).toBe(
      "Every day, 1 session",
    );
    expect(describeRecurrence({ freq: "monthly", interval: 3, until: null, count: 4 })).toBe(
      "Every 3 months, 4 sessions",
    );
    expect(describeRecurrence(null)).toBe("");
  });
});

/**
 * P0-4 regression: the events list rendered every start time in the viewer's
 * own timezone.
 *
 * The stored data was always right — an 18:00 Eastern event is stored as
 * 22:00Z. The bug was in this formatter: it asked `Intl.DateTimeFormat` for
 * `dateStyle` and `timeStyle` *and* `timeZoneName`, a combination ECMA-402
 * forbids. TypeScript accepts it, because `Intl.DateTimeFormatOptions` allows
 * every key independently, so the defect was invisible to the typechecker and
 * threw only at runtime — on every render, for every event. The `catch` behind
 * it reformatted with no `timeZone`, so the column silently tracked whoever was
 * looking: "3:00 PM" in California, "10:00 PM" on the UTC server.
 *
 * These would have caught it, because a throw into that catch loses the zone
 * abbreviation, and the abbreviation is what they assert on.
 */

// 2026-09-15 18:00 America/New_York — the exact value from the bug report.
const SEPTEMBER_EVENING = "2026-09-15T22:00:00.000Z";

describe("describeStart", () => {
  it("renders in the event's zone, not the machine's", () => {
    const label = describeStart(SEPTEMBER_EVENING, "America/New_York");
    expect(label).toContain("6:00");
    expect(label).toContain("PM");
    expect(label).toContain("Sep 15");
    // The reported symptom: 3:00 PM is this instant in Pacific time, which is
    // what the broken catch produced on a Pacific machine.
    expect(label).not.toContain("3:00");
  });

  it("names the zone, so the reader can tell which clock it is", () => {
    // The assertion that fails the moment the Intl options go back to an
    // illegal combination: the catch branch cannot produce an abbreviation.
    expect(describeStart(SEPTEMBER_EVENING, "America/New_York")).toContain("EDT");
  });

  it("tracks daylight saving, printing EST for a winter date", () => {
    // Same wall-clock hour, other side of the DST boundary: 18:00 EST is 23:00Z
    // rather than 22:00Z, and the abbreviation has to move with it.
    const label = describeStart("2026-01-15T23:00:00.000Z", "America/New_York");
    expect(label).toContain("6:00");
    expect(label).toContain("EST");
  });

  it("handles a half-hour offset zone", () => {
    // Kolkata is UTC+5:30, and the date rolls over. A formatter that fell back
    // to the machine zone would not land on 3:30 AM on the 16th.
    const label = describeStart(SEPTEMBER_EVENING, "Asia/Kolkata");
    expect(label).toContain("3:30");
    expect(label).toContain("AM");
    expect(label).toContain("Sep 16");
  });

  it("falls back to a labelled UTC time when the zone is not a real zone", () => {
    // A garbage zone must not blank the column, and must not quietly render in
    // the viewer's zone either — which is what the old catch did.
    const label = describeStart(SEPTEMBER_EVENING, "Not/AZone");
    expect(label).toContain("UTC");
    expect(label).toContain("10:00");
  });

  it("falls back to Eastern when the event carries no zone at all", () => {
    expect(describeStart(SEPTEMBER_EVENING, "")).toContain("EDT");
  });

  it("says so plainly when there is no date, rather than printing an epoch", () => {
    expect(describeStart(null, "America/New_York")).toBe("No date yet");
    expect(describeStart("not a date", "America/New_York")).toBe("No date yet");
  });
});

/**
 * The reminder wording, which is duplicated on purpose.
 *
 * The server writes a `label` on every reminder it sends down, and the browser
 * needs the same sentence for a choice that does not exist on the server yet —
 * the "add another reminder" dropdown, before anything has been saved. Two
 * copies of a sentence is a drift risk, so these assertions are the same ones
 * `services/events.test.ts` makes of `describeReminderOffset`. If the two ever
 * disagree, the editor will offer "1 day before" and the saved reminder will
 * come back calling itself something else.
 */
describe("describeReminderOffset", () => {
  it("matches the server's wording for every offset", () => {
    expect(describeReminderOffset("registration", 0)).toBe("as soon as they sign up");
    expect(describeReminderOffset("before", 0)).toBe("when it starts");
    expect(describeReminderOffset("before", 15)).toBe("15 minutes before");
    expect(describeReminderOffset("before", 60)).toBe("1 hour before");
    expect(describeReminderOffset("before", 180)).toBe("3 hours before");
    expect(describeReminderOffset("before", 1440)).toBe("1 day before");
    expect(describeReminderOffset("before", 2880)).toBe("2 days before");
    expect(describeReminderOffset("before", 7 * 1440)).toBe("7 days before");
  });

  it("labels every dropdown choice the way the server will name it back", () => {
    for (const choice of REMINDER_CHOICES) {
      const asServerWillSayIt = describeReminderOffset(choice.kind, choice.offsetMinutes);
      // The dropdown is allowed friendlier capitalisation and "1 week" for
      // seven days; what it may not do is name a different moment.
      expect(choice.label.toLowerCase().replace("1 week before", "7 days before")).toBe(
        asServerWillSayIt,
      );
    }
  });

  it("offers no two choices at the same moment", () => {
    const slots = REMINDER_CHOICES.map((c) => `${c.kind}:${c.offsetMinutes}`);
    expect(new Set(slots).size).toBe(slots.length);
  });
});
