import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  BookOpen,
  CreditCard,
  FileText,
  Inbox,
  MessageSquare,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import type { DashboardOverview, RevenueSummary, StripeStatus } from "@/types/admin";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  formatCurrency,
  formatNumber,
  formatRelative,
  percentDelta,
} from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  LEAD_STATUS_TONE,
  Skeleton,
  leadStatusLabel,
} from "@/pages/admin/ui/primitives";
import { pluralize } from "@/pages/admin/ui/friendly";
import { CHART_COLORS, DonutChart, Sparkline, TrendAreaChart } from "@/pages/admin/ui/Charts";

type MetricKey = "gross" | "subscription" | "optins" | "offers";

interface Metric {
  key: MetricKey;
  label: string;
  value: string;
  /**
   * One line saying what the number counts and over what period. The four tabs
   * mix all-time counts with 30-day totals, which is impossible to guess from a
   * label alone — so the selected tab always explains itself above the chart.
   */
  description: string;
  delta: number | null;
  seriesKey: string;
  color: string;
  currency: boolean;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("gross");

  useEffect(() => {
    let cancelled = false;

    Promise.all([adminApi.overview(), adminApi.revenue()])
      .then(([o, r]) => {
        if (cancelled) return;
        setOverview(o);
        setRevenue(r);
      })
      .catch(() => {
        // Whatever went wrong is ours to fix, so she gets the one thing she can
        // usefully do rather than a diagnosis of our servers.
        if (!cancelled) setError("We couldn't load your dashboard. Try refreshing the page.");
      });

    // Stripe is optional; a missing key must not blank the whole dashboard.
    adminApi
      .stripeStatus()
      .then((s) => !cancelled && setStripe(s))
      .catch(() => !cancelled && setStripe({ configured: false }));

    return () => {
      cancelled = true;
    };
  }, []);

  /** Chart rows: revenue series merged with the activity series by date. */
  const chartData = useMemo(() => {
    if (!overview || !revenue) return [];
    const revenueByDate = new Map(revenue.series.map((p) => [p.date, p]));

    return overview.series.map((point) => {
      const rev = revenueByDate.get(point.date);
      const oneTime = rev?.oneTimeCents ?? 0;
      const subscription = rev?.subscriptionCents ?? 0;
      return {
        date: point.date,
        gross: oneTime + subscription,
        subscription,
        optins: point.subscribers,
        offers: oneTime > 0 ? 1 : 0,
      };
    });
  }, [overview, revenue]);

  const metrics: Metric[] = useMemo(() => {
    if (!revenue || !overview) return [];
    return [
      {
        key: "gross",
        label: "Money coming in",
        value: formatCurrency(revenue.last30Cents),
        description:
          "What you've been paid in the last 30 days. The chart shows each day's takings, and the little arrow compares it with the 30 days before.",
        delta: percentDelta(revenue.last30Cents, revenue.prev30Cents),
        seriesKey: "gross",
        color: CHART_COLORS.plum,
        currency: true,
      },
      {
        key: "subscription",
        label: "Money every month",
        value: formatCurrency(revenue.mrrCents),
        description:
          "What everyone on a plan or membership adds up to each month. The chart shows those payments as they came in.",
        delta: null,
        seriesKey: "subscription",
        color: CHART_COLORS.gold,
        currency: true,
      },
      {
        key: "optins",
        label: "People on your list",
        value: formatNumber(overview.totals.subscribers),
        description:
          "Everyone who has signed up to hear from you, all time. The chart shows how many joined each day.",
        delta: null,
        seriesKey: "optins",
        color: CHART_COLORS.green,
        currency: false,
      },
      {
        key: "offers",
        label: "Things sold",
        value: formatNumber(revenue.ordersPaid),
        description:
          "How many times someone has bought from you, all time. The chart marks the days a sale came in.",
        delta: null,
        seriesKey: "offers",
        color: CHART_COLORS.lilac,
        currency: false,
      },
    ];
  }, [revenue, overview]);

