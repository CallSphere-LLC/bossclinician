import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { readFileSync } from "node:fs";
import ImportedSalesPage from "./ImportedSalesPage";
import type { CourseDetailResponse } from "./CoursePriceLabel";
const slugs = ["provider-partnership-guide", "private-practice-protection-pack", "from-profile-to-profit"];
const fixture = (slug: string, available=true, owned=false, amountCents=9700) => ({
  slug, owned, priceText:"$97", offers:[{slug,available,amountCents,currency:"usd",pricingType:"one_time"}],
}) as CourseDetailResponse;
const render = (c: CourseDetailResponse) => renderToStaticMarkup(<MemoryRouter><ImportedSalesPage course={c}/></MemoryRouter>);
describe("imported sales page purchase boundaries", () => {
  for (const slug of slugs) {
    it(slug+" follows live pricing, ownership and availability", () => {
      const live=render(fixture(slug,true,false,4700));
      expect(live).toContain("$47");
      expect(live).not.toContain("$97");
      expect(live).toContain('href="/checkout/'+slug+'"');
      expect(live).not.toMatch(/__SOURCE_|resource_redirect\/offers|thrivecart.com/);
      expect(render(fixture(slug,true,true))).toContain('href="/library/'+slug+'"');
      const unavailable=render(fixture(slug,false));
      expect(unavailable).not.toContain('href="/checkout/');
      expect(unavailable).toContain('aria-disabled="true"');
    });
  }
  it("offers Profile to Profit only as one payment", () => {
    const html=render(fixture(slugs[2]));
    expect(html).not.toContain("2 MONTHLY PAYMENTS");
    expect(html).not.toContain("$50");
    expect(html).toContain("ONE TIME PAYMENT");
  });
  it("starter suite follows live pricing and drops source-only compare-at lines", () => {
    const slug="private-practice-starter-suite";
    const source=render(fixture(slug,true,false,2700));
    expect(source).toContain("ONLY $27 TODAY");
    expect(source).toContain("USUALLY $197");
    expect(source).toContain('href="/checkout/'+slug+'"');
    expect(source).not.toMatch(/__SOURCE_|resource_redirect\/offers|thrivecart.com|bossclinician\.com\/offers/);
    const live=render(fixture(slug,true,false,3300));
    expect(live).toContain("ONLY $33 TODAY");
    expect(live).toContain("TRAINING FOR $33");
    expect(live).not.toContain("ONLY $27 TODAY");
    expect(live).not.toContain("USUALLY $197");
    expect(live).not.toContain("SAVING $170");
    expect(render(fixture(slug,true,true))).toContain('href="/library/'+slug+'"');
    const unavailable=render(fixture(slug,false));
    expect(unavailable).not.toContain('href="/checkout/');
    expect(unavailable).toContain('aria-disabled="true"');
    expect(unavailable).toContain("Start Today With Clarity");
  });
  it("starter suite keeps the owner's source sections and removed bonus", () => {
    const html=render(fixture("private-practice-starter-suite"));
    for(const text of ["Check All Of The Questions","CAN YOU RELATE?","IMAGINE THIS:","3 Power-Packed Video Lessons",
      "ACTION ORIENTED RESOURCES!","What Students Are Saying","Meet Yvette Howard","Everything You’ll Get",
      "Frequently Asked Questions","DISCLAIMER:"]) expect(html).toContain(text);
    expect(html).not.toContain("Pricing Formula Cheat Sheet");
    expect(html).toContain('data-source-video="3mmz1sj272"');
    expect(html).toContain('data-source-video="vy92lsus9y"');
    expect(html).not.toContain("<iframe");
  });
  it("bundles static local assets with scoped styling and preserved source sections", () => {
    for(const name of ["doctor","protection","profile","starter"]){
      const html=readFileSync(new URL("../../content/"+name+"/source.html",import.meta.url),"utf8");
      const css=readFileSync(new URL("../../content/"+name+"/source.css",import.meta.url),"utf8");
      expect(html).not.toMatch(/<script|<iframe|<form|\son[a-z]+=/i);
      expect(html).not.toMatch(/src=["']https?:/);
      expect(css).not.toMatch(/url\(["']?https?:/);
      expect(css).toContain("."+name+"-sales-page");
      expect(html).not.toContain('id="section-header"');
    }
    const doctor=readFileSync(new URL("../../content/doctor/source.css",import.meta.url),"utf8");
    expect(doctor).toContain("@keyframes doctor-sales-page-scroll");
    expect(doctor).toContain("prefers-reduced-motion");
  });
});
