import { describe, expect, it } from "vitest";
import {
  BUILT_IN_SEGMENTS,
  CONTACT_SORTS,
  CONTACT_SORT_KEYS,
  DATE_PRESETS,
  DEFAULT_CONTACT_SORT,
  EMAIL_STATUS_WORDS,
  FILTER_CATEGORIES,
  SEGMENT_PATTERN,
  buildFilterRow,
  buildScopeClauses,
  filterCatalog,
  parseFilterRows,
  shiftPlaceholders,
  sortSql,
  type FilterRow,
} from "./contactFilters";

/**
 * The People list's Kajabi-style segments, filters and sorts (QA rows 22–23).
 *
 * Every filter row arrives from a URL, so the property that matters is the one
 * services/segments.ts holds its saved rules to: only whitelisted categories
 * and conditionals compile, and nothing a person typed reaches the SQL except
 * as a bind parameter.
 */

const ZONE = "America/Los_Angeles";

// Values chosen so that, if any of them were spliced into the SQL, the test
// would find it there.
const HOSTILE_TEXT = "Zebra%_'); DROP TABLE contacts; --";
const HOSTILE_TITLE = "t:Xyzzy Offer'); DELETE FROM orders; --";
const HOSTILE_FIELD = "Xyzzy Field'); DROP TABLE tags; --";

/** A valid value (and text) for each kind of value box, per option list. */
function samplesFor(value: string, options: string | undefined): { value: string; text: string }[] {
  switch (value) {
    case "none":
      return [{ value: "", text: "" }];
    case "days":
      return [{ value: "30", text: "" }];
    case "engagement_days":
      return [{ value: "90", text: "" }];
    case "money":
      return [{ value: "$1,250.50", text: "" }];
    case "date_range":
      return DATE_PRESETS.map((preset) => ({
        value: preset.key,
        text: preset.key === "custom" ? "2026-01-01~2026-03-31" : "",
      }));
    case "field":
    case "field_text": {
      const field = options === "defaultFields" ? "city" : HOSTILE_FIELD;
      return [{ value: field, text: value === "field_text" ? HOSTILE_TEXT : "" }];
    }
    case "choice":
      if (options === "statuses") return [{ value: "never_subscribed", text: "" }];
      if (options === "tags") return [{ value: "xyzzy-tag", text: "" }];
      if (options === "offers" || options === "products") {
        return [
          { value: "987654", text: "" },
          { value: HOSTILE_TITLE, text: "" },
        ];
      }
      return [{ value: "987654", text: "" }];
    default:
      throw new Error(`No sample for value kind ${value}`);
  }
}

