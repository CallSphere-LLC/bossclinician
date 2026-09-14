import { describe, it, expect } from "vitest";
import {
  BroadcastRefusal,
  EVENT_ANCHOR_LATE_GRACE_MINUTES,
  audiencePredicate,
  decideEventAnchor,
  variantFor,
} from "./broadcasts";

/**
 * Only the pure half is unit tested here. Resolving an audience and fanning a
 * send out are SQL and a queue, and are covered against a real database.
 */
describe("audiencePredicate", () => {
  it("answers with a predicate for every key the admin can choose", () => {
    for (const key of [
      "all_contacts",
      "all_subscribers",
      "all_members",
      "leads",
      "community",
      "customers",
    ]) {
      expect(audiencePredicate(key)).toBeTruthy();
    }
  });

  it("refuses an unknown key rather than falling back to everybody", () => {
    // The fallback this replaced was `all_subscribers`, so a campaign whose
    // audience column held a value nothing recognised — the state a segment
    // being deleted leaves behind — was sent to the entire list.
    expect(audiencePredicate("")).toBeNull();
    expect(audiencePredicate("segment")).toBeNull();
    expect(audiencePredicate("all_subscibers")).toBeNull();
  });

  it("does not answer with anything off Object's prototype", () => {
    // Otherwise `audience = "toString"` resolves to a function and is
    // interpolated straight into the WHERE clause.
    for (const key of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(audiencePredicate(key)).toBeNull();
    }
  });
});

describe("BroadcastRefusal", () => {
  it("is an Error the send route can tell apart from a fault", () => {
    // The route shows a refusal's own words to the person sending and hides
    // everything else behind "something went wrong on our end". That rests on
    // `instanceof`, so a refactor back to a plain Error would quietly start
    // printing raw Postgres messages at the owner again.
    const refusal = new BroadcastRefusal("Add a subject line before sending");
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal).toBeInstanceOf(BroadcastRefusal);
    expect(new Error("duplicate key value")).not.toBeInstanceOf(BroadcastRefusal);
    expect(refusal.message).toBe("Add a subject line before sending");
  });
});

describe("variantFor", () => {
  it("is stable for the same address, so a retry does not move the arm", () => {
    const first = variantFor("success+reader@simulator.amazonses.com", 50);
    for (let i = 0; i < 5; i += 1) {
      expect(variantFor("success+reader@simulator.amazonses.com", 50)).toBe(first);
    }
  });

  it("puts everybody in A when there is no split", () => {
    expect(variantFor("success+reader@simulator.amazonses.com", 0)).toBe("a");
  });
});

