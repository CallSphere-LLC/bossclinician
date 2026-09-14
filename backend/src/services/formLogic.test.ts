import { describe, expect, it } from "vitest";
import {
  answerProblem,
  keptAnswers,
  logicProblem,
  visibleQuestionKeys,
  type LogicField,
} from "./formLogic";

/**
 * G1: conditional questions. The page hides a question whose rule isn't met;
 * these pin the server's own copy of that decision, which is the one that
 * decides what is required and what is stored. The frontend twin
 * (frontend/src/lib/formLogic.test.ts) runs the same cases.
 */

const practice: LogicField[] = [
  { key: "name", label: "Your name", type: "text", required: true },
  { key: "email", label: "Email address", type: "email", required: true },
  { key: "has_practice", label: "Do you run a practice?", type: "radio", options: ["Yes", "No"] },
  {
    key: "practice_size",
    label: "How many clinicians?",
    type: "text",
    required: true,
    showIf: { field: "has_practice", operator: "equals", value: "Yes" },
  },
  {
    key: "practice_city",
    label: "Which city?",
    type: "text",
    showIf: { field: "practice_size", operator: "answered" },
  },
  {
    key: "license",
    label: "Your license",
    type: "file",
    required: true,
    showIf: { field: "has_practice", operator: "equals", value: "Yes" },
  },
];

describe("visibleQuestionKeys", () => {
  it("hides a question until its trigger's answer matches", () => {
    expect(visibleQuestionKeys(practice, {}).has("practice_size")).toBe(false);
    expect(visibleQuestionKeys(practice, { has_practice: "No" }).has("practice_size")).toBe(false);
    expect(visibleQuestionKeys(practice, { has_practice: "Yes" }).has("practice_size")).toBe(true);
  });

  it("compares answers without caring about case or stray spaces", () => {
    expect(visibleQuestionKeys(practice, { has_practice: "  yes " }).has("practice_size")).toBe(true);
  });

  it("hides a question whose trigger is itself hidden, whatever its stale answer says", () => {
    const visible = visibleQuestionKeys(practice, { has_practice: "No", practice_size: "4" });
    expect(visible.has("practice_size")).toBe(false);
    expect(visible.has("practice_city")).toBe(false);
  });

  it("always shows the name and email address", () => {
    const visible = visibleQuestionKeys(practice, {});
    expect(visible.has("name")).toBe(true);
    expect(visible.has("email")).toBe(true);
  });

  it("supports each operator", () => {
    const fields: LogicField[] = [
      { key: "q", type: "text" },
      { key: "eq", showIf: { field: "q", operator: "equals", value: "blue" } },
      { key: "ne", showIf: { field: "q", operator: "not_equals", value: "blue" } },
      { key: "has", showIf: { field: "q", operator: "contains", value: "lu" } },
      { key: "any", showIf: { field: "q", operator: "answered" } },
      { key: "in", showIf: { field: "q", operator: "one_of", values: ["red", "Blue"] } },
    ];
    expect([...visibleQuestionKeys(fields, { q: "Blue" })].sort()).toEqual(
      ["any", "eq", "has", "in", "q"].sort(),
    );
    expect([...visibleQuestionKeys(fields, { q: "green" })].sort()).toEqual(["any", "ne", "q"].sort());
    // Not answered: only "is not" holds.
    expect([...visibleQuestionKeys(fields, { q: "   " })].sort()).toEqual(["ne", "q"].sort());
  });

  it("reads 'tick any that apply' as each ticked choice", () => {
    const fields: LogicField[] = [
      { key: "services", type: "checkboxes", options: ["Therapy", "Coaching", "Supervision"] },
      { key: "coach", showIf: { field: "services", operator: "one_of", values: ["Coaching", "Supervision"] } },
    ];
    expect(visibleQuestionKeys(fields, { services: ["Therapy"] }).has("coach")).toBe(false);
    expect(visibleQuestionKeys(fields, { services: ["Therapy", "Coaching"] }).has("coach")).toBe(true);
  });

  it("treats an untouched tick box as not ticked", () => {
    const fields: LogicField[] = [
      { key: "agree", type: "checkbox" },
      { key: "why_not", showIf: { field: "agree", operator: "equals", value: "no" } },
      { key: "thanks", showIf: { field: "agree", operator: "answered" } },
    ];
    expect(visibleQuestionKeys(fields, {}).has("why_not")).toBe(true);
    expect(visibleQuestionKeys(fields, {}).has("thanks")).toBe(false);
    expect(visibleQuestionKeys(fields, { agree: true }).has("thanks")).toBe(true);
  });

  it("counts a file question as answered only when a file arrived", () => {
    const fields: LogicField[] = [
      { key: "cv", type: "file" },
      { key: "about_cv", showIf: { field: "cv", operator: "answered" } },
    ];
    expect(visibleQuestionKeys(fields, { cv: "typed-in text" }).has("about_cv")).toBe(false);
    expect(visibleQuestionKeys(fields, { cv: { file: true } }).has("about_cv")).toBe(true);
  });

  it("shows a question whose rule names no earlier question, rather than hiding it for good", () => {
    const fields: LogicField[] = [
      { key: "later_rule", showIf: { field: "below", operator: "answered" } },
      { key: "below" },
    ];
    expect(visibleQuestionKeys(fields, {}).has("later_rule")).toBe(true);
  });

  it("survives a fields column that isn't a list of questions", () => {
    expect(visibleQuestionKeys(null, {}).size).toBe(0);
    expect(visibleQuestionKeys([7, null, { key: "a", showIf: "nonsense" }], {}).has("a")).toBe(true);
  });
});

