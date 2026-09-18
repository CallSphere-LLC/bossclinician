import { describe, expect, it, vi } from "vitest";
import { auditLogQuerySchema, buildAuditFilters, escapeLike } from "./auditLog";

// The router module imports the pool, and the pool wants a database URL that has
// nothing to do with building a WHERE clause.
vi.mock("../../db/pool", () => ({ pool: { query: vi.fn() } }));

/**
 * The audit log's filters are typed by a person into a search box and end up in
 * SQL. Two things have to hold: every value travels as a parameter, and a `%`
 * or `_` she types is a character to find rather than a wildcard.
 */

describe("escapeLike", () => {
  it("defuses the LIKE wildcards and the escape character itself", () => {
    expect(escapeLike("50%_off")).toBe("50\\%\\_off");
    expect(escapeLike("a\\b")).toBe("a\\\\b");
    expect(escapeLike("offer.grant")).toBe("offer.grant");
  });
});

describe("buildAuditFilters", () => {
  it("has no WHERE clause when nothing is filtered", () => {
    expect(buildAuditFilters({})).toEqual({ where: "", params: [] });
  });

  it("matches the action as a prefix and the actor anywhere in the address", () => {
    const { where, params } = buildAuditFilters({ actor: "yvette", action: "offer." });
    expect(where).toBe("WHERE a.admin_email ILIKE $1 AND a.action LIKE $2");
    expect(params).toEqual(["%yvette%", "offer.%"]);
  });

  it("numbers every parameter in order, and never inlines a value", () => {
    const from = new Date("2026-09-01T00:00:00Z");
    const to = new Date("2026-09-30T23:59:59Z");
    const { where, params } = buildAuditFilters({
      actor: "a",
      action: "b",
      entityType: "offer",
      entityId: "12",
      from,
      to,
    });
    expect(where).toBe(
      "WHERE a.admin_email ILIKE $1 AND a.action LIKE $2 AND a.entity_type = $3 " +
        "AND a.entity_id = $4 AND a.created_at >= $5 AND a.created_at <= $6"
    );
    expect(params).toEqual(["%a%", "b%", "offer", "12", from, to]);
  });

  it("treats a typed underscore as an underscore", () => {
    const { params } = buildAuditFilters({ action: "_" });
    expect(params).toEqual(["\\_%"]);
  });
});

describe("auditLogQuerySchema", () => {
  it("defaults to the first page of fifty", () => {
    const parsed = auditLogQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(50);
  });

  it("refuses a page size that would dump the table", () => {
    expect(auditLogQuerySchema.safeParse({ limit: "5000" }).success).toBe(false);
  });

  it("reads dates from the query string", () => {
    const parsed = auditLogQuerySchema.parse({ from: "2026-09-01T00:00:00.000Z" });
    expect(parsed.from).toBeInstanceOf(Date);
  });
});
