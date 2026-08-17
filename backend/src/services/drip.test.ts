import { describe, it, expect } from "vitest";
import {
  DEFAULT_DRIP_SETTINGS,
  describeUnlock,
  parseReleaseTime,
  resolveDripState,
  unlockAt,
  zonedWallClockToUtc,
  type DripSettings,
} from "./drip";

const NY: DripSettings = { releaseMinute: 6 * 60, timezone: "America/New_York" };
const HONOLULU: DripSettings = { releaseMinute: 6 * 60, timezone: "Pacific/Honolulu" };

describe("zonedWallClockToUtc", () => {
  it("converts a winter (EST, UTC-5) wall clock", () => {
    // 6am on 15 January in New York is 11:00 UTC.
    expect(zonedWallClockToUtc(2026, 1, 15, 6 * 60, "America/New_York").toISOString()).toBe(
      "2026-01-15T11:00:00.000Z",
    );
  });

  it("converts a summer (EDT, UTC-4) wall clock", () => {
    // The same 6am in July is 10:00 UTC. Getting this wrong by an hour is the
    // classic drip bug: half the year the lesson opens at 5am or 7am.
    expect(zonedWallClockToUtc(2026, 7, 15, 6 * 60, "America/New_York").toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
  });

  it("handles a zone with no DST", () => {
    expect(zonedWallClockToUtc(2026, 1, 15, 6 * 60, "Pacific/Honolulu").toISOString()).toBe(
      "2026-01-15T16:00:00.000Z",
    );
    expect(zonedWallClockToUtc(2026, 7, 15, 6 * 60, "Pacific/Honolulu").toISOString()).toBe(
      "2026-07-15T16:00:00.000Z",
    );
  });

  it("handles a positive-offset zone", () => {
    expect(zonedWallClockToUtc(2026, 1, 15, 9 * 60, "Europe/London").toISOString()).toBe(
      "2026-01-15T09:00:00.000Z",
    );
    expect(zonedWallClockToUtc(2026, 7, 15, 9 * 60, "Europe/London").toISOString()).toBe(
      "2026-07-15T08:00:00.000Z",
    );
  });

  it("resolves the day DST springs forward", () => {
    // 8 March 2026, US spring-forward. 6am EST does not skip; it is 11:00 UTC
    // before the change and 10:00 UTC after.
    expect(zonedWallClockToUtc(2026, 3, 7, 6 * 60, "America/New_York").toISOString()).toBe(
      "2026-03-07T11:00:00.000Z",
    );
    expect(zonedWallClockToUtc(2026, 3, 9, 6 * 60, "America/New_York").toISOString()).toBe(
      "2026-03-09T10:00:00.000Z",
    );
  });
});

describe("unlockAt", () => {
  const granted = new Date("2026-01-15T18:30:00Z"); // 1:30pm New York

  it("returns null when there is no drip configured", () => {
    expect(unlockAt({ dripDays: null, dripDate: null }, granted, NY)).toBeNull();
  });

  it("returns null for a zero-day drip — day zero means available now", () => {
    expect(unlockAt({ dripDays: 0, dripDate: null }, granted, NY)).toBeNull();
  });

  it("unlocks N days later at the site release time, not at the enrollment time", () => {
    // Granted at 1:30pm on the 15th; a 7-day drip opens at 6am on the 22nd,
    // NOT at 1:30pm. The release hour is the whole point of the setting.
    const at = unlockAt({ dripDays: 7, dripDate: null }, granted, NY);
    expect(at?.toISOString()).toBe("2026-01-22T11:00:00.000Z");
  });

  it("crosses a DST boundary on the calendar, not on milliseconds", () => {
    // Granted 1 March, +14 days = 15 March, which is after the 8 March change.
    // Naive millisecond arithmetic would land at 10:00 UTC on the 15th only by
    // accident; the calendar walk gets there for the right reason.
    const springGrant = new Date("2026-03-01T18:00:00Z");
    const at = unlockAt({ dripDays: 14, dripDate: null }, springGrant, NY);
    expect(at?.toISOString()).toBe("2026-03-15T10:00:00.000Z");
  });

  it("respects the member-agnostic site timezone", () => {
    const at = unlockAt({ dripDays: 7, dripDate: null }, granted, HONOLULU);
    // Granted 18:30Z on the 15th is 08:30 on the 15th in Honolulu, so +7 days
    // is the 22nd at 6am local = 16:00Z.
    expect(at?.toISOString()).toBe("2026-01-22T16:00:00.000Z");
  });

  it("honours a custom release hour", () => {
    const at = unlockAt({ dripDays: 1, dripDate: null }, granted, {
      releaseMinute: 9 * 60 + 30,
      timezone: "America/New_York",
    });
    expect(at?.toISOString()).toBe("2026-01-16T14:30:00.000Z");
  });

  it("uses a fixed date at the release hour", () => {
    const at = unlockAt(
      { dripDays: null, dripDate: new Date("2026-06-01T00:00:00Z") },
      granted,
      NY,
    );
    // The date is read in the site zone. Midnight UTC on 1 June is 8pm on
    // 31 May in New York, so the release lands on 31 May at 6am local.
    expect(at?.toISOString()).toBe("2026-05-31T10:00:00.000Z");
  });

  it("prefers a fixed date over a day count when both are set", () => {
    const at = unlockAt(
      { dripDays: 90, dripDate: new Date("2026-02-01T15:00:00Z") },
      granted,
      NY,
    );
    expect(at?.toISOString()).toBe("2026-02-01T11:00:00.000Z");
  });

  it("anchors to the grant date, so a late enrollee drips from their own start", () => {
    const early = unlockAt({ dripDays: 7, dripDate: null }, new Date("2026-01-01T12:00:00Z"), NY);
    const late = unlockAt({ dripDays: 7, dripDate: null }, new Date("2026-06-01T12:00:00Z"), NY);
    expect(early?.toISOString()).toBe("2026-01-08T11:00:00.000Z");
    expect(late?.toISOString()).toBe("2026-06-08T10:00:00.000Z");
  });
});

describe("resolveDripState", () => {
  const granted = new Date("2026-01-15T18:30:00Z");

  it("is unlocked when nothing is scheduled", () => {
    const state = resolveDripState({
      lesson: { dripDays: null, dripDate: null },
      grantedAt: granted,
      now: granted,
      settings: NY,
    });
    expect(state).toEqual({ unlocked: true, unlocksAt: null });
  });

  it("is locked before the release instant and unlocked at it", () => {
    const base = {
      lesson: { dripDays: 7, dripDate: null },
      grantedAt: granted,
      settings: NY,
    };

    const justBefore = resolveDripState({ ...base, now: new Date("2026-01-22T10:59:59Z") });
    expect(justBefore.unlocked).toBe(false);
    expect(justBefore.unlocksAt?.toISOString()).toBe("2026-01-22T11:00:00.000Z");

    const exactly = resolveDripState({ ...base, now: new Date("2026-01-22T11:00:00Z") });
    expect(exactly).toEqual({ unlocked: true, unlocksAt: null });
  });

  it("keeps a lesson locked while its module is still locked", () => {
    // The lesson has no delay of its own, but lives in a module that opens on
    // day 14. Without the module gate this lesson would leak on day 1.
    const state = resolveDripState({
      lesson: { dripDays: null, dripDate: null },
      module: { dripDays: 14, dripDate: null },
      grantedAt: granted,
      now: new Date("2026-01-16T12:00:00Z"),
      settings: NY,
    });
    expect(state.unlocked).toBe(false);
    expect(state.unlocksAt?.toISOString()).toBe("2026-01-29T11:00:00.000Z");
  });

  it("applies the LATER of the lesson and module gates", () => {
    const state = resolveDripState({
      lesson: { dripDays: 3, dripDate: null },
      module: { dripDays: 21, dripDate: null },
      grantedAt: granted,
      now: new Date("2026-01-20T12:00:00Z"),
      settings: NY,
    });
    expect(state.unlocked).toBe(false);
    expect(state.unlocksAt?.toISOString()).toBe("2026-02-05T11:00:00.000Z");
  });

  it("unlocks once both gates have passed", () => {
    const state = resolveDripState({
      lesson: { dripDays: 3, dripDate: null },
      module: { dripDays: 21, dripDate: null },
      grantedAt: granted,
      now: new Date("2026-03-01T12:00:00Z"),
      settings: NY,
    });
    expect(state).toEqual({ unlocked: true, unlocksAt: null });
  });

  it("ignores a null module", () => {
    const state = resolveDripState({
      lesson: { dripDays: null, dripDate: null },
      module: null,
      grantedAt: granted,
      now: granted,
      settings: NY,
    });
    expect(state.unlocked).toBe(true);
  });
});

describe("parseReleaseTime", () => {
  it("parses valid times", () => {
    expect(parseReleaseTime("06:00")).toBe(360);
    expect(parseReleaseTime("9:30")).toBe(570);
    expect(parseReleaseTime("00:00")).toBe(0);
    expect(parseReleaseTime("23:59")).toBe(1439);
    expect(parseReleaseTime("  08:15  ")).toBe(495);
  });

  it("falls back to the default rather than throwing on nonsense", () => {
    // A bad value in a settings blob must not take the course player down.
    for (const bad of ["", "nope", "25:00", "10:75", "6", "6:5", "--"]) {
      expect(parseReleaseTime(bad)).toBe(DEFAULT_DRIP_SETTINGS.releaseMinute);
    }
  });
});

describe("describeUnlock", () => {
  it("reads as a date a person would say out loud", () => {
    expect(describeUnlock(new Date("2026-01-22T11:00:00Z"), "America/New_York")).toBe(
      "Thursday, January 22",
    );
  });

  it("describes the date in the viewer's zone, not UTC", () => {
    // 01:00 UTC on the 23rd is still the 22nd in New York.
    expect(describeUnlock(new Date("2026-01-23T01:00:00Z"), "America/New_York")).toBe(
      "Thursday, January 22",
    );
  });
});
