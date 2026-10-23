import { describe, expect, it } from "vitest";
import {
  AUTOMATION_SCOPE_FACT,
  MERGEABLE_FACTS,
  SWEPT_TRIGGERS,
  TRIGGER_DESCRIPTORS,
  TRIGGER_TYPES,
  describeTriggerConfigProblem,
  emailMergeValues,
  parseLessonNotWatchedConfig,
  parseLiveSessionConfig,
  sampleFactsFor,
  scopeAllows,
} from "./engineV2";

/**
 * Row 171: the three triggers the engagement sweep raises, and the two pieces
 * of engine behaviour they need — one automation per swept occurrence, and the
 * reminder's own links in the email.
 */

describe("the engagement triggers", () => {
  it("are triggers the builder can offer, narrowed by course or community", () => {
    for (const type of ["lesson_not_watched", "live_session_missed", "live_session_replay_ready"] as const) {
      expect(TRIGGER_TYPES).toContain(type);
      expect(SWEPT_TRIGGERS.has(type)).toBe(true);
      expect(TRIGGER_DESCRIPTORS.find((d) => d.type === type)).toBeTruthy();
    }
    expect(TRIGGER_DESCRIPTORS.find((d) => d.type === "lesson_not_watched")?.subjectSource).toBe("courses");
    expect(TRIGGER_DESCRIPTORS.find((d) => d.type === "live_session_missed")?.subjectSource).toBe("communities");
  });

  it("leaves every trigger somebody performs unswept", () => {
    expect(SWEPT_TRIGGERS.has("lesson_completed")).toBe(false);
    expect(SWEPT_TRIGGERS.has("event_attended")).toBe(false);
  });
});

describe("scopeAllows", () => {
  it("lets every automation run an ordinary occurrence", () => {
    expect(scopeAllows({}, 7)).toBe(true);
    expect(scopeAllows(undefined, 7)).toBe(true);
    expect(scopeAllows({ [AUTOMATION_SCOPE_FACT]: 0 }, 7)).toBe(true);
  });

  it("runs a swept occurrence for its own automation only", () => {
    // The 3-day reminder's occurrence must not run the 7-day automation.
    expect(scopeAllows({ [AUTOMATION_SCOPE_FACT]: 7 }, 7)).toBe(true);
    expect(scopeAllows({ [AUTOMATION_SCOPE_FACT]: 7 }, 8)).toBe(false);
    expect(scopeAllows({ [AUTOMATION_SCOPE_FACT]: "7" }, 7)).toBe(true);
  });
});

describe("emailMergeValues", () => {
  it("fills the reminder's links and keeps the three tokens every email had", () => {
    const values = emailMergeValues({
      name: "Jane Doe",
      email: "jane@example.com",
      facts: { lessonUrl: "https://site.test/library/x/lessons/y", lessonTitle: "Intro", watchedPercent: 40 },
    });
    expect(values.lessonUrl).toBe("https://site.test/library/x/lessons/y");
    expect(values.lessonTitle).toBe("Intro");
    expect(values.watchedPercent).toBe("40");
    expect(values.firstName).toBe("Jane");
    expect(values.name).toBe("Jane Doe");
    expect(values.email).toBe("jane@example.com");
  });

  it("never fills a fact outside the list, so older emails keep saying what they said", () => {
    const values = emailMergeValues({
      name: "",
      email: "a@b.test",
      facts: { source: "apply", answer: "secret", [AUTOMATION_SCOPE_FACT]: 3 },
    });
    expect(values.source).toBeUndefined();
    expect(values.answer).toBeUndefined();
    expect(values[AUTOMATION_SCOPE_FACT]).toBeUndefined();
    expect(values.firstName).toBe("there");
    expect(values.name).toBe("a@b.test");
  });

  it("does not let a fact replace the person's own name", () => {
    expect(MERGEABLE_FACTS as readonly string[]).not.toContain("firstName");
    expect(MERGEABLE_FACTS as readonly string[]).not.toContain("email");
  });
});

describe("trigger settings", () => {
  it("needs a course and a sane number of days before a lesson reminder can run", () => {
    expect(describeTriggerConfigProblem("lesson_not_watched", {})).toMatch(/no course/);
    expect(describeTriggerConfigProblem("lesson_not_watched", { courseId: null })).toMatch(/no course/);
    expect(describeTriggerConfigProblem("lesson_not_watched", { courseId: 5, days: 0 })).toMatch(/days/);
    expect(describeTriggerConfigProblem("lesson_not_watched", { courseId: 5, days: 400 })).toMatch(/days/);
    expect(describeTriggerConfigProblem("lesson_not_watched", { courseId: 5 })).toBeNull();
    expect(describeTriggerConfigProblem("lesson_not_watched", { courseId: 5, days: 7, lessonId: "" })).toBeNull();
  });

  it("asks nothing more of the live-session triggers or any other trigger", () => {
    expect(describeTriggerConfigProblem("live_session_missed", {})).toBeNull();
    expect(describeTriggerConfigProblem("live_session_replay_ready", { communityId: 2, audience: "members" })).toBeNull();
    expect(describeTriggerConfigProblem("form_submitted", {})).toBeNull();
  });

  it("fills in the defaults", () => {
    expect(parseLessonNotWatchedConfig({ courseId: "5" })).toEqual({
      courseId: 5,
      days: 3,
      basis: "release",
      watch: "not_completed",
    });
    expect(parseLessonNotWatchedConfig({})).toBeNull();
    expect(parseLiveSessionConfig({ communityId: "", eventId: null })).toEqual({ audience: "registered" });
    expect(parseLiveSessionConfig({ audience: "nonsense" })).toEqual({ audience: "registered" });
  });
});

describe("sampleFactsFor", () => {
  it("gives a practice run a link where the reminder's link goes", () => {
    expect(sampleFactsFor("lesson_not_watched").lessonUrl).toMatch(/^https?:\/\//);
    expect(sampleFactsFor("live_session_missed").replayUrl).toMatch(/^https?:\/\//);
    expect(sampleFactsFor("form_submitted")).toEqual({});
  });
});
