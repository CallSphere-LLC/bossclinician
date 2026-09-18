import { describe, expect, it } from "vitest";
import { adminGoogleErrorMessage } from "@/pages/admin/AdminGoogleButton";

describe("adminGoogleErrorMessage", () => {
  it("has a sentence for each code the server sends", () => {
    for (const code of [
      "google_cancelled",
      "google_unverified",
      "google_failed",
      "google_mismatch",
      "google_disabled",
      "google_no_account",
      "google_mfa",
    ]) {
      expect(adminGoogleErrorMessage(code), code).toEqual(expect.any(String));
    }
    expect(adminGoogleErrorMessage("google_no_account")).toContain("isn't set up as an admin");
  });

  it("says nothing for a code it doesn't know, or for none", () => {
    expect(adminGoogleErrorMessage("google_made_up")).toBeNull();
    expect(adminGoogleErrorMessage("<script>alert(1)</script>")).toBeNull();
    expect(adminGoogleErrorMessage("")).toBeNull();
    expect(adminGoogleErrorMessage(null)).toBeNull();
  });

  it("does not find anything on Object.prototype", () => {
    expect(adminGoogleErrorMessage("constructor")).toBeNull();
    expect(adminGoogleErrorMessage("toString")).toBeNull();
    expect(adminGoogleErrorMessage("__proto__")).toBeNull();
  });
});
