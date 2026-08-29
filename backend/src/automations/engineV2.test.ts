import { describe, it, expect } from "vitest";
import { ACTION_TYPES, TRIGGER_DESCRIPTORS, resumeDedupeKey } from "./engineV2";

/**
 * The engine itself is a database and a queue and is exercised against both.
 * What is worth pinning here is the one pure decision inside it that, when it
 * was wrong, stopped whole automations silently: the key a resumption is queued
 * under.
 */
describe("resumeDedupeKey", () => {
  it("separates arriving at a step from that step's own delay being served", () => {
    // The sequence that used to hang: a `wait` step queues "resume at step 4",
    // and the job that runs step 4 finds a delay on it and has to queue "step
    // 4's delay is now served". Both are about index 4 of the same run. Under
    // one key the second enqueue collided with the key the first job was still
    // holding, `enqueue` answered "already going to happen", and the run parked
    // on `waiting` for good with the email never sent.
    expect(resumeDedupeKey(7, 4, false)).not.toBe(resumeDedupeKey(7, 4, true));
  });

  it("is stable, so a genuine duplicate of either still collapses", () => {
    expect(resumeDedupeKey(7, 4, true)).toBe(resumeDedupeKey(7, 4, true));
    expect(resumeDedupeKey(7, 4, false)).toBe(resumeDedupeKey(7, 4, false));
  });

  it("keeps runs and positions apart", () => {
    expect(resumeDedupeKey(7, 4, true)).not.toBe(resumeDedupeKey(8, 4, true));
    expect(resumeDedupeKey(7, 4, true)).not.toBe(resumeDedupeKey(7, 5, true));
  });

  it("names the run, so nothing else in the queue can collide with it", () => {
    expect(resumeDedupeKey(7, 4, true).startsWith("automation-resume:7:4")).toBe(true);
  });
});

describe("the builder's vocabulary", () => {
  it("offers a subject list for every trigger that can be narrowed", () => {
    for (const descriptor of TRIGGER_DESCRIPTORS) {
      // A trigger with a subject key and no source is one the builder cannot
      // offer a choice for, which leaves it firing for everybody.
      expect(descriptor.subjectKey === "").toBe(descriptor.subjectSource === "");
    }
  });

  it("has a wait and a branch, which the runner handles rather than performs", () => {
    expect(ACTION_TYPES).toContain("wait");
    expect(ACTION_TYPES).toContain("branch");
  });
});
