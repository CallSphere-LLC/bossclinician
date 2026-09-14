import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_PATH_ALIASES, resolveAdminAlias } from "@/pages/admin/adminAliases";

/**
 * The admin route table, read out of the router itself.
 *
 * Read rather than imported: importing AdminApp would pull in every admin
 * screen and the DOM they expect, and these tests are about paths. Reading the
 * source means the list cannot go stale as routes are added — a new route
 * appears here the moment it appears in the router.
 */
function adminRoutePatterns(): string[] {
  const source = readFileSync(
    path.resolve(__dirname, "./AdminApp.tsx"),
    "utf8",
  );
  const patterns: string[] = [];
  for (const match of source.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const raw = match[1];
    if (raw === "*" || raw === "/*") continue;
    // The outer <Routes> declares /login and /invite/:token; the inner one is
    // written relative to /admin. Both end up under the /admin prefix.
    patterns.push(raw === "/" ? "/admin" : `/admin${raw}`);
  }
  return patterns;
}

/** `/admin/offers/:id` → a regex that matches `/admin/offers/42`. */
function toMatcher(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${body}/?$`);
}

const ROUTES = adminRoutePatterns();

function isRealRoute(pathname: string): boolean {
  return ROUTES.some((pattern) => toMatcher(pattern).test(pathname));
}

describe("the admin route table", () => {
  it("was found in the router", () => {
    // A guard on the reading above: if the regex ever stops matching the
    // router's JSX, every other assertion here would pass vacuously.
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES).toContain("/admin/offers");
    expect(ROUTES).toContain("/admin/sales/coupons");
  });

  it("makes the email delivery log directly addressable", () => {
    // It used to be a card that only existed once /admin/settings/email had
    // rendered, so this exact URL fell through to the catch-all.
    expect(isRealRoute("/admin/settings/email/log")).toBe(true);
  });
});

describe("resolveAdminAlias", () => {
  it("sends the paths the tester tried to the real screens", () => {
    expect(resolveAdminAlias("/admin/sales/offers")).toBe("/admin/offers");
    expect(resolveAdminAlias("/admin/coupons")).toBe("/admin/sales/coupons");
  });

  it("leaves a path that really does not exist alone, for the 404", () => {
    expect(resolveAdminAlias("/admin/definitely-not-a-page")).toBeNull();
    expect(resolveAdminAlias("/admin/settings/email/log")).toBeNull();
    expect(resolveAdminAlias("/admin")).toBeNull();
  });

  it("carries deeper segments across the move", () => {
    expect(resolveAdminAlias("/admin/sales/offers/42")).toBe("/admin/offers/42");
    expect(resolveAdminAlias("/admin/sales/offers/new")).toBe("/admin/offers/new");
    // Ids keep their case even though the match ignores it.
    expect(resolveAdminAlias("/admin/Sales/Offers/aB9")).toBe("/admin/offers/aB9");
  });

  it("ignores a trailing slash", () => {
    expect(resolveAdminAlias("/admin/coupons/")).toBe("/admin/sales/coupons");
  });

  it("only ever points at a path the router serves", () => {
    for (const { from, to } of ADMIN_PATH_ALIASES) {
      expect(isRealRoute(to), `${from} → ${to} is not a route`).toBe(true);
    }
  });

  it("never chains one alias into another", () => {
    // A target that is itself an alias would redirect twice — or, if two
    // entries ever pointed at each other, forever.
    for (const { to } of ADMIN_PATH_ALIASES) {
      expect(resolveAdminAlias(to), `${to} resolves again`).toBeNull();
    }
  });

  it("never chains once a deeper segment is carried across either", () => {
    for (const { from } of ADMIN_PATH_ALIASES) {
      const first = resolveAdminAlias(`${from}/zz-42`);
      expect(first, `${from}/zz-42`).not.toBeNull();
      expect(resolveAdminAlias(first!), `${from}/zz-42 → ${first} resolves again`).toBeNull();
    }
  });
});

/**
 * Every alias, spelled out. Deliberately a second copy of the table rather than
 * a loop over it: a loop would pass for an entry whose target was typed wrong,
 * and this is the list someone reads to find out where a URL goes.
 */
const EXPECTED: readonly [from: string, to: string][] = [
  ["/admin/sales/offers", "/admin/offers"],
  ["/admin/coupons", "/admin/sales/coupons"],
  ["/admin/payments", "/admin/sales/payments"],
  ["/admin/plans", "/admin/sales/plans"],
  ["/admin/subscriptions", "/admin/sales/subscriptions"],
  ["/admin/invoices", "/admin/sales/invoices"],
  ["/admin/payouts", "/admin/sales/payouts"],
  ["/admin/affiliates", "/admin/partners"],
  ["/admin/campaigns", "/admin/marketing/campaigns"],
  ["/admin/funnels", "/admin/marketing/funnels"],
  ["/admin/sequences", "/admin/marketing/sequences"],
  ["/admin/emails", "/admin/marketing/emails"],
  ["/admin/quizzes", "/admin/marketing/quizzes"],
  ["/admin/automations", "/admin/marketing/automations-v2"],
  ["/admin/forms", "/admin/marketing/forms-v2"],
  ["/admin/events", "/admin/marketing/events-v2"],
  ["/admin/reports", "/admin/analytics/reports"],
  ["/admin/analytics/overview", "/admin/analytics"],
  ["/admin/dashboard", "/admin"],
  ["/admin/home", "/admin"],
  ["/admin/products/catalogue", "/admin/catalogue"],
  ["/admin/products/catalog", "/admin/catalogue"],
  ["/admin/products/courses", "/admin/courses"],
  ["/admin/products/community", "/admin/community"],
  ["/admin/products/media", "/admin/media"],
  ["/admin/products/coaching", "/admin/coaching"],
  ["/admin/products/podcasts", "/admin/podcasts"],
  ["/admin/products/newsletters", "/admin/newsletters"],
  ["/admin/sales/partners", "/admin/partners"],
  ["/admin/sales/affiliates", "/admin/partners"],
  ["/admin/website/blog", "/admin/blog"],
  ["/admin/website/pages", "/admin/pages"],
  ["/admin/website/testimonials", "/admin/testimonials"],
  ["/admin/website/resources", "/admin/resources"],
  ["/admin/contacts/tags", "/admin/tags"],
  ["/admin/contacts/segments", "/admin/segments"],
  ["/admin/contacts/groups", "/admin/segments"],
  ["/admin/contacts/leads", "/admin/leads"],
  ["/admin/contacts/conversations", "/admin/conversations"],
  ["/admin/contacts/members", "/admin/members"],
  ["/admin/contacts/subscribers", "/admin/subscribers"],
  ["/admin/catalog", "/admin/catalogue"],
  ["/admin/media-library", "/admin/media"],
  ["/admin/communities", "/admin/community"],
  ["/admin/blog-posts", "/admin/blog"],
  ["/admin/posts", "/admin/blog"],
  ["/admin/people", "/admin/contacts"],
  ["/admin/groups", "/admin/segments"],
  ["/admin/insights", "/admin/contacts/insights"],
  ["/admin/email-templates", "/admin/marketing/emails"],
  ["/admin/templates", "/admin/marketing/emails"],
  ["/admin/marketing/templates", "/admin/marketing/emails"],
  ["/admin/team", "/admin/settings/team"],
  ["/admin/users", "/admin/settings/team"],
  ["/admin/connections", "/admin/settings/connections"],
  ["/admin/integrations", "/admin/settings/connections"],
  ["/admin/availability", "/admin/settings/availability"],
  ["/admin/settings/users", "/admin/settings/team"],
  ["/admin/settings/billing", "/admin/settings/payments"],
  ["/admin/settings/email-log", "/admin/settings/email/log"],
  ["/admin/settings/delivery-log", "/admin/settings/email/log"],
  ["/admin/settings/email/logs", "/admin/settings/email/log"],
  ["/admin/email-log", "/admin/settings/email/log"],
  ["/admin/email/log", "/admin/settings/email/log"],
];

describe("every alias", () => {
  it.each(EXPECTED)("%s → %s", (from, to) => {
    expect(resolveAdminAlias(from)).toBe(to);
    expect(resolveAdminAlias(`${from}/`)).toBe(to);
    expect(resolveAdminAlias(from.toUpperCase())).toBe(to);
    expect(isRealRoute(to), `${to} is not a route`).toBe(true);
  });

  it("has a case above for each entry in the table, and no case for a missing one", () => {
    expect([...ADMIN_PATH_ALIASES].map(({ from, to }) => [from, to]).sort()).toEqual(
      [...EXPECTED].map(([from, to]) => [from, to]).sort(),
    );
  });

  it("has each path at most once", () => {
    const froms = ADMIN_PATH_ALIASES.map(({ from }) => from);
    expect(new Set(froms).size).toBe(froms.length);
  });

  it("is reachable: any alias a dynamic route would swallow sits behind AliasFirst", () => {
    // The catch-all only sees what no route matched. /settings/:group matches
    // /admin/settings/users, so that alias only works because the :group route
    // checks the table first — and an alias a route swallows without that
    // check would be dead code that looks like a fix.
    const source = readFileSync(path.resolve(__dirname, "./AdminApp.tsx"), "utf8");
    const guarded = [...source.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<AliasFirst>/g)].map(
      (m) => `/admin${m[1]}`,
    );
    expect(guarded).toEqual(expect.arrayContaining(["/admin/contacts/:id", "/admin/settings/:group"]));

    for (const { from } of ADMIN_PATH_ALIASES) {
      const swallowedBy = ROUTES.filter((pattern) => toMatcher(pattern).test(from));
      for (const pattern of swallowedBy) {
        expect(guarded, `${from} is matched by ${pattern}, which does not check aliases`).toContain(
          pattern,
        );
      }
    }
  });

  it("never takes over a real group of settings", () => {
    const settingsSource = path.resolve(__dirname, "../../../../backend/src/services/settings.ts");
    if (!existsSync(settingsSource)) return; // frontend checked out on its own
    const block = readFileSync(settingsSource, "utf8").split("export const SETTING_GROUPS")[1]?.split("];")[0] ?? "";
    const keys = [...block.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toContain("email");
    expect(keys).toContain("integrations");

    for (const key of keys) {
      expect(resolveAdminAlias(`/admin/settings/${key}`), `/admin/settings/${key}`).toBeNull();
    }
  });
});

describe("the sidebar", () => {
  it("links only to addresses the router serves", () => {
    const nav = readFileSync(path.resolve(__dirname, "./ui/nav.ts"), "utf8");
    const targets = [...nav.matchAll(/to:\s*"(\/admin[^"]*)"/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(30);
    for (const to of targets) {
      expect(isRealRoute(to), `sidebar link ${to} is not a route`).toBe(true);
      expect(resolveAdminAlias(to), `sidebar link ${to} is also an alias`).toBeNull();
    }
  });
});
