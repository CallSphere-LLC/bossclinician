import { describe, expect, it } from "vitest";
import { recoveryDestination, withRecoveryNext } from "./passwordRecoveryLinks";

describe("recovery return paths", () => {
  it.each(["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%2f%2fevil.invalid", "/login", "/forgot-password", "/reset-password/token", "/admin/offers"])("member rejects %s", path => {
    expect(recoveryDestination("member", path)).toBe("/library");
  });
  it.each(["https://evil.invalid/admin", "//evil.invalid/admin", "/admin/../../evil", "/admin/%2e%2e/checkout", "/admin/login", "/admin/reset-password/token", "/admin/forgot-password", "/checkout/offer", "/administrator"])("admin rejects %s", path => {
    expect(recoveryDestination("admin", path)).toBe("/admin");
  });
  it.each([["member", "/checkout/offer?plan=annual#details"], ["admin", "/admin/offers/42?tab=pricing#form"]] as const)("%s carries destination through each recovery page", (kind, destination) => {
    let next = destination;
    for (const page of ["/forgot-password", "/reset-password/token", "/login"]) {
      const url = new URL(withRecoveryNext(page, kind, next), "https://test.invalid");
      next = recoveryDestination(kind, url.searchParams.get("next")) as typeof destination;
      expect(next).toBe(destination);
    }
  });
});
