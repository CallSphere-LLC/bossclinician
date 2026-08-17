import { describe, expect, it } from "vitest";
import { nextSendAt, type SequenceSendRules } from "./sequences";

/**
 * The sequence scheduler.
 *
 * These are the tests that decide whether email 4 goes out on Tuesday morning
 * or at half past two on Sunday night, and they are written against real
 * calendar dates in a real zone rather than against offsets, because every bug
 * this code can have is a bug about a specific day.
 *
 * March 8th and November 1st 2026 are the United States daylight-saving
 * transitions. Both are Sundays, which is convenient: one of them also proves
 * the weekend rule and the DST rule compose.
 */

const NEW_YORK = "America/New_York";

const plain: SequenceSendRules = {
  skipWeekends: false,
  windowStartMinute: null,
  windowEndMinute: null,
  timezone: NEW_YORK,
};

/** 9am to 5pm, the working-hours window the admin offers by default. */
const workingHours: SequenceSendRules = {
  ...plain,
  windowStartMinute: 9 * 60,
  windowEndMinute: 17 * 60,
};

const iso = (date: Date): string => date.toISOString();

describe("nextSendAt", () => {
  it("adds the delay and stops there when no rules apply", () => {
    expect(iso(nextSendAt(new Date("2026-06-01T12:00:00Z"), 1440, plain))).toBe(
      "2026-06-02T12:00:00.000Z"
    );
  });

  it("treats a zero delay as 'right now'", () => {
    expect(iso(nextSendAt(new Date("2026-06-01T12:00:00Z"), 0, plain))).toBe(
      "2026-06-01T12:00:00.000Z"
    );
  });

  describe("skipping weekends", () => {
    const weekdaysOnly: SequenceSendRules = { ...plain, skipWeekends: true };

    it("moves a Saturday send to the Monday, keeping the local hour", () => {
      // Friday 08:00 in New York, plus a day, lands on Saturday.
      const result = nextSendAt(new Date("2026-06-05T12:00:00Z"), 1440, weekdaysOnly);
      expect(iso(result)).toBe("2026-06-08T12:00:00.000Z");
    });

    it("moves a Sunday send to the Monday", () => {
      // Saturday 08:00 plus a day is Sunday; one more day is the Monday.
      const result = nextSendAt(new Date("2026-06-06T12:00:00Z"), 1440, weekdaysOnly);
      expect(iso(result)).toBe("2026-06-08T12:00:00.000Z");
    });

    it("leaves a weekday alone", () => {
      const result = nextSendAt(new Date("2026-06-01T12:00:00Z"), 1440, weekdaysOnly);
      expect(iso(result)).toBe("2026-06-02T12:00:00.000Z");
    });

    it("keeps the local hour across the autumn clock change", () => {
      // Friday 30 October, 08:00 EDT. A day later is Saturday, so the send is
      // pushed to Monday 2 November — by which time the clocks have gone back,
      // and 08:00 in New York is an hour later in UTC than it was on Friday.
      // Adding 72 hours of milliseconds instead would send at 07:00 local.
      const result = nextSendAt(new Date("2026-10-30T12:00:00Z"), 1440, {
        ...weekdaysOnly,
        timezone: NEW_YORK,
      });
      expect(iso(result)).toBe("2026-11-02T13:00:00.000Z");
    });
  });

  describe("send windows", () => {
    it("holds an early send until the window opens, the same day", () => {
      // 08:00 in New York, window opens at 09:00.
      const result = nextSendAt(new Date("2026-06-01T12:00:00Z"), 0, workingHours);
      expect(iso(result)).toBe("2026-06-01T13:00:00.000Z");
    });

    it("pushes a late send to the next morning", () => {
      // 19:00 in New York on the Monday, window shut at 17:00.
      const result = nextSendAt(new Date("2026-06-01T23:00:00Z"), 0, workingHours);
      expect(iso(result)).toBe("2026-06-02T13:00:00.000Z");
    });

    it("leaves a send that is already inside the window alone", () => {
      // 12:00 in New York, comfortably mid-window.
      const result = nextSendAt(new Date("2026-06-01T16:00:00Z"), 0, workingHours);
      expect(iso(result)).toBe("2026-06-01T16:00:00.000Z");
    });

    it("handles a window that wraps past midnight", () => {
      // An evening-and-overnight window, 22:00 to 06:00. 12:00 local is outside
      // it, so the send waits for 22:00 the same evening.
      const overnight: SequenceSendRules = {
        ...plain,
        windowStartMinute: 22 * 60,
        windowEndMinute: 6 * 60,
      };
      const result = nextSendAt(new Date("2026-06-01T16:00:00Z"), 0, overnight);
      expect(iso(result)).toBe("2026-06-02T02:00:00.000Z");
    });

    it("opens the window at the reader's local 9am on both sides of a DST change", () => {
      // The same wall-clock instruction — "hold this until 9am" — resolves to
      // two different UTC instants a day apart, because the clocks go forward
      // between them. A fixed offset here would send an hour early all summer.
      const saturday = nextSendAt(new Date("2026-03-07T09:00:00Z"), 0, workingHours);
      expect(iso(saturday)).toBe("2026-03-07T14:00:00.000Z");

      const sunday = nextSendAt(new Date("2026-03-08T09:00:00Z"), 0, workingHours);
      expect(iso(sunday)).toBe("2026-03-08T13:00:00.000Z");
    });
  });

  describe("the rules together", () => {
    it("lands a weekend send on Monday at the window's opening minute", () => {
      // Friday 19:00 New York: past the window, so tomorrow — which is a
      // Saturday, so Monday, at 09:00 rather than at 19:00.
      const result = nextSendAt(new Date("2026-06-05T23:00:00Z"), 0, {
        ...workingHours,
        skipWeekends: true,
      });
      expect(iso(result)).toBe("2026-06-08T13:00:00.000Z");
    });

    it("respects the contact's own zone rather than the site's", () => {
      // 08:00 in New York is 05:00 in Los Angeles, which is before that
      // reader's 09:00 — so their copy waits four hours longer.
      const result = nextSendAt(new Date("2026-06-01T12:00:00Z"), 0, {
        ...workingHours,
        timezone: "America/Los_Angeles",
      });
      expect(iso(result)).toBe("2026-06-01T16:00:00.000Z");
    });
  });
});
