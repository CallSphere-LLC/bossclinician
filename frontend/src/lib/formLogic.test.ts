import { describe, expect, it } from "vitest";
import {
  acceptAttribute,
  fileProblem,
  logicProblem,
  ruleProblem,
  visibleQuestionKeys,
  type LogicField,
} from "./formLogic";

/**
 * The page's copy of the conditional-question rules. The cases mirror
 * backend/src/services/formLogic.test.ts: if the two ever disagree, the page
 * shows a question whose answer the server then throws away.
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
];

describe("visibleQuestionKeys (page)", () => {
  it("hides a question until its trigger's answer matches", () => {
    expect(visibleQuestionKeys(practice, {}).has("practice_size")).toBe(false);
    expect(visibleQuestionKeys(practice, { has_practice: "  yes " }).has("practice_size")).toBe(true);
  });

  it("hides a question whose trigger is itself hidden", () => {
    const visible = visibleQuestionKeys(practice, { has_practice: "No", practice_size: "4" });
    expect(visible.has("practice_city")).toBe(false);
  });

  it("supports each operator the same way the server does", () => {
    const fields: LogicField[] = [
      { key: "q", type: "text" },
      { key: "eq", showIf: { field: "q", operator: "equals", value: "blue" } },
      { key: "ne", showIf: { field: "q", operator: "not_equals", value: "blue" } },
      { key: "has", showIf: { field: "q", operator: "contains", value: "lu" } },
      { key: "any", showIf: { field: "q", operator: "answered" } },
      { key: "in", showIf: { field: "q", operator: "one_of", values: ["red", "Blue"] } },
    ];
    expect([...visibleQuestionKeys(fields, { q: "Blue" })].sort()).toEqual(["any", "eq", "has", "in", "q"].sort());
    expect([...visibleQuestionKeys(fields, { q: "green" })].sort()).toEqual(["any", "ne", "q"].sort());
    expect([...visibleQuestionKeys(fields, { q: "   " })].sort()).toEqual(["ne", "q"].sort());
  });

  it("reads tick boxes and file questions the same way the server does", () => {
    const fields: LogicField[] = [
      { key: "agree", type: "checkbox" },
      { key: "why_not", showIf: { field: "agree", operator: "equals", value: "no" } },
      { key: "services", type: "checkboxes", options: ["Therapy", "Coaching"] },
      { key: "coach", showIf: { field: "services", operator: "one_of", values: ["Coaching"] } },
      { key: "cv", type: "file" },
      { key: "about_cv", showIf: { field: "cv", operator: "answered" } },
    ];
    const none = visibleQuestionKeys(fields, {});
    expect(none.has("why_not")).toBe(true);
    expect(none.has("coach")).toBe(false);
    expect(none.has("about_cv")).toBe(false);
    const some = visibleQuestionKeys(fields, { agree: true, services: ["Coaching"], cv: { file: true } });
    expect(some.has("why_not")).toBe(false);
    expect(some.has("coach")).toBe(true);
    expect(some.has("about_cv")).toBe(true);
  });
});

describe("logicProblem (builder)", () => {
  it("accepts a sound list and refuses a rule naming a question below it", () => {
    expect(logicProblem(practice)).toBeNull();
    expect(
      logicProblem([
        { key: "a", label: "A", showIf: { field: "b", operator: "answered" } },
        { key: "b", label: "B" },
      ]),
    ).toBe("“A” depends on “B”, which comes after it. Move “A” below it, or change the rule.");
  });
});

describe("ruleProblem", () => {
  it("says what the More rules want", () => {
    expect(ruleProblem({ key: "zip", label: "ZIP", pattern: "^[0-9]{5}$" }, "9021")).toBe(
      "“ZIP” needs to be a five-digit ZIP code.",
    );
    expect(ruleProblem({ key: "n", label: "N", pattern: "^[0-9]+$" }, "12a")).toBe(
      "“N” can only contain numbers.",
    );
    expect(ruleProblem({ key: "bio", label: "Bio", minLength: 5 }, "hey")).toBe("“Bio” needs at least 5 characters.");
    expect(ruleProblem({ key: "bio", label: "Bio", minLength: 5 }, "")).toBeNull();
  });
});

describe("file questions on the page", () => {
  const field = { key: "cv", label: "Your CV", fileTypes: ["pdf"], maxSizeMb: 2 };

  it("offers the picker only the accepted kinds", () => {
    expect(acceptAttribute(field)).toBe(".pdf,application/pdf");
  });

  it("refuses the wrong kind or too big a file before uploading it", () => {
    expect(fileProblem(field, { name: "cv.docx", size: 100 })).toBe("“Your CV” takes PDFs. That file isn't one.");
    expect(fileProblem(field, { name: "cv.pdf", size: 3 * 1024 * 1024 })).toBe(
      "“Your CV” takes files up to 2 MB. That one is bigger.",
    );
    expect(fileProblem(field, { name: "CV.PDF", size: 1024 })).toBeNull();
  });

  it("never allows more than the hard cap, whatever was stored", () => {
    expect(fileProblem({ key: "cv", fileTypes: ["pdf"], maxSizeMb: 50 }, { name: "a.pdf", size: 11 * 1024 * 1024 })).toMatch(
      /up to 10 MB/,
    );
  });
});
