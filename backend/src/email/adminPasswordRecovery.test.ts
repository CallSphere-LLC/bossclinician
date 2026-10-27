import { describe, expect, it, vi } from "vitest";
const config = vi.hoisted(() => ({ adminOrigin: "https://admin.bossclinician.callsphere.site", publicSiteUrl: "https://bossclinician.callsphere.site" }));
vi.mock("../config/env", () => ({ env: config }));
import { adminPasswordResetEmail } from "./adminPasswordRecovery";
import { passwordReset } from "./memberTemplates";

describe("canonical recovery mail", () => {
  it("uses canonical admin even with a stale alias", () => {
    expect(adminPasswordResetEmail("synthetic", "/admin/offers/7").text).toContain("https://admin.bossclinician.com/admin/reset-password/synthetic?next=%2Fadmin%2Foffers%2F7");
  });
  it("uses the shared canonical helper for member reset mail", () => {
    expect(passwordReset({ firstName: "Synthetic", token: "synthetic", expiresInMinutes: 60, next: "/checkout/offer" }).text).toContain("https://www.bossclinician.com/reset-password/synthetic?next=%2Fcheckout%2Foffer");
  });
  it("never accepts external destinations", () => {
    expect(adminPasswordResetEmail("synthetic", "https://attacker.invalid").text).not.toContain("attacker");
    expect(passwordReset({ firstName: "Synthetic", token: "synthetic", expiresInMinutes: 60, next: "//attacker.invalid" }).text).not.toContain("attacker");
  });
});