  const activeMetric = metrics.find((m) => m.key === metric) ?? metrics[0];
  const firstName = (user?.name || user?.email || "there").split(/[\s@]/)[0];

  const leadDonut = useMemo(() => {
    const palette: Record<string, string> = {
      new: "#3B82F6",
      contacted: CHART_COLORS.gold,
      qualified: CHART_COLORS.green,
      closed: CHART_COLORS.plum,
      archived: CHART_COLORS.slate,
    };
    return (overview?.leadsByStatus ?? []).map((s) => ({
      // The stored status is a one-word machine state; the slice, its tooltip
      // and the legend below all read the owner's wording for it instead.
      name: leadStatusLabel(s.status),
      value: s.count,
      color: palette[s.status] ?? CHART_COLORS.slate,
    }));
  }, [overview]);

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-2xl text-ink">Dashboard</h1>
        <ErrorNotice message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-plum">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1 className="mt-1.5 font-display text-[2rem] leading-tight text-ink">
            Welcome back, {firstName}.
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button asChild variant="secondary" size="sm">
            <Link to="/admin/media">
              <Upload />
              Add a file
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/admin/blog/new">
              <Plus />
              Write a post
            </Link>
          </Button>
        </div>
      </div>

      {/* Revenue command centre */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline/60 px-5 py-3.5">
            <Badge tone="plum">Last 30 days</Badge>
            <Badge tone="neutral">US dollars</Badge>
            <p className="text-xs text-ink-soft">Pick a number to chart it below.</p>
            <Link
              to="/admin/analytics"
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-plum hover:underline"
            >
              See all your numbers
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          {/* The four numbers she can chart — the toggle above says so out loud */}
          <div
            role="group"
            aria-label="Choose which number to show on the chart"
            className="grid grid-cols-2 divide-hairline/60 border-b border-hairline/60 sm:grid-cols-4 sm:divide-x"
          >
            {metrics.length === 0
              ? Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="px-5 py-4">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-2.5 h-7 w-28" />
                  </div>
                ))
              : metrics.map((m) => {
                  const selected = m.key === metric;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMetric(m.key)}
                      aria-pressed={selected}
                      className={cn(
                        "relative px-5 py-4 text-left transition-colors",
                        selected ? "bg-lilac-tint/40" : "hover:bg-cream/70",
                      )}
                    >
                      {selected && (
                        <motion.span
                          layoutId="metric-underline"
                          className="absolute inset-x-0 bottom-0 h-0.5 bg-plum"
                          transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        />
                      )}
                      <span className="block text-xs font-semibold text-ink-soft">{m.label}</span>
                      <span className="mt-1.5 flex items-baseline gap-2">
                        <span className="font-display text-[1.35rem] text-ink">{m.value}</span>
                        {m.delta !== null && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 text-[0.7rem] font-bold",
                              m.delta >= 0 ? "text-green" : "text-red-300",
                            )}
                          >
                            {m.delta >= 0 ? (
                              <TrendingUp className="size-3" />
                            ) : (
                              <TrendingDown className="size-3" />
                            )}
                            {Math.abs(m.delta)}%
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
          </div>