describe("answerProblem", () => {
  it("does not require a hidden question", () => {
    const data = { has_practice: "No" };
    const visible = visibleQuestionKeys(practice, data);
    expect(answerProblem(practice, data, visible, new Set())).toBeNull();
  });

  it("requires a shown question, and says which", () => {
    const data = { has_practice: "Yes" };
    const visible = visibleQuestionKeys(practice, data);
    expect(answerProblem(practice, data, visible, new Set(["license"]))).toBe(
      "Please answer “How many clinicians?” — it's required.",
    );
  });

  it("requires a file only when one really arrived, not when one was claimed", () => {
    const data = { has_practice: "Yes", practice_size: "3", license: { file: true } };
    const visible = visibleQuestionKeys(practice, data);
    expect(answerProblem(practice, data, visible, new Set())).toBe(
      "Please attach a file for “Your license”.",
    );
    expect(answerProblem(practice, data, visible, new Set(["license"]))).toBeNull();
  });

  it("enforces the More rules on a shown question", () => {
    const fields: LogicField[] = [
      { key: "zip", label: "ZIP", pattern: "^[0-9]{5}$" },
      { key: "bio", label: "Bio", minLength: 5, maxLength: 10 },
    ];
    const all = new Set(["zip", "bio"]);
    expect(answerProblem(fields, { zip: "9021" }, all, new Set())).toBe(
      "“ZIP” needs to be a five-digit ZIP code.",
    );
    expect(answerProblem(fields, { bio: "hey" }, all, new Set())).toBe("“Bio” needs at least 5 characters.");
    expect(answerProblem(fields, { bio: "far too long a bio" }, all, new Set())).toBe(
      "“Bio” can be at most 10 characters.",
    );
    // Unanswered and optional: no rule applies.
    expect(answerProblem(fields, { zip: "", bio: "" }, all, new Set())).toBeNull();
    // Hidden: no rule applies.
    expect(answerProblem(fields, { zip: "abc" }, new Set(), new Set())).toBeNull();
  });
});

describe("keptAnswers", () => {
  it("drops hidden answers and anything typed under a file question", () => {
    const data = {
      name: "ZZ Test",
      email: "success+zz@simulator.amazonses.com",
      has_practice: "No",
      practice_size: "12",
      license: { file: true, mediaAssetId: 41 },
      utm_source: "newsletter",
    };
    const visible = visibleQuestionKeys(practice, data);
    expect(keptAnswers(practice, data, visible)).toEqual({
      name: "ZZ Test",
      email: "success+zz@simulator.amazonses.com",
      has_practice: "No",
      utm_source: "newsletter",
    });
  });
});

describe("logicProblem", () => {
  it("accepts a sound list", () => {
    expect(logicProblem(practice)).toBeNull();
  });

  it("refuses a rule naming a question below it", () => {
    expect(
      logicProblem([
        { key: "a", label: "A", showIf: { field: "b", operator: "answered" } },
        { key: "b", label: "B" },
      ]),
    ).toBe("“A” depends on “B”, which comes after it. Move “A” below it, or change the rule.");
  });

  it("refuses a rule naming a question that was deleted", () => {
    expect(logicProblem([{ key: "a", label: "A", showIf: { field: "gone", operator: "answered" } }])).toMatch(
      /isn't on this form any more/,
    );
  });

  it("refuses a choice that isn't one of the trigger's choices any more", () => {
    expect(
      logicProblem([
        { key: "size", label: "Size", type: "select", options: ["Small", "Large"] },
        { key: "x", label: "X", showIf: { field: "size", operator: "equals", value: "Medium" } },
      ]),
    ).toBe("“X” shows when “Size” is “Medium”, but that isn't one of its choices any more.");
  });

  it("refuses tests that make no sense for the trigger", () => {
    expect(
      logicProblem([
        { key: "cv", label: "CV", type: "file" },
        { key: "x", label: "X", showIf: { field: "cv", operator: "contains", value: "pdf" } },
      ]),
    ).toMatch(/doesn't work with “CV”/);
    expect(
      logicProblem([
        { key: "q", label: "Q" },
        { key: "x", label: "X", showIf: { field: "q", operator: "equals", value: "  " } },
      ]),
    ).toMatch(/blank/);
    expect(
      logicProblem([
        { key: "q", label: "Q" },
        { key: "x", label: "X", showIf: { field: "q", operator: "one_of", values: [] } },
      ]),
    ).toMatch(/list is empty/);
  });

  it("refuses rules on or about the name and email address", () => {
    expect(
      logicProblem([{ key: "q", label: "Q" }, { key: "email", label: "Email", showIf: { field: "q", operator: "answered" } }]),
    ).toMatch(/always asked/);
    expect(
      logicProblem([{ key: "name", label: "Name" }, { key: "x", label: "X", showIf: { field: "name", operator: "answered" } }]),
    ).toMatch(/name or email/);
  });
});
