import { describe, expect, it } from "vitest";
import {
  MARKETING_MERGE_KEYS,
  MERGE_TAGS,
  buildMergeValues,
  mergeTagsFor,
  customFieldValues,
  familyName,
  formatMergeDate,
  greetingName,
  type MergeLinks,
} from "./mergeValues";

/**
 * The values behind the composer's "Insert their details…" picker.
 *
 * The bug this file exists for: the picker offered twelve tokens, the senders
 * filled in three, and the renderer blanks anything it is not given. So the
 * test that matters most is the dull one — every key the picker may offer for a
 * marketing send is present and is not an empty string.
 */

const links: MergeLinks = {
  unsubscribeUrl: "https://example.test/api/email/unsubscribe/token",
  loginUrl: "https://example.test/login",
  startUrl: "https://example.test/library",
};

const NOON_UTC = new Date("2026-09-15T12:00:00Z");

describe("buildMergeValues", () => {
  it("fills in every token a marketing email may use", () => {
    const values = buildMergeValues(
      {
        email: "yvette@example.com",
        name: "Yvette Howard",
        firstName: "Yvette",
        lastName: "Howard",
        timezone: "America/New_York",
        customFields: {},
      },
      links,
      NOON_UTC
    );

    for (const key of MARKETING_MERGE_KEYS) {
      expect(values[key], key).toBeTruthy();
    }
    expect(values).toMatchObject({
      firstName: "Yvette",
      lastName: "Howard",
      name: "Yvette Howard",
      email: "yvette@example.com",
      date: "September 15",
      loginUrl: links.loginUrl,
      startUrl: links.startUrl,
      unsubscribeUrl: links.unsubscribeUrl,
    });
  });

  it("works out first and last names from the full name when they were never stored", () => {
    const values = buildMergeValues({ email: "a@example.com", name: "Mary Jane Watson" }, links, NOON_UTC);
    expect(values.firstName).toBe("Mary");
    expect(values.lastName).toBe("Jane Watson");
  });

  it("greets a nameless contact as 'there' and uses their address as the name", () => {
    const values = buildMergeValues({ email: "a@example.com", name: "", firstName: null }, links, NOON_UTC);
    expect(values.firstName).toBe("there");
    expect(values.lastName).toBe("");
    expect(values.name).toBe("a@example.com");
  });

  it("adds custom fields as custom.<key>, and never lets one overwrite a built-in", () => {
    const values = buildMergeValues(
      {
        email: "a@example.com",
        name: "Ada",
        customFields: { practice_name: "Calm Rooms", years: 7, licensed: true, email: "spoof@example.com" },
      },
      links,
      NOON_UTC
    );
    expect(values["custom.practice_name"]).toBe("Calm Rooms");
    expect(values["custom.years"]).toBe("7");
    expect(values["custom.licensed"]).toBe("true");
    expect(values["custom.email"]).toBe("spoof@example.com");
    expect(values.email).toBe("a@example.com");
  });
});

describe("mergeTagsFor", () => {
  const keyOf = (token: string): string => token.replace(/[{}]/g, "");

  it("offers a broadcast or a sequence only what the sender fills in", () => {
    for (const source of ["broadcast", "sequence"] as const) {
      const offered = mergeTagsFor(source).map((tag) => keyOf(tag.token));
      expect([...offered].sort()).toEqual([...MARKETING_MERGE_KEYS].sort());
      expect(offered).not.toContain("offerName");
      expect(offered).not.toContain("total");
    }
  });

  it("resolves every marketing token it offers to something", () => {
    const values = buildMergeValues(
      { email: "yvette@example.com", name: "Yvette Howard", timezone: "UTC" },
      links,
      NOON_UTC
    );
    for (const tag of mergeTagsFor("sequence")) {
      expect(values[keyOf(tag.token)], tag.token).toBeTruthy();
    }
  });

  it("keeps the purchase tokens for transactional email, and for callers that do not say", () => {
    expect(mergeTagsFor("transactional")).toHaveLength(MERGE_TAGS.length);
    expect(mergeTagsFor()).toHaveLength(MERGE_TAGS.length);
    expect(mergeTagsFor("transactional").map((tag) => tag.token)).toContain("{{offerName}}");
  });

  it("calls the date what it is in a newsletter", () => {
    expect(mergeTagsFor("broadcast").find((tag) => tag.token === "{{date}}")?.label).toBe("Today's date");
    expect(mergeTagsFor("transactional").find((tag) => tag.token === "{{date}}")?.label).toBe(
      "The date in question"
    );
  });
});

describe("customFieldValues", () => {
  it("ignores anything that is not a plain object", () => {
    expect(customFieldValues(null)).toEqual({});
    expect(customFieldValues("nope")).toEqual({});
    expect(customFieldValues(["a"])).toEqual({});
  });

  it("blanks nulls, skips nested values, and makes awkward keys spellable", () => {
    expect(
      customFieldValues({
        "practice name": "Calm Rooms",
        gone: null,
        nested: { a: 1 },
        list: [1, 2],
      })
    ).toEqual({ "custom.practice_name": "Calm Rooms", "custom.gone": "" });
  });

  it("keeps the first of two keys that collapse to the same token", () => {
    expect(customFieldValues({ "a b": "first", "a-b": "second" })).toEqual({ "custom.a_b": "first" });
  });
});

describe("formatMergeDate", () => {
  it("uses the reader's own calendar day", () => {
    // 02:00 UTC on the 16th is still the evening of the 15th in New York.
    const late = new Date("2026-09-16T02:00:00Z");
    expect(formatMergeDate(late, "America/New_York")).toBe("September 15");
    expect(formatMergeDate(late, "UTC")).toBe("September 16");
  });

  it("falls back to UTC rather than throwing on a zone nobody recognises", () => {
    expect(formatMergeDate(NOON_UTC, "Not/AZone")).toBe("September 15");
  });
});

describe("name helpers", () => {
  it("prefers the stored first name", () => {
    expect(greetingName("Yvette Howard", " Yve ")).toBe("Yve");
  });

  it("prefers the stored last name", () => {
    expect(familyName("Yvette Howard", "Howard-Smith")).toBe("Howard-Smith");
    expect(familyName("Cher", "")).toBe("");
  });
});
