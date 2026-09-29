import { describe, expect, it } from "vitest";
import {
  communityRecurrenceProblem,
  seriesAfterSave,
  seriesView,
  upcomingSessions,
  type CommunityEventSeries,
} from "./communityEventSeries";

const LA = "America/Los_Angeles";

const wall = (at: Date | string, timeZone = LA) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));

/** Kajabi's "Monthly Coaching Calls": Fri 9 Oct 2026, 10:00 Pacific, every month, no end. */
const coachingCalls: CommunityEventSeries = {
  starts_at: new Date("2026-10-09T17:00:00.000Z"),
  duration_minutes: 60,
  timezone: LA,
  recurrence_freq: "monthly",
  recurrence_interval: 1,
  recurrence_until: null,
  recurrence_count: null,
};

describe("upcomingSessions", () => {
  it("keeps an open monthly series on the 9th at 10:00 Pacific across the November change", () => {
    const list = upcomingSessions(coachingCalls, new Date("2026-09-29T12:00:00.000Z"), 3);
    expect(list.map((at) => wall(at))).toEqual([
      "10/09/2026, 10:00",
      "11/09/2026, 10:00",
      "12/09/2026, 10:00",
    ]);
    // 10:00 PST is an hour later in UTC than 10:00 PDT.
    expect(list[1].toISOString()).toBe("2026-11-09T18:00:00.000Z");
  });

  it("moves on once a session has finished, and keeps one that is still on", () => {
    const during = upcomingSessions(coachingCalls, new Date("2026-10-09T17:30:00.000Z"), 1);
    expect(during[0].toISOString()).toBe("2026-10-09T17:00:00.000Z");
    const after = upcomingSessions(coachingCalls, new Date("2026-10-09T18:01:00.000Z"), 1);
    expect(wall(after[0])).toBe("11/09/2026, 10:00");
  });

  it("walks an open series past the helper's own chunk size", () => {
    // Daily from 1 Jan 2026: 20 Aug 2027 is well past the first few chunks.
    const daily: CommunityEventSeries = {
      ...coachingCalls,
      starts_at: new Date("2026-01-01T18:00:00.000Z"),
      recurrence_freq: "daily",
    };
    const list = upcomingSessions(daily, new Date("2027-08-20T12:00:00.000Z"), 2);
    expect(list.map((at) => wall(at))).toEqual(["08/20/2027, 10:00", "08/21/2027, 10:00"]);
  });

  it("stops a bounded series at its end, as the events helper does", () => {
    const three = { ...coachingCalls, recurrence_count: 3 };
    expect(upcomingSessions(three, new Date("2026-12-10T00:00:00.000Z"), 5)).toEqual([]);
    expect(upcomingSessions(three, new Date("2026-11-10T00:00:00.000Z"), 5)).toHaveLength(1);
  });

  it("treats a single session as a series of one", () => {
    const single = { ...coachingCalls, recurrence_freq: null };
    expect(upcomingSessions(single, new Date("2026-10-01T00:00:00.000Z"), 3)).toHaveLength(1);
    expect(upcomingSessions(single, new Date("2026-10-10T00:00:00.000Z"), 3)).toEqual([]);
  });
});

describe("seriesView", () => {
  it("labels a series and gives its next session, keeping the series start apart", () => {
    const view = seriesView(coachingCalls, new Date("2026-10-20T00:00:00.000Z"));
    expect(view.recurring).toBe(true);
    expect(view.recurrenceLabel).toBe("Every month");
    expect(view.nextStartsAt).toBe("2026-11-09T18:00:00.000Z");
    expect(view.occurrences).toHaveLength(4);
    expect(view.upcoming).toBe(true);
  });

  it("leaves a single event's upcoming rule as it was", () => {
    const single = { ...coachingCalls, recurrence_freq: null };
    const view = seriesView(single, new Date("2026-10-20T00:00:00.000Z"));
    expect(view).toMatchObject({
      recurring: false,
      recurrenceLabel: "",
      nextStartsAt: "2026-10-09T17:00:00.000Z",
      upcoming: false,
    });
    expect(seriesView({ ...single, starts_at: null }, new Date()).upcoming).toBe(true);
  });
});

describe("communityRecurrenceProblem and seriesAfterSave", () => {
  const startsAt = new Date("2026-10-09T17:00:00.000Z");

  it("allows a series with no end, which the site-wide events refuse", () => {
    expect(
      communityRecurrenceProblem({
        startsAt,
        timezone: LA,
        rule: { freq: "monthly", interval: 1, until: null, count: null },
      })
    ).toBeNull();
  });

  it("keeps every other rule of the events helper", () => {
    const rule = { freq: "weekly" as const, interval: 1, until: null, count: null };
    expect(communityRecurrenceProblem({ startsAt: null, timezone: LA, rule })).toMatch(/first session/);
    expect(communityRecurrenceProblem({ startsAt, timezone: LA, rule: { ...rule, interval: 0 } })).toMatch(/1 to 99/);
    expect(
      communityRecurrenceProblem({ startsAt, timezone: LA, rule: { ...rule, until: "2026-12-01", count: 3 } })
    ).toMatch(/not both/);
    expect(communityRecurrenceProblem({ startsAt, timezone: "Mars/Olympus", rule })).toMatch(/time zone/);
  });

  it("normalises a new event's rule and defaults the zone", () => {
    const saved = seriesAfterSave({ recurrenceFreq: "monthly" }, null, startsAt);
    expect(saved.touched).toBe(true);
    expect(saved.columns).toEqual({
      recurrence_freq: "monthly",
      recurrence_interval: 1,
      recurrence_until: null,
      recurrence_count: null,
      timezone: LA,
    });
  });

  it("clears the whole rule when repeating is switched off", () => {
    const current = {
      recurrence_freq: "weekly" as const,
      recurrence_interval: 2,
      recurrence_until: "2026-12-31",
      recurrence_count: null,
      timezone: LA,
    };
    const saved = seriesAfterSave({ recurrenceFreq: "" }, current, startsAt);
    expect(saved.columns).toMatchObject({
      recurrence_freq: null,
      recurrence_interval: 1,
      recurrence_until: null,
      recurrence_count: null,
    });
  });

  it("leaves the stored rule alone on an unrelated edit, but refuses clearing the date a series needs", () => {
    const current = {
      recurrence_freq: "monthly" as const,
      recurrence_interval: 1,
      recurrence_until: null,
      recurrence_count: null,
      timezone: LA,
    };
    expect(seriesAfterSave({ title: "Renamed" }, current, startsAt).touched).toBe(false);
    expect(() => seriesAfterSave({ startsAt: null }, current, null)).toThrow(/first session/);
  });
});
