import { describe, expect, it } from "vitest";
import { adminOperationRequestSchema } from "./adminCatalog";
import { prepareAdminOperation } from "../../services/voice/adminCatalog";

describe("admin operation identifiers from tool calls", () => {
  it("normalizes the actual numeric update payload before route preparation", () => {
    const payload = { resource: "tags", action: "update", id: 62, body: { description: "verified exact-payload update" } };
    const numeric = prepareAdminOperation(adminOperationRequestSchema.parse(payload));
    const text = prepareAdminOperation(adminOperationRequestSchema.parse({ ...payload, id: "62" }));
    expect(numeric).toEqual(text);
    expect(numeric).toMatchObject({ path: "/admin/tags/62", method: "PUT", body: payload.body });
  });
  it("preserves page slugs exactly and accepts safe numeric delete ids", () => {
    expect(adminOperationRequestSchema.parse({ resource: "pages", action: "update", id: "home-page" }).id).toBe("home-page");
    expect(prepareAdminOperation(adminOperationRequestSchema.parse({ resource: "tags", action: "delete", id: 62 }))).toMatchObject({ path: "/admin/tags/62", method: "DELETE" });
  });
  it("refuses fractional, nonpositive, unsafe and nonfinite numeric identifiers", () => {
    for (const id of [0, -1, 1.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(adminOperationRequestSchema.safeParse({ resource: "tags", action: "update", id }).success).toBe(false);
    }
  });
});
