import { describe, expect, it } from "vitest";
import {
  REMINDER_CATCHUP_HOURS,
  REPLAY_SEND_WINDOW_DAYS,
  heldInLiveRoom,
  isDueNow,
  lessonDueAt,
  lessonLink,
  manualSendKey,
  matchesStatusFilter,
  needsReminder,
  parseSessionKey,
  replayWindowOpen,
  sessionEndsAt,
  sessionKey,
  visitCoversSession,
  watchStatusOf,
  watchedPercentOf,
} from "./engagement";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const none = { completedAt: null, watchedPercent: 0, lastPositionSeconds: 0, maxPositionSeconds: 0 };

describe("watchStatusOf (row 171)", () => {
  it("is completed once the lesson is, whatever the numbers say", () => {
    expect(watchStatusOf({ ...none, completedAt: new Date() })).toBe("completed");
    expect(watchStatusOf({ ...none, completedAt: "2026-10-01T00:00:00Z", watchedPercent: 3 })).toBe("completed");
  });

  it("calls any playback at all partial", () => {
    expect(watchStatusOf({ ...none, watchedPercent: 1 })).toBe("partial");
    expect(watchStatusOf({ ...none, lastPositionSeconds: 12 })).toBe("partial");
    expect(watchStatusOf({ ...none, maxPositionSeconds: 5 })).toBe("partial");
    expect(watchStatusOf({ ...none, watchedSeconds: 30 })).toBe("partial");
  });

  it("calls opening the page without pressing play not started", () => {
    expect(watchStatusOf(none)).toBe("not_started");
  });
});

describe("watchedPercentOf", () => {
  it("takes the larger of the player's figure and the played-through point, capped at 100", () => {
    expect(watchedPercentOf({ ...none, watchedPercent: 40, maxPositionSeconds: 30 }, 100)).toBe(40);
    expect(watchedPercentOf({ ...none, watchedPercent: 10, maxPositionSeconds: 80 }, 100)).toBe(80);
    expect(watchedPercentOf({ ...none, watchedPercent: 0, maxPositionSeconds: 500 }, 100)).toBe(100);
  });

  it("does not divide by an unknown length", () => {
    expect(watchedPercentOf({ ...none, watchedPercent: 25, maxPositionSeconds: 90 }, 0)).toBe(25);
  });
});

describe("needsReminder / matchesStatusFilter", () => {
  it("reminds about an unfinished video unless only never-played ones were asked for", () => {
    expect(needsReminder("not_started", "not_completed")).toBe(true);
    expect(needsReminder("partial", "not_completed")).toBe(true);
    expect(needsReminder("completed", "not_completed")).toBe(false);
    expect(needsReminder("partial", "not_started")).toBe(false);
    expect(needsReminder("not_started", "not_started")).toBe(true);
  });

  it("filters the report the way its menu reads", () => {
    expect(matchesStatusFilter("completed", "all")).toBe(true);
    expect(matchesStatusFilter("completed", "not_completed")).toBe(false);
    expect(matchesStatusFilter("partial", "not_completed")).toBe(true);
    expect(matchesStatusFilter("partial", "not_started")).toBe(false);
  });
});

describe("lessonDueAt / isDueNow", () => {
  const granted = new Date("2026-10-01T12:00:00Z");

  it("counts from the grant, or from a later release, by the automation's basis", () => {
    const released = new Date("2026-10-08T12:00:00Z");
    expect(lessonDueAt({ grantedAt: granted, releasedAt: released, basis: "access", days: 3 }).toISOString()).toBe(
      "2026-10-04T12:00:00.000Z"
    );
    expect(lessonDueAt({ grantedAt: granted, releasedAt: released, basis: "release", days: 3 }).toISOString()).toBe(
      "2026-10-11T12:00:00.000Z"
    );
  });

  it("never counts from a release earlier than the grant", () => {
    const early = new Date("2026-09-01T00:00:00Z");
    expect(lessonDueAt({ grantedAt: granted, releasedAt: early, basis: "release", days: 1 }).toISOString()).toBe(
      "2026-10-02T12:00:00.000Z"
    );
    expect(lessonDueAt({ grantedAt: granted, releasedAt: null, basis: "release", days: 1 }).toISOString()).toBe(
      "2026-10-02T12:00:00.000Z"
    );
  });

  it("is due from the moment itself until the catch-up window closes, and not before or after", () => {
    const due = new Date("2026-10-10T00:00:00Z");
    expect(isDueNow(due, new Date(due.getTime() - 1))).toBe(false);
    expect(isDueNow(due, due)).toBe(true);
    expect(isDueNow(due, new Date(due.getTime() + (REMINDER_CATCHUP_HOURS - 1) * HOUR))).toBe(true);
    // The backlog guard: a reminder that fell due long before the automation
    // was switched on is not sent by it.
    expect(isDueNow(due, new Date(due.getTime() + REMINDER_CATCHUP_HOURS * HOUR))).toBe(false);
    expect(isDueNow(due, new Date(due.getTime() + 30 * DAY))).toBe(false);
  });
});

