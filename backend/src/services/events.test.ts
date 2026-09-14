import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_REMINDERS,
  DOORS_OPEN_MINUTES,
  REGISTRATION_REMINDER_MAX_LATENESS_MINUTES,
  REMINDER_MAX_LATENESS_MINUTES,
  MAX_OCCURRENCES,
  buildIcs,
  describeRecurrence,
  describeReminderOffset,
  describeSession,
  isRoomOpen,
  occurrenceAt,
  occurrencesFor,
  recurrenceProblem,
  reminderFireTime,
  reminderVerdict,
  replayExpiryFor,
  sessionTimeFor,
  signRegistration,
  verifyRegistration,
  type EventSchedule,
  type ReminderSpec,
} from "./events";

const EVERGREEN: EventSchedule = {
  kind: "evergreen",
  startsAt: null,
  durationMinutes: 60,
  timezone: "America/New_York",
  evergreenIntervalMinutes: 15,
  replayExpiresAfterHours: 48,
};

const HOURLY: EventSchedule = { ...EVERGREEN, evergreenIntervalMinutes: 60 };

describe("sessionTimeFor — evergreen", () => {
  it("starts at the next quarter-hour in the event's own zone", () => {
    // 14:03:30 New York (18:03 UTC in July) → 14:15 New York = 18:15 UTC.
    const at = sessionTimeFor(EVERGREEN, new Date("2026-07-15T18:03:30.000Z"));
    expect(at.toISOString()).toBe("2026-07-15T18:15:00.000Z");
  });

  it("skips a boundary that is already upon the registrant", () => {
    // 14:14:30 is thirty seconds from 14:15. Being handed a session that starts
    // before the confirmation page finishes rendering is not a session.
    const at = sessionTimeFor(EVERGREEN, new Date("2026-07-15T18:14:30.000Z"));
    expect(at.toISOString()).toBe("2026-07-15T18:30:00.000Z");
  });

  it("uses the event's zone, not UTC, for the boundary", () => {
    const halfPastInIndia: EventSchedule = {
      ...HOURLY,
      timezone: "Asia/Kolkata",
    };
    // India is UTC+5:30, so its hour boundaries fall on :30 past a UTC hour.
    const at = sessionTimeFor(halfPastInIndia, new Date("2026-07-15T18:03:00.000Z"));
    expect(at.toISOString()).toBe("2026-07-15T18:30:00.000Z");
  });

  it("rolls over midnight", () => {
    // 23:52 New York on 15 July = 03:52 UTC on the 16th.
    const at = sessionTimeFor(EVERGREEN, new Date("2026-07-16T03:52:00.000Z"));
    expect(at.toISOString()).toBe("2026-07-16T04:00:00.000Z");
  });

  it("lands on a real instant when the clocks spring forward", () => {
    // 8 March 2026, US spring-forward: 02:00–02:59 local does not exist. A
    // registrant at 01:52 EST (06:52 UTC) must not be handed 02:00, which is
    // not a time that happens.
    const at = sessionTimeFor(HOURLY, new Date("2026-03-08T06:52:00.000Z"));
    expect(at.toISOString()).toBe("2026-03-08T07:00:00.000Z");

    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(at);
    expect(local).toBe("03:00");
  });

  it("moves forward when the clocks go back and the hour repeats", () => {
    // 1 November 2026, US fall-back: 01:00–01:59 local happens twice. At 01:30
    // EDT (05:30 UTC) the 01:00 boundary is already an hour gone, so the next
    // session is the 02:00 EST one — 07:00 UTC. The repeated hour is skipped
    // rather than fired twice, which is what a wall-clock cadence means and
    // what a calendar app does with the same repeat rule. What must never
    // happen is a session in the past, which is the assertion above it.
    const registeredAt = new Date("2026-11-01T05:30:00.000Z");
    const at = sessionTimeFor(HOURLY, registeredAt);
    expect(at.getTime()).toBeGreaterThan(registeredAt.getTime());
    expect(at.toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("keeps the cadence on a fifteen-minute event through the fall-back hour", () => {
    const registeredAt = new Date("2026-11-01T05:22:00.000Z");
    const at = sessionTimeFor(EVERGREEN, registeredAt);
    expect(at.getTime()).toBeGreaterThan(registeredAt.getTime());
    expect(at.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("falls back to an hourly cadence when the interval is missing", () => {
    const broken: EventSchedule = { ...EVERGREEN, evergreenIntervalMinutes: null };
    const at = sessionTimeFor(broken, new Date("2026-07-15T18:03:00.000Z"));
    expect(at.toISOString()).toBe("2026-07-15T19:00:00.000Z");
  });

  it("handles a daily cadence without stepping through every minute", () => {
    const daily: EventSchedule = { ...EVERGREEN, evergreenIntervalMinutes: 1440 };
    // Midnight New York on the 16th is 04:00 UTC.
    const at = sessionTimeFor(daily, new Date("2026-07-15T18:03:00.000Z"));
    expect(at.toISOString()).toBe("2026-07-16T04:00:00.000Z");
  });
});

describe("sessionTimeFor — live and replay", () => {
  it("gives every live registrant the same start", () => {
    const live: EventSchedule = {
      ...EVERGREEN,
      kind: "live",
      startsAt: new Date("2026-09-01T17:00:00.000Z"),
      evergreenIntervalMinutes: null,
    };
    expect(sessionTimeFor(live, new Date("2026-08-01T10:00:00.000Z")).toISOString()).toBe(
      "2026-09-01T17:00:00.000Z"
    );
  });

  it("opens a replay the moment somebody registers", () => {
    const replay: EventSchedule = { ...EVERGREEN, kind: "replay", evergreenIntervalMinutes: null };
    const at = new Date("2026-08-01T10:00:00.000Z");
    expect(sessionTimeFor(replay, at).toISOString()).toBe(at.toISOString());
  });
});

describe("replayExpiryFor", () => {
  it("counts from the end of the session, not its start", () => {
    const expiry = replayExpiryFor(EVERGREEN, new Date("2026-07-15T18:15:00.000Z"));
    // 18:15 + 60 minutes of session + 48 hours.
    expect(expiry?.toISOString()).toBe("2026-07-17T19:15:00.000Z");
  });

  it("never expires when no window is set", () => {
    expect(replayExpiryFor({ ...EVERGREEN, replayExpiresAfterHours: null }, new Date())).toBeNull();
  });
});

describe("isRoomOpen", () => {
  const sessionAt = new Date("2026-07-15T18:00:00.000Z");
  const window = {
    sessionAt,
    durationMinutes: 60,
    replayExpiresAt: new Date("2026-07-17T19:00:00.000Z"),
    hasReplay: true,
  };

  it("is shut before the doors open, and says when to come back", () => {
    const access = isRoomOpen(window, new Date("2026-07-15T17:30:00.000Z"));
    expect(access.open).toBe(false);
    expect(access.state).toBe("early");
    expect(access.opensAt?.toISOString()).toBe(
      new Date(sessionAt.getTime() - DOORS_OPEN_MINUTES * 60_000).toISOString()
    );
  });

  it("opens the doors early", () => {
    expect(isRoomOpen(window, new Date("2026-07-15T17:52:00.000Z")).open).toBe(true);
  });

  it("is open all the way to the end of the session", () => {
    expect(isRoomOpen(window, new Date("2026-07-15T18:59:00.000Z")).state).toBe("live");
    expect(isRoomOpen(window, new Date("2026-07-15T19:00:00.000Z")).state).toBe("live");
  });

  it("hands over to the replay once the session has ended", () => {
    const access = isRoomOpen(window, new Date("2026-07-15T19:00:01.000Z"));
    expect(access.open).toBe(true);
    expect(access.state).toBe("replay");
    expect(access.closesAt?.toISOString()).toBe("2026-07-17T19:00:00.000Z");
  });

  it("refuses an expired replay, and says when it closed", () => {
    const access = isRoomOpen(window, new Date("2026-07-18T09:00:00.000Z"));
    expect(access.open).toBe(false);
    expect(access.state).toBe("expired");
    expect(access.closesAt?.toISOString()).toBe("2026-07-17T19:00:00.000Z");
  });

  it("never expires a replay with no window on it", () => {
    const forever = { ...window, replayExpiresAt: null };
    expect(isRoomOpen(forever, new Date("2030-01-01T00:00:00.000Z")).state).toBe("replay");
  });

  it("distinguishes a session with no recording from an expired one", () => {
    const noReplay = { ...window, hasReplay: false };
    const access = isRoomOpen(noReplay, new Date("2026-07-15T20:00:00.000Z"));
    expect(access.open).toBe(false);
    expect(access.state).toBe("ended");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "event-7-registration-42@bossclinician",
    title: "The Practice Reset; live",
    description: "Ninety minutes on pricing, boundaries and the maths.",
    url: "https://example.test/events/reset/room?token=abc",
    startsAt: new Date("2026-07-15T18:15:00.000Z"),
    durationMinutes: 90,
    generatedAt: new Date("2026-07-01T12:00:00.000Z"),
  });

  it("writes the start and end as UTC instants", () => {
    expect(ics).toContain("DTSTART:20260715T181500Z");
    expect(ics).toContain("DTEND:20260715T194500Z");
  });

  it("escapes the characters iCalendar reserves", () => {
    expect(ics).toContain("SUMMARY:The Practice Reset\\; live");
  });

  it("ends every line with CRLF", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("buildIcs — location and repeating events", () => {
  it("writes a physical address as LOCATION, escaped", () => {
    const ics = buildIcs({
      uid: "event-7-registration-42@bossclinician",
      title: "In-person workshop",
      description: "",
      url: "https://example.test/events/x",
      startsAt: new Date("2026-10-06T22:00:00.000Z"),
      durationMinutes: 60,
      location: "12 Main St, Suite 4\nAustin, TX 78701",
      generatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(ics).toContain("LOCATION:12 Main St\\, Suite 4\\nAustin\\, TX 78701");
  });

  it("leaves LOCATION out of an online event", () => {
    expect(ics()).not.toContain("LOCATION:");
    function ics() {
      return buildIcs({
        uid: "u@bossclinician",
        title: "Online",
        description: "",
        url: "https://example.test",
        startsAt: new Date("2026-10-06T22:00:00.000Z"),
        durationMinutes: 60,
      });
    }
  });

  it("writes one VEVENT per session, each with its own UID and DTSTART", () => {
    const occurrences = occurrencesFor(new Date("2026-10-20T22:00:00.000Z"), "America/New_York", {
      freq: "weekly",
      interval: 1,
      until: null,
      count: 3,
    });
    const ics = buildIcs({
      uid: "event-7-registration-42@bossclinician",
      title: "Office hours",
      description: "",
      url: "https://example.test",
      startsAt: occurrences[0],
      occurrences,
      durationMinutes: 60,
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("UID:event-7-registration-42-s1@bossclinician");
    expect(ics).toContain("UID:event-7-registration-42-s3@bossclinician");
    // 6:00 PM EDT on 20 and 27 October, then 6:00 PM EST on 3 November — the
    // UTC instant moves by an hour so the wall clock does not.
    expect(ics).toContain("DTSTART:20261020T220000Z");
    expect(ics).toContain("DTSTART:20261027T220000Z");
    expect(ics).toContain("DTSTART:20261103T230000Z");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("per-member time zone", () => {
  it("shows an admin's 6:00 PM EDT session as 3:00 PM PDT to a Pacific member", () => {
    // The member route formats the registrant's session in the zone the
    // registration was taken in, falling back to the event's own.
    const sessionAt = new Date("2026-09-15T22:00:00.000Z");
    expect(describeSession(sessionAt, "America/New_York")).toBe(
      "Tuesday, September 15 at 6:00 PM EDT"
    );
    expect(describeSession(sessionAt, "America/Los_Angeles")).toBe(
      "Tuesday, September 15 at 3:00 PM PDT"
    );
  });
});

describe("occurrencesFor", () => {
  const NY = "America/New_York";
  const wall = (at: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(at);

  it("is a series of one without a rule", () => {
    const start = new Date("2026-10-06T22:00:00.000Z");
    expect(occurrencesFor(start, NY, null)).toEqual([start]);
  });

  it("repeats weekly on the same wall-clock time across the fall-back", () => {
    const list = occurrencesFor(new Date("2026-10-27T22:00:00.000Z"), NY, {
      freq: "weekly",
      interval: 1,
      until: null,
      count: 3,
    });
    expect(list.map(wall)).toEqual([
      "10/27/2026, 18:00",
      "11/03/2026, 18:00",
      "11/10/2026, 18:00",
    ]);
  });

  it("stops on the end date, inclusive, read in the event's zone", () => {
    // 9:00 PM Pacific on 1 September, daily until the 3rd. The last session,
    // 9:00 PM on the 3rd, is already the 4th in UTC — the end date is read on
    // the event's own calendar, so it is still included.
    const list = occurrencesFor(new Date("2026-09-02T04:00:00.000Z"), "America/Los_Angeles", {
      freq: "daily",
      interval: 1,
      until: "2026-09-03",
      count: null,
    });
    expect(list).toHaveLength(3);
  });

  it("repeats every N", () => {
    const list = occurrencesFor(new Date("2026-10-06T22:00:00.000Z"), NY, {
      freq: "daily",
      interval: 3,
      until: null,
      count: 3,
    });
    expect(list.map((at) => at.toISOString())).toEqual([
      "2026-10-06T22:00:00.000Z",
      "2026-10-09T22:00:00.000Z",
      "2026-10-12T22:00:00.000Z",
    ]);
  });

  it("skips months without the day, as RRULE does", () => {
    // 31 January, monthly: February, April and June have no 31st.
    const list = occurrencesFor(new Date("2027-01-31T23:00:00.000Z"), NY, {
      freq: "monthly",
      interval: 1,
      until: "2027-07-31",
      count: null,
    });
    expect(list.map((at) => wall(at).slice(0, 10))).toEqual([
      "01/31/2027",
      "03/31/2027",
      "05/31/2027",
      "07/31/2027",
    ]);
  });

  it("never produces more than the cap", () => {
    const list = occurrencesFor(new Date("2026-10-06T22:00:00.000Z"), NY, {
      freq: "daily",
      interval: 1,
      until: "2030-01-01",
      count: null,
    });
    expect(list).toHaveLength(MAX_OCCURRENCES);
  });
});

describe("occurrenceAt and sessionTimeFor — repeating", () => {
  const series = occurrencesFor(new Date("2026-10-06T22:00:00.000Z"), "America/New_York", {
    freq: "weekly",
    interval: 1,
    until: null,
    count: 4,
  });

  it("is the next session that has not finished", () => {
    expect(occurrenceAt(series, 60, new Date("2026-10-07T12:00:00.000Z"))?.toISOString()).toBe(
      "2026-10-13T22:00:00.000Z"
    );
    // Half way through a session, that session is still the one.
    expect(occurrenceAt(series, 60, new Date("2026-10-13T22:30:00.000Z"))?.toISOString()).toBe(
      "2026-10-13T22:00:00.000Z"
    );
  });

  it("is the last session once the series is over", () => {
    expect(occurrenceAt(series, 60, new Date("2027-01-01T00:00:00.000Z"))?.toISOString()).toBe(
      "2026-10-27T22:00:00.000Z"
    );
  });

  it("never goes back before the registrant's own first session", () => {
    expect(
      occurrenceAt(series, 60, new Date("2026-10-01T00:00:00.000Z"), series[2])?.toISOString()
    ).toBe("2026-10-20T22:00:00.000Z");
  });

  it("books somebody who signs up in week two into week two", () => {
    const schedule: EventSchedule = {
      kind: "live",
      startsAt: series[0],
      durationMinutes: 60,
      timezone: "America/New_York",
      evergreenIntervalMinutes: null,
      replayExpiresAfterHours: null,
      recurrence: { freq: "weekly", interval: 1, until: null, count: 4 },
    };
    expect(sessionTimeFor(schedule, new Date("2026-10-08T12:00:00.000Z")).toISOString()).toBe(
      "2026-10-13T22:00:00.000Z"
    );
  });
});

describe("describeRecurrence and recurrenceProblem", () => {
  it("says the rule the way a person would", () => {
    expect(describeRecurrence({ freq: "weekly", interval: 1, until: null, count: 6 })).toBe(
      "Every week, 6 sessions"
    );
    expect(describeRecurrence({ freq: "weekly", interval: 2, until: "2026-10-31", count: null })).toBe(
      "Every 2 weeks until October 31, 2026"
    );
    expect(describeRecurrence({ freq: "daily", interval: 1, until: null, count: 1 })).toBe(
      "Every day, 1 session"
    );
    expect(describeRecurrence({ freq: "monthly", interval: 3, until: null, count: 4 })).toBe(
      "Every 3 months, 4 sessions"
    );
    expect(describeRecurrence(null)).toBe("");
  });

  const base = {
    kind: "live",
    startsAt: new Date("2026-10-06T22:00:00.000Z"),
    timezone: "America/New_York",
  };

  it("accepts a sound rule and no rule", () => {
    expect(recurrenceProblem({ ...base, rule: null })).toBeNull();
    expect(
      recurrenceProblem({ ...base, rule: { freq: "weekly", interval: 1, until: "2026-12-01", count: null } })
    ).toBeNull();
  });

  it("explains each way a rule can be wrong", () => {
    const weekly = { freq: "weekly" as const, interval: 1, until: null, count: 4 };
    expect(recurrenceProblem({ ...base, kind: "evergreen", rule: weekly })).toMatch(/Only a live event/);
    expect(recurrenceProblem({ ...base, rule: { ...weekly, count: null } })).toMatch(/when the repeats stop/);
    expect(recurrenceProblem({ ...base, rule: { ...weekly, until: "2026-12-01" } })).toMatch(/not both/);
    expect(recurrenceProblem({ ...base, rule: { ...weekly, interval: 0 } })).toMatch(/1 to 99/);
    expect(recurrenceProblem({ ...base, rule: { ...weekly, count: 500 } })).toMatch(/between 1 and 200/);
    expect(
      recurrenceProblem({ ...base, rule: { ...weekly, count: null, until: "2026-10-01" } })
    ).toMatch(/before the first session/);
    expect(
      recurrenceProblem({ ...base, rule: { ...weekly, count: null, until: "2026-02-30" } })
    ).toMatch(/isn't a real date/);
    expect(
      recurrenceProblem({
        ...base,
        rule: { freq: "daily", interval: 1, count: null, until: "2028-01-01" },
      })
    ).toMatch(/more than 200 sessions/);
  });
});

describe("registration links", () => {
  it("round-trips a registration id", () => {
    expect(verifyRegistration(signRegistration(42))).toBe(42);
  });

  it("refuses a tampered token", () => {
    const token = signRegistration(42);
    expect(verifyRegistration(`${token}x`)).toBeNull();
    expect(verifyRegistration(signRegistration(43).split(".")[0] + "." + token.split(".")[1])).toBeNull();
  });

  it("refuses nonsense", () => {
    expect(verifyRegistration("")).toBeNull();
    expect(verifyRegistration("not-a-token")).toBeNull();
  });
});

/* ------------------------------------------------------------------ reminders */

describe("reminderFireTime", () => {
  const NEW_YORK = "America/New_York";

  it("fires a confirmation the moment somebody registers", () => {
    const registeredAt = new Date("2026-09-04T14:11:00.000Z");
    const at = reminderFireTime(
      { kind: "registration", offsetMinutes: 0 },
      { sessionAt: new Date("2026-09-15T22:00:00.000Z"), registeredAt, timezone: NEW_YORK }
    );
    expect(at.toISOString()).toBe(registeredAt.toISOString());
  });

  it("fires an at-the-start reminder exactly at the start", () => {
    const sessionAt = new Date("2026-09-15T22:00:00.000Z");
    const at = reminderFireTime(
      { kind: "before", offsetMinutes: 0 },
      { sessionAt, registeredAt: new Date("2026-09-04T14:00:00.000Z"), timezone: NEW_YORK }
    );
    expect(at.toISOString()).toBe(sessionAt.toISOString());
  });

  it("counts an hours-before reminder back from the registrant's own session", () => {
    // The evergreen case: the session belongs to this registrant, not the event.
    const at = reminderFireTime(
      { kind: "before", offsetMinutes: 90 },
      {
        sessionAt: new Date("2026-09-15T22:00:00.000Z"),
        registeredAt: new Date("2026-09-04T14:00:00.000Z"),
        timezone: NEW_YORK,
      }
    );
    expect(at.toISOString()).toBe("2026-09-15T20:30:00.000Z");
  });

  it("keeps the wall-clock time when a day-before reminder crosses spring-forward", () => {
    // 8 March 2026 is the US spring-forward. A 6:00 PM Eastern session on the
    // 8th is 22:00 UTC (EDT); 6:00 PM the day before is 23:00 UTC (EST) — one
    // wall-clock day apart, but only 23 hours of elapsed time. Plain
    // subtraction of 1440 minutes lands at 5:00 PM on the 7th, an hour early,
    // and an hour out is the error that makes somebody distrust every time the
    // platform ever shows them.
    const sessionAt = new Date("2026-03-08T22:00:00.000Z"); // 6:00 PM EDT
    const at = reminderFireTime(
      { kind: "before", offsetMinutes: 1440 },
      { sessionAt, registeredAt: new Date("2026-03-01T12:00:00.000Z"), timezone: NEW_YORK }
    );

    const wall = (instant: Date) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: NEW_YORK,
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
      }).format(instant);

    expect(wall(at)).toBe(wall(sessionAt));
    expect(wall(at)).toBe("18:00");
    // 23:00 UTC on the 7th: EST, one hour behind the session's EDT.
    expect(at.toISOString()).toBe("2026-03-07T23:00:00.000Z");
    // 23 hours of elapsed time for one calendar day, which is what the
    // transition means and what plain arithmetic cannot produce.
    expect(sessionAt.getTime() - at.getTime()).toBe(23 * 3_600_000);
  });

  it("keeps the wall-clock time when a day-before reminder crosses fall-back", () => {
    // 1 November 2026 is the US fall-back. A 6:00 PM Eastern session on the 1st
    // is 23:00 UTC (EST); the day before at 6:00 PM is 22:00 UTC (EDT).
    const sessionAt = new Date("2026-11-01T23:00:00.000Z");
    const at = reminderFireTime(
      { kind: "before", offsetMinutes: 1440 },
      { sessionAt, registeredAt: new Date("2026-10-20T12:00:00.000Z"), timezone: NEW_YORK }
    );
    expect(at.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(sessionAt.getTime() - at.getTime()).toBe(25 * 3_600_000);
  });

  it("treats a sub-day offset as real elapsed time, not wall clock", () => {
    // "An hour before" means an hour, even across a transition. Only whole-day
    // offsets are a wall-clock question.
    const sessionAt = new Date("2026-03-08T07:30:00.000Z"); // 03:30 EDT, just after the jump
    const at = reminderFireTime(
      { kind: "before", offsetMinutes: 60 },
      { sessionAt, registeredAt: new Date("2026-03-01T12:00:00.000Z"), timezone: NEW_YORK }
    );
    expect(sessionAt.getTime() - at.getTime()).toBe(3_600_000);
  });

  it("respects the event's own zone rather than the server's", () => {
    const sessionAt = new Date("2026-09-15T22:00:00.000Z");
    const easternDayBefore = reminderFireTime(
      { kind: "before", offsetMinutes: 1440 },
      { sessionAt, registeredAt: sessionAt, timezone: "America/New_York" }
    );
    const kolkataDayBefore = reminderFireTime(
      { kind: "before", offsetMinutes: 1440 },
      { sessionAt, registeredAt: sessionAt, timezone: "Asia/Kolkata" }
    );
    // No DST in either zone in September, so both are a plain 24 hours — the
    // point being that the zone is consulted rather than assumed.
    expect(easternDayBefore.toISOString()).toBe("2026-09-14T22:00:00.000Z");
    expect(kolkataDayBefore.toISOString()).toBe("2026-09-14T22:00:00.000Z");
  });
});

describe("reminderVerdict", () => {
  const SESSION = new Date("2026-09-15T22:00:00.000Z");
  const base = {
    kind: "before" as const,
    offsetMinutes: 60,
    sessionAt: SESSION,
    durationMinutes: 60,
  };

  it("waits while the moment is still ahead", () => {
    expect(
      reminderVerdict({
        ...base,
        scheduledFor: new Date("2026-09-15T21:00:00.000Z"),
        now: new Date("2026-09-15T20:00:00.000Z"),
      })
    ).toBe("wait");
  });

  it("sends when the moment has arrived", () => {
    expect(
      reminderVerdict({
        ...base,
        scheduledFor: new Date("2026-09-15T21:00:00.000Z"),
        now: new Date("2026-09-15T21:02:00.000Z"),
      })
    ).toBe("send");
  });

  it("skips a before-it-starts reminder once it has started", () => {
    // The heart of the backlog guard. A worker that comes back up after the
    // webinar began must not tell people it is about to begin.
    expect(
      reminderVerdict({
        ...base,
        scheduledFor: new Date("2026-09-15T21:00:00.000Z"),
        now: new Date("2026-09-15T22:00:01.000Z"),
      })
    ).toBe("skip");
  });

  it("skips everything once the session is over", () => {
    for (const kind of ["before", "registration"] as const) {
      expect(
        reminderVerdict({
          ...base,
          kind,
          offsetMinutes: 0,
          scheduledFor: new Date("2026-09-15T22:00:00.000Z"),
          now: new Date("2026-09-15T23:00:01.000Z"),
        })
      ).toBe("skip");
    }
  });

  it("still sends the we're-live reminder a few minutes into the session", () => {
    // Scheduled *at* the start, so it is exempt from the has-it-started rule:
    // "come on in" is true five minutes in, and would otherwise never send at
    // all, because it becomes due at the very instant it becomes past-due.
    expect(
      reminderVerdict({
        ...base,
        offsetMinutes: 0,
        scheduledFor: SESSION,
        now: new Date("2026-09-15T22:05:00.000Z"),
      })
    ).toBe("send");
  });

  it("skips a reminder that is more than an hour late", () => {
    // A day-before reminder for a session still a fortnight out is not
    // protected by the has-it-started rule, so the lateness cap is what stops a
    // restart mailing yesterday's batch.
    const sessionAt = new Date("2026-09-29T22:00:00.000Z");
    const scheduledFor = new Date("2026-09-28T22:00:00.000Z");
    expect(
      reminderVerdict({
        kind: "before",
        offsetMinutes: 1440,
        sessionAt,
        durationMinutes: 60,
        scheduledFor,
        now: new Date(scheduledFor.getTime() + (REMINDER_MAX_LATENESS_MINUTES - 1) * 60_000),
      })
    ).toBe("send");
    expect(
      reminderVerdict({
        kind: "before",
        offsetMinutes: 1440,
        sessionAt,
        durationMinutes: 60,
        scheduledFor,
        now: new Date(scheduledFor.getTime() + (REMINDER_MAX_LATENESS_MINUTES + 1) * 60_000),
      })
    ).toBe("skip");
  });

  it("gives a confirmation a longer grace than a reminder", () => {
    const registeredAt = new Date("2026-09-04T14:00:00.000Z");
    const twoHoursLater = new Date(registeredAt.getTime() + 2 * 3_600_000);
    expect(
      reminderVerdict({
        kind: "registration",
        offsetMinutes: 0,
        sessionAt: SESSION,
        durationMinutes: 60,
        scheduledFor: registeredAt,
        now: twoHoursLater,
      })
    ).toBe("send");

    expect(
      reminderVerdict({
        kind: "registration",
        offsetMinutes: 0,
        sessionAt: SESSION,
        durationMinutes: 60,
        scheduledFor: registeredAt,
        now: new Date(
          registeredAt.getTime() + (REGISTRATION_REMINDER_MAX_LATENESS_MINUTES + 1) * 60_000
        ),
      })
    ).toBe("skip");
  });

  it("refuses to schedule a reminder configured after its own moment", () => {
    // A "one week before" reminder added to an event three days out. Written as
    // skipped when the plan is drawn up, so it is visible and never sent —
    // rather than queued in the past, which is a blast waiting for a tick.
    const sessionAt = new Date("2026-09-15T22:00:00.000Z");
    const spec: ReminderSpec = { kind: "before", offsetMinutes: 7 * 1440 };
    const scheduledFor = reminderFireTime(spec, {
      sessionAt,
      registeredAt: new Date("2026-09-01T12:00:00.000Z"),
      timezone: "America/New_York",
    });
    expect(scheduledFor.toISOString()).toBe("2026-09-08T22:00:00.000Z");
    expect(
      reminderVerdict({
        kind: spec.kind,
        offsetMinutes: spec.offsetMinutes,
        scheduledFor,
        sessionAt,
        durationMinutes: 60,
        now: new Date("2026-09-12T12:00:00.000Z"),
      })
    ).toBe("skip");
  });

  it("skips the entire backlog a restart would otherwise blast", () => {
    /*
     * The scenario in one test. The scheduler was down for two days; four
     * reminders across two past sessions and one future one are sitting due.
     * Exactly one of them — the future session's, which has only just come due —
     * may go out.
     */
    const now = new Date("2026-09-15T12:00:00.000Z");
    const queue = [
      // Yesterday's webinar, its day-before reminder.
      {
        kind: "before" as const,
        offsetMinutes: 1440,
        sessionAt: new Date("2026-09-14T18:00:00.000Z"),
        scheduledFor: new Date("2026-09-13T18:00:00.000Z"),
      },
      // Yesterday's webinar, its we're-live one.
      {
        kind: "before" as const,
        offsetMinutes: 0,
        sessionAt: new Date("2026-09-14T18:00:00.000Z"),
        scheduledFor: new Date("2026-09-14T18:00:00.000Z"),
      },
      // A confirmation for somebody who registered two days ago.
      {
        kind: "registration" as const,
        offsetMinutes: 0,
        sessionAt: new Date("2026-09-20T18:00:00.000Z"),
        scheduledFor: new Date("2026-09-13T09:00:00.000Z"),
      },
      // Tomorrow's webinar, due four minutes ago. This one is real.
      {
        kind: "before" as const,
        offsetMinutes: 1440,
        sessionAt: new Date("2026-09-16T11:56:00.000Z"),
        scheduledFor: new Date("2026-09-15T11:56:00.000Z"),
      },
    ];

    const verdicts = queue.map((row) =>
      reminderVerdict({ ...row, durationMinutes: 60, now })
    );
    expect(verdicts).toEqual(["skip", "skip", "skip", "send"]);
  });
});

describe("describeReminderOffset", () => {
  it("says each offset the way a person would", () => {
    expect(describeReminderOffset({ kind: "registration", offsetMinutes: 0 })).toBe(
      "as soon as they sign up"
    );
    expect(describeReminderOffset({ kind: "before", offsetMinutes: 0 })).toBe("when it starts");
    expect(describeReminderOffset({ kind: "before", offsetMinutes: 30 })).toBe(
      "30 minutes before"
    );
    expect(describeReminderOffset({ kind: "before", offsetMinutes: 60 })).toBe("1 hour before");
    expect(describeReminderOffset({ kind: "before", offsetMinutes: 180 })).toBe("3 hours before");
    expect(describeReminderOffset({ kind: "before", offsetMinutes: 1440 })).toBe("1 day before");
    expect(describeReminderOffset({ kind: "before", offsetMinutes: 4320 })).toBe("3 days before");
  });
});

describe("DEFAULT_EVENT_REMINDERS", () => {
  it("keeps the three steps the hard-coded job already sent, plus the promised confirmation", () => {
    // Migration 036 seeds exactly this set onto every existing event, so an
    // event that was getting reminders goes on getting the same ones.
    expect(DEFAULT_EVENT_REMINDERS).toEqual([
      { kind: "registration", offsetMinutes: 0 },
      { kind: "before", offsetMinutes: 1440 },
      { kind: "before", offsetMinutes: 60 },
      { kind: "before", offsetMinutes: 0 },
    ]);
  });

  it("has no two reminders in the same slot", () => {
    const slots = DEFAULT_EVENT_REMINDERS.map((r) => `${r.kind}:${r.offsetMinutes}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("never schedules two defaults at the same instant for one registrant", () => {
    // The unique index enforces one row per slot; this checks the *times* do
    // not collide either, because two emails arriving together saying different
    // things about one webinar is the failure a naive offset list produces.
    const sessionAt = new Date("2026-09-15T22:00:00.000Z");
    const registeredAt = new Date("2026-09-04T14:00:00.000Z");
    const times = DEFAULT_EVENT_REMINDERS.map((spec) =>
      reminderFireTime(spec, { sessionAt, registeredAt, timezone: "America/New_York" }).getTime()
    );
    expect(new Set(times).size).toBe(times.length);
  });
});