function placeholders(sql: string): number[] {
  return [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
}

describe("filter categories", () => {
  it("lists Kajabi's categories, in Kajabi's order", () => {
    expect(FILTER_CATEGORIES.map((category) => category.label)).toEqual([
      "Assessment",
      "Contacts",
      "Coupon",
      "Customers",
      "Custom Fields",
      "Default Fields",
      "Email Activity",
      "Email Broadcast",
      "Email Engagement",
      "Email Sequence",
      "Events",
      "Forms",
      "Lifetime Value",
      "Email Marketing Status",
      "Newsletter",
      "Offers",
      "Products",
      "Tags",
    ]);
  });

  it("offers Kajabi's Contacts conditionals, with Is hidden listed but not answerable", () => {
    const contacts = filterCatalog().find((category) => category.key === "contacts");
    expect(contacts?.conditionals.map((conditional) => conditional.label)).toEqual([
      "Contact was added",
      "Contact was not added",
      "Is hidden",
    ]);
    expect(contacts?.conditionals.find((conditional) => conditional.key === "hidden")?.unavailable).not.toBe("");
    expect(() => buildFilterRow({ category: "contacts", op: "hidden", value: "", text: "" }, [], ZONE)).toThrow(
      /community feature/,
    );
  });

  // One case per category × conditional × sample value: the whitelist, whole.
  const cases = FILTER_CATEGORIES.flatMap((category) =>
    category.conditionals
      .filter((conditional) => !conditional.unavailable)
      .flatMap((conditional) =>
        samplesFor(conditional.value, conditional.options).map((sample) => ({
          name: `${category.key}.${conditional.key} = ${JSON.stringify(sample.value)}`,
          row: { category: category.key, op: conditional.key, ...sample } satisfies FilterRow,
        })),
      ),
  );

  it.each(cases)("$name compiles to a bound, parenthesised predicate", ({ row }) => {
    const params: unknown[] = ["already bound"];
    const sql = buildFilterRow(row, params, ZONE);

    expect(sql.startsWith("(") && sql.endsWith(")")).toBe(true);
    for (const raw of [HOSTILE_TEXT, HOSTILE_FIELD, "Xyzzy Offer", "xyzzy-tag", "987654", "DROP TABLE", "DELETE FROM"]) {
      expect(sql).not.toContain(raw);
    }

    // Every placeholder names a bound value, numbering carries on from what was
    // already bound, and nothing bound goes unused.
    const used = placeholders(sql);
    for (const n of used) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(params.length);
    }
    for (let n = 2; n <= params.length; n += 1) expect(used).toContain(n);
  });

  it("binds the hostile text, field and title as values", () => {
    const params: unknown[] = [];
    buildFilterRow({ category: "custom_fields", op: "contains", value: HOSTILE_FIELD, text: HOSTILE_TEXT }, params, ZONE);
    expect(params).toContain(HOSTILE_FIELD);
    expect(params).toContain("%zebra\\%\\_'); drop table contacts; --%");

    const offer: unknown[] = [];
    buildFilterRow({ category: "offers", op: "purchased", value: HOSTILE_TITLE, text: "" }, offer, ZONE);
    expect(offer).toEqual(["Xyzzy Offer'); DELETE FROM orders; --"]);
  });

  it("turns dollars into cents", () => {
    const params: unknown[] = [];
    expect(buildFilterRow({ category: "lifetime_value", op: "gt", value: "$1,250.50", text: "" }, params, ZONE)).toBe(
      "(c.lifetime_value_cents > $1)",
    );
    expect(params).toEqual([125050]);
  });

  it("refuses a category or conditional that isn't on the list", () => {
    expect(() => buildFilterRow({ category: "email; DROP", op: "is", value: "x", text: "" }, [], ZONE)).toThrow(
      /don't recognise/,
    );
    expect(() => buildFilterRow({ category: "tags", op: "is_like", value: "x", text: "" }, [], ZONE)).toThrow(
      /comparison/,
    );
    expect(() => buildFilterRow({ category: "__proto__", op: "toString", value: "", text: "" }, [], ZONE)).toThrow();
  });

  it.each([
    ["an id that isn't a number", { category: "forms", op: "submitted", value: "1 OR 1=1", text: "" }],
    ["days outside the choices", { category: "email_activity", op: "opened", value: "13", text: "" }],
    ["engagement days outside Kajabi's", { category: "email_engagement", op: "engaged", value: "7", text: "" }],
    ["a status we don't track", { category: "email_marketing_status", op: "is", value: "maybe", text: "" }],
    ["an amount that isn't money", { category: "lifetime_value", op: "lt", value: "lots", text: "" }],
    ["a default field that isn't one", { category: "default_fields", op: "is", value: "password_hash", text: "x" }],
    ["empty text to compare", { category: "default_fields", op: "is", value: "city", text: "  " }],
    ["a date range that ends first", { category: "contacts", op: "added", value: "custom", text: "2026-03-01~2026-01-01" }],
    ["a day that doesn't exist", { category: "contacts", op: "added", value: "custom", text: "2026-02-30~2026-03-01" }],
    ["a preset that doesn't exist", { category: "contacts", op: "added", value: "since_forever", text: "" }],
    ["an offer with no id or title", { category: "offers", op: "has_access", value: "t:   ", text: "" }],
  ])("refuses %s", (_label, row) => {
    expect(() => buildFilterRow(row, [], ZONE)).toThrow();
  });

  it("cuts calendar days in the site's zone", () => {
    const params: unknown[] = [];
    const sql = buildFilterRow({ category: "contacts", op: "added", value: "today", text: "" }, params, ZONE);
    expect(sql).toContain("date_trunc('day'");
    expect(params).toEqual([ZONE, ZONE]);
  });
});

