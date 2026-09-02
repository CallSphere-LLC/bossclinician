import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowUpRight,
  BookOpen,
  CreditCard,
  FileText,
  Inbox,
  Landmark,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { formatValue, reportsApi, type DashboardOverview as Overview } from "@/lib/reportsApi";
import type { DashboardOverview, RevenueSummary, StripeStatus } from "@/types/admin";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import {
  formatBytes,
  formatCurrency,
  formatNumber,
  formatRelative,
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
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { CHART_COLORS, DonutChart, Sparkline, TrendAreaChart } from "@/pages/admin/ui/Charts";

/**
 * The screen Yvette opens every morning.
 *
 * The top row is the five figures she actually asks for — money coming in,
 * money every month, people joining the list, things sold, and everything she
 * has kept all time — each with the last thirty days behind it and a comparison
 * against the thirty before. The Stripe balance joins them only when card
 * payments are set up: a "£0.00 balance" tile on an account with no payment
 * provider reads as a bank account somebody has emptied.
 *
 * Those five come from the nightly rollup rather than from live table scans, so
 * this page is a handful of index lookups however many years of trade sit behind
 * it. The one thing that must never happen is a silently stale figure, so the
 * page says when it was last worked out and offers to do it again.
 */

/** The palette each tile charts in, in the order the tiles appear. */
const TILE_COLORS: Record<string, string> = {
  gross: CHART_COLORS.plum,
  recurring: CHART_COLORS.gold,
  optins: CHART_COLORS.green,
  sold: CHART_COLORS.lilac,
  net: CHART_COLORS.plumDeep,
};

export default function Dashboard() {
  const { user } = useAuth();
  const [figures, setFigures] = useState<Overview | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("gross");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Taken one at a time: an account without permission for the money figures
    // used to fail all three and land on an error screen it could never leave.
    Promise.all([
      reportsApi.dashboard(30).catch(() => null),
      adminApi.overview().catch(() => null),
      adminApi.revenue().catch(() => null),
    ])
      .then(([f, o, r]) => {
        if (cancelled) return;
        if (f) setFigures(f);
        if (o) setOverview(o);
        if (r) setRevenue(r);
        // Only nothing at all is worth an error: the rest of the screen still
        // has something true to show.
        if (!f && !o && !r) {
          // Whatever went wrong is ours to fix, so she gets the one thing she
          // can usefully do rather than a diagnosis of our servers.
          setError("We couldn't load your dashboard. Try refreshing the page.");
        }
      })
      .catch(() => {
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

  const tiles = figures?.tiles ?? [];
  const active = tiles.find((t) => t.key === selected) ?? tiles[0];

  /** The selected tile's own daily series, ready for the big chart. */
  const chartData = useMemo(
    () => (active?.sparkline ?? []).map((p) => ({ date: p.date, value: p.value })),
    [active],
  );

  /**
   * The activity series as plain rows.
   *
   * Recharts takes an indexable record; a named interface has no index
   * signature, so the shape is spelled out here once rather than cast four
   * times at the call sites.
   */
  const activitySeries = useMemo(
    () =>
      (overview?.series ?? []).map((p) => ({
        date: p.date,
        leads: p.leads,
        subscribers: p.subscribers,
        revenueCents: p.revenueCents,
      })),
    [overview],
  );

  const leadDonut = useMemo(() => {
    const palette: Record<string, string> = {
      new: "var(--info)",
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

  const firstName = (user?.name || user?.email || "there").split(/[\s@]/)[0];

  async function refreshFigures() {
    setRefreshing(true);
    try {
      await reportsApi.refresh();
      toast.success("We're working your figures out — check back in a minute or two.");
    } catch (err) {
      toast.error(friendlyError(err, "figure"));
    } finally {
      setRefreshing(false);
    }
  }

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

      {/* When the figures were last worked out */}
      {figures && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          {figures.figuresUpdatedAt ? (
            <>Worked out {formatRelative(figures.figuresUpdatedAt)}, and again every night.</>
          ) : (
            <>Your figures haven't been worked out yet.</>
          )}
          <button
            type="button"
            onClick={refreshFigures}
            disabled={refreshing}
            className="inline-flex items-center gap-1 font-semibold text-plum hover:underline disabled:opacity-60"
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
            {refreshing ? "Working them out…" : "Work them out now"}
          </button>
        </p>
      )}

      {/* The daily numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.length === 0
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-36 w-full" />)
          : tiles.map((tile) => {
              const chosen = tile.key === selected;
              const colour = TILE_COLORS[tile.key] ?? CHART_COLORS.plum;
              return (
                <Card
                  key={tile.key}
                  className={cn(
                    "overflow-hidden transition-colors",
                    chosen && "border-plum-bright/45",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(tile.key)}
                    aria-pressed={chosen}
                    className="w-full px-5 pt-5 text-left"
                  >
                    <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                      {tile.label}
                    </span>
                    <span className="mt-2 flex flex-wrap items-baseline gap-2">
                      <span className="font-display text-[1.7rem] leading-none text-ink">
                        {formatValue(tile.value, tile.format, tile.currency)}
                      </span>
                      {tile.changePercent !== null && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 text-[0.7rem] font-bold",
                            tile.changePercent >= 0 ? "text-green-bright" : "text-red-300",
                          )}
                        >
                          {tile.changePercent >= 0 ? (
                            <TrendingUp className="size-3" />
                          ) : (
                            <TrendingDown className="size-3" />
                          )}
                          {Math.abs(tile.changePercent)}%
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-ink-soft">
                      {tile.description}
                    </span>
                  </button>

                  {tile.sparkline.length > 0 && (
                    <div className="-mx-1 mt-3">
                      <Sparkline
                        data={tile.sparkline.map((p) => ({ date: p.date, value: p.value }))}
                        dataKey="value"
                        color={colour}
                      />
                    </div>
                  )}

                  {tile.reportId && (
                    <div className="border-t border-hairline/60 px-5 py-2.5">
                      <Link
                        to={`/admin/analytics/reports/${tile.reportId}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-plum hover:underline"
                      >
                        See the whole picture
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </div>
                  )}
                </Card>
              );
            })}

        {/* Only when card payments are actually set up. */}
        {figures?.balance && (
          <Card className="overflow-hidden p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Waiting to reach your bank
                </p>
                <p className="mt-2 font-display text-[1.7rem] leading-none text-ink">
                  {figures.balance.available.length === 0
                    ? formatCurrency(0)
                    : figures.balance.available
                        .map((b) => formatValue(b.amountCents, "money", b.currency))
                        .join(" · ")}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  Ready to pay out
                  {figures.balance.pending.length > 0 && (
                    <>
                      , with{" "}
                      {figures.balance.pending
                        .map((b) => formatValue(b.amountCents, "money", b.currency))
                        .join(" · ")}{" "}
                      still clearing
                    </>
                  )}
                  .
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/[0.12] text-gold">
                <Landmark className="size-4" />
              </span>
            </div>
            <div className="mt-4 border-t border-hairline/70 pt-3">
              <Link
                to="/admin/sales/payouts"
                className="inline-flex items-center gap-1 text-xs font-semibold text-plum hover:underline"
              >
                See your payouts
                <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </Card>
        )}
      </div>

      {/* The chart for whichever number she picked */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline/60 px-5 py-3.5">
            <Badge tone="plum">Last {figures?.range.days ?? 30} days</Badge>
            {active && active.format === "money" && (
              <Badge tone="neutral">
                {active.currency === "mixed"
                  ? "More than one currency"
                  : active.currency.toUpperCase()}
              </Badge>
            )}
            <p className="text-xs text-ink-soft">Pick a number above to chart it here.</p>
            <Link
              to="/admin/analytics/reports"
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-plum hover:underline"
            >
              See all your numbers
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          <div className="px-3 py-5 sm:px-5">
            {active && (
              <p className="mb-3 px-2 text-xs leading-relaxed text-ink-soft sm:px-1">
                <span className="font-semibold text-ink">{active.label}.</span>{" "}
                {active.description}
                {active.previousValue !== null && (
                  <>
                    {" "}
                    That's {formatValue(active.value, active.format, active.currency)} against{" "}
                    {formatValue(active.previousValue, active.format, active.currency)} in the
                    period before.
                  </>
                )}
              </p>
            )}
            {figures === null ? (
              <Skeleton className="h-[260px] w-full" />
            ) : chartData.length === 0 ? (
              /* An all-time total has no day-by-day line. A skeleton here reads
                 as "still loading" and never resolves. */
              <p className="px-2 py-16 text-center text-sm text-ink-soft">
                This one is an all-time total, so there's no day-by-day line to draw.
              </p>
            ) : (
              <TrendAreaChart
                data={chartData}
                currency={active?.format === "money"}
                series={[
                  {
                    key: "value",
                    label: active?.label ?? "Money coming in",
                    color: TILE_COLORS[active?.key ?? "gross"] ?? CHART_COLORS.plum,
                  },
                ]}
              />
            )}
          </div>
        </Card>

        {/* Income rail */}
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <Card className="relative overflow-hidden bg-surface-raised p-5 text-ink">
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
          series={activitySeries}
          seriesKey="leads"
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
          series={activitySeries}
          seriesKey="subscribers"
          color={CHART_COLORS.green}
        />
        <StatTile
          label="Lessons"
          value={overview?.totals.lessons}
          hint={overview ? `Across ${pluralize(overview.totals.courses, "course")}` : undefined}
          icon={<BookOpen className="size-4" />}
          to="/admin/courses"
          series={activitySeries}
          /* No lessons-per-day figure is collected, and the line under this
             number used to be daily takings — a money curve under a count. */
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
          series={activitySeries}
          /* Likewise: this drew email sign-ups under a count of chats. */
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
  /** Omitted where nothing collected matches the number above. */
  seriesKey?: string;
  color: string;
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full overflow-hidden p-5 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-plum/30 group-hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.55)]">
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
        {seriesKey && series.length > 0 && (
          <div className="-mx-1 mt-3">
            <Sparkline data={series} dataKey={seriesKey} color={color} />
          </div>
        )}
      </Card>
    </Link>
  );
}
