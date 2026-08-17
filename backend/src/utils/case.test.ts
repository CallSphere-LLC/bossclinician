import { describe, it, expect } from "vitest";
import { toCamel, toSnake, rowToCamel, rowsToCamel, objToSnake } from "./case";

/** The member column set the Phase 1 API contract is written against. */
const MEMBER_COLUMNS = [
  "id",
  "email",
  "first_name",
  "last_name",
  "avatar_url",
  "timezone",
  "locale",
  "status",
  "email_verified_at",
  "last_login_at",
  "created_at",
] as const;

describe("toCamel", () => {
  it("converts snake_case to camelCase", () => {
    expect(toCamel("first_name")).toBe("firstName");
    expect(toCamel("email_verified_at")).toBe("emailVerifiedAt");
    expect(toCamel("id")).toBe("id");
  });

  it("leaves an already-camelCase key alone", () => {
    // rowToCamel runs over rows that have sometimes already been mapped.
    expect(toCamel("firstName")).toBe("firstName");
    expect(toCamel("avatarUrl")).toBe("avatarUrl");
  });
});

describe("toSnake", () => {
  it("converts camelCase to snake_case", () => {
    expect(toSnake("firstName")).toBe("first_name");
    expect(toSnake("emailVerifiedAt")).toBe("email_verified_at");
    expect(toSnake("id")).toBe("id");
  });

  it("leaves an already-snake_case key alone", () => {
    expect(toSnake("first_name")).toBe("first_name");
  });
});

describe("round trip", () => {
  it("returns every member column unchanged after snake -> camel -> snake", () => {
    for (const column of MEMBER_COLUMNS) {
      expect(toSnake(toCamel(column))).toBe(column);
    }
  });

  it("does not round-trip a column with a digit segment", () => {
    // Documented limitation, not an accident of this test: toCamel uppercases
    // the character after the underscore, and "1".toUpperCase() is "1", so the
    // separator is lost and toSnake cannot put it back. coaching_sessions has
    // two such columns (reminder_1h_sent_at, reminder_24h_sent_at). Nothing
    // reads them through these helpers yet; when something does, the mapping
    // has to be spelled out rather than derived.
    expect(toCamel("reminder_1h_sent_at")).toBe("reminder1hSentAt");
    expect(toSnake("reminder1hSentAt")).toBe("reminder1h_sent_at");
    expect(toSnake(toCamel("reminder_1h_sent_at"))).not.toBe("reminder_1h_sent_at");
  });
});

describe("rowToCamel", () => {
  it("maps every key and preserves values by identity", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const row = {
      id: 42,
      first_name: "Yvette",
      last_name: null,
      email_verified_at: createdAt,
      avatar_url: "/uploads/a.png",
    };

    const mapped = rowToCamel(row);

    expect(mapped).toEqual({
      id: 42,
      firstName: "Yvette",
      lastName: null,
      emailVerifiedAt: createdAt,
      avatarUrl: "/uploads/a.png",
    });
    // Dates must survive as Dates — the JSON layer serialises them, not this.
    expect((mapped as { emailVerifiedAt: Date }).emailVerifiedAt).toBe(createdAt);
  });

  it("returns an empty object for an empty row", () => {
    expect(rowToCamel({})).toEqual({});
  });

  it("does not mutate the row it was given", () => {
    const row = { first_name: "Yvette" };
    rowToCamel(row);
    expect(row).toEqual({ first_name: "Yvette" });
  });

  it("keeps falsy values rather than dropping them", () => {
    // `false` and `0` are meaningful for published flags and sort orders.
    expect(rowToCamel({ is_published: false, sort_order: 0, deleted_at: null })).toEqual({
      isPublished: false,
      sortOrder: 0,
      deletedAt: null,
    });
  });
});

describe("rowsToCamel", () => {
  it("maps each row", () => {
    expect(rowsToCamel([{ first_name: "A" }, { first_name: "B" }])).toEqual([
      { firstName: "A" },
      { firstName: "B" },
    ]);
  });

  it("returns an empty array for no rows", () => {
    expect(rowsToCamel([])).toEqual([]);
  });
});

describe("objToSnake", () => {
  it("converts a camelCase body into snake_case keys", () => {
    expect(objToSnake({ firstName: "Yvette", avatarUrl: null, id: 1 })).toEqual({
      first_name: "Yvette",
      avatar_url: null,
      id: 1,
    });
  });

  it("round-trips with rowToCamel for the member column set", () => {
    const row = Object.fromEntries(MEMBER_COLUMNS.map((c, i) => [c, i]));
    expect(objToSnake(rowToCamel(row))).toEqual(row);
  });
});
