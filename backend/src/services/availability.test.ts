import { describe, it, expect } from "vitest";
import {
  computeSlots,
  describeInstant,
  isSlotBookable,
  parseCoachingPolicy,
  DEFAULT_COACHING_POLICY,
  type AvailabilityOverride,
  type AvailabilityRule,
  type BookedSession,
  type ComputeSlotsInput,
} from "./availability";

/** Mon-Fri 9am-5pm in the coach's zone. */
function weekdayRules(timezone: string, startMinute = 9 * 60, endMinute = 17 * 60): AvailabilityRule[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({
    id: weekday,
    timezone,
    weekday,
    startMinute,
    endMinute,
    active: true,
  }));
}

function rule(partial: Partial<AvailabilityRule> & { weekday: number }): AvailabilityRule {
  return {
    id: 1,
    timezone: "America/New_York",
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    active: true,
    ...partial,
  };
}

function block(startsAt: string, endsAt: string, available = false): AvailabilityOverride {
  return { id: 1, startsAt: new Date(startsAt), endsAt: new Date(endsAt), available };
}

function booked(startsAt: string, durationMinutes = 60): BookedSession {
  return { id: 1, startsAt: new Date(startsAt), durationMinutes };
}

/** Everything a slot computation needs, with the interesting bits left to callers. */
function input(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    rules: weekdayRules("America/New_York"),
    overrides: [],
    existingSessions: [],
    durationMinutes: 60,
    slotIntervalMinutes: 60,
    from: new Date("2026-01-12T00:00:00Z"),
    to: new Date("2026-01-17T00:00:00Z"),
    memberTimezone: "America/New_York",
    now: new Date("2026-01-01T00:00:00Z"),
    minimumNoticeMinutes: 0,
    ...overrides,
  };
}

const iso = (slots: { startsAt: Date }[]): string[] => slots.map((s) => s.startsAt.toISOString());

describe("computeSlots — a normal week", () => {
  it("offers every hour of every working day", () => {
    const slots = computeSlots(input());
    // Five days, 9am-5pm, one-hour slots.
    expect(slots).toHaveLength(40);
    expect(slots[0].startsAt.toISOString()).toBe("2026-01-12T14:00:00.000Z");
    expect(slots[7].startsAt.toISOString()).toBe("2026-01-12T21:00:00.000Z");
    expect(slots[slots.length - 1].startsAt.toISOString()).toBe("2026-01-16T21:00:00.000Z");
  });

  it("does not offer a slot that would run past the end of the window", () => {
    // 9am-5pm cannot hold a 90-minute slot starting at 4pm.
    const slots = computeSlots(input({ durationMinutes: 90, slotIntervalMinutes: 90 }));
    const monday = slots.filter((s) => s.day === "2026-01-12");
    expect(iso(monday)).toEqual([
      "2026-01-12T14:00:00.000Z",
      "2026-01-12T15:30:00.000Z",
      "2026-01-12T17:00:00.000Z",
      "2026-01-12T18:30:00.000Z",
      "2026-01-12T20:00:00.000Z",
    ]);
  });

  it("separates how often a slot starts from how long it runs", () => {
    // Half-hourly starts for hour-long sessions: 9:00, 9:30 ... 16:00.
    const slots = computeSlots(input({ slotIntervalMinutes: 30 }));
    expect(slots.filter((s) => s.day === "2026-01-12")).toHaveLength(15);
  });

  it("leaves the weekend alone", () => {
    const slots = computeSlots(input({ to: new Date("2026-01-19T00:00:00Z") }));
    expect(slots.some((s) => s.day === "2026-01-17" || s.day === "2026-01-18")).toBe(false);
  });

  it("ignores rules that have been switched off", () => {
    const rules = weekdayRules("America/New_York").map((r) => ({ ...r, active: false }));
    expect(computeSlots(input({ rules }))).toHaveLength(0);
  });

  it("clips to the requested window rather than the whole rule", () => {
    const slots = computeSlots(
      input({
        from: new Date("2026-01-12T16:00:00Z"),
        to: new Date("2026-01-12T19:00:00Z"),
      })
    );
    // A slot may run past `to`; what it may not do is start after it.
    expect(iso(slots)).toEqual([
      "2026-01-12T16:00:00.000Z",
      "2026-01-12T17:00:00.000Z",
      "2026-01-12T18:00:00.000Z",
    ]);
  });

  it("returns nothing for an inverted window", () => {
    expect(
      computeSlots(
        input({ from: new Date("2026-01-17T00:00:00Z"), to: new Date("2026-01-12T00:00:00Z") })
      )
    ).toHaveLength(0);
  });
});