          <div className="px-3 py-5 sm:px-5">
            {activeMetric && (
              <p className="mb-3 px-2 text-xs leading-relaxed text-ink-soft sm:px-1">
                {activeMetric.description}
              </p>
            )}
            {chartData.length === 0 ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <TrendAreaChart
                data={chartData}
                currency={activeMetric?.currency ?? false}
                series={[
                  {
                    key: activeMetric?.seriesKey ?? "gross",
                    label: activeMetric?.label ?? "Money coming in",
                    color: activeMetric?.color ?? CHART_COLORS.plum,
                  },
                ]}
              />
            )}
          </div>
        </Card>

        {/* Income rail */}
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <Card className="relative overflow-hidden bg-[linear-gradient(150deg,#3D2D5C_0%,#0F1E3A_100%)] p-5 text-white">
            <div className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full bg-gold/20 blur-2xl" />
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-white/65">
              Money you've made
            </p>
            <p className="text-[0.68rem] text-white/45">Everything people have paid you, all time</p>
            {revenue ? (
              <p className="mt-3 font-display text-[1.9rem] leading-none">
                {formatCurrency(revenue.grossCents)}
              </p>
            ) : (
              <Skeleton className="mt-3 h-7 w-32 bg-white/15" />
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-white/60">
              <Wallet className="size-3.5 text-gold" />
              {revenue ? `From ${pluralize(revenue.ordersPaid, "purchase")}` : "Adding it up…"}
            </p>
          </Card>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                  Money every month
                </p>
                <p className="text-[0.68rem] text-ink-soft/75">From people on a plan</p>
                {revenue ? (
                  <p className="mt-2.5 font-display text-[1.6rem] leading-none text-ink">
                    {formatCurrency(revenue.mrrCents)}
                  </p>
                ) : (
                  <Skeleton className="mt-2.5 h-6 w-24" />
                )}
              </div>
              <span className="grid size-9 place-items-center rounded-xl bg-gold/[0.12] text-gold">
                <CreditCard className="size-4" />
              </span>
            </div>

            <div className="mt-4 border-t border-hairline/70 pt-3">
              {stripe === null ? (
                <Skeleton className="h-4 w-32" />
              ) : stripe.configured ? (
                <p className="flex items-center gap-2 text-xs text-ink-soft">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      stripe.chargesEnabled ? "bg-green" : "bg-gold",
                    )}
                  />
                  {stripe.chargesEnabled
                    ? "Card payments are switched on"
                    : "Card payments are still being checked"}
                </p>
              ) : (
                <Link
                  to="/admin/sales/plans"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-plum hover:underline"
                >
                  Set up card payments so people can buy
                  <ArrowUpRight className="size-3.5" />
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Bento stat row */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Enquiries"
          value={overview?.totals.leads}
          hint={
            overview
              ? overview.totals.newLeads === 0
                ? "You've replied to everyone"
                : `${pluralize(overview.totals.newLeads, "new enquiry", "new enquiries")} to reply to`
              : undefined
          }
          icon={<Inbox className="size-4" />}
          to="/admin/leads"
          series={chartData}
          seriesKey="optins"
          color={CHART_COLORS.plum}
        />
        <StatTile
          label="Members"
          value={overview?.totals.members}
          hint={
            overview
              ? overview.totals.enrollments === 0
                ? "Nobody in a course yet"
                : `${formatNumber(overview.totals.enrollments)} students enrolled`
              : undefined
          }
          icon={<Users className="size-4" />}
          to="/admin/members"
          series={chartData}
          seriesKey="optins"
          color={CHART_COLORS.green}
        />
        <StatTile
          label="Lessons"
          value={overview?.totals.lessons}
          hint={overview ? `Across ${pluralize(overview.totals.courses, "course")}` : undefined}
          icon={<BookOpen className="size-4" />}
          to="/admin/courses"
          series={chartData}
          seriesKey="gross"
          color={CHART_COLORS.gold}
        />
        {/* Points at the inbox that actually holds these conversations, rather
            than at analytics where there is nothing to read. */}
        <StatTile
          label="AI chat conversations"
          value={overview?.totals.chats}
          hint="Typed and voice chats on your site"
          icon={<MessageSquare className="size-4" />}
          to="/admin/conversations"
          series={chartData}
          seriesKey="subscription"
          color={CHART_COLORS.lilac}
        />
      </div>

      {/* Bento content row */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Latest enquiries"
            subtitle="The most recent people to get in touch"
            icon={<Inbox className="size-4" />}
            action={
              <Button asChild variant="ghost" size="sm">
                <Link to="/admin/leads">See them all</Link>
              </Button>
            }
          />
          {overview === null ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : overview.recentLeads.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="No enquiries yet"
              description="They'll appear here as people fill in the forms on your site."
            />
          ) : (
            <ul className="divide-y divide-hairline/60">
              {overview.recentLeads.map((lead) => (
                <li
                  key={lead.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-lilac-tint/25"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
                    {lead.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{lead.name}</p>
                    <p className="truncate text-xs text-ink-soft">{lead.email}</p>
                  </div>
                  <Badge tone={LEAD_STATUS_TONE[lead.status] ?? "neutral"}>
                    {leadStatusLabel(lead.status)}
                  </Badge>
                  <span className="w-full text-xs text-ink-soft/80 sm:w-auto">
                    {formatRelative(lead.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Where your enquiries are up to"
            subtitle="Everyone who's got in touch, grouped by what you've done next"
          />
          <div className="p-5">
            {overview === null ? (
              <Skeleton className="h-[200px] w-full" />
            ) : leadDonut.length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title="No enquiries yet"
                description="They'll appear here as they come in."
              />
            ) : (
              <>
                <DonutChart data={leadDonut} totalLabel="Enquiries" />
                <ul className="mt-4 space-y-1.5">
                  {leadDonut.map((slice) => (
                    <li key={slice.name} className="flex items-center gap-2 text-sm">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: slice.color }}
                      />
                      <span className="text-ink-soft">{slice.name}</span>
                      <span className="ml-auto font-semibold tabular-nums text-ink">
                        {slice.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Community + storage */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="relative overflow-hidden xl:col-span-2">
          <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-lilac-tint/70 blur-3xl" />
          <div className="relative p-6">
            <Badge tone="gold">
              <Sparkles className="size-3" />
              Community
            </Badge>
            <h3 className="mt-3 font-display text-xl text-ink">Grow more together</h3>
            <p className="mt-1.5 max-w-lg text-sm text-ink-soft">
              Run group conversations, challenges, leaderboards and live events for your members —
              all from here, with as many groups as you like and no extra charge per person.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Button asChild size="sm">
                <Link to="/admin/community">Open your community</Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <a href="https://www.kajabi.com/product/communities" target="_blank" rel="noreferrer">
                  Compare with Kajabi
                  <ArrowUpRight />
                </a>
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Your files" subtitle="Pictures, videos, audio and documents" />
          <div className="p-5">
            {overview ? (
              <>
                <p className="font-display text-[1.6rem] leading-none text-ink">
                  {formatNumber(overview.totals.media)}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {formatBytes(overview.totals.storageBytes)} of space used
                </p>
              </>
            ) : (
              <>
                <Skeleton className="h-6 w-16" />
                <Skeleton className="mt-2 h-3 w-28" />
              </>
            )}
            <Button asChild variant="secondary" size="sm" className="mt-4 w-full">
              <Link to="/admin/media">
                <Upload />
                Add files
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
              <Link to="/admin/blog/new">
                <FileText />
                Write a blog post
              </Link>
            </Button>
            {overview && (
              <p className="mt-1.5 text-center text-[0.68rem] text-ink-soft">
                {overview.totals.posts === 0
                  ? "Nothing on your blog yet"
                  : `${pluralize(overview.totals.posts, "post")} live on your blog`}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- StatTile */

function StatTile({
  label,
  value,
  hint,
  icon,
  to,
  series,
  seriesKey,
  color,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  icon: React.ReactNode;
  to: string;
  series: Record<string, unknown>[];
  seriesKey: string;
  color: string;
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full overflow-hidden p-5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-plum/30 group-hover:shadow-[0_18px_40px_-20px_rgba(15,30,58,0.35)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
              {label}
            </p>
            {value === undefined ? (
              <Skeleton className="mt-2 h-6 w-16" />
            ) : (
              <p className="mt-2 font-display text-[1.65rem] leading-none text-ink">
                {formatNumber(value)}
              </p>
            )}
            {hint && <p className="mt-1.5 truncate text-xs text-ink-soft">{hint}</p>}
          </div>
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{ background: `${color}1A`, color }}
          >
            {icon}
          </span>
        </div>
        {series.length > 0 && (
          <div className="-mx-1 mt-3">
            <Sparkline data={series} dataKey={seriesKey} color={color} />
          </div>
        )}
      </Card>
    </Link>
  );
}