describe("decideEventAnchor", () => {
  const EVENT = new Date("2026-09-15T18:00:00.000Z");
  /** "24 hours before the event." */
  const DAY_BEFORE = -24 * 60;

  it("waits while the send moment is still ahead", () => {
    expect(
      decideEventAnchor({
        eventStartsAt: EVENT,
        published: true,
        offsetMinutes: DAY_BEFORE,
        armedAt: new Date("2026-09-04T12:00:00.000Z"),
        now: new Date("2026-09-10T12:00:00.000Z"),
      }),
    ).toEqual({ action: "wait" });
  });

  it("sends when the moment arrives", () => {
    expect(
      decideEventAnchor({
        eventStartsAt: EVENT,
        published: true,
        offsetMinutes: DAY_BEFORE,
        armedAt: new Date("2026-09-04T12:00:00.000Z"),
        // 24 hours before 18:00 on the 15th is 18:00 on the 14th.
        now: new Date("2026-09-14T18:00:30.000Z"),
      }),
    ).toEqual({ action: "send" });
  });

  it("follows the event when the event is moved", () => {
    // The point of resolving at send time rather than at save time. The
    // campaign was armed against an event on the 15th; the event moved to the
    // 22nd, so the send moment moved with it and nothing goes out on the 14th.
    const moved = new Date("2026-09-22T18:00:00.000Z");
    expect(
      decideEventAnchor({
        eventStartsAt: moved,
        published: true,
        offsetMinutes: DAY_BEFORE,
        armedAt: new Date("2026-09-04T12:00:00.000Z"),
        now: new Date("2026-09-14T18:00:30.000Z"),
      }),
    ).toEqual({ action: "wait" });
  });

  /* ------------------------------------------------------- the backlog guard */

  it("never sends a window that had already closed when it was armed", () => {
    /*
     * THE case this guard exists for. "24 hours before" is switched on twelve
     * hours before the event: the send moment was twelve hours ago. A sweeper
     * that only asks "is the moment past?" mails the entire list on its next
     * tick, under the owner's name, unrecallably.
     */
    const decision = decideEventAnchor({
      eventStartsAt: EVENT,
      published: true,
      offsetMinutes: DAY_BEFORE,
      armedAt: new Date("2026-09-15T06:00:00.000Z"),
      now: new Date("2026-09-15T06:00:05.000Z"),
    });
    expect(decision.action).toBe("skip");
    expect(decision).toMatchObject({
      reason: expect.stringContaining("had already passed when this was scheduled"),
    });
  });

  it("never sends when the event itself is already in the past", () => {
    const decision = decideEventAnchor({
      eventStartsAt: new Date("2026-08-01T18:00:00.000Z"),
      published: true,
      offsetMinutes: DAY_BEFORE,
      armedAt: new Date("2026-09-04T12:00:00.000Z"),
      now: new Date("2026-09-04T12:00:05.000Z"),
    });
    expect(decision.action).toBe("skip");
  });

  it("still skips a long-past window when nothing recorded the arming moment", () => {
    // Rows written before `anchor_armed_at` existed. The late-grace rule is the
    // only floor available, so it has to hold on its own.
    const decision = decideEventAnchor({
      eventStartsAt: EVENT,
      published: true,
      offsetMinutes: DAY_BEFORE,
      armedAt: null,
      now: new Date("2026-09-15T06:00:00.000Z"),
    });
    expect(decision.action).toBe("skip");
  });

  it("absorbs a short outage rather than dropping the send", () => {
    // Armed a week out, the moment was reached, and the scheduler was down for
    // half an hour. That mail is still worth sending.
    expect(
      decideEventAnchor({
        eventStartsAt: EVENT,
        published: true,
        offsetMinutes: DAY_BEFORE,
        armedAt: new Date("2026-09-04T12:00:00.000Z"),
        now: new Date("2026-09-14T18:30:00.000Z"),
      }),
    ).toEqual({ action: "send" });
  });

  it("gives up once the send is more than the grace window late", () => {
    const decision = decideEventAnchor({
      eventStartsAt: EVENT,
      published: true,
      offsetMinutes: DAY_BEFORE,
      armedAt: new Date("2026-09-04T12:00:00.000Z"),
      now: new Date("2026-09-14T21:00:00.000Z"),
    });
    expect(decision.action).toBe("skip");
    expect(decision).toMatchObject({
      reason: expect.stringContaining("more than an hour ago"),
    });
  });

  it("uses the grace window the constant names", () => {
    const base = {
      eventStartsAt: EVENT,
      published: true,
      offsetMinutes: DAY_BEFORE,
      armedAt: new Date("2026-09-04T12:00:00.000Z"),
    };
    const sendAt = EVENT.getTime() + DAY_BEFORE * 60_000;
    const grace = EVENT_ANCHOR_LATE_GRACE_MINUTES * 60_000;
    expect(decideEventAnchor({ ...base, now: new Date(sendAt + grace) }).action).toBe("send");
    expect(decideEventAnchor({ ...base, now: new Date(sendAt + grace + 1000) }).action).toBe("skip");
  });

  /* ------------------------------------------------------- the other refusals */

  it("waits on an unpublished event instead of giving up on it", () => {
    // Publishing an event a few days before it runs is normal, and the campaign
    // written alongside it should still be waiting when that happens.
    expect(
      decideEventAnchor({
        eventStartsAt: EVENT,
        published: false,
        offsetMinutes: DAY_BEFORE,
        armedAt: new Date("2026-09-04T12:00:00.000Z"),
        now: new Date("2026-09-14T18:00:30.000Z"),
      }),
    ).toEqual({ action: "wait" });
  });

  it("skips, with words, when the event has been deleted", () => {
    // `anchor_event_id` is ON DELETE SET NULL, so this is the row a deleted
    // event leaves behind. Retrying it forever is the alternative.
    const decision = decideEventAnchor({
      eventStartsAt: null,
      published: false,
      offsetMinutes: DAY_BEFORE,
      armedAt: new Date("2026-09-04T12:00:00.000Z"),
      now: new Date("2026-09-14T18:00:30.000Z"),
    });
    expect(decision.action).toBe("skip");
    expect(decision).toMatchObject({
      reason: expect.stringContaining("no longer has a start time"),
    });
  });

  it("handles an offset after the event as well as before it", () => {
    // "One hour after it ends" — a replay link, a follow-up, a survey.
    const base = {
      eventStartsAt: EVENT,
      published: true,
      offsetMinutes: 120,
      armedAt: new Date("2026-09-04T12:00:00.000Z"),
    };
    expect(decideEventAnchor({ ...base, now: new Date("2026-09-15T19:00:00.000Z") })).toEqual({
      action: "wait",
    });
    expect(decideEventAnchor({ ...base, now: new Date("2026-09-15T20:00:30.000Z") })).toEqual({
      action: "send",
    });
  });

  it("treats 'upon registration' style zero offsets as an immediate moment", () => {
    const base = {
      eventStartsAt: EVENT,
      published: true,
      offsetMinutes: 0,
      armedAt: new Date("2026-09-04T12:00:00.000Z"),
    };
    expect(decideEventAnchor({ ...base, now: new Date("2026-09-15T17:59:00.000Z") })).toEqual({
      action: "wait",
    });
    expect(decideEventAnchor({ ...base, now: new Date("2026-09-15T18:00:00.000Z") })).toEqual({
      action: "send",
    });
  });
});
