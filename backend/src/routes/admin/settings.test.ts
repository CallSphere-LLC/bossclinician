import { describe, it, expect } from "vitest";
import { keepStoredSecrets, withoutSecrets } from "./settings";

/**
 * The settings screen this endpoint serves reads the whole table and posts back
 * whatever it was given. Three keys hold a credential beside their ordinary
 * fields, and the newer settings screen is built on the promise that those
 * never leave the server once saved — so this one has to strip them on the way
 * out and put them back on the way in, or the first save would blank all three.
 */
describe("withoutSecrets", () => {
  it("keeps the site key and drops the Turnstile secret", () => {
    expect(
      withoutSecrets("form_settings", {
        spamProtection: "turnstile",
        turnstileSiteKey: "0x4AAA-public",
        turnstileSecret: "0x4AAA-SECRET",
      })
    ).toEqual({ spamProtection: "turnstile", turnstileSiteKey: "0x4AAA-public" });
  });

  it("drops the Meta access token and the email provider's signing secret", () => {
    expect(withoutSecrets("analytics", { metaPixelId: "1", metaAccessToken: "EAAG-SECRET" })).toEqual({
      metaPixelId: "1",
    });
    expect(
      withoutSecrets("email_provider", { provider: "ses", webhookSecret: "whsec_SECRET" })
    ).toEqual({ provider: "ses" });
  });

  it("leaves a key with no secret fields exactly as it was", () => {
    const nav = [{ label: "Home", href: "/" }];
    expect(withoutSecrets("nav", nav)).toBe(nav);
    expect(withoutSecrets("branding", { logoUrl: "/a.png" })).toEqual({ logoUrl: "/a.png" });
  });
});

describe("keepStoredSecrets", () => {
  it("puts back a secret the body did not carry", () => {
    expect(
      keepStoredSecrets(
        "analytics",
        { metaPixelId: "2" },
        { metaPixelId: "1", metaAccessToken: "EAAG-SECRET" }
      )
    ).toEqual({ metaPixelId: "2", metaAccessToken: "EAAG-SECRET" });
  });

  it("lets a body that carries one overwrite it, blank included", () => {
    expect(
      keepStoredSecrets(
        "analytics",
        { metaAccessToken: "" },
        { metaAccessToken: "EAAG-SECRET" }
      )
    ).toEqual({ metaAccessToken: "" });
  });

  it("changes nothing for a key with no secret fields", () => {
    const incoming = { logoUrl: "/b.png" };
    expect(keepStoredSecrets("branding", incoming, { logoUrl: "/a.png" })).toBe(incoming);
  });

  it("changes nothing when there is no stored row yet", () => {
    const incoming = { metaPixelId: "2" };
    expect(keepStoredSecrets("analytics", incoming, undefined)).toBe(incoming);
  });
});
