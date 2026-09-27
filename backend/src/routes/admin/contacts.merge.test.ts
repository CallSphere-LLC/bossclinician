import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MERGEABLE_TABLES } from "./contacts";

/**
 * A merge deletes the duplicate contact. Any table whose `contact_id` is
 * `ON DELETE SET NULL` and is not re-pointed first loses its link to the person
 * without an error — form replies, coaching sessions and uploaded files vanish
 * from the survivor's card. This reads the migrations so a new reference added
 * later fails here rather than in somebody's merged profile.
 */
const MIGRATIONS = join(__dirname, "../../db/migrations");

function setNullContactTables(): string[] {
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const statement of sql.split(";")) {
      if (!/REFERENCES\s+contacts\s*\(id\)\s+ON DELETE SET NULL/i.test(statement)) continue;
      const altered = /ALTER TABLE\s+(?:IF EXISTS\s+)?(\w+)/i.exec(statement);
      const created = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i.exec(statement);
      const table = (altered ?? created)?.[1];
      if (table) tables.add(table);
    }
  }
  return [...tables].sort();
}

describe("MERGEABLE_TABLES", () => {
  it("re-points every nullable contact reference before the duplicate is deleted", () => {
    const found = setNullContactTables();
    expect(found.length).toBeGreaterThan(5);
    const missing = found.filter((table) => !(MERGEABLE_TABLES as readonly string[]).includes(table));
    expect(missing).toEqual([]);
  });
});
