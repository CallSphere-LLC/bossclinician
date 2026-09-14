/**
 * Admin URLs that people type, bookmark or share — and that are not the route.
 *
 * The admin's information architecture moved as it grew: coupons went under
 * `/admin/sales/`, offers stayed at the top level, and the marketing screens
 * gained a `/marketing/` prefix. Anyone who bookmarked the older address, or
 * who simply guesses the shape from the sidebar grouping ("Coupons is under
 * Sales, so it must be /admin/coupons"), asks for a path no route matches.
 *
 * These entries are consulted only *after* the router has failed to match, so
 * an alias can never shadow a real screen: add a route at one of these paths
 * and the route wins, with nothing here to undo first. That is also why the
 * list can afford to be generous — an entry for a path that is already real is
 * inert rather than harmful.
 */

export interface AdminPathAlias {
  /** The path someone asked for, without a trailing slash. */
  from: string;
  /** The canonical path it should land on. */
  to: string;
}

export const ADMIN_PATH_ALIASES: readonly AdminPathAlias[] = [
  // Offers never moved under /sales, but everything either side of them did.
  { from: "/admin/sales/offers", to: "/admin/offers" },

  // …and the mirror image: the seven Sales screens that *are* nested, guessed
  // at the top level because that is where Offers sits.
  { from: "/admin/coupons", to: "/admin/sales/coupons" },
  { from: "/admin/payments", to: "/admin/sales/payments" },
  { from: "/admin/plans", to: "/admin/sales/plans" },
  { from: "/admin/subscriptions", to: "/admin/sales/subscriptions" },
  { from: "/admin/invoices", to: "/admin/sales/invoices" },
  { from: "/admin/payouts", to: "/admin/sales/payouts" },
  // "Affiliates" is what this screen was called before it became "Partners",
  // and the public signup page still lives at /partners.
  { from: "/admin/affiliates", to: "/admin/partners" },

  // The marketing screens, guessed without their prefix.
  { from: "/admin/campaigns", to: "/admin/marketing/campaigns" },
  { from: "/admin/funnels", to: "/admin/marketing/funnels" },
  { from: "/admin/sequences", to: "/admin/marketing/sequences" },
  { from: "/admin/emails", to: "/admin/marketing/emails" },
  { from: "/admin/quizzes", to: "/admin/marketing/quizzes" },
  // Both point at the current builder, not the older screen kept alive beside
  // it: someone typing the bare path wants the one the sidebar links to.
  { from: "/admin/automations", to: "/admin/marketing/automations-v2" },
  { from: "/admin/forms", to: "/admin/marketing/forms-v2" },
  { from: "/admin/events", to: "/admin/marketing/events-v2" },

  // Reports moved under Analytics.
  { from: "/admin/reports", to: "/admin/analytics/reports" },
  { from: "/admin/analytics/overview", to: "/admin/analytics" },

  // The dashboard is the bare /admin, but "dashboard" is what the sidebar
  // calls it.
  { from: "/admin/dashboard", to: "/admin" },
  { from: "/admin/home", to: "/admin" },

  // The other sidebar groups, guessed *with* a prefix by analogy with
  // /sales/ and /marketing/ — Products, Website and Contacts screens all live
  // at the top level.
  { from: "/admin/products/catalogue", to: "/admin/catalogue" },
  { from: "/admin/products/catalog", to: "/admin/catalogue" },
  { from: "/admin/products/courses", to: "/admin/courses" },
  { from: "/admin/products/community", to: "/admin/community" },
  { from: "/admin/products/media", to: "/admin/media" },
  { from: "/admin/products/coaching", to: "/admin/coaching" },
  { from: "/admin/products/podcasts", to: "/admin/podcasts" },
  { from: "/admin/products/newsletters", to: "/admin/newsletters" },
  { from: "/admin/sales/partners", to: "/admin/partners" },
  { from: "/admin/sales/affiliates", to: "/admin/partners" },
  { from: "/admin/website/blog", to: "/admin/blog" },
  { from: "/admin/website/pages", to: "/admin/pages" },
  { from: "/admin/website/testimonials", to: "/admin/testimonials" },
  { from: "/admin/website/resources", to: "/admin/resources" },
  // /contacts/:id would read these as a contact id, so AdminApp checks this
  // table before rendering that route too.
  { from: "/admin/contacts/tags", to: "/admin/tags" },
  { from: "/admin/contacts/segments", to: "/admin/segments" },
  { from: "/admin/contacts/groups", to: "/admin/segments" },
  { from: "/admin/contacts/leads", to: "/admin/leads" },
  { from: "/admin/contacts/conversations", to: "/admin/conversations" },
  { from: "/admin/contacts/members", to: "/admin/members" },
  { from: "/admin/contacts/subscribers", to: "/admin/subscribers" },

  // What the sidebar calls a screen, or its everyday spelling, as the path.
  { from: "/admin/catalog", to: "/admin/catalogue" },
  { from: "/admin/media-library", to: "/admin/media" },
  { from: "/admin/communities", to: "/admin/community" },
  { from: "/admin/blog-posts", to: "/admin/blog" },
  { from: "/admin/posts", to: "/admin/blog" },
  { from: "/admin/people", to: "/admin/contacts" },
  { from: "/admin/groups", to: "/admin/segments" },
  { from: "/admin/insights", to: "/admin/contacts/insights" },
  { from: "/admin/email-templates", to: "/admin/marketing/emails" },
  { from: "/admin/templates", to: "/admin/marketing/emails" },
  { from: "/admin/marketing/templates", to: "/admin/marketing/emails" },

  // Settings screens guessed without /settings/. Not /admin/settings/integrations:
  // that is a real group of settings ("Connected services"), not an alias.
  { from: "/admin/team", to: "/admin/settings/team" },
  { from: "/admin/users", to: "/admin/settings/team" },
  { from: "/admin/connections", to: "/admin/settings/connections" },
  { from: "/admin/integrations", to: "/admin/settings/connections" },
  { from: "/admin/availability", to: "/admin/settings/availability" },
  // /settings/:group would read these one-segment ones as a group name, so
  // AdminApp checks this table before rendering that route. A test keeps any
  // of them from ever colliding with a real group key.
  { from: "/admin/settings/users", to: "/admin/settings/team" },
  { from: "/admin/settings/billing", to: "/admin/settings/payments" },
  { from: "/admin/settings/email-log", to: "/admin/settings/email/log" },
  { from: "/admin/settings/delivery-log", to: "/admin/settings/email/log" },

  // The delivery log, by the other names people give it.
  { from: "/admin/settings/email/logs", to: "/admin/settings/email/log" },
  { from: "/admin/email-log", to: "/admin/settings/email/log" },
  { from: "/admin/email/log", to: "/admin/settings/email/log" },
];

/** Longest prefix first, so a nested alias is never shadowed by its parent. */
const BY_SPECIFICITY = [...ADMIN_PATH_ALIASES].sort((a, b) => b.from.length - a.from.length);

/**
 * The canonical path for an admin URL that matched no route, or null.
 *
 * Deeper segments come along: `/admin/sales/offers/42` resolves to
 * `/admin/offers/42`, so a bookmarked editor link survives the move too. The
 * comparison ignores case and a trailing slash — those are variations on a
 * typed URL, not different addresses — while the tail is passed through
 * verbatim, because an id in it may well be case-sensitive.
 */
export function resolveAdminAlias(pathname: string): string | null {
  const trimmed = pathname.replace(/\/+$/, "");
  const lower = trimmed.toLowerCase();

  for (const { from, to } of BY_SPECIFICITY) {
    if (lower === from) return to;
    if (lower.startsWith(`${from}/`)) return `${to}${trimmed.slice(from.length)}`;
  }
  return null;
}
