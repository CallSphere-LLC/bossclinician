import { describe, expect, it } from "vitest";
import { NAV_GROUPS, activeNavTarget, groupForPath } from "@/pages/admin/ui/nav";

/** Every address the sidebar links to, in the order it shows them. */
function sidebarTargets(): string[] {
  return NAV_GROUPS.flatMap((group) => (group.to ? [group.to] : (group.children ?? []).map((c) => c.to)));
}

function labelsOf(groupId: string): string[] {
  return NAV_GROUPS.find((g) => g.id === groupId)?.children?.map((c) => c.label) ?? [];
}

describe("the sidebar's shape", () => {
  it("lists Products the way Kajabi does, then the catalogue and the media library", () => {
    // The order a Kajabi hand reaches for, and the two the tester asked to
    // find under Products as well.
    expect(labelsOf("products")).toEqual([
      "All Products",
      "Courses",
      "Coaching",
      "Community",
      "Podcasts",
      "Newsletters",
      "Downloads",
      "Your Catalogue",
      "Media Library",
    ]);
  });

  it("puts the groups in Kajabi's order", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      "Dashboard",
      "Products",
      "Sales",
      "Website",
      "Marketing",
      "Contacts",
      "Analytics",
      "Settings",
    ]);
  });

  it("opens each group with Kajabi's own items, in Kajabi's order", () => {
    expect(labelsOf("sales").slice(0, 1)).toEqual(["Payments"]);
    expect(labelsOf("website").slice(0, 2)).toEqual(["Website Pages", "Blog"]);
    expect(labelsOf("marketing")[0]).toBe("Overview");
    expect(labelsOf("marketing")[1]).toBe("Email Campaigns");
    expect(labelsOf("contacts").slice(0, 3)).toEqual(["All Contacts", "Insights", "Assessments"]);
    expect(labelsOf("analytics")).toEqual(["Overview", "Reports"]);
  });

  it("still reaches every page the sidebar reached before it was reorganised", () => {
    // The sidebar before it followed Kajabi. Moving a row is fine; losing one
    // leaves a working screen nobody can find.
    const before = [
      "/admin",
      "/admin/products",
      "/admin/courses",
      "/admin/coaching",
      "/admin/community",
      "/admin/podcasts",
      "/admin/newsletters",
      "/admin/downloads",
      "/admin/catalogue",
      "/admin/media",
      "/admin/offers",
      "/admin/sales/payments",
      "/admin/sales/plans",
      "/admin/sales/subscriptions",
      "/admin/sales/invoices",
      "/admin/sales/coupons",
      "/admin/sales/payouts",
      "/admin/partners",
      "/admin/blog",
      "/admin/testimonials",
      "/admin/resources",
      "/admin/pages",
      "/admin/marketing/overview",
      "/admin/marketing/events",
      "/admin/marketing/campaigns",
      "/admin/marketing/funnels",
      "/admin/marketing/automations-v2",
      "/admin/marketing/emails",
      "/admin/marketing/quizzes",
      "/admin/marketing/events-v2",
      "/admin/marketing/forms-v2",
      "/admin/contacts/insights",
      "/admin/contacts",
      "/admin/segments",
      "/admin/tags",
      "/admin/leads",
      "/admin/conversations",
      "/admin/voice-sessions",
      "/admin/members",
      "/admin/subscribers",
      "/admin/analytics",
      "/admin/analytics/reports",
      "/admin/settings",
    ];
    expect([...sidebarTargets()].sort()).toEqual([...before].sort());
  });

  it("links to each page once, so no page ever lights two rows", () => {
    const targets = sidebarTargets();
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("keeps the enquiries count on the Leads Inbox row", () => {
    const leads = NAV_GROUPS.flatMap((g) => g.children ?? []).filter((c) => c.badge === "leads");
    expect(leads.map((c) => c.to)).toEqual(["/admin/leads"]);
  });
});

describe("activeNavTarget", () => {
  it.each([
    // A row is active on its own page and on anything beneath it…
    ["/admin", "/admin"],
    ["/admin/", "/admin"],
    ["/admin/contacts", "/admin/contacts"],
    ["/admin/contacts/8d0f6c1e-1b2a-4c3d-9e8f-0a1b2c3d4e5f", "/admin/contacts"],
    ["/admin/courses/42/curriculum", "/admin/courses"],
    ["/admin/offers/new", "/admin/offers"],
    ["/admin/sales/invoices/9/receipt", "/admin/sales/invoices"],
    ["/admin/partners/7", "/admin/partners"],
    ["/admin/community/3", "/admin/community"],
    ["/admin/marketing/sequences/5", "/admin/marketing/campaigns"],
    ["/admin/marketing/quizzes/12", "/admin/marketing/quizzes"],
    ["/admin/settings/team", "/admin/settings"],
    ["/admin/settings/email/log", "/admin/settings"],
    // …but the deepest row wins, so the page beneath another row's address
    // lights only itself.
    ["/admin/contacts/insights", "/admin/contacts/insights"],
    ["/admin/analytics/reports", "/admin/analytics/reports"],
    ["/admin/analytics/reports/revenue", "/admin/analytics/reports"],
    // Whole segments: the old forms screen's address is the start of the new
    // one's, and neither may claim the other.
    ["/admin/marketing/forms-v2", "/admin/marketing/forms-v2"],
    ["/admin/marketing/events-v2", "/admin/marketing/events-v2"],
    ["/admin/marketing/events", "/admin/marketing/events"],
    // The router ignores case and a trailing slash; so does the highlight.
    ["/admin/Contacts/Insights/", "/admin/contacts/insights"],
  ])("%s lights %s", (pathname, target) => {
    expect(activeNavTarget(pathname)).toBe(target);
  });

  it("lights nothing for a page the sidebar does not list", () => {
    // The dashboard is exact: an unknown page is not "somewhere in the
    // dashboard".
    expect(activeNavTarget("/admin/definitely-not-a-page")).toBeNull();
    expect(activeNavTarget("/admin/marketing/automations")).toBeNull();
  });
});

describe("groupForPath", () => {
  it.each([
    ["/admin/contacts/123", "contacts"],
    ["/admin/contacts/insights", "contacts"],
    // Quizzes live at a marketing address but on the Contacts menu, as Kajabi's
    // Assessments do — the group that opens is the one she sees the row in.
    ["/admin/marketing/quizzes/7", "contacts"],
    ["/admin/partners", "sales"],
    ["/admin/media", "products"],
    ["/admin/marketing/campaigns", "marketing"],
    ["/admin/analytics/reports/abc", "analytics"],
  ])("%s opens %s", (pathname, group) => {
    expect(groupForPath(pathname)).toBe(group);
  });

  it("opens no group for a single-row destination or an unknown page", () => {
    expect(groupForPath("/admin")).toBeNull();
    expect(groupForPath("/admin/settings/team")).toBeNull();
    expect(groupForPath("/admin/definitely-not-a-page")).toBeNull();
  });
});