describe("visitCoversSession", () => {
  const start = new Date("2026-10-09T17:00:00Z");

  it("counts a stay that overlaps the session, including the early doors", () => {
    expect(visitCoversSession({ joinedAt: new Date("2026-10-09T17:05:00Z"), leftAt: new Date("2026-10-09T17:40:00Z") }, start, 60)).toBe(true);
    expect(visitCoversSession({ joinedAt: new Date("2026-10-09T16:52:00Z"), leftAt: new Date("2026-10-09T16:55:00Z") }, start, 60)).toBe(true);
    expect(visitCoversSession({ joinedAt: new Date("2026-10-09T17:59:00Z"), leftAt: new Date("2026-10-09T18:30:00Z") }, start, 60)).toBe(true);
  });

  it("does not count a stay entirely before or after it", () => {
    expect(visitCoversSession({ joinedAt: new Date("2026-10-09T15:00:00Z"), leftAt: new Date("2026-10-09T16:30:00Z") }, start, 60)).toBe(false);
    expect(visitCoversSession({ joinedAt: new Date("2026-10-09T18:01:00Z"), leftAt: new Date("2026-10-09T18:30:00Z") }, start, 60)).toBe(false);
  });

  it("credits a never-closed visit by its join alone, so a ghost is not at every later call", () => {
    expect(visitCoversSession({ joinedAt: new Date("2026-10-09T17:10:00Z"), leftAt: null }, start, 60)).toBe(true);
    expect(visitCoversSession({ joinedAt: new Date("2026-09-18T21:00:00Z"), leftAt: null }, start, 60)).toBe(false);
  });
});

describe("replayWindowOpen", () => {
  const end = sessionEndsAt(new Date("2026-10-09T17:00:00Z"), 60);

  it("opens when the session ends and closes after the window", () => {
    expect(end.toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(replayWindowOpen(end, new Date(end.getTime() - 1))).toBe(false);
    expect(replayWindowOpen(end, end)).toBe(true);
    expect(replayWindowOpen(end, new Date(end.getTime() + (REPLAY_SEND_WINDOW_DAYS * DAY) - 1))).toBe(true);
    expect(replayWindowOpen(end, new Date(end.getTime() + REPLAY_SEND_WINDOW_DAYS * DAY))).toBe(false);
  });
});

describe("heldInLiveRoom", () => {
  it("treats the editor's 'live room' (no link) and the room's own address as tracked", () => {
    expect(heldInLiveRoom("", "the-boss")).toBe(true);
    expect(heldInLiveRoom("https://bossclinician.callsphere.site/community/the-boss/live", "the-boss")).toBe(true);
    expect(heldInLiveRoom("/community/The-Boss/live/", "the-boss")).toBe(true);
  });

  it("treats an external meeting, or another room, as untracked", () => {
    expect(heldInLiveRoom("https://zoom.us/j/123", "the-boss")).toBe(false);
    expect(heldInLiveRoom("https://bossclinician.callsphere.site/community/the-lounge/live", "the-boss")).toBe(false);
  });
});

describe("session keys", () => {
  it("round-trips", () => {
    const at = new Date("2026-10-09T17:00:00.000Z");
    const key = sessionKey("community", 6, at);
    expect(key).toBe("c6@2026-10-09T17:00:00.000Z");
    expect(parseSessionKey(key)).toEqual({ source: "community", eventId: 6, startsAt: at });
    expect(parseSessionKey(sessionKey("event", 12, at))?.source).toBe("event");
  });

  it("refuses anything else", () => {
    expect(parseSessionKey("x6@2026")).toBeNull();
    expect(parseSessionKey("c6@not-a-date")).toBeNull();
  });
});

describe("manualSendKey", () => {
  it("collapses two presses on one day and lets a press tomorrow through", () => {
    const morning = new Date("2026-10-23T09:00:00Z");
    const evening = new Date("2026-10-23T20:00:00Z");
    const tomorrow = new Date("2026-10-24T09:00:00Z");
    expect(manualSendKey("lesson_reminder", "lesson:5", 40, morning)).toBe(
      manualSendKey("lesson_reminder", "lesson:5", 40, evening)
    );
    expect(manualSendKey("lesson_reminder", "lesson:5", 40, morning)).not.toBe(
      manualSendKey("lesson_reminder", "lesson:5", 40, tomorrow)
    );
  });

  it("keeps people, things and kinds apart", () => {
    const at = new Date("2026-10-23T09:00:00Z");
    expect(manualSendKey("lesson_reminder", "lesson:5", 40, at)).not.toBe(manualSendKey("lesson_reminder", "lesson:5", 41, at));
    expect(manualSendKey("lesson_reminder", "lesson:5", 40, at)).not.toBe(manualSendKey("lesson_reminder", "lesson:6", 40, at));
    expect(manualSendKey("replay", "c6@x", "A@B.com", at)).toBe(manualSendKey("replay", "c6@x", "a@b.com", at));
  });
});

describe("lessonLink", () => {
  it("builds the member player's address", () => {
    expect(lessonLink("https://site.test/", "the-course", "intro")).toBe("https://site.test/library/the-course/lessons/intro");
    expect(lessonLink("https://site.test", "", "intro")).toBe("https://site.test/library");
  });
});
