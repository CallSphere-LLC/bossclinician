import { describe, expect, it } from "vitest";
import { AUTO_COMPLETE_PERCENT, creditWatchedPercent, type StoredWatch } from "./curriculum";

/**
 * What a progress ping is allowed to earn.
 *
 * The stored figure completes lessons, fills the rollup and is what a CEU
 * certificate is issued against, so these cases are the difference between a
 * document a licensing board can rely on and one anybody can mint with curl.
 */

const FORTY_MINUTES = { videoDurationSeconds: 2400, durationMinutes: 40 };
const NOW = new Date("2026-03-03T12:00:00Z");

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

const untouched: StoredWatch = { watchedPercent: 0, watchedSeconds: 0, lastViewedAt: null };

function credit(input: {
  positionSeconds: number;
  claimedPercent: number;
  lesson?: { videoDurationSeconds: number; durationMinutes: number };
  stored?: StoredWatch;
}) {
  return creditWatchedPercent({
    positionSeconds: input.positionSeconds,
    claimedPercent: input.claimedPercent,
    lesson: input.lesson ?? FORTY_MINUTES,
    stored: input.stored ?? untouched,
    now: NOW,
  });
}

/**
 * A player pinging every `every` seconds for `minutes` of wall clock, reporting
 * the whole lesson watched each time — the shape of both an honest viewer near
 * the end and a script pretending to be one.
 */
function pingFor(input: {
  minutes: number;
  every: number;
  lesson?: { videoDurationSeconds: number; durationMinutes: number };
}): StoredWatch {
  let stored: StoredWatch = { ...untouched };
  const pings = Math.floor((input.minutes * 60) / input.every);

  for (let i = 0; i < pings; i += 1) {
    const verdict = creditWatchedPercent({
      positionSeconds: 1_000_000,
      claimedPercent: 100,
      lesson: input.lesson ?? FORTY_MINUTES,
      stored: { ...stored, lastViewedAt: secondsAgo(input.every) },
      now: NOW,
    });
    if (!verdict.ok) throw new Error("a plausible ping was refused");
    stored = {
      watchedPercent: Math.max(stored.watchedPercent, verdict.percent),
      watchedSeconds: Math.max(stored.watchedSeconds, verdict.watchedSeconds),
      lastViewedAt: NOW,
    };
  }

  return stored;
}

describe("creditWatchedPercent", () => {
  it("refuses a full course in one request", () => {
    // The exploit this exists for: position 0 and 100% in the same body.
    expect(credit({ positionSeconds: 0, claimedPercent: 100 }).ok).toBe(false);
  });

  it("refuses a claim of having finished a lesson barely started", () => {
    // No media length recorded, so only the author's estimate is available —
    // second three and "watched it all" still cannot both be true.
    expect(
      credit({
        positionSeconds: 3,
        claimedPercent: 100,
        lesson: { videoDurationSeconds: 0, durationMinutes: 40 },
      }).ok
    ).toBe(false);
  });

  it("ignores a percentage the position does not support", () => {
    // Ten minutes into a forty-minute lesson is 25%, whatever the body claims.
    expect(
      credit({
        positionSeconds: 600,
        claimedPercent: 100,
        stored: { watchedPercent: 20, watchedSeconds: 600, lastViewedAt: secondsAgo(120) },
      })
    ).toMatchObject({ ok: true, percent: 25 });
  });

  it("takes the percentage from the position rather than the body", () => {
    const verdict = credit({
      positionSeconds: 1200,
      claimedPercent: 3,
      stored: { watchedPercent: 40, watchedSeconds: 1300, lastViewedAt: secondsAgo(60) },
    });
    // Half of a forty-minute lesson, though the body said three percent.
    expect(verdict).toMatchObject({ ok: true, percent: 50 });
  });

  it("lets no ping earn more than the time since the last one", () => {
    // Ten seconds of real time buys twenty-five seconds of lesson, and no more.
    const verdict = credit({
      positionSeconds: 2400,
      claimedPercent: 100,
      stored: { watchedPercent: 20, watchedSeconds: 480, lastViewedAt: secondsAgo(10) },
    });
    expect(verdict).toEqual({ ok: true, percent: 21, watchedSeconds: 505 });
  });

  it("does not let a long silence bank credit", () => {
    // An hour between pings is not an hour of watching. The gap is capped, so
    // the ping earns two minutes' worth at double speed and nothing more.
    const verdict = credit({
      positionSeconds: 2400,
      claimedPercent: 100,
      stored: { watchedPercent: 0, watchedSeconds: 0, lastViewedAt: secondsAgo(3600) },
    });
    expect(verdict).toEqual({ ok: true, percent: 12, watchedSeconds: 300 });
  });

  it("cannot be hurried by firing the same ping repeatedly", () => {
    // Concurrent pings all read the same stored row, so they compute the same
    // total and the greatest of them is what one of them would have earned.
    const stored: StoredWatch = {
      watchedPercent: 30,
      watchedSeconds: 720,
      lastViewedAt: secondsAgo(10),
    };
    for (let i = 0; i < 50; i += 1) {
      expect(credit({ positionSeconds: 2400, claimedPercent: 100, stored })).toEqual({
        ok: true,
        percent: 31,
        watchedSeconds: 745,
      });
    }
  });

  it("keeps a forty-minute lesson from completing in four minutes", () => {
    expect(pingFor({ minutes: 4, every: 4 }).watchedPercent).toBeLessThan(AUTO_COMPLETE_PERCENT);
  });

  it("lets somebody who sat through the lesson finish it", () => {
    // Sixteen minutes is the floor for forty minutes of lesson at the 2x the
    // player offers plus the margin; twenty minutes of pings clears it.
    expect(pingFor({ minutes: 20, every: 10 }).watchedPercent).toBe(100);
  });

  it("accrues on a lecture far longer than the gap between pings", () => {
    // Two hours of lesson at a ten-second cadence: a total kept in percent would
    // round every ping to nothing and never move off zero.
    const twoHours = { videoDurationSeconds: 7200, durationMinutes: 120 };
    expect(pingFor({ minutes: 10, every: 10, lesson: twoHours }).watchedPercent).toBe(20);
    expect(pingFor({ minutes: 50, every: 10, lesson: twoHours }).watchedPercent).toBe(100);
  });

  it("does not un-earn what scrubbing backwards passed over", () => {
    // Back to the start of a lesson already watched: the position supports 0, and
    // the caller's GREATEST keeps the 95 that is on record.
    const verdict = credit({
      positionSeconds: 4,
      claimedPercent: 95,
      stored: { watchedPercent: 95, watchedSeconds: 2300, lastViewedAt: secondsAgo(10) },
    });
    expect(verdict).toMatchObject({ ok: true, percent: 0 });
  });

  it("credits a lesson short enough to finish between two pings", () => {
    expect(
      credit({
        positionSeconds: 20,
        claimedPercent: 100,
        lesson: { videoDurationSeconds: 20, durationMinutes: 0 },
      })
    ).toMatchObject({ ok: true, percent: 100 });
  });

  it("still paces a lesson nobody recorded a length for", () => {
    const unmeasured = { videoDurationSeconds: 0, durationMinutes: 0 };

    // Nothing to check the claim against but the clock, and the clock is enough
    // to stop 0 to 100 arriving in one request.
    expect(
      credit({ positionSeconds: 300, claimedPercent: 100, lesson: unmeasured })
    ).toMatchObject({ ok: true, percent: 6 });

    // Second nought and "watched it all" stay contradictory even here.
    expect(credit({ positionSeconds: 0, claimedPercent: 100, lesson: unmeasured }).ok).toBe(false);
  });
});
