import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import CeuTerms from "./CeuTerms";
import { kajabiPublicRoutes } from "./routes";
import { footer } from "@/content/site";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

/**
 * QA sheet row 239 (20 Oct 2026): the CE policy page from
 * bossclinician.com/ceu-terms-boss-clinician, at the same path, linked from the
 * footer. The wording is a board-facing policy and must stay as published.
 */
function render(): { html: string; head: HeadDescriptor[] } {
  const head: HeadDescriptor[] = [];
  const html = renderToString(
    <SsrProvider
      runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}
    >
      <StaticRouter location="/ceu-terms-boss-clinician">
        <CeuTerms />
      </StaticRouter>
    </SsrProvider>,
  );
  return { html, head };
}

describe("/ceu-terms-boss-clinician (row 239)", () => {
  it("is a public route at the Kajabi path", () => {
    expect(kajabiPublicRoutes.some((r) => r.path === "/ceu-terms-boss-clinician")).toBe(true);
  });

  it("is linked from the footer's legal links", () => {
    expect(footer.legalLinks.map((l) => l.to)).toContain("/ceu-terms-boss-clinician");
  });

  it("renders the published policy", () => {
    const { html } = render();
    for (const text of [
      "Continuing Education Program Policies",
      "Updated 11/14/2025",
      "strict conformance with Nevada State Board of MFT/LPC and Social Work.",
      "Confidentiality of Participant Information:",
      "Grievance Procedure:",
      "If the grievance concerns [name of organization] in a specific regard",
      "The social work consultant is Yvette Howard Email is ",
      "Confidentiality:",
      "locked files of the Owner &amp; Training Development Officer",
      "CE Program’s written response",
      "Fees, Refunds, and Cancellation",
      "Webinar/ On-demand courses: Due to the digital nature of on-demand courses",
      "Live Online or In-Person Trainings:",
      "You may request a refund up to 7 days prior to the training.",
      "Disclosure or Use of Client Information in a CE Program.",
      "ADA accommodations will be made in accordance with the law",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("prints every contact address as published, each a mailto link", () => {
    const { html } = render();
    for (const email of [
      "yvette@profitableprivatepractice.com",
      "admin@profitableprivatepractices.com",
      "yvette@profitableprivatepractices.com",
      "support@profitableprivatepractices.com",
    ]) {
      expect(html).toContain(`href="mailto:${email}"`);
    }
  });
});
