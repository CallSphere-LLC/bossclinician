import { describe, it, expect } from "vitest";
import {
  ACTION_CONFIG_SCHEMAS,
  ACTION_TYPES,
  TRIGGER_DESCRIPTORS,
  describeActionProblem,
  describeConditionProblem,
  resumeDedupeKey,
} from "./engineV2";

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

/**
 * P0-6 regression: a step nobody finished must not report itself as done.
 *
 * The bug was not that a half-built step failed — it was that it succeeded. An
 * "add a tag" with no tag chosen saved, went active, and every run of it wrote
 * RAN FINE into the history, so the one screen that could have told her the
 * automation did nothing told her it had worked.
 *
 * These are the pure half of the fix: what "finished" means. Every gate — the
 * save endpoint, the turn-it-on check, the dry run and the runner — asks these
 * two functions, so pinning them here pins all four.
 */
describe("what counts as a finished step", () => {
  it("refuses an empty config for every kind of step", () => {
    // The exact repro, generalised: nothing chosen is never a runnable step.
    for (const actionType of ACTION_TYPES) {
      expect(describeActionProblem(actionType, {})).not.toBeNull();
    }
  });

  it("has a rule for every kind of step the builder offers", () => {
    // A type missing from the map would be waved through by all four gates.
    for (const actionType of ACTION_TYPES) {
      expect(ACTION_CONFIG_SCHEMAS[actionType]).toBeDefined();
    }
  });

  it("says what is missing in words she can act on", () => {
    expect(describeActionProblem("add_tag", {})).toBe("has no tag chosen");
    // These lines are shown on the builder and written into the run log.
    // "Required at config.tagId" is the parser talking, not the product.
    for (const actionType of ACTION_TYPES) {
      expect(describeActionProblem(actionType, {})).not.toMatch(/required|invalid|config\./i);
    }
  });

  it("accepts a step once the thing it acts on is chosen", () => {
    expect(describeActionProblem("add_tag", { tagId: 4 })).toBeNull();
    // A <select> posts its value as a string; the builder must not be the only
    // caller whose perfectly good step is called unfinished.
    expect(describeActionProblem("add_tag", { tagId: "4" })).toBeNull();
    expect(describeActionProblem("subscribe_sequence", { sequenceId: 2 })).toBeNull();
    expect(describeActionProblem("fire_webhook", { url: "https://example.com/hook" })).toBeNull();
    expect(describeActionProblem("send_email", { subject: "Hello", bodyMd: "Hi there" })).toBeNull();
    expect(describeActionProblem("create_task", { title: "Call them" })).toBeNull();
    expect(describeActionProblem("wait", { days: 3 })).toBeNull();
  });

  it("treats an emptied choice the same as an unmade one", () => {
    // What the builder actually stores when she opens a picker and closes it.
    expect(describeActionProblem("add_tag", { tagId: null })).not.toBeNull();
    expect(describeActionProblem("add_tag", { tagId: "" })).not.toBeNull();
    expect(describeActionProblem("add_tag", { tagId: 0 })).not.toBeNull();
    expect(describeActionProblem("send_email", { subject: "   ", bodyMd: "   " })).not.toBeNull();
    expect(describeActionProblem("create_task", { title: "" })).not.toBeNull();
  });

  it("refuses a wait that waits no time at all", () => {
    // It reads as "wait a while" in the sentence and carries straight on when
    // it runs, which is the one difference she cannot see on the screen.
    expect(describeActionProblem("wait", { days: 0, minutes: 0 })).not.toBeNull();
    expect(describeActionProblem("wait", { minutes: 30 })).toBeNull();
  });

  it("refuses a branch with nothing to check", () => {
    // An empty gate held nothing back and logged "Condition held — carrying
    // on", so a step added to stop the run let everybody through.
    expect(describeActionProblem("branch", { conditions: { match: "all", rules: [] } })).not.toBeNull();
    expect(
      describeActionProblem("branch", {
        conditions: { match: "all", rules: [{ field: "tag", op: "has", value: null }] },
      })
    ).not.toBeNull();
    expect(
      describeActionProblem("branch", {
        conditions: { match: "all", rules: [{ field: "tag", op: "has", value: 3 }] },
      })
    ).toBeNull();
  });

  it("refuses a step type this engine no longer knows", () => {
    // Rows left behind by the first engine. Nothing to run, and nothing about
    // it is a success.
    expect(describeActionProblem("send_sms", { tagId: 1 })).not.toBeNull();
  });
});

describe("what counts as a finished condition", () => {
  it("refuses a rule with nothing chosen to check against", () => {
    // Exactly what "Add a condition" used to save, and what the live
    // automation still holds: a tag rule about no tag.
    expect(
      describeConditionProblem({ match: "all", rules: [{ field: "tag", op: "has", value: null }] })
    ).not.toBeNull();
  });

  it("refuses it whichever way round the operator reads", () => {
    // `has` against nothing is always false and the automation fires for
    // nobody; `not_has` against nothing is always true and it fires for
    // everybody. The second is the one that mails the wrong people.
    for (const op of ["has", "not_has"]) {
      expect(
        describeConditionProblem({ match: "all", rules: [{ field: "tag", op, value: null }] })
      ).not.toBeNull();
    }
  });

  it("counts them, so she is told how many there are to fix", () => {
    const problem = describeConditionProblem({
      match: "all",
      rules: [
        { field: "tag", op: "has", value: null },
        { field: "in_sequence", op: "not_has", value: null },
      ],
    });
    expect(problem).toContain("2 conditions");
  });

  it("accepts no conditions at all — that is a rule that runs for everybody", () => {
    expect(describeConditionProblem({ match: "all", rules: [] })).toBeNull();
    expect(describeConditionProblem({})).toBeNull();
    expect(describeConditionProblem(null)).toBeNull();
    expect(describeConditionProblem(undefined)).toBeNull();
  });

  it("accepts a finished rule, including one that needs no value", () => {
    expect(
      describeConditionProblem({ match: "all", rules: [{ field: "tag", op: "has", value: 3 }] })
    ).toBeNull();
    // "they are not a customer yet" asks about the person, not about a thing
    // she has to pick from a list.
    expect(
      describeConditionProblem({ match: "any", rules: [{ field: "customer", op: "is_not", value: true }] })
    ).toBeNull();
  });

  it("still reads the flat map older automations were saved with", () => {
    // Calling those unfinished would make every automation from before the
    // builder impossible to turn back on.
    expect(describeConditionProblem({ source: "apply" })).toBeNull();
  });

  it("refuses a shape it cannot read rather than ignoring it", () => {
    // An unreadable `rules` parsed as "no rules", which is the difference
    // between a narrowed automation and one that runs for the whole list.
    expect(describeConditionProblem({ rules: 5 })).not.toBeNull();
    expect(describeConditionProblem({ match: "sometimes", rules: [] })).not.toBeNull();
  });
});
