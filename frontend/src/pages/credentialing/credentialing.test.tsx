import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import CredentialForYou from "./CredentialForYou";
import CredentialingIntake from "./CredentialingIntake";
import CredentialingNextSteps from "./CredentialingNextSteps";
import CredentialingRequest from "./CredentialingRequest";
import { credentialingPublicRoutes } from "./routes";
import { PUBLIC_ROUTES } from "@/App";
import { credentialForYou, credentialingIntake, credentialingNextSteps, NO_GUARANTEE_DISCLAIMER, NO_REFUND_POLICY, START_DATE_LINES } from "@/content/credentialForYou";
import { avatarSections } from "@/content/resourceHub";
import { footer, isNavMenu, nav, workWithMeMenu } from "@/content/site";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

/** Sheet row 214, rendered in Node with no `window`, as the server renders it. */
function render(location: string, page: ReactElement): { html: string; head: HeadDescriptor[] } {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}>
      <StaticRouter location={location}>{page}</StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

describe("/credential-for-you", () => {
  const { html, head } = render("/credential-for-you", <CredentialForYou />);

  it("uses her page title", () => {
    expect(head.at(-1)?.title).toBe("Credentialing Support for Mental Health Providers | Boss Clinician");
  });

  it("sends the three paid services to checkout with her labels, and the rest to the request form", () => {
    for (const [slug, label] of [
      ["commercial", "Start Commercial Credentialing"],
      ["medicare", "Start Medicare Credentialing"],
      ["package", "Start My Credentialing Package"],
    ]) {
      expect(html).toContain(`href="/checkout/credential-for-you-${slug}"`);
      expect(html).toContain(label);
    }
    expect(html).not.toContain("credential-for-you-caqh");
    expect(html).not.toContain("credential-for-you-recredentialing");
    const requests = html.match(/href="\/credentialing-request\?service=/g) ?? [];
    expect(requests).toHaveLength(8);
    expect(html).toContain("/credentialing-request?service=Medicaid");
    expect(html).not.toContain("Buy Now");
  });

  it("states the package as a fixed price with her exact scope", () => {
    expect(html).not.toContain("Starting at $1,997");
    expect(html).toContain("$1,997");
    expect(html).toContain("This package includes up to 6 commercial payer applications for one provider.");
    expect(html).toContain(
      "Medicare, Medicaid, TRICARE/federal plans, group enrollment, additional providers, and other enrollment needs outside of this scope are not included and may require a separate service or quote."
    );
    for (const item of ["Routine payer follow-up", "Credentialing tracking", "Final credentialing status summary"]) {
      expect(html).toContain(item);
    }
  });

  it("states her refund policy and disclaimer, promises no refund window, and asks for no banking details", () => {
    expect(html).toContain(NO_REFUND_POLICY);
    expect(html).toContain(NO_GUARANTEE_DISCLAIMER);
    expect(html).not.toMatch(/14[- ]day|within 14|Banking/i);
  });

  it("carries the start-date language and the anchor the checkout box links to", () => {
    for (const line of START_DATE_LINES) expect(html).toContain(escaped(line));
    expect(html).toContain('id="disclaimer"');
    expect(html).toContain(escaped(credentialForYou.disclaimer.title));
  });

  it("sets prices in the body font", () => {
    expect(html).toMatch(/class="[^"]*font-body[^"]*tabular-nums[^"]*"[^>]*>\$225 per payer/);
  });
});

describe("the page after purchase", () => {
  const { html, head } = render("/credentialing-next-steps", <CredentialingNextSteps />);

  it("has her copy, the intake button, and is noindex", () => {
    expect(head.at(-1)?.noindex).toBe(true);
    expect(html).toContain("What Happens Next");
    expect(html).toContain("After completing your intake, a member of our credentialing team will review your information.");
    expect(html).toContain(
      "Allondra from Boss Clinician will contact you at the email address provided during checkout with your service agreement and instructions for submitting the additional information and documentation needed for your credentialing application."
    );
    expect(html).toContain("Please watch for an email from:");
    expect(html).toContain('href="mailto:allondra@bossclinician.com"');
    expect(html).toContain("Your credentialing timeline begins once your intake is complete, your service agreement is completed, and all required documents and information have been received.");
    expect(html).toContain('href="/credentialing-intake"');
    expect(html).toContain(credentialingNextSteps.cta);
  });
});

describe("the forms", () => {
  it("preselects only a service the form offers", () => {
    const { html } = render("/credentialing-request?service=Medicaid", <CredentialingRequest />);
    expect(html).toMatch(/<option[^>]*value="Medicaid"[^>]*selected|<option[^>]*selected[^>]*value="Medicaid"/);
    const { html: forged } = render("/credentialing-request?service=Free", <CredentialingRequest />);
    expect(forged).not.toContain("Free");
  });

  it("never asks for banking details, an SSN or a date of birth", () => {
    const asked = credentialingIntake.fields.map((field) => `${field.key} ${field.key === "tax_id" ? "" : field.label}`).join(" ");
    expect(asked).not.toMatch(/bank|routing|account number|\bssn\b|social security|birth|\bdob\b/i);
    expect(render("/credentialing-intake", <CredentialingIntake />).head.at(-1)?.noindex).toBe(true);
  });
});

describe("where it lives", () => {
  it("is routed", () => {
    const paths = PUBLIC_ROUTES.map((route) => route.path);
    for (const route of credentialingPublicRoutes) expect(paths).toContain(route.path);
  });

  it("sits under Resources and the footer, and not with the programs", () => {
    const resources = nav.find((entry) => entry.label === "Resources");
    expect(resources && isNavMenu(resources) ? resources.items.map((item) => item.to) : []).toEqual(
      expect.arrayContaining(["/resource-hub", "/credential-for-you", "/courses/credential-with-confidence"]),
    );
    expect(workWithMeMenu.items.some((item) => item.to === "/credential-for-you")).toBe(false);
    expect(footer.resourceLinks.some((link) => link.to === "/credential-for-you")).toBe(true);
    const card = avatarSections.flatMap((section) => section.cards).find((item) => item.href === "/credential-for-you");
    expect(card?.ctaLabel).toBe("Explore Credentialing Support");
  });
});
