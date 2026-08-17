import { describe, expect, it } from "vitest";
import { compileSegment } from "./segments";
import { HttpError } from "../utils/httpError";

/**
 * A segment definition is JSON an admin screen writes, stored in a column and
 * evaluated later by a background job. That makes it the one place in this
 * codebase where attacker-shaped data could plausibly become SQL, so these
 * tests are about the compiler refusing rather than about it working.
 *
 * The assertions read the generated SQL text on purpose: "it returned the right
 * contacts" would still pass if the field name had been concatenated in.
 */

function expectRejected(definition: unknown): void {
  let thrown: unknown;
  try {
    compileSegment(definition);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(HttpError);
  expect((thrown as HttpError).status).toBe(400);
}

describe("compileSegment", () => {
  it("matches everyone when there are no rules", () => {
    expect(compileSegment({ match: "all", rules: [] })).toEqual({ where: "TRUE", params: [] });
  });

  it("binds a text value rather than writing it into the SQL", () => {
    const compiled = compileSegment({
      match: "all",
      rules: [{ field: "email", op: "contains", value: "Yvette@Example.com" }],
    });

    expect(compiled.where).toBe("(lower(c.email::text) LIKE $1)");
    expect(compiled.params).toEqual(["%yvette@example.com%"]);
  });

  it("escapes the characters LIKE treats as wildcards", () => {
    const compiled = compileSegment({
      rules: [{ field: "name", op: "contains", value: "100%_off" }],
    });

    expect(compiled.params).toEqual(["%100\\%\\_off%"]);
  });

  it("joins with AND for 'all' and OR for 'any', numbering parameters in order", () => {
    const all = compileSegment({
      match: "all",
      rules: [
        { field: "order_count", op: "gt", value: 2 },
        { field: "lifetime_value_cents", op: "lt", value: 50000 },
      ],
    });
    expect(all.where).toBe("(c.order_count > $1) AND (c.lifetime_value_cents < $2)");
    expect(all.params).toEqual([2, 50000]);

    const any = compileSegment({
      match: "any",
      rules: [
        { field: "order_count", op: "eq", value: 0 },
        { field: "email_marketing_status", op: "eq", value: "opted_out" },
      ],
    });
    expect(any.where).toBe("(c.order_count = $1) OR (c.email_marketing_status = $2)");
    expect(any.params).toEqual([0, "opted_out"]);
  });

  it("expresses tags as an EXISTS over contact_tags, with the slug bound", () => {
    const has = compileSegment({ rules: [{ field: "tag", op: "has", value: "Bali-2027-Attendee" }] });
    expect(has.where).toContain("EXISTS (SELECT 1 FROM contact_tags");
    expect(has.where).toContain("t.slug = $1::citext");
    expect(has.where.startsWith("(NOT ")).toBe(false);
    expect(has.params).toEqual(["bali-2027-attendee"]);

    const lacks = compileSegment({ rules: [{ field: "tag", op: "not_has", value: "vip" }] });
    expect(lacks.where.startsWith("(NOT EXISTS")).toBe(true);
  });

  it("counts only settled orders for a purchase rule", () => {
    const compiled = compileSegment({
      rules: [{ field: "purchased_offer", op: "has", value: 12 }],
    });
    expect(compiled.where).toContain("o.offer_id = $1");
    expect(compiled.where).toContain("o.status = 'paid'");
    expect(compiled.params).toEqual([12]);
  });

  it("treats a contact who has never been active as matching 'last active before'", () => {
    const compiled = compileSegment({
      rules: [{ field: "last_activity_at", op: "before", value: "2026-01-01T00:00:00.000Z" }],
    });
    expect(compiled.where).toBe("((c.last_activity_at IS NULL OR c.last_activity_at < $1))");
    expect(compiled.params[0]).toBeInstanceOf(Date);
  });

  it("refuses a field nobody built instead of interpolating it", () => {
    expectRejected({ rules: [{ field: "password_hash", op: "eq", value: "x" }] });
    expectRejected({
      rules: [{ field: "id) OR 1=1 --", op: "eq", value: "x" }],
    });
    // Inherited properties are not fields: `constructor` and `toString` live on
    // every object, and a plain `in` check would have let them through.
    expectRejected({ rules: [{ field: "constructor", op: "eq", value: "x" }] });
    expectRejected({ rules: [{ field: "__proto__", op: "eq", value: "x" }] });
  });

  it("refuses an operator the field does not offer", () => {
    expectRejected({ rules: [{ field: "email", op: "gt", value: "a" }] });
    expectRejected({ rules: [{ field: "tag", op: "contains", value: "a" }] });
    expectRejected({ rules: [{ field: "order_count", op: "= 1; DROP TABLE contacts; --", value: 1 }] });
  });

  it("refuses a value of the wrong shape", () => {
    expectRejected({ rules: [{ field: "order_count", op: "gt", value: "lots" }] });
    expectRejected({ rules: [{ field: "created_at", op: "after", value: "not a date" }] });
    expectRejected({ rules: [{ field: "email", op: "eq", value: 42 }] });
    expectRejected({ rules: [{ field: "purchased_offer", op: "has", value: 1.5 }] });
    expectRejected({ rules: [{ field: "email_marketing_status", op: "eq", value: "unsubscribed" }] });
  });

  it("refuses a definition that is not a rule list at all", () => {
    expectRejected({ match: "either", rules: [] });
    expectRejected({ rules: "everyone" });
    expectRejected({ rules: [{ field: "", op: "eq", value: "x" }] });
  });
});
