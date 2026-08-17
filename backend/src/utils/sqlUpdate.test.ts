import { describe, it, expect } from "vitest";
import { buildUpdate } from "./sqlUpdate";

const ALLOWED = ["first_name", "last_name", "timezone", "locale", "sort_order"] as const;

/** Reads the clause back as [column, placeholderIndex] pairs. */
function parseClause(clause: string): Array<[string, number]> {
  return clause.split(", ").map((assignment) => {
    const match = /^(\w+) = \$(\d+)$/.exec(assignment);
    if (!match) throw new Error(`assignment is not a plain bind: ${assignment}`);
    return [match[1], Number(match[2])];
  });
}

describe("buildUpdate", () => {
  it("maps camelCase body keys onto their snake_case columns", () => {
    const update = buildUpdate({ firstName: "Yvette", lastName: "Howard" }, ALLOWED);
    expect(update).toEqual({
      clause: "first_name = $1, last_name = $2",
      values: ["Yvette", "Howard"],
    });
  });

  it("accepts a body key that is already snake_case", () => {
    expect(buildUpdate({ first_name: "Yvette" }, ALLOWED)).toEqual({
      clause: "first_name = $1",
      values: ["Yvette"],
    });
  });

  it("binds values positionally in the same order as the clause", () => {
    const body = { locale: "en-GB", firstName: "Yvette", timezone: "Europe/London" };
    const update = buildUpdate(body, ALLOWED);
    if (!update) throw new Error("expected an update");

    // The caller splices these straight into pool.query, so a clause whose
    // placeholder order disagrees with the values array silently writes the
    // timezone into first_name.
    const columnByPlaceholder = new Map(
      parseClause(update.clause).map(([column, index]) => [index, column]),
    );
    const expected: Record<string, unknown> = {
      first_name: "Yvette",
      timezone: "Europe/London",
      locale: "en-GB",
    };

    expect(update.values).toHaveLength(3);
    update.values.forEach((value, i) => {
      const column = columnByPlaceholder.get(i + 1);
      expect(column).toBeDefined();
      expect(value).toBe(expected[column as string]);
    });
  });

  it("numbers placeholders contiguously from $1 even when keys are dropped", () => {
    // The dropped keys must not consume a placeholder slot; a gap would make
    // every later parameter bind to the wrong position.
    const update = buildUpdate(
      { role: "admin", firstName: "Yvette", id: 999, lastName: "Howard" },
      ALLOWED,
    );
    expect(update).toEqual({
      clause: "first_name = $1, last_name = $2",
      values: ["Yvette", "Howard"],
    });
  });

  it("drops a key that is not in the allowlist", () => {
    // Privilege escalation shape: the body asks to flip a column the route
    // never offered.
    const update = buildUpdate({ firstName: "Yvette", status: "active", role: "admin" }, ALLOWED);
    expect(update).toEqual({ clause: "first_name = $1", values: ["Yvette"] });
    expect(update?.clause).not.toContain("status");
    expect(update?.clause).not.toContain("role");
  });

  it("returns null when nothing in the body is updatable", () => {
    expect(buildUpdate({}, ALLOWED)).toBeNull();
    expect(buildUpdate({ role: "admin", id: 1 }, ALLOWED)).toBeNull();
    expect(buildUpdate({ firstName: "Yvette" }, [])).toBeNull();
  });

  it("drops a key crafted to break out of the SET clause", () => {
    // The one that matters. Column names are the only part of this query that
    // is not a bind parameter, so a key that survives the allowlist check would
    // be concatenated straight into the SQL by every caller.
    const malicious = {
      "id = 1; DROP TABLE leads; --": "x",
      "first_name = 'owned', role = 'admin'": "x",
      "first_name": "Yvette",
    };

    const update = buildUpdate(malicious, ALLOWED);
    expect(update).toEqual({ clause: "first_name = $1", values: ["Yvette"] });
    expect(update?.clause).not.toMatch(/DROP/i);
    expect(update?.clause).not.toContain(";");
    expect(update?.clause).not.toContain("--");
    expect(update?.clause).not.toContain("'");
  });

  it("drops an injection key even when it is the only key", () => {
    expect(buildUpdate({ "id = 1; DROP TABLE leads; --": 1 }, ALLOWED)).toBeNull();
    expect(buildUpdate({ "*": 1, "1=1": 1, "first_name)": 1 }, ALLOWED)).toBeNull();
  });

  it("binds a hostile value instead of putting it in the clause", () => {
    const payload = "'; DROP TABLE leads; --";
    const update = buildUpdate({ firstName: payload }, ALLOWED);

    expect(update?.clause).toBe("first_name = $1");
    expect(update?.values).toEqual([payload]);
    expect(update?.clause).not.toContain(payload);
  });

  it("emits only plain `column = $n` assignments", () => {
    const update = buildUpdate(
      { firstName: "a", lastName: "b", timezone: "c", locale: "d" },
      ALLOWED,
    );
    if (!update) throw new Error("expected an update");
    // parseClause throws on anything that is not a bare bind.
    expect(parseClause(update.clause)).toHaveLength(4);
  });

  it("binds an explicit null rather than skipping the column", () => {
    // Clearing a field is a real edit — "no last name" must reach the database.
    expect(buildUpdate({ lastName: null }, ALLOWED)).toEqual({
      clause: "last_name = $1",
      values: [null],
    });
  });

  it("assigns the same column twice when the body supplies both spellings", () => {
    // Current behaviour, pinned rather than endorsed: callers pass req.body
    // through unfiltered, so a body carrying both spellings produces
    // `sort_order = $1, sort_order = $2`, which Postgres rejects with 42701 and
    // the route surfaces as a 500. Harmless to the data, but it is a 400.
    expect(buildUpdate({ sortOrder: 1, sort_order: 2 }, ALLOWED)).toEqual({
      clause: "sort_order = $1, sort_order = $2",
      values: [1, 2],
    });
  });
});
