import { describe, expect, it } from "vitest";
import {
  DOORS_OPEN_MINUTES,
  buildIcs,
  isRoomOpen,
  replayExpiryFor,
  sessionTimeFor,
  signRegistration,
  verifyRegistration,
  type EventSchedule,
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
