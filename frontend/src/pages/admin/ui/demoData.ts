import type {
  AttentionItem,
  DashboardMoney,
  DashboardPulse,
  Kpi,
  TodayEntry,
} from "@/lib/dashboardApi";

/**
 * The realistic Boss Clinician dataset — Part II §53.
 *
 * §53 rules out Lorem Ipsum and names the people, programs and offers this
 * business actually sells, so the dashboard can be judged as a working screen
 * before there is a year of trade behind it.
 *
 * **This is never a silent fallback.** An empty database and a demo dataset
 * look identical on a KPI card, and the one thing a business owner must be
 * able to trust about this screen is that the money on it is her money. So
 * sample mode is opt-in, announced by a banner that cannot be dismissed while
 * it is on, and — because the flag lives in component state rather than in
 * storage — gone on the next page load.
 *
 * When the real endpoints answer with zeros, the dashboard shows §43 empty
 * states instead. "Nothing has happened yet" is information; a fabricated
 * $42,680 is not.
 */

const DAY = 86_400_000;

/** A gently trending series, deterministic so the chart does not jitter. */
function series(days: number, base: number, drift: number, wobble: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < days; i += 1) {
    const trend = base + (drift * i) / days;
    // Two out-of-phase sines rather than Math.random(): a re-render must not
    // redraw the sparkline with a different shape.
    const noise = Math.sin(i * 0.9) * wobble + Math.sin(i * 0.31) * wobble * 0.6;
    out.push(Math.max(0, Math.round(trend + noise)));
  }
  return out;
}

function points(days: number, values: number[]): { date: string; value: number }[] {
  const start = Date.now() - (days - 1) * DAY;
  return values.map((value, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    value,
  }));
}

function kpi(
  key: string,
  label: string,
  description: string,
  format: Kpi["format"],
  value: number,
  changePercent: number | null,
  sparkline: number[],
  to: string | null,
  sense: Kpi["sense"] = "higher-is-better",
): Kpi {
  return {
    key,
    label,
    description,
    format,
    currency: "usd",
    value,
    previousValue: changePercent === null ? null : Math.round(value / (1 + changePercent / 100)),
    changePercent,
    sparkline,
    sense,
    to,
  };
}

export function demoMoney(days: number): DashboardMoney {
  const gross = series(days, 1_180_00, 460_00, 220_00);
  const net = gross.map((v) => Math.round(v * 0.93));
  const subs = series(days, 384_00, 96_00, 62_00);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (days - 1) * DAY).toISOString().slice(0, 10);

  return {
    range: {
      from,
      to,
      previousFrom: new Date(Date.now() - (days * 2 - 1) * DAY).toISOString().slice(0, 10),
      previousTo: new Date(Date.now() - days * DAY).toISOString().slice(0, 10),
      days,
    },
    figuresUpdatedAt: new Date().toISOString(),
    kpis: {
      primary: [
        kpi("gross-revenue", "Gross Revenue", "Everything people paid you.", "money", 4_268_000, 12.4, gross, null),
        kpi("net-revenue", "Net Revenue", "What you kept after refunds.", "money", 3_969_240, 11.1, net, null),
        kpi("subscription-revenue", "Subscription Revenue", "Membership invoices settled.", "money", 1_182_000, 8.6, subs, null),
        kpi("offers-sold", "Offers Sold", "Purchases people completed.", "count", 148, 9.2, series(days, 4, 3, 2), null),
        kpi("new-contacts", "New Contacts", "People who arrived in your list.", "count", 324, 18, series(days, 9, 5, 4), null),
        kpi("email-optins", "Email Opt-ins", "New sign-ups to hear from you.", "count", 261, 14.3, series(days, 7, 4, 3), null),
      ],
      secondary: [
        kpi("mrr", "MRR", "What memberships add up to each month.", "money", 1_246_000, null, [], null),
        kpi("aov", "Average Order Value", "Gross revenue per order.", "money", 28_838, null, [], null),
        kpi("refunds", "Refunds", "Money handed back.", "money", 149_500, -22.5, series(days, 4_000, -1_500, 2_400), null, "lower-is-better"),
        kpi("active-members", "Active Members", "People who can sign in right now.", "count", 612, null, [], null),
        kpi("applications", "Applications", "Enquiries received.", "count", 25, null, [], null),
        kpi("course-completion", "Course Completion", "Average progress across everyone enrolled.", "percent", 71, null, [], null),
        kpi("coaching-sessions", "Coaching Sessions", "Sessions booked into this period.", "count", 46, null, [], null),
        kpi("failed-payments", "Failed Payments", "Card charges that did not go through.", "count", 5, null, [], null, "lower-is-better"),
        kpi("email-open-rate", "Email Open Rate", "Opens as a share of everything sent.", "percent", 48.2, null, [], null),
        kpi("email-click-rate", "Email Click Rate", "Clicks as a share of everything sent.", "percent", 7.6, null, [], null),
      ],
    },
    revenue: {
      gross: points(days, gross),
      net: points(days, net),
      subscriptions: points(days, subs),
      currency: "usd",
      summary: {
        grossCents: 4_268_000,
        netCents: 3_969_240,
        refundCents: 149_500,
        subscriptionCents: 1_182_000,
        averageOrderCents: 28_838,
        orders: 148,
      },
    },
    balance: {
      available: [{ amountCents: 1_842_600, currency: "usd" }],
      pending: [{ amountCents: 396_400, currency: "usd" }],
    },
  };
}

