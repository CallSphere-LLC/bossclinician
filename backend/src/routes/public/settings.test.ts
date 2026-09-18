import { describe, it, expect } from "vitest";
import { publicView, withComputedFlags } from "./settings";

/**
 * The public settings endpoint is unauthenticated, and the settings table holds
 * a Turnstile secret, an email-provider webhook secret and a Meta access token.
 * Before this allow-list existed it returned every row to anyone who asked.
 *
 * These tests pin the boundary. A new secret added to a seeded key is invisible
 * to the public site until somebody adds it below deliberately — the point is
 * that the failure mode is "a field is missing", never "a secret is published".
 */
describe("publicView", () => {
  it("passes through keys that are pure presentation", () => {
    expect(publicView("nav", { items: [1, 2] })).toEqual({ items: [1, 2] });
    expect(publicView("footer", { text: "x" })).toEqual({ text: "x" });
    expect(publicView("branding", { logoUrl: "/a.png" })).toEqual({ logoUrl: "/a.png" });
  });

  it("hides a key that is not on the list at all", () => {
    // Every one of these carries something a visitor has no business reading.
    for (const key of ["notifications", "tax", "customer_payments", "drip", "scheduling"]) {
      expect(publicView(key, { anything: true })).toBeUndefined();
    }
  });

  it("publishes the Turnstile site key and withholds its secret", () => {
    const view = publicView("form_settings", {
      spamProtection: "turnstile",
      turnstileSiteKey: "0x4AAA-public",
      turnstileSecret: "0x4AAA-SECRET",
    }) as Record<string, unknown>;

    expect(view.turnstileSiteKey).toBe("0x4AAA-public");
    expect(view.spamProtection).toBe("turnstile");
    expect(view).not.toHaveProperty("turnstileSecret");
    expect(JSON.stringify(view)).not.toContain("SECRET");
  });

  it("publishes analytics ids and withholds the Meta access token", () => {
    const view = publicView("analytics", {
      ga4MeasurementId: "G-123",
      metaPixelId: "456",
      metaAccessToken: "EAAG-SECRET-TOKEN",
    }) as Record<string, unknown>;

    expect(view).toEqual({ ga4MeasurementId: "G-123", metaPixelId: "456" });
    expect(JSON.stringify(view)).not.toContain("EAAG");
  });

  it("withholds the email provider's webhook secret entirely", () => {
    // `email_provider` is not on the list at all — nothing in it is public.
    expect(publicView("email_provider", { provider: "resend", webhookSecret: "whsec_x" }))
      .toBeUndefined();
  });

  it("publishes only the postal address from marketing email settings", () => {
    const view = publicView("marketing_email", {
      address: "123 Main St",
      fromEmail: "yvette@example.com",
      replyTo: "private@example.com",
    });
    // The address is required in a marketing footer by CAN-SPAM; the sending
    // addresses are not, and are worth harvesting.
    expect(view).toEqual({ address: "123 Main St" });
  });

  it("does not invent fields the stored value does not have", () => {
    expect(publicView("checkout", { supportEmail: "a@b.c" })).toEqual({ supportEmail: "a@b.c" });
  });

  it("refuses a non-object value for a field-filtered key", () => {
    // A malformed row must not fall through to being published whole.
    expect(publicView("analytics", "not-an-object")).toBeUndefined();
    expect(publicView("analytics", null)).toBeUndefined();
  });

  it("cannot be reached through a prototype key", () => {
    // The allow-list is a plain object literal, so these inherit from Object;
    // the lookup must not treat that as membership.
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(publicView(key, { leaked: true })).toBeUndefined();
    }
  });
});

/**
 * `googleEnabled` is computed from the environment, not read from the table, so
 * it takes a different road from everything above — and it is the one value the
 * sign-in screen needs even when the table has nothing to say about signing in.
 */
describe("withComputedFlags", () => {
  it("adds the flag beside what the allow-list already published", () => {
    const merged = { member_signin: publicView("member_signin", { magicLinkEnabled: true }), nav: { items: [] } };
    expect(withComputedFlags(merged, { googleEnabled: true })).toEqual({
      member_signin: { magicLinkEnabled: true, googleEnabled: true },
      nav: { items: [] },
    });
  });

  it("publishes the flag when there is no member_signin row at all", () => {
    expect(withComputedFlags({}, { googleEnabled: false })).toEqual({ member_signin: { googleEnabled: false } });
    expect(withComputedFlags({ member_signin: "junk" }, { googleEnabled: true })).toEqual({
      member_signin: { googleEnabled: true },
    });
  });

  it("never lets a stored value stand in for the computed one", () => {
    // Not reachable through publicView, which drops the field — this pins the
    // order of the spread in case the allow-list ever grows it by mistake.
    const view = withComputedFlags({ member_signin: { googleEnabled: true } }, { googleEnabled: false });
    expect(view.member_signin).toEqual({ googleEnabled: false });
  });

  it("publishes a boolean and nothing about the credentials behind it", () => {
    const view = withComputedFlags({}, { googleEnabled: true });
    expect(Object.keys(view.member_signin as object)).toEqual(["googleEnabled"]);
  });
});
