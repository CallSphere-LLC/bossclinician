import { describe, expect, it } from "vitest";
import {
  MODULES,
  ROLES,
  ROLE_DESCRIPTORS,
  can,
  isRole,
  limitedToOwnRecords,
  permissionsForRole,
  type Permission,
} from "./permissions";

/**
 * The permission matrix is the only thing standing between "the coach can see
 * the coaching calendar" and "the coach can read every customer's card
 * history". It is data, so it is worth asserting as data — particularly the
 * negatives, which is where a new module quietly added to the wrong role list
 * would otherwise go unnoticed.
 */

describe("can", () => {
  it("gives the owner everything", () => {
    for (const module of MODULES) {
      expect(can("owner", `${module}.view`)).toBe(true);
      expect(can("owner", `${module}.manage`)).toBe(true);
    }
    expect(can("owner", "orders.refund_request")).toBe(true);
  });

  it("gives a manager everything except handing out admin accounts", () => {
    expect(can("admin", "settings.manage")).toBe(true);
    expect(can("admin", "orders.manage")).toBe(true);
    expect(can("admin", "admins.view")).toBe(true);
    expect(can("admin", "admins.manage")).toBe(false);
  });

  it("keeps marketing to contacts, marketing and the website", () => {
    expect(can("marketing", "contacts.manage")).toBe(true);
    expect(can("marketing", "marketing.manage")).toBe(true);
    expect(can("marketing", "website.manage")).toBe(true);

    expect(can("marketing", "orders.manage")).toBe(false);
    expect(can("marketing", "orders.refund_request")).toBe(false);
    expect(can("marketing", "settings.view")).toBe(false);
    expect(can("marketing", "settings.manage")).toBe(false);
    expect(can("marketing", "admins.manage")).toBe(false);
  });

  it("lets support look and ask for a refund, and nothing else", () => {
    expect(can("support", "contacts.view")).toBe(true);
    expect(can("support", "orders.view")).toBe(true);
    expect(can("support", "orders.refund_request")).toBe(true);

    expect(can("support", "contacts.manage")).toBe(false);
    expect(can("support", "orders.manage")).toBe(false);
    expect(can("support", "settings.view")).toBe(false);
    expect(can("support", "settings.manage")).toBe(false);
    expect(can("support", "marketing.manage")).toBe(false);
  });

  it("confines a coach to coaching", () => {
    expect(can("coach", "coaching.view")).toBe(true);
    expect(can("coach", "coaching.manage")).toBe(true);

    for (const module of MODULES) {
      if (module === "coaching") continue;
      expect(can("coach", `${module}.view`)).toBe(false);
      expect(can("coach", `${module}.manage`)).toBe(false);
    }
    expect(can("coach", "orders.refund_request")).toBe(false);
  });

  it("scopes a coach to their own records inside the module they do own", () => {
    expect(limitedToOwnRecords("coach")).toBe(true);
    for (const role of ROLES) {
      if (role !== "coach") expect(limitedToOwnRecords(role)).toBe(false);
    }
  });

  it("fails closed on a role it has never heard of", () => {
    expect(can("", "contacts.view")).toBe(false);
    expect(can("superuser", "contacts.view")).toBe(false);
    expect(can("OWNER", "contacts.view")).toBe(false);
    expect(permissionsForRole("superuser")).toEqual([]);
  });

  it("only settings.manage reaches settings, for exactly two roles", () => {
    const allowed = ROLES.filter((role) => can(role, "settings.manage"));
    expect(allowed).toEqual(["owner", "admin"]);
  });

  it("only the owner may change who has an account", () => {
    const allowed = ROLES.filter((role) => can(role, "admins.manage"));
    expect(allowed).toEqual(["owner"]);
  });
});

describe("the matrix as a whole", () => {
  it("grants manage only where it also grants view", () => {
    for (const role of ROLES) {
      const held = new Set<Permission>(permissionsForRole(role));
      for (const module of MODULES) {
        if (held.has(`${module}.manage`)) expect(held.has(`${module}.view`)).toBe(true);
      }
    }
  });

  it("describes every role in plain English for the Team screen", () => {
    expect(ROLE_DESCRIPTORS.map((d) => d.role).sort()).toEqual([...ROLES].sort());
    for (const descriptor of ROLE_DESCRIPTORS) {
      expect(descriptor.label).not.toBe(descriptor.role);
      expect(descriptor.summary.length).toBeGreaterThan(10);
      expect(descriptor.canDo.length).toBeGreaterThan(0);
      // No permission strings leaking onto a non-technical screen.
      const words = [descriptor.summary, ...descriptor.canDo, ...descriptor.cannotDo].join(" ");
      expect(words).not.toMatch(/\.(view|manage)\b/);
    }
  });

  it("recognises exactly the roles the database allows", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("root")).toBe(false);
  });
});
