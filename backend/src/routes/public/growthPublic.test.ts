import { describe, it, expect } from "vitest";
import { contactFromSubmission } from "./growthPublic";

/**
 * P0-1 regression: a form submission that captured nothing.
 *
 * The public submit handler inserted a row into `form_submissions` and stopped.
 * No contact, no tags, no sequence, no automation — and, the part these pin, no
 * reading of the "save this answer to" menu the builder has always offered. A
 * form asking for a phone number stored it in a JSON blob that no segment,
 * sequence or contact screen could see.
 *
 * `contactFromSubmission` is the pure half of that fix and the only half worth
 * testing without a database, because it is also the security boundary:
 * `contactField` is a name an admin typed into a free-text box, and what these
 * assert is that no such name can ever be anything but a named argument of
 * `upsertContact` or a key inside a jsonb value.
 */
describe("contactFromSubmission", () => {
  it("writes each answer to the contact column its question names", () => {
    const contact = contactFromSubmission(
      [
        { key: "first", label: "First name", contactField: "firstName" },
        { key: "last", label: "Surname", contactField: "lastName" },
        { key: "mobile", label: "Phone", contactField: "phone" },
        { key: "tz", label: "Timezone", contactField: "timezone" },
      ],
      { first: "Yvette", last: "Howard", mobile: "555-0134", tz: "Europe/London" },
      "",
    );

    expect(contact.firstName).toBe("Yvette");
    expect(contact.lastName).toBe("Howard");
    expect(contact.phone).toBe("555-0134");
    expect(contact.timezone).toBe("Europe/London");
  });

  it("refuses a column name that is not on the allowlist", () => {
    // The box accepts anything she types, so "email_marketing_status" is a
    // thing she can write, and honouring it would re-subscribe somebody who
    // opted out. Off the list means custom field, where the name is a jsonb key.
    const contact = contactFromSubmission(
      [{ key: "q1", contactField: "email_marketing_status" }],
      { q1: "subscribed" },
      "",
    );

    expect(contact).not.toHaveProperty("email_marketing_status");
    expect(contact.customFields).toEqual({ email_marketing_status: "subscribed" });
  });

  it("never lets a typed name reach anything but a known key", () => {
    // The shape of the return value is the guarantee: whatever arrives, the
    // caller passes named arguments to `upsertContact` and a jsonb object. A
    // name that is not one of the five known targets cannot add a key here.
    const contact = contactFromSubmission(
      [{ key: "q1", contactField: "name; DROP TABLE contacts--" }],
      { q1: "x" },
      "",
    );

    expect(Object.keys(contact).sort()).toEqual([
      "customFields",
      "email",
      "firstName",
      "lastName",
      "name",
      "phone",
      "timezone",
    ]);
    // Not a key the builder would have accepted either, so it is dropped rather
    // than stored under a name no segment could ever name back.
    expect(contact.customFields).toEqual({});
  });

  it("keeps a well-formed custom answer, where segments can find it", () => {
    const contact = contactFromSubmission(
      [{ key: "q1", contactField: "biggest_bottleneck" }],
      { q1: "Scheduling" },
      "",
    );

    expect(contact.customFields).toEqual({ biggest_bottleneck: "Scheduling" });
  });

  it("prefers the question pointed at the address over the envelope's guess", () => {
    // The page fills the envelope's `email` in only when it can guess which
    // field holds one. A form whose email question is keyed `work_address` used
    // to produce a submission with no address on it, and so no lead at all.
    const contact = contactFromSubmission(
      [{ key: "work_address", contactField: "email" }],
      { work_address: "  Yvette@Example.COM " },
      "",
    );

    expect(contact.email).toBe("yvette@example.com");
  });

  it("drops an answer that is not an address at all", () => {
    // Public endpoint, and only the envelope's `email` is schema-validated. A
    // contact is keyed on its address, so "no thanks" arriving in the mapped
    // question would be a contact row nobody can ever mail, merge or find.
    expect(contactFromSubmission([{ key: "q1", contactField: "email" }], { q1: "no thanks" }, "")
      .email).toBe("");
    expect(contactFromSubmission([], {}, "not-an-address").email).toBe("");
  });

  it("falls back to the envelope address when no question claims one", () => {
    const contact = contactFromSubmission([{ key: "q1" }], { q1: "hello" }, "Someone@Example.com");
    expect(contact.email).toBe("someone@example.com");
  });

  it("reads a plain name field, which the starter questions do not map", () => {
    // "Your name" is a whole name and there is no whole-name column, so the
    // starter leaves it unmapped. Without this fallback everybody arriving
    // through the default form would be a contact with an address and no name.
    const contact = contactFromSubmission(
      [{ key: "name" }, { key: "email", contactField: "email" }],
      { name: "Yvette Howard", email: "y@example.com" },
      "",
    );

    expect(contact.name).toBe("Yvette Howard");
  });

  it("leaves the whole name alone once the halves are being collected", () => {
    // Both set would have `upsertContact` receive a name and two halves that
    // disagree, and its longest-name rule would then pick between them.
    const contact = contactFromSubmission(
      [{ key: "name" }, { key: "first", contactField: "firstName" }],
      { name: "Yvette Howard", first: "Yvette" },
      "",
    );

    expect(contact.name).toBe("");
    expect(contact.firstName).toBe("Yvette");
  });

  it("ignores unanswered questions rather than blanking what is on record", () => {
    // `upsertContact` only fills blanks, but an empty string is still a value
    // it would consider; skipping here keeps the intent obvious at both ends.
    const contact = contactFromSubmission(
      [
        { key: "mobile", contactField: "phone" },
        { key: "note", contactField: "biggest_bottleneck" },
      ],
      { mobile: "", note: undefined },
      "y@example.com",
    );

    expect(contact.phone).toBe("");
    expect(contact.customFields).toEqual({});
  });

  it("survives a fields column that is not a list of questions", () => {
    // jsonb, written by successive versions of the builder. A row that is null
    // or an object must not throw on a public endpoint.
    expect(contactFromSubmission(null, { name: "Yvette" }, "y@example.com").email).toBe(
      "y@example.com",
    );
    expect(contactFromSubmission({}, {}, "y@example.com").name).toBe("");
    expect(contactFromSubmission([{ contactField: "phone" }, 7, null], {}, "").phone).toBe("");
  });

  it("bounds every value it writes to a column", () => {
    const contact = contactFromSubmission(
      [{ key: "q1", contactField: "firstName" }],
      { q1: "x".repeat(5000) },
      "",
    );

    expect(contact.firstName.length).toBe(200);
  });
});
