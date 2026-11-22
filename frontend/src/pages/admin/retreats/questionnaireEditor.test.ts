import { describe, expect, it } from "vitest";
import type { QuestionDefinition, QuestionnaireDefinition } from "@/lib/retreatsApi";
import { conditionTargets, moveItem, newId, parseOptions, tidyDefinition, usedIds, validateDefinition } from "./questionnaireEditor";

const q = (id: string, patch: Partial<QuestionDefinition> = {}): QuestionDefinition => ({
  id,
  type: "short_text",
  label: id,
  help: "",
  required: false,
  options: [],
  showTo: "all",
  showIf: null,
  sensitive: false,
  ...patch,
});
const def = (questions: QuestionDefinition[]): QuestionnaireDefinition => ({ intro: "", sections: [{ id: "s1", title: "S", description: "", questions }] });

describe("ids", () => {
  it("never returns an id that is already used", () => {
    const taken = usedIds(def([q("q_000001")]));
    expect(taken.has("s1")).toBe(true);
    let n = 0;
    const repeat = () => (n++ < 3 ? 1.5 / 36 ** 8 : 2.5 / 36 ** 8); // first tries collide with q_000001
    expect(newId("q", taken, repeat)).toBe("q_000002");
    const many = new Set<string>();
    for (let i = 0; i < 200; i += 1) many.add(newId("s", many));
    expect(many.size).toBe(200);
  });
});

describe("moveItem", () => {
  it("moves up and down and ignores moves off either end", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("validation", () => {
  it("needs wording and, for choice questions, options", () => {
    expect(validateDefinition(def([q("a", { label: " " })]))).toEqual(["Question 1 needs its wording."]);
    expect(validateDefinition(def([q("a", { type: "dropdown" })]))[0]).toContain("needs at least one option");
    expect(validateDefinition(def([q("a", { type: "dropdown", options: ["XS"] })]))).toEqual([]);
    expect(validateDefinition({ intro: "", sections: [] })).toEqual(["Add at least one section."]);
  });

  it("catches duplicate ids and broken conditions", () => {
    expect(validateDefinition(def([q("a"), q("a")])).join(" ")).toContain("shares its id");
    expect(validateDefinition(def([q("b", { showIf: { questionId: "gone", anyOf: [] } })])).join(" ")).toContain("isn't in this questionnaire");
    const choice = q("a", { type: "single_choice", options: ["Yes"] });
    expect(validateDefinition(def([choice, q("b", { showIf: { questionId: "a", anyOf: ["No"] } })])).join(" ")).toContain("no longer offers");
  });

  it("tidies options off non-choice questions and stale condition values", () => {
    const choice = q("a", { type: "single_choice", options: ["Yes"] });
    const tidy = tidyDefinition(def([choice, q("b", { options: ["x"], showIf: { questionId: "a", anyOf: ["Yes", "No"] } }), q("c", { showIf: { questionId: "gone", anyOf: [] } })]));
    const [, b, c] = tidy.sections[0].questions;
    expect(b.options).toEqual([]);
    expect(b.showIf).toEqual({ questionId: "a", anyOf: ["Yes"] });
    expect(c.showIf).toBeNull();
    expect(validateDefinition(tidy)).toEqual([]);
  });

  it("parses one option per line and offers only other, non-file questions as conditions", () => {
    expect(parseOptions(" XS\n\nS\nXS\n")).toEqual(["XS", "S"]);
    const d = def([q("a"), q("photo", { type: "file" }), q("b")]);
    expect(conditionTargets(d, "b").map((x) => x.id)).toEqual(["a", "photo"]);
  });
});
