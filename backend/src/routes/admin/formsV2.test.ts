import { describe, it, expect } from "vitest";
import { STARTER_FIELDS, fieldsError, parseSinceDays } from "./formsV2";

describe("parseSinceDays — ?since=30d on a form's replies", () => {
  it("reads a number of days", () => {
    expect(parseSinceDays("30d")).toBe(30);
    expect(parseSinceDays("7d")).toBe(7);
  });

  it("treats anything else as no filter", () => {
    for (const value of [undefined, "", "30", "abc", "0d", "99999d", ["30d"]]) {
      expect(parseSinceDays(value)).toBeNull();
    }
  });
});

/**
 * P0-1 regression: every new form arrived with no questions on it.
 *
 * The builder's create call sends a name and nothing else, and this route
 * defaulted `fields` to `[]` — so a form was published the moment it was made,
 * rendered as a heading with a Send button under it, and stored an empty object
 * for every reply. The legacy screen seeded the same two starters, which is why
 * nobody noticed until forms were built on the new one.
 */
describe("the questions a new form starts with", () => {
  it("asks for a name and an address, so the form is usable as created", () => {
    expect(STARTER_FIELDS.map((field) => field.key)).toEqual(["name", "email"]);
  });

  it("points the address question at the contact's address column", () => {
    // The one mapping that has to be there from the first save: a contact is
    // keyed on its address, so a form that collects one without saying where it
    // goes can make no lead, apply no tag and start no sequence.
    const email = STARTER_FIELDS.find((field) => field.key === "email");
    expect(email?.type).toBe("email");
    expect(email?.contactField).toBe("email");
  });

  it("asks for both, because a submission with neither identifies nobody", () => {
    for (const field of STARTER_FIELDS) expect(field.required).toBe(true);
  });

  it("leaves the whole-name question unmapped, having no column to map it to", () => {
    // Filing "Yvette Howard" under first_name is worse than leaving it to the
    // submit path's own fallback, which reads a field keyed `name` as the
    // display name.
    expect(STARTER_FIELDS.find((field) => field.key === "name")?.contactField).toBeUndefined();
  });
});

/**
 * G1 / G2: what the builder may save. Each refusal is a question that would
 * otherwise never show, always show, or collect a file nobody can reach.
 */
describe("fieldsError — conditions and file questions", () => {
  it("accepts the starter questions untouched", () => {
    expect(fieldsError(STARTER_FIELDS)).toBeNull();
  });

  it("accepts a conditional file question with sensible limits", () => {
    expect(
      fieldsError([
        ...STARTER_FIELDS,
        { key: "has_license", label: "Licensed?", type: "radio", options: ["Yes", "No"] },
        {
          key: "license",
          label: "Your license",
          type: "file",
          required: true,
          fileTypes: ["pdf", "image"],
          maxSizeMb: 10,
          showIf: { field: "has_license", operator: "equals", value: "Yes" },
        },
      ]),
    ).toBeNull();
  });

  it("refuses a file limit over the hard cap", () => {
    expect(
      fieldsError([{ key: "cv", label: "CV", type: "file", maxSizeMb: 11 }]),
    ).toBe("“CV” can take files up to 10 MB at most.");
  });

  it("refuses a file question with no kinds of file ticked", () => {
    expect(fieldsError([{ key: "cv", label: "CV", type: "file", fileTypes: [] }])).toMatch(/Tick at least one/);
  });

  it("refuses a file question pointed at a contact detail", () => {
    expect(
      fieldsError([{ key: "cv", label: "CV", type: "file", contactField: "phone" }]),
    ).toMatch(/attached to the contact/);
  });

  it("refuses more than five file questions", () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      key: `file_${index}`,
      label: `File ${index}`,
      type: "file" as const,
    }));
    expect(fieldsError(six)).toBe("A form can ask for up to 5 files.");
  });

  it("refuses a rule naming a question below it", () => {
    expect(
      fieldsError([
        { key: "a", label: "A", type: "text", showIf: { field: "b", operator: "answered" } },
        { key: "b", label: "B", type: "text" },
      ]),
    ).toMatch(/which comes after it/);
  });
});
