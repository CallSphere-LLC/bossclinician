import { describe, it, expect } from "vitest";
import { STARTER_FIELDS } from "./formsV2";

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
