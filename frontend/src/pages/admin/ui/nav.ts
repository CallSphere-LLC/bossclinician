import {
  BarChart3,
  CreditCard,
  Globe,
  LayoutDashboard,
  Megaphone,
  Package,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin information architecture.
 *
 * Mirrors Kajabi's own sidebar — its groups, the order of the groups, the order
 * of the items inside each one, and its words for them — so a hand that has
 * spent years in Kajabi reaches for the right row without reading the list.
 * Where this console has a screen Kajabi does not (the enquiries inbox, the
 * assistant's conversations, groups and tags, email sequences), it sits in the
 * group Kajabi would have put it in, *after* Kajabi's own items: the rows she
 * already knows stay exactly where her hand expects them, and the extras read
 * as extras.
 *
 * Kajabi items with no screen behind them here — Cart, Landing Pages,
 * Navigation, Design, Agents, Amplify, Backstage, Branded App and the rest — are
 * left out rather than pointed at a placeholder. A row that opens nothing she
 * recognises costs more trust than a row that is not there.
 *
 * Sidebar labels are free to use Kajabi's word while the page heading keeps its
 * own ("Affiliates" opens the page titled Partners): she navigates by the
 * sidebar, so that is where the familiar word earns its keep.
 *
 * `ready: false` marks a destination that renders an honest placeholder rather
 * than a half-built screen — the nav still shows the shape of the product.
 */

export interface NavChild {
  to: string;
  label: string;
  ready?: boolean;
  badge?: "leads";
}

export interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Single-destination groups (Dashboard, Settings) have no children. */
  to?: string;
  end?: boolean;
  children?: NavChild[];
}

/*
 * Group ids are stored, not just rendered: the open/closed state of the rail is
 * remembered in the browser under them, and the "page not found" screen offers
 * a whole group when someone types its name. Renaming an id quietly closes that
 * group for everyone and breaks /admin/<id> suggestions, so they stay put even
 * where the label around them moved.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/admin",
    end: true,
  },
  {
    id: "products",
    label: "Products",
    icon: Package,
    // Kajabi's Products menu, in its order, then the two the tester asked to
    // find here too. Kajabi keeps its media library as a row of its own lower
    // down; here it sits with the products because that is where she goes
    // looking for the video she is about to put in a lesson — and one row, not
    // two, so the same page never lights up twice.
    children: [
      { to: "/admin/products", label: "All Products", ready: true },
      { to: "/admin/courses", label: "Courses", ready: true },
      { to: "/admin/coaching", label: "Coaching", ready: true },
      { to: "/admin/community", label: "Community", ready: true },
      { to: "/admin/podcasts", label: "Podcasts", ready: true },
      { to: "/admin/newsletters", label: "Newsletters", ready: true },
      { to: "/admin/downloads", label: "Downloads", ready: true },
      { to: "/admin/catalogue", label: "Your Catalogue", ready: true },
      { to: "/admin/media", label: "Media Library", ready: true },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: CreditCard,
    // Kajabi: Payments, Pricing, Payouts, Cart, Invoices, Coupons, Affiliates.
    // Kajabi's Pricing is where a price and its checkout are set, which is what
    // Offers and Plans & Pricing are between them — so both take its slot, under
    // their own names: relabelling Offers "Pricing" would put "Pricing" and
    // "Plans & Pricing" next to each other and make her guess which is which.
    // Cart has no screen here. Subscriptions is ours alone, so it comes last.
    children: [
      { to: "/admin/sales/payments", label: "Payments", ready: true },
      { to: "/admin/offers", label: "Offers", ready: true },
      { to: "/admin/sales/plans", label: "Plans & Pricing", ready: true },
      { to: "/admin/sales/payouts", label: "Payouts", ready: true },
      { to: "/admin/sales/invoices", label: "Invoices", ready: true },
      { to: "/admin/sales/coupons", label: "Coupons", ready: true },
      { to: "/admin/partners", label: "Affiliates", ready: true },
      { to: "/admin/sales/subscriptions", label: "Subscriptions", ready: true },
    ],
  },
  {
    id: "website",
    label: "Website",
    icon: Globe,
    // Kajabi: Design, Website Pages, Landing Pages, Navigation, Blog. Only
    // Website Pages and Blog have a screen here; testimonials and the free
    // resources are pieces of the public site she edits, so they follow.
    children: [
      { to: "/admin/pages", label: "Website Pages", ready: true },
      { to: "/admin/blog", label: "Blog", ready: true },
      { to: "/admin/testimonials", label: "Testimonials", ready: true },
      { to: "/admin/resources", label: "Resources", ready: true },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Megaphone,
    // Kajabi: Overview, Email Campaigns, Funnels, Automations, Events, Forms.
    // The other email screens sit directly under Email Campaigns because that
    // is the one place she looks for anything that sends an email; the older
    // Events and Forms screens sit directly under their current namesakes.
    children: [
      // At /overview rather than the bare marketing path: a child is active on
      // every page beneath its address, so a bare group path would light up on
      // every marketing screen.
      { to: "/admin/marketing/overview", label: "Overview", ready: true },
      { to: "/admin/marketing/campaigns", label: "Email Campaigns", ready: true },
      // Called what its page calls itself: these are the receipts, password
      // resets and welcome notes the site sends on its own, not a design for
      // a campaign.
      { to: "/admin/marketing/emails", label: "Automatic Emails", ready: true },
      { to: "/admin/marketing/funnels", label: "Funnels", ready: true },
      // The first automations screen is deliberately not listed. It reads and
      // writes the same records as the one below, in an older shape: opening an
      // automation built below and saving it there flattens its conditions into
      // text the engine cannot read, and the automation quietly stops running.
      // The route still exists for anyone who has the address.
      { to: "/admin/marketing/automations-v2", label: "Automations", ready: true },
      // Two different things were both called "Events": this first one takes
      // registrations for a webinar or a live class, while "Community Events"
      // schedules an event inside a community. Identical labels meant picking
      // one at random and finding the event she made nowhere in the other.
      { to: "/admin/marketing/events-v2", label: "Events", ready: true },
      { to: "/admin/marketing/events", label: "Community Events", ready: true },
      { to: "/admin/marketing/forms-v2", label: "Forms", ready: true },
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: Users,
    // Kajabi: All Contacts, Insights, Assessments. Assessments is Kajabi's home
    // for quizzes and tests, so the quiz screen moved here from Marketing even
    // though its address still says marketing — the address is a bookmark, the
    // row is where she looks. Everything after the first three is a view of
    // the same people that Kajabi does not have.
    children: [
      { to: "/admin/contacts", label: "All Contacts", ready: true },
      { to: "/admin/contacts/insights", label: "Insights", ready: true },
      { to: "/admin/marketing/quizzes", label: "Assessments", ready: true },
      { to: "/admin/leads", label: "Leads Inbox", ready: true, badge: "leads" },
      { to: "/admin/conversations", label: "Conversations", ready: true },
      // Calls taken by the assistant, with what was said, beside the written
      // ones: the same question asked of a different channel.
      { to: "/admin/voice-sessions", label: "Voice conversations", ready: true },
      { to: "/admin/members", label: "Members", ready: true },
      { to: "/admin/subscribers", label: "Subscribers", ready: true },
      { to: "/admin/tags", label: "Tags", ready: true },
      { to: "/admin/segments", label: "Groups", ready: true },
    ],
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: BarChart3,
    children: [
      { to: "/admin/analytics", label: "Overview", ready: true },
      { to: "/admin/analytics/reports", label: "Reports", ready: true },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    to: "/admin/settings",
  },
];

/** `pathname` is `target` itself or a page beneath it — whole segments only. */
function isWithin(pathname: string, target: string, exact: boolean): boolean {
  if (pathname === target) return true;
  return !exact && pathname.startsWith(`${target}/`);
}

/**
 * The one sidebar address that reads as "you are here" for a pathname.
 *
 * Every row is active on its own page and on anything beneath it — a contact's
 * card highlights All Contacts, a lesson editor highlights Courses — but
 * several rows sit beneath another row's address (Insights under All Contacts,
 * Reports under the analytics Overview). Left to each link's own matching, both
 * lit up at once and she could not tell which page she was on. So the rows are
 * weighed together and the deepest address that contains the page wins, which
 * leaves exactly one row highlighted wherever she is.
 *
 * Whole segments, never raw prefixes: the old forms screen's address is the
 * start of the new one's, and a raw prefix would call one the other.
 */
/**
 * Screens that no longer have a row of their own but belong to one: sequences
 * now live inside Email Campaigns (as Kajabi lists them), so a sequence's
 * editor lights that row.
 */
const NAV_PARENTS: { prefix: string; target: string }[] = [
  { prefix: "/admin/marketing/sequences", target: "/admin/marketing/campaigns" },
];

export function activeNavTarget(pathname: string): string | null {
  // The router ignores case and a trailing slash, so the highlight does too.
  let path = pathname.toLowerCase().replace(/\/+$/, "");
  for (const { prefix, target } of NAV_PARENTS) {
    if (isWithin(path, prefix, false)) path = target;
  }
  let best: string | null = null;
  for (const group of NAV_GROUPS) {
    const rows = group.to
      ? [{ target: group.to, exact: Boolean(group.end) }]
      : (group.children ?? []).map((child) => ({ target: child.to, exact: false }));
    for (const { target, exact } of rows) {
      if (isWithin(path, target, exact) && (best === null || target.length > best.length)) {
        best = target;
      }
    }
  }
  return best;
}

/** Which group contains a given pathname — used to auto-open the active group. */
export function groupForPath(pathname: string): string | null {
  const target = activeNavTarget(pathname);
  if (target === null) return null;
  const group = NAV_GROUPS.find((g) => g.children?.some((c) => c.to === target));
  return group?.id ?? null;
}