export const DEMO_ATTENTION: AttentionItem[] = [
  {
    key: "failed-payments",
    title: "Failed payments",
    detail: "Some customers may lose access if the payment is not recovered.",
    count: 5,
    severity: "critical",
    actionLabel: "Review payments",
    to: "/admin/sales/payments",
  },
  {
    key: "disputes",
    title: "Disputed payments",
    detail: "A card issuer is holding these funds. They have a deadline to respond by.",
    count: 1,
    severity: "critical",
    actionLabel: "Review disputes",
    to: "/admin/sales/payments",
  },
  {
    key: "community-reports",
    title: "Reported posts",
    detail: "Members have flagged these for you to look at.",
    count: 4,
    severity: "warning",
    actionLabel: "Review reports",
    to: "/admin/community",
  },
  {
    key: "failed-automations",
    title: "Automations that did not finish",
    detail: "Some customers did not get what the automation was meant to do.",
    count: 2,
    severity: "warning",
    actionLabel: "Review automations",
    to: "/admin/marketing/automations-v2",
  },
  {
    key: "coaching-followup",
    title: "Coaching sessions to close off",
    detail: "These are past their time and still marked as scheduled.",
    count: 2,
    severity: "warning",
    actionLabel: "Open calendar",
    to: "/admin/coaching",
  },
  {
    key: "affiliate-applications",
    title: "Partner applications waiting",
    detail: "Nobody can start referring until you approve them.",
    count: 1,
    severity: "info",
    actionLabel: "Review applications",
    to: "/admin/partners",
  },
];

