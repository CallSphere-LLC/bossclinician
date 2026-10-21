import { describe,it,expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import FullyBookedSalesPage from "./FullyBookedSalesPage";
import type { CourseDetailResponse } from "./CoursePriceLabel";
const course = {
  slug:"fully-booked-toolkit",owned:false,priceText:"$67",
  offers:[{slug:"fully-booked-toolkit",available:true,amountCents:6700,currency:"usd",pricingType:"one_time"}],
} as unknown as CourseDetailResponse;
function render(value=course) {return renderToStaticMarkup(<MemoryRouter><FullyBookedSalesPage course={value}/></MemoryRouter>);}
describe("Fully Booked sales page",()=>{
  it("shows the supplied cover before loading the third-party player",()=>{
    const html=render();
    expect(html).toContain('/images/fully-booked-video-cover.webp');
    expect(html).toContain('aria-label="Play the Fully Booked Toolkit introduction"');
    expect(html).not.toContain("<iframe");
    expect(html).toContain("From Profile to Profit");
    expect(html).toContain("Client Consultation Call Script");
    expect(html).toContain("Sharon S. LPC");
    expect(html).toContain("Kristan L. LCSW");
    expect(html).toContain("Deanna H. LCSW");
  });
  it("uses the live price and suppresses the old promotion if the price changes",()=>{
    const html=render({...course,offers:[{...course.offers[0],amountCents:9700}]});
    expect(html).toContain("$97");
    expect(html).not.toContain("85%");
    expect(html).not.toContain("$67");
  });
  it("never directs an owner to buy again",()=>{
    const html=render({...course,owned:true});
    expect(html).toContain('href="/library/fully-booked-toolkit"');
    expect(html).not.toContain('href="/checkout/fully-booked-toolkit"');
  });
  it("respects unavailable offers",()=>{
    const html=render({...course,offers:[{...course.offers[0],available:false,unavailableReason:"Temporarily unavailable"}]});
    expect(html).toContain("Temporarily unavailable");
    expect(html).not.toContain('href="/checkout/fully-booked-toolkit"');
  });
});
