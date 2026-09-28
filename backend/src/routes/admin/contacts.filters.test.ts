import { describe, expect, it } from "vitest";
import { buildFilters, exportQuerySchema } from "./contacts";

/**
 * The CSV is the People list as a file, and it is built from the same
 * `buildFilters` the list uses — so the only thing deciding whether the two
 * agree is which keys the export schema admits. `z.object` strips what it was
 * not told about, which makes a missing key a silently wider export rather than
 * a rejected request: the screen sends the filters it is showing, the parse
 * drops them, and the file comes back with every contact in it.
 */
describe("exportQuerySchema", () => {
  it("keeps every filter the People screen can send", () => {
    const parsed = exportQuerySchema.parse({
      q: "jane",
      tag: "retreat",
      status: "opted_out",
      untagged: "false",
      community: "true",
      audience: "customer",
      optOut: "self",
      engagement: "inactive",
      segment: "customers",
      filters: '[{"category":"tags","op":"has","value":"vip"}]',
    });

    expect(parsed).toEqual({
      q: "jane",
      tag: "retreat",
      status: "opted_out",
      untagged: false,
      community: true,
      audience: "customer",
      optOut: "self",
      engagement: "inactive",
      segment: "customers",
      filters: '[{"category":"tags","op":"has","value":"vip"}]',
    });
  });

  it("turns each of them into a clause rather than exporting the whole list", () => {
    const { where } = buildFilters(exportQuerySchema.parse({ community: "true" }));
    expect(where).toContain("community_memberships");
    expect(where).toContain("cm.banned_at IS NULL");

    // The three insight tiles link straight to a filtered list with an Export
    // button on it. Dropping these handed back everybody, including the people
    // who had just been filtered out.
    expect(buildFilters(exportQuerySchema.parse({ optOut: "self" })).where).toContain(
      "c.consent_source NOT IN ('admin','manual')",
    );
    expect(buildFilters(exportQuerySchema.parse({ audience: "customer" })).where).toContain(
      "c.order_count > 0",
    );
    expect(buildFilters(exportQuerySchema.parse({ engagement: "inactive" })).where).toContain(
      "270 days",
    );
  });

  it("exports everyone but the team and test accounts when nothing is filtered", () => {
    // 415 people, as Kajabi counts them: the nine team and test accounts
    // (migration 075) are not part of her audience.
    expect(buildFilters(exportQuerySchema.parse({})).where).toBe("WHERE NOT c.is_internal");
  });

  it("refuses a filter value the list would refuse", () => {
    expect(exportQuerySchema.safeParse({ community: "yes" }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ optOut: "everyone" }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ segment: "everyone" }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ status: "never_subscribed" }).success).toBe(true);
  });

  it("carries the Kajabi segment and filter rows into the file", () => {
    const { where, params } = buildFilters({
      segment: "hard_bounced",
      rows: [{ category: "tags", op: "has", value: "vip", text: "" }],
      timeZone: "America/Los_Angeles",
    });
    expect(where).toContain("c.email_marketing_status = 'bounced'");
    expect(where).toContain("t.slug = $1::citext");
    expect(params).toEqual(["vip"]);
  });

  it("shows only the team and test accounts when that segment is chosen", () => {
    expect(buildFilters({ segment: "team" }).where).toBe("WHERE c.is_internal");
  });
});

/** Every clause carries its own bind parameter; nothing user-typed is interpolated. */
describe("buildFilters", () => {
  it("binds the search term and the tag rather than writing them into the SQL", () => {
    const { where, params } = buildFilters({ q: "100%_x", tag: "retreat" });
    expect(where).not.toContain("100%");
    expect(params).toEqual(["%100\\%\\_x%", "retreat"]);
  });

  it("numbers the filter rows after the search and tag", () => {
    const { where, params } = buildFilters({
      q: "sam",
      tag: "retreat",
      rows: [{ category: "lifetime_value", op: "gt", value: "100", text: "" }],
    });
    expect(where).toContain("c.lifetime_value_cents > $3");
    expect(params).toEqual(["%sam%", "retreat", 10000]);
  });
});