describe("computeSlots — DST", () => {
  it("holds 9am local across the spring-forward weekend", () => {
    // The whole point of storing wall-clock minutes. A fixed -5 offset would put
    // the Monday appointment at 8am for the coach and 9am in the member's diary.
    const slots = computeSlots(
      input({
        from: new Date("2026-03-06T00:00:00Z"),
        to: new Date("2026-03-10T00:00:00Z"),
        now: new Date("2026-02-01T00:00:00Z"),
      })
    );

    const friday = slots.filter((s) => s.day === "2026-03-06");
    const monday = slots.filter((s) => s.day === "2026-03-09");

    expect(friday[0].startsAt.toISOString()).toBe("2026-03-06T14:00:00.000Z");
    expect(monday[0].startsAt.toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(friday[0].timeLabel).toBe("9:00 AM EST");
    expect(monday[0].timeLabel).toBe("9:00 AM EDT");
  });

  it("does not invent the hour that spring-forward deletes", () => {
    // 1am-4am on 8 March 2026 is three hours on the clock and two in real time.
    const slots = computeSlots(
      input({
        rules: [rule({ weekday: 0, startMinute: 60, endMinute: 4 * 60 })],
        from: new Date("2026-03-08T00:00:00Z"),
        to: new Date("2026-03-09T00:00:00Z"),
        now: new Date("2026-02-01T00:00:00Z"),
      })
    );
    expect(iso(slots)).toEqual(["2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z"]);
  });

  it("holds 9am local across the fall-back weekend", () => {
    const slots = computeSlots(
      input({
        from: new Date("2026-10-30T00:00:00Z"),
        to: new Date("2026-11-03T00:00:00Z"),
        now: new Date("2026-10-01T00:00:00Z"),
      })
    );

    const friday = slots.filter((s) => s.day === "2026-10-30");
    const monday = slots.filter((s) => s.day === "2026-11-02");

    expect(friday[0].startsAt.toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(monday[0].startsAt.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(friday[0].timeLabel).toBe("9:00 AM EDT");
    expect(monday[0].timeLabel).toBe("9:00 AM EST");
  });

  it("counts the repeated hour on a fall-back morning once each", () => {
    // 1am-3am on 1 November 2026 is two hours on the clock and three in real
    // time, because 1am happens twice.
    const slots = computeSlots(
      input({
        rules: [rule({ weekday: 0, startMinute: 60, endMinute: 3 * 60 })],
        from: new Date("2026-11-01T00:00:00Z"),
        to: new Date("2026-11-02T00:00:00Z"),
        now: new Date("2026-10-01T00:00:00Z"),
      })
    );
    expect(iso(slots)).toEqual([
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
    ]);
  });
});

describe("computeSlots — overrides", () => {
  it("blocks a whole day out", () => {
    const slots = computeSlots(
      input({
        overrides: [block("2026-01-14T00:00:00Z", "2026-01-15T00:00:00Z")],
      })
    );
    expect(slots.some((s) => s.day === "2026-01-14")).toBe(false);
    expect(slots).toHaveLength(32);
  });

  it("splits a day when the block lands in the middle of it", () => {
    const slots = computeSlots(
      input({
        from: new Date("2026-01-14T00:00:00Z"),
        to: new Date("2026-01-15T00:00:00Z"),
        overrides: [block("2026-01-14T16:00:00Z", "2026-01-14T19:00:00Z")],
      })
    );
    expect(iso(slots)).toEqual([
      "2026-01-14T14:00:00.000Z",
      "2026-01-14T15:00:00.000Z",
      "2026-01-14T19:00:00.000Z",
      "2026-01-14T20:00:00.000Z",
      "2026-01-14T21:00:00.000Z",
    ]);
  });

  it("opens an extra Saturday that no weekly rule covers", () => {
    const slots = computeSlots(
      input({
        from: new Date("2026-01-17T00:00:00Z"),
        to: new Date("2026-01-18T00:00:00Z"),
        overrides: [block("2026-01-17T15:00:00Z", "2026-01-17T17:00:00Z", true)],
      })
    );
    expect(iso(slots)).toEqual(["2026-01-17T15:00:00.000Z", "2026-01-17T16:00:00.000Z"]);
  });

  it("lets a block win over an overlapping extra window", () => {
    // "Open the Saturday" then "actually, not the second hour" has to read in
    // that order, or the exception to the exception is silently ignored.
    const slots = computeSlots(
      input({
        from: new Date("2026-01-17T00:00:00Z"),
        to: new Date("2026-01-18T00:00:00Z"),
        overrides: [
          block("2026-01-17T15:00:00Z", "2026-01-17T17:00:00Z", true),
          block("2026-01-17T16:00:00Z", "2026-01-17T17:00:00Z"),
        ],
      })
    );
    expect(iso(slots)).toEqual(["2026-01-17T15:00:00.000Z"]);
  });
});

describe("computeSlots — existing bookings", () => {
  it("removes exactly the slot that is taken", () => {
    const slots = computeSlots(
      input({
        from: new Date("2026-01-12T00:00:00Z"),
        to: new Date("2026-01-13T00:00:00Z"),
        existingSessions: [booked("2026-01-12T16:00:00Z")],
      })
    );
    expect(slots).toHaveLength(7);
    expect(iso(slots)).not.toContain("2026-01-12T16:00:00.000Z");
    expect(iso(slots)).toContain("2026-01-12T15:00:00.000Z");
  });

  it("removes every slot a long session overlaps, not just the one it starts on", () => {
    const slots = computeSlots(
      input({
        from: new Date("2026-01-12T00:00:00Z"),
        to: new Date("2026-01-13T00:00:00Z"),
        existingSessions: [booked("2026-01-12T16:30:00Z", 90)],
      })
    );
    expect(iso(slots)).not.toContain("2026-01-12T16:00:00.000Z");
    expect(iso(slots)).not.toContain("2026-01-12T17:00:00.000Z");
    expect(iso(slots)).toContain("2026-01-12T18:00:00.000Z");
  });

  it("ignores a booking that only touches a slot boundary", () => {
    // A session ending at 16:00 does not overlap a slot starting at 16:00.
    const slots = computeSlots(
      input({
        from: new Date("2026-01-12T00:00:00Z"),
        to: new Date("2026-01-13T00:00:00Z"),
        existingSessions: [booked("2026-01-12T15:00:00Z")],
      })
    );
    expect(iso(slots)).toContain("2026-01-12T16:00:00.000Z");
  });
});

describe("computeSlots — minimum notice", () => {
  it("refuses anything inside the notice window", () => {
    const slots = computeSlots(
      input({
        now: new Date("2026-01-12T20:15:00Z"),
        minimumNoticeMinutes: 24 * 60,
      })
    );
    // 24 hours from 3:15pm on the 12th is 3:15pm on the 13th, so the first
    // takeable slot is 4pm — the whole of the 12th and most of the 13th are gone.
    expect(slots.some((s) => s.day === "2026-01-12")).toBe(false);
    expect(slots[0].startsAt.toISOString()).toBe("2026-01-13T21:00:00.000Z");
  });

  it("never offers the past even with no notice window at all", () => {
    const slots = computeSlots(
      input({
        now: new Date("2026-01-14T18:30:00Z"),
        minimumNoticeMinutes: 0,
      })
    );
    expect(slots[0].startsAt.toISOString()).toBe("2026-01-14T19:00:00.000Z");
  });

  it("empties the calendar when the notice window covers the whole window", () => {
    expect(
      computeSlots(input({ now: new Date("2026-01-12T00:00:00Z"), minimumNoticeMinutes: 60 * 24 * 30 }))
    ).toHaveLength(0);
  });
});

describe("computeSlots — coach and member in different zones", () => {
  const auckland = input({
    rules: [rule({ weekday: 1, timezone: "America/Los_Angeles", startMinute: 9 * 60, endMinute: 11 * 60 })],
    from: new Date("2026-01-12T00:00:00Z"),
    to: new Date("2026-01-14T00:00:00Z"),
    memberTimezone: "Pacific/Auckland",
  });

  it("produces the same instants regardless of who is reading them", () => {
    const forMember = computeSlots(auckland);
    const forCoach = computeSlots({ ...auckland, memberTimezone: "America/Los_Angeles" });
    expect(iso(forMember)).toEqual(iso(forCoach));
    expect(iso(forMember)).toEqual([
      "2026-01-12T17:00:00.000Z",
      "2026-01-12T18:00:00.000Z",
    ]);
  });

  it("labels each slot on the member's calendar day, not the coach's", () => {
    const slots = computeSlots(auckland);
    // 9am Monday in Los Angeles is 6am Tuesday in Auckland.
    expect(slots[0].day).toBe("2026-01-13");
    expect(slots[0].dayLabel).toBe("Tuesday, January 13");
    expect(slots[0].timeLabel).toBe("6:00 AM GMT+13");
    expect(computeSlots({ ...auckland, memberTimezone: "America/Los_Angeles" })[0].day).toBe(
      "2026-01-12"
    );
  });

  it("falls back to UTC rather than throwing on a zone nobody recognises", () => {
    const slots = computeSlots({ ...auckland, memberTimezone: "Mars/Olympus_Mons" });
    expect(slots[0].day).toBe("2026-01-12");
    expect(slots[0].timeLabel).toBe("5:00 PM UTC");
  });

  it("resolves a coach rule stored with an unusable zone against UTC", () => {
    const slots = computeSlots({
      ...auckland,
      rules: [rule({ weekday: 1, timezone: "", startMinute: 9 * 60, endMinute: 11 * 60 })],
      memberTimezone: "UTC",
    });
    expect(iso(slots)).toEqual(["2026-01-12T09:00:00.000Z", "2026-01-12T10:00:00.000Z"]);
  });
});

describe("isSlotBookable", () => {
  const base = {
    rules: weekdayRules("America/New_York"),
    overrides: [],
    existingSessions: [],
    durationMinutes: 60,
    slotIntervalMinutes: 60,
    memberTimezone: "America/New_York",
    now: new Date("2026-01-01T00:00:00Z"),
    minimumNoticeMinutes: 24 * 60,
  };

  it("accepts an instant that is on the grid and free", () => {
    expect(isSlotBookable(base, new Date("2026-01-12T16:00:00Z"))).toBe(true);
  });

  it("rejects an instant between two slots", () => {
    expect(isSlotBookable(base, new Date("2026-01-12T16:17:00Z"))).toBe(false);
  });

  it("rejects an instant somebody else has just taken", () => {
    expect(
      isSlotBookable(
        { ...base, existingSessions: [booked("2026-01-12T16:00:00Z")] },
        new Date("2026-01-12T16:00:00Z")
      )
    ).toBe(false);
  });

  it("rejects an instant inside the notice window", () => {
    expect(
      isSlotBookable({ ...base, now: new Date("2026-01-12T00:00:00Z") }, new Date("2026-01-12T16:00:00Z"))
    ).toBe(false);
  });
});

describe("parseCoachingPolicy", () => {
  it("falls back to the defaults for a missing row", () => {
    expect(parseCoachingPolicy(undefined)).toEqual(DEFAULT_COACHING_POLICY);
    expect(parseCoachingPolicy("nonsense")).toEqual(DEFAULT_COACHING_POLICY);
  });

  it("reads hours from the settings screen as minutes", () => {
    const policy = parseCoachingPolicy({
      minimumNoticeHours: 12,
      cancellationWindowHours: 48,
      slotIntervalMinutes: 15,
      bookingHorizonDays: 30,
      timezone: "Europe/London",
      meetingUrlBase: "https://meet.example.com/",
    });
    expect(policy.minimumNoticeMinutes).toBe(720);
    expect(policy.cancellationWindowMinutes).toBe(2880);
    expect(policy.slotIntervalMinutes).toBe(15);
    expect(policy.bookingHorizonDays).toBe(30);
    expect(policy.timezone).toBe("Europe/London");
    expect(policy.meetingUrlBase).toBe("https://meet.example.com");
  });

  it("keeps zero windows, which mean 'no restriction'", () => {
    const policy = parseCoachingPolicy({ minimumNoticeHours: 0, cancellationWindowHours: 0 });
    expect(policy.minimumNoticeMinutes).toBe(0);
    expect(policy.cancellationWindowMinutes).toBe(0);
  });

  it("refuses a timezone Intl cannot use", () => {
    expect(parseCoachingPolicy({ timezone: "Middle/Earth" }).timezone).toBe(
      DEFAULT_COACHING_POLICY.timezone
    );
  });

  it("refuses values of the wrong shape", () => {
    const policy = parseCoachingPolicy({
      minimumNoticeHours: "24",
      slotIntervalMinutes: -5,
      bookingHorizonDays: 0,
    });
    expect(policy.minimumNoticeMinutes).toBe(DEFAULT_COACHING_POLICY.minimumNoticeMinutes);
    expect(policy.slotIntervalMinutes).toBe(DEFAULT_COACHING_POLICY.slotIntervalMinutes);
    expect(policy.bookingHorizonDays).toBe(DEFAULT_COACHING_POLICY.bookingHorizonDays);
  });
});

describe("describeInstant", () => {
  it("reads the instant in the zone it is given", () => {
    const labels = describeInstant(new Date("2026-01-12T14:00:00Z"), "America/New_York");
    expect(labels.day).toBe("2026-01-12");
    expect(labels.label).toBe("Monday, January 12 at 9:00 AM EST");
  });
});
