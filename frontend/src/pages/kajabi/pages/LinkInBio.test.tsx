import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import LinkInBio from "./LinkInBio";
import { SsrProvider } from "@/ssr/context";
import type { HeadDescriptor } from "@/seo/types";

function render() {
  const head: HeadDescriptor[] = [];
  const html = renderToString(<SsrProvider runtime={{ payload: { origin: "https://example.com", indexable: true, data: {} }, headSink: head }}><StaticRouter location="/link-in-bio"><LinkInBio /></StaticRouter></SsrProvider>);
  return { html, head };
}
describe("approved link-in-bio handoff", () => {
 const { html, head } = render();
 it("keeps the identity and introduces the approved audience", () => {
  expect(html).toContain("Build a private practice");
  expect(html).toContain("you can actually stay in.");
  expect(html).toContain("Hey, I’m Yvette Howard,");
  expect(html).toContain("@bossclinician");
  expect(html).toContain("I help mental health clinicians build and run a private practice");
  expect(head.at(-1)?.description).toContain("mental health clinicians");
  expect(html).not.toContain("Helping therapists");
 });
 it("orders four stage choices and their exact destinations once", () => {
  const routes = ["/practicepreptraining", "/private-practice-for-you", "/freedom-masterclass", "/hiring-quiz", "/boss-assessment", "/club", "/lounge", "/boardroom", "/retreats", "/replay-documentation", "/practice-quiz", "/resource-hub", "/about"];
  let previous = -1;
  for (const route of routes) { const tag=`href="${route}"`; expect(html.split(tag)).toHaveLength(2); const index=html.indexOf(tag); expect(index).toBeGreaterThan(previous); previous=index; }
  for (const label of ["Watch the Free Practice Prep Training", "Take the Free Quiz", "Watch the Free Lounge Masterclass", "Take the Hiring-Readiness Quiz", "Take the Group Practice Assessment", "Explore the Club", "Explore the Lounge", "Explore the Boardroom and Apply", "Explore the FlourisHealer Bali Retreat"]) expect(html).toContain(label);
 });
 it("keeps existing story, testimonials, social destinations and policies", () => {
  for(const text of ["Kristan L., LCSW", "Rosa M., LCSW", "Michael M., LPC", "Sharon S., LPC", "while working in dialysis", "LCSW", "Group Practice Owner", "Doctoral Candidate"]) expect(html).toContain(text);
  for(const href of ["https://instagram.com/bossclinician", "https://facebook.com/yvette.hwd", "https://threads.net/@bossclinician", "/privacy-policy", "/terms-of-use", "/financial-disclaimer", "/disclaimer"]) expect(html).toContain(`href="${href}"`);
  expect(html).not.toContain("Developer notes");expect(html).not.toContain("During a campaign");expect(html).not.toContain("Start Here");
 });
});