/** Today's schedule, anchored to the current date so it always reads as today. */
export function demoToday(): TodayEntry[] {
  const at = (hour: number, minute: number) => {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  return [
    {
      key: "demo-1",
      at: at(9, 0),
      title: "Boardroom Coaching Session",
      subtitle: "Sarah Miller",
      kind: "coaching",
      to: "/admin/coaching",
    },
    {
      key: "demo-2",
      at: at(11, 30),
      title: "Discovery Call",
      subtitle: "Emma Davis",
      kind: "coaching",
      to: "/admin/coaching",
    },
    {
      key: "demo-3",
      at: at(14, 0),
      title: "Lounge Group Session",
      subtitle: "24 attendees",
      kind: "community-event",
      to: "/admin/marketing/events",
    },
    {
      key: "demo-4",
      at: at(16, 30),
      title: "Private Coaching",
      subtitle: "Michael Harris",
      kind: "coaching",
      to: "/admin/coaching",
    },
  ];
}

export function demoPulse(days: number): DashboardPulse {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  return {
    days,
    programs: [
      { id: 1, title: "The Lounge", kind: "community", members: 126, revenueCents: 1_842_000, completionPercent: null },
      { id: 2, title: "The Boardroom", kind: "community", members: 68, revenueCents: 2_140_000, completionPercent: null },
      { id: 3, title: "Private Coaching", kind: "coaching", members: 24, revenueCents: 1_260_000, completionPercent: null },
      { id: 4, title: "Private Practice Accelerator", kind: "course", members: 214, revenueCents: 986_000, completionPercent: 73 },
      { id: 5, title: "Clinician Business Foundations", kind: "course", members: 96, revenueCents: 412_000, completionPercent: 61 },
    ],
    sales: {
      purchases: 148,
      refunds: 6,
      upsells: 21,
      recoveredCheckouts: 9,
      abandonedCheckouts: 34,
      recent: [
        { id: 1041, customer: "Jane Cooper", email: "jane@example.com", offer: "The Boardroom", type: "payment_plan", amountCents: 125_000, currency: "usd", status: "paid", at: ago(42) },
        { id: 1040, customer: "Sarah Thompson", email: "sarah@example.com", offer: "The Lounge Monthly", type: "subscription", amountCents: 9_700, currency: "usd", status: "paid", at: ago(96) },
        { id: 1039, customer: "Michael Harris", email: "michael@example.com", offer: "Private Coaching Package", type: "one_time", amountCents: 240_000, currency: "usd", status: "paid", at: ago(180) },
        { id: 1038, customer: "Emma Davis", email: "emma@example.com", offer: "Boardroom Annual", type: "subscription", amountCents: 118_800, currency: "usd", status: "paid", at: ago(260) },
        { id: 1037, customer: "David Nguyen", email: "david@example.com", offer: "The Lounge Monthly", type: "subscription", amountCents: 9_700, currency: "usd", status: "failed", at: ago(320) },
        { id: 1036, customer: "Rachel Green", email: "rachel@example.com", offer: "Private Practice Accelerator", type: "one_time", amountCents: 49_700, currency: "usd", status: "paid", at: ago(410) },
        { id: 1035, customer: "Jessica Miller", email: "jessica@example.com", offer: "Boardroom 3-Payment Plan", type: "payment_plan", amountCents: 125_000, currency: "usd", status: "paid", at: ago(520) },
        { id: 1034, customer: "Jennifer Clark", email: "jennifer@example.com", offer: "Clinician Business Foundations", type: "one_time", amountCents: 29_700, currency: "usd", status: "refunded", at: ago(640) },
      ],
    },
    contacts: {
      total: 4_812,
      newThisPeriod: 324,
      members: 612,
      subscribed: 3_940,
      topCustomer: { name: "Michael Harris", email: "michael@example.com", lifetimeValueCents: 486_000 },
    },
    marketing: {
      sends: 8_420,
      opens: 4_058,
      clicks: 640,
      unsubscribes: 34,
      openRate: 48.2,
      clickRate: 7.6,
      unsubscribeRate: 0.4,
      activeSequences: 6,
      activeAutomations: 11,
    },
    courses: [
      { id: 1, title: "Private Practice Accelerator", learners: 214, completionPercent: 73 },
      { id: 2, title: "Boardroom Foundations", learners: 118, completionPercent: 61 },
      { id: 3, title: "Marketing for Therapists", learners: 87, completionPercent: 82 },
    ],
    coaching: {
      today: 4,
      thisWeek: 17,
      completed: 38,
      cancelled: 3,
      upcoming: 22,
      next: [
        { id: 1, at: ago(-180), title: "Boardroom Strategy Session", member: "Sarah Thompson" },
        { id: 2, at: ago(-1_440), title: "Discovery Call", member: "Emma Davis" },
        { id: 3, at: ago(-2_880), title: "Private Coaching", member: "Michael Harris" },
      ],
    },
    community: {
      activeMembers: 194,
      postsThisWeek: 58,
      commentsThisWeek: 216,
      reportedPosts: 4,
    },
    applications: [
      { status: "new", count: 12 },
      { status: "contacted", count: 7 },
      { status: "qualified", count: 4 },
      { status: "closed", count: 2 },
    ],
    activity: [
      { id: 1, kind: "order", title: "Emma purchased The Boardroom", at: ago(12), contactId: null, person: "Emma Davis" },
      { id: 2, kind: "lesson", title: "Sarah completed Module 6", at: ago(38), contactId: null, person: "Sarah Thompson" },
      { id: 3, kind: "booking", title: "Michael booked a coaching session", at: ago(72), contactId: null, person: "Michael Harris" },
      { id: 4, kind: "form", title: "New application submitted", at: ago(105), contactId: null, person: "Rachel Green" },
      { id: 5, kind: "payment", title: "Payment failed", at: ago(150), contactId: null, person: "David Nguyen" },
      { id: 6, kind: "certificate", title: "Jennifer earned a certificate", at: ago(214), contactId: null, person: "Jennifer Clark" },
    ],
  };
}
