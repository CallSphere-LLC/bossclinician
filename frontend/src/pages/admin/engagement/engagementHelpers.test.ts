import { describe, expect, it } from "vitest";
import type { ProgressRow, SessionPerson } from "@/lib/engagementApi";
import {
  defaultReminderSelection,
  defaultReplaySelection,
  describeMinutes,
  describeSendResult,
  progressRowKey,
  reminderTarget,
} from "@/pages/admin/engagement/engagementHelpers";

function row(overrides: Partial<ProgressRow>): ProgressRow {
  return {
    memberId: 1,
    name: "Jane",
    email: "jane@example.com",
    courseId: 9,
    courseTitle: "Course",
    lessonId: 100,
    lessonTitle: "Intro",
    moduleTitle: "Start",
    status: "not_started",
    watchedPercent: 0,
    completedAt: null,
    firstViewedAt: null,
    lastViewedAt: null,
    grantedAt: "2026-10-01T00:00:00.000Z",
    lastRemindedAt: null,
    lessonUrl: "https://site.test/library/c/lessons/intro",
    ...overrides,
  };
}

function person(overrides: Partial<SessionPerson>): SessionPerson {
  return {
    memberId: 1,
    contactId: 1,
    email: "jane@example.com",
    name: "Jane",
    invitedAs: "going",
    invited: true,
    attended: false,
    minutesAttended: 0,
    replaySentAt: null,
    ...overrides,
  };
}

describe("defaultReminderSelection (row 171)", () => {
  it("ticks whoever has not finished, and nobody reminded today", () => {
    const now = new Date("2026-10-23T15:00:00Z");
    const rows = [
      row({ memberId: 1, status: "not_started" }),
      row({ memberId: 2, status: "partial" }),
      row({ memberId: 3, status: "completed" }),
      row({ memberId: 4, status: "partial", lastRemindedAt: "2026-10-23T09:00:00.000Z" }),
      row({ memberId: 5, status: "partial", lastRemindedAt: "2026-10-20T09:00:00.000Z" }),
    ];
    const ticked = defaultReminderSelection(rows, now);
    expect([...ticked].sort()).toEqual(["1:100", "2:100", "5:100"]);
  });
});

describe("reminderTarget", () => {
  it("is one lesson and the people ticked for it", () => {
    const rows = [row({ memberId: 1 }), row({ memberId: 2 }), row({ memberId: 3 })];
    const target = reminderTarget(rows, new Set(["1:100", "3:100"]));
    expect(target).toEqual({ lessonId: 100, lessonTitle: "Intro", memberIds: [1, 3] });
  });

  it("asks her to narrow to one lesson rather than send about several", () => {
    const rows = [row({ memberId: 1, lessonId: 100 }), row({ memberId: 1, lessonId: 101 })];
    const target = reminderTarget(rows, new Set(rows.map(progressRowKey)));
    expect("problem" in target && target.problem).toMatch(/one lesson/);
  });

  it("needs somebody ticked", () => {
    expect("problem" in reminderTarget([row({})], new Set())).toBe(true);
  });
});

describe("defaultReplaySelection", () => {
  const people = [
    person({ memberId: 1, attended: false }),
    person({ memberId: 2, attended: true }),
    person({ memberId: 3, attended: false, replaySentAt: "2026-10-22T00:00:00.000Z" }),
    person({ memberId: 4, invited: false, invitedAs: "walk_in", attended: true }),
    person({ memberId: 5, attended: null }),
  ];

  it("ticks the invited who did not come (or may not have) and have not had it yet", () => {
    expect([...defaultReplaySelection(people)].sort()).toEqual(["m1", "m5"]);
  });

  it("adds whoever came when asked to", () => {
    expect([...defaultReplaySelection(people, true)].sort()).toEqual(["m1", "m2", "m4", "m5"]);
  });
});

describe("wording", () => {
  it("says what a press did", () => {
    expect(describeSendResult({ queued: 1, alreadySent: 0, noContact: 0, notEligible: 0 }, "reminder")).toBe(
      "1 reminder is on its way."
    );
    expect(describeSendResult({ queued: 3, alreadySent: 2, noContact: 0, notEligible: 0 })).toBe(
      "3 emails are on their way. 2 already had one today, so were skipped."
    );
  });

  it("reads minutes in the room", () => {
    expect(describeMinutes(0)).toBe("");
    expect(describeMinutes(42)).toBe("42 min");
    expect(describeMinutes(65)).toBe("1 h 5 min");
    expect(describeMinutes(120)).toBe("2 h");
  });
});
