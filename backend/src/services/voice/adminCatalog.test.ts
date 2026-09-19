import { describe, expect, it } from "vitest";
import { ADMIN_RESOURCES, adminCatalog, prepareAdminOperation } from "./adminCatalog";

describe("admin operation catalog", () => {
  it("uses actual route validators for all exposed schemas", () => {
    for (const resource of ADMIN_RESOURCES) {
      expect(adminCatalog(resource.key, "update")).toHaveProperty("schema");
      expect(adminCatalog(resource.key, "update")).toHaveProperty("action", "update");
      if (resource.create) expect(adminCatalog(resource.key, "create")).toHaveProperty("schema");
    }
  });
  it("validates before the approval card and preserves the actual route and method", () => {
    expect(prepareAdminOperation({ resource: "tags", action: "create", body: { name: "  QA  " } })).toEqual({ resource: "tags", action: "create", path: "/admin/tags", method: "POST", body: { name: "QA" } });
    expect(prepareAdminOperation({ resource: "events", action: "update", id: "7", body: { title: "New title" } })).toMatchObject({ path: "/admin/events/7", method: "PATCH" });
    expect(() => prepareAdminOperation({ resource: "tags", action: "create", body: {} })).toThrow();
  });
  it("refuses unknown endpoints and traversal instead of forwarding arbitrary API requests", () => {
    for (const id of ["../admins", "1?x=2", "https://external.test", "0", "1/2"]) {
      expect(() => prepareAdminOperation({ resource: "tags", action: "delete", id })).toThrow();
    }
    expect(() => prepareAdminOperation({ resource: "admins", action: "create", body: {} })).toThrow();
    expect(() => prepareAdminOperation({ resource: "pages", action: "delete", id: "home" })).toThrow();
  });
});