describe("parseFilterRows", () => {
  it("reads the JSON the screen keeps in its address bar", () => {
    const rows = parseFilterRows(JSON.stringify([{ category: "tags", op: "has", value: "vip" }]));
    expect(rows).toEqual([{ category: "tags", op: "has", value: "vip", text: "" }]);
  });

  it("treats no parameter as no filters", () => {
    expect(parseFilterRows(undefined)).toEqual([]);
    expect(parseFilterRows("")).toEqual([]);
  });

  it("refuses what isn't a list of rows", () => {
    expect(() => parseFilterRows("{not json")).toThrow(/couldn't be read/);
    expect(() => parseFilterRows(JSON.stringify({ category: "tags" }))).toThrow(/couldn't be read/);
    expect(() => parseFilterRows(JSON.stringify(Array.from({ length: 21 }, () => ({ category: "customers", op: "is" }))))).toThrow();
  });
});

describe("segments", () => {
  it("are Kajabi's five, in Kajabi's order", () => {
    expect(BUILT_IN_SEGMENTS.map((segment) => segment.label)).toEqual([
      "All Contacts",
      "Customers",
      "Subscribed",
      "Inactive",
      "Hard Bounced",
    ]);
  });

  it("accepts only known segment keys", () => {
    for (const ok of ["all", "customers", "subscribed", "inactive", "hard_bounced", "team", "saved-12"]) {
      expect(SEGMENT_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ["saved-0", "saved-x", "everyone", "team;", "saved-1 OR 1=1"]) {
      expect(SEGMENT_PATTERN.test(bad)).toBe(false);
    }
  });

  it("leaves team and test accounts out of every segment but their own", () => {
    for (const segment of ["all", "customers", "subscribed", "inactive", "hard_bounced", undefined]) {
      expect(buildScopeClauses({ segment, timeZone: ZONE }, [])).toContain("NOT c.is_internal");
    }
    expect(buildScopeClauses({ segment: "team", timeZone: ZONE }, [])).toEqual(["c.is_internal"]);
  });

  it("defines each built-in segment the way the report says", () => {
    const clause = (segment: string) => buildScopeClauses({ segment, timeZone: ZONE }, []).join(" AND ");
    expect(clause("all")).toBe("NOT c.is_internal");
    expect(clause("customers")).toContain("c.order_count > 0");
    expect(clause("customers")).toContain("access_grants");
    expect(clause("subscribed")).toContain("c.email_marketing_status = 'subscribed'");
    expect(clause("inactive")).toContain("interval '90 days'");
    expect(clause("inactive")).toContain("c.email_marketing_status = 'subscribed'");
    expect(clause("hard_bounced")).toContain("c.email_marketing_status = 'bounced'");
  });

  it("moves a saved segment's placeholders along past what is already bound", () => {
    const params: unknown[] = ["%sam%"];
    const clauses = buildScopeClauses(
      {
        segment: "saved-3",
        saved: { where: "(c.name = $1) AND (c.lifetime_value_cents > $2)", params: ["Sam", 100] },
        rows: [{ category: "tags", op: "has", value: "vip", text: "" }],
        timeZone: ZONE,
      },
      params,
    );
    expect(clauses).toContain("((c.name = $2) AND (c.lifetime_value_cents > $3))");
    expect(clauses.at(-1)).toContain("$4::citext");
    expect(params).toEqual(["%sam%", "Sam", 100, "vip"]);
  });

  it("refuses a saved segment it wasn't given", () => {
    expect(() => buildScopeClauses({ segment: "saved-3", saved: null, timeZone: ZONE }, [])).toThrow(/no longer exists/);
  });

  it("shifts every placeholder, including double-digit ones", () => {
    expect(shiftPlaceholders("$1 $2 $10", 5)).toBe("$6 $7 $15");
  });
});

describe("sorts", () => {
  it("are Kajabi's ten, word for word and in its order", () => {
    expect(CONTACT_SORT_KEYS.map((key) => CONTACT_SORTS[key].label)).toEqual([
      "Name A–Z",
      "Name Z–A",
      "Email A–Z",
      "Email Z–A",
      "Lifetime Value (most first)",
      "Lifetime Value (least first)",
      "Added date (oldest first)",
      "Added date (newest first)",
      "Last activity (oldest first)",
      "Last activity (newest first)",
    ]);
  });

  it("defaults to Added date (newest first), as Kajabi does", () => {
    expect(DEFAULT_CONTACT_SORT).toBe("added_desc");
    expect(sortSql(undefined)).toBe(CONTACT_SORTS.added_desc.sql);
    expect(sortSql("anything; DROP TABLE contacts")).toBe(CONTACT_SORTS.added_desc.sql);
  });

  it("still understands the words the list used before", () => {
    expect(sortSql("recent")).toBe(CONTACT_SORTS.activity_desc.sql);
    expect(sortSql("newest")).toBe(CONTACT_SORTS.added_desc.sql);
    expect(sortSql("name")).toBe(CONTACT_SORTS.name_asc.sql);
    expect(sortSql("orders")).toContain("c.order_count DESC");
  });

  it("ends every order on the id, so pages don't overlap on a tie", () => {
    for (const key of CONTACT_SORT_KEYS) expect(CONTACT_SORTS[key].sql).toMatch(/c\.id (ASC|DESC)$/);
  });
});

describe("email marketing words", () => {
  it("reads like Kajabi, including Never subscribed", () => {
    expect(Object.values(EMAIL_STATUS_WORDS)).toEqual([
      "Subscribed",
      "Opted out",
      "Hard bounced",
      "Marked as spam",
      "Unconfirmed",
      "Never subscribed",
    ]);
  });
});
