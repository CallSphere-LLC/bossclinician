import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import CredentialWithConfidence from "./CredentialWithConfidence";
import { SsrProvider } from "@/ssr/context";
import { ssrKeys } from "@/ssr/keys";
import { credentialWithConfidence as cwc } from "@/content/credentialWithConfidence";

describe("Credentialing standalone sales route", () => {
  it("renders the standalone price and excludes bundle checkout prices", () => {
    const course = {
      slug: "credential-with-confidence", title: "Credentialing with Confidence",
      modules: [], image: "", owned: false, priceText: "$127",
      offers: [
        { slug: "credential-with-confidence", amountCents: 12700 },
        { slug: "the-lounge", amountCents: 199700 },
        { slug: "the-lounge-vip", amountCents: 349700 },
      ].map(o => ({ ...o, id: o.slug, available: true, currency: "usd", pricingType: "one_time" })),
    };
    const html = renderToStaticMarkup(
      <SsrProvider runtime={{ payload: { origin:"https://example.test", indexable:true,
        data:{[ssrKeys.courseDetail(course.slug)]:course}},headSink:[] }}>
        <StaticRouter location={"/courses/"+course.slug}><CredentialWithConfidence /></StaticRouter>
      </SsrProvider>);
    expect(html).toContain("$127");
    expect(html).toContain('href="/checkout/credential-with-confidence"');
    expect(html).not.toContain("$1,997");
    expect(html).not.toContain("$3,497");
    expect(html).not.toContain('href="/checkout/the-lounge');
  });
  it("uses the 21 Nov 2026 headline and describes skills, not paid claims", () => {
    expect(`${cwc.hero.title} ${cwc.hero.titleAccent}`).toBe("Understand Insurance Enrollment and Ethical Billing, Step by Step.");
    for (const text of [cwc.hero.sub, cwc.seo.description]) {
      expect(text).toContain("Learn how to prepare enrollment information, track applications, and review billing practices.");
      expect(text).not.toContain("claims get paid");
    }
    expect(cwc.compliance).toContain("1.75 NBCC Clock Hours");
  });
});
