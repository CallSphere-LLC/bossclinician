import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  CreditCard,
  FileText,
  Info,
  Landmark,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Repeat,
  ShoppingBag,
  Sparkles,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber, formatRelative } from "@/lib/format";
import { formatValue, reportsApi } from "@/lib/reportsApi";
import {
  comparisonLabel,
  DASHBOARD_RANGES,
  dashboardApi,
  type AttentionItem,
  type DashboardMoney,
  type DashboardPulse,
  type Kpi,
  type RecentSale,
  type TodayEntry,
} from "@/lib/dashboardApi";
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
import { KPICard, KPIGrid } from "@/pages/admin/ui/KPICard";
import { Drawer, DrawerFacts } from "@/pages/admin/ui/Drawer";
import { TrendAreaChart, useChartColors } from "@/pages/admin/ui/Charts";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { DEMO_ATTENTION, demoMoney, demoPulse, demoToday } from "@/pages/admin/ui/demoData";

/**
 * The business command centre — Part II §11, §14–§16, §18–§31, §55.
 *
 * Laid out in the order §55 draws it: the KPI row, then revenue beside what
 * needs attention, then programs beside today, then the sales table, then the
 * three summaries, then the activity feed. That order is not decoration — it
 * answers §1's five questions from the top down, so the owner who reads only
 * the first screenful has still read the important half.
 *
 * Four rules run through the whole file:
 *
 * - **A section the role cannot see is absent, not empty.** The server omits
 *   it (see `dashboardPanels.ts`), and `undefined` here renders nothing at all,
 *   where `[]` renders the §43 empty state. A Coach should not be told there
 *   is a payments panel she is not allowed to read.
 *
 * - **Partial failure is normal.** Four requests fan out and each is caught
 *   separately; one 403 or one slow panel must not blank a screen where the
 *   rest of the figures are fine.
 *
 * - **Nothing is invented.** Where there is no data the panel says so in
 *   words. Sample data exists (§53) but only behind an explicit toggle and a
 *   banner, because an empty database and a demo dataset are indistinguishable
 *   on a KPI card and only one of them is her money.
 *
 * - **Colour is never the only signal** (§51): every status carries a word,
 *   every trend carries an arrow and a sign.
 */

/* ------------------------------------------------------------------ helpers */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** First name only — "Good morning, Yvette Howard" reads like a form letter. */
function firstName(user: { name?: string | null; email?: string | null } | null): string {
  const source = user?.name?.trim() || user?.email || "";
  const name = source.split(/[\s@.]+/)[0] ?? "";
  return name ? name[0].toUpperCase() + name.slice(1) : "there";
}

function formatKpi(kpi: Kpi): string {
  return formatValue(kpi.value, kpi.format, kpi.currency);
}

const KPI_ICONS: Record<string, ReactNode> = {
  "gross-revenue": <TrendingUp />,
  "net-revenue": <Wallet />,
  "subscription-revenue": <Repeat />,
  "offers-sold": <ShoppingBag />,
  "new-contacts": <UserPlus />,
  "email-optins": <Mail />,
  mrr: <Repeat />,
  aov: <CreditCard />,
  refunds: <RefreshCw />,
  "active-members": <Users />,
  applications: <FileText />,
  "course-completion": <BookOpen />,
  "coaching-sessions": <CalendarDays />,
  "failed-payments": <AlertTriangle />,
  "email-open-rate": <Mail />,
  "email-click-rate": <Mail />,
};

/* -------------------------------------------------------------------- page */

type RevenueSeriesKey = "gross" | "net" | "subscriptions";

export default function Dashboard() {
  const { user } = useAuth();
  const colors = useChartColors();

  const [rangeKey, setRangeKey] = useState("30");
  const [sample, setSample] = useState(false);

  const [money, setMoney] = useState<DashboardMoney | null>(null);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  const [today, setToday] = useState<TodayEntry[] | null>(null);
  const [pulse, setPulse] = useState<DashboardPulse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revenueSeries, setRevenueSeries] = useState<RevenueSeriesKey>("gross");
  const [showSecondary, setShowSecondary] = useState(false);

  const range = DASHBOARD_RANGES.find((r) => r.key === rangeKey) ?? DASHBOARD_RANGES[2];
  const days = range.days;

  useEffect(() => {
    if (sample) {
      setMoney(demoMoney(days));
      setAttention(DEMO_ATTENTION);
      setToday(demoToday());
      setPulse(demoPulse(days));
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Settled separately rather than through Promise.all: a role without
    // `orders.view` gets a 403 on one of these, and one rejection must not
    // take the other three figures off the screen with it.
    Promise.all([
      dashboardApi.money(days).catch(() => null),
      dashboardApi.attention().catch(() => null),
      dashboardApi.today().catch(() => null),
      dashboardApi.pulse(days).catch(() => null),
    ]).then(([m, a, t, p]) => {
      if (cancelled) return;
      setMoney(m);
      setAttention(a?.items ?? null);
      setToday(t?.entries ?? null);
      setPulse(p);
      // Only a clean sweep is worth an error banner — anything less and the
      // screen still has something true on it.
      setError(
        m || a || t || p
          ? null
          : "We couldn't load your dashboard. Try refreshing the page.",
      );
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [days, sample]);

  /** Re-run the nightly rollup so the figures catch up without waiting for it. */
  const recalculate = useCallback(async () => {
    setRefreshing(true);
    try {
      await reportsApi.refresh();
      toast.success("Working your figures out again. They'll update shortly.");
    } catch (err) {
      toast.error(friendlyError(err, "work your figures out again"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const comparison = comparisonLabel(days);

  const revenuePoints = useMemo(() => {
    if (!money) return [];
    return money.revenue[revenueSeries].map((p) => ({ date: p.date, value: p.value }));
  }, [money, revenueSeries]);

  return (
    <div className="space-y-6">
      <DashboardHeader
        name={firstName(user)}
        rangeKey={rangeKey}
        onRange={setRangeKey}
        comparison={comparison}
        figuresUpdatedAt={money?.figuresUpdatedAt ?? null}
        refreshing={refreshing}
        onRefresh={recalculate}
        sample={sample}
        onSample={setSample}
      />

      {sample && <SampleBanner onExit={() => setSample(false)} />}
      {error && <ErrorNotice message={error} />}

      {/* §14 — the six primary figures. */}
      {loading && !money ? (
        <KPIGrid columns={6}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[7.5rem]" />
          ))}
        </KPIGrid>
      ) : money ? (
        <>
          <KPIGrid columns={6}>
            {money.kpis.primary.map((k) => (
              <KPICard
                key={k.key}
                title={k.label}
                value={formatKpi(k)}
                change={k.changePercent}
                comparison={comparison}
                sense={k.sense}
                sparkline={k.sparkline}
                icon={KPI_ICONS[k.key]}
                to={sample ? undefined : (k.to ?? undefined)}
                highlight={k.key === "gross-revenue"}
              />
            ))}
          </KPIGrid>

          <div>
            <button
              type="button"
              onClick={() => setShowSecondary((v) => !v)}
              aria-expanded={showSecondary}
              className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-1 text-[0.8rem] font-semibold text-ink-soft transition-colors hover:text-accent"
            >
              {showSecondary ? "Hide" : "Show"} the other figures
              <span aria-hidden className={cn("transition-transform", showSecondary && "rotate-90")}>
                ›
              </span>
            </button>
            {/* Progressive disclosure, per §1: eleven more cards above the
                revenue chart would bury the thing the page exists to show. */}
            {showSecondary && (
              <KPIGrid columns={5}>
                {money.kpis.secondary.map((k) => (
                  <KPICard
                    key={k.key}
                    title={k.label}
                    value={formatKpi(k)}
                    change={k.changePercent}
                    comparison={k.changePercent === null ? undefined : comparison}
                    hint={k.changePercent === null ? k.description : undefined}
                    sense={k.sense}
                    sparkline={k.sparkline}
                    icon={KPI_ICONS[k.key]}
                    to={sample ? undefined : (k.to ?? undefined)}
                  />
                ))}
                {money.balance && <BalanceCard balance={money.balance} />}
              </KPIGrid>
            )}
          </div>
        </>
      ) : null}

      {/* §18 + §19 — revenue beside what needs her. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Revenue"
            subtitle={`Last ${days} days · ${comparison}`}
            icon={<TrendingUp />}
            action={
              <SeriesSwitch value={revenueSeries} onChange={setRevenueSeries} />
            }
          />
          <div className="px-2 pb-2 pt-4">
            <TrendAreaChart
              data={revenuePoints}
              series={[{ key: "value", label: SERIES_LABEL[revenueSeries], color: colors.accent }]}
              currency
              height={244}
              emptyMessage="No revenue in this period yet — this fills in as orders come through."
            />
          </div>
          {money && <RevenueSummary summary={money.revenue.summary} currency={money.revenue.currency} />}
        </Card>

        <NeedsAttention items={attention} loading={loading} />
      </div>

      {/* §21 + §20 — programs beside today. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <ProgramPerformance programs={pulse?.programs} className="xl:col-span-2" />
        <TodayPanel entries={today} loading={loading} />
      </div>

      {/* §22 + §23 */}
      {pulse?.sales && <SalesSection sales={pulse.sales} days={days} />}

      {/* §25, §26, §28 */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <MarketingPanel marketing={pulse?.marketing} />
        <CoursePanel courses={pulse?.courses} />
        <CommunityPanel community={pulse?.community} />
      </div>

      {/* §24, §27, §29 */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ContactsPanel contacts={pulse?.contacts} />
        <CoachingPanel coaching={pulse?.coaching} />
        <ApplicationsPanel applications={pulse?.applications} />
      </div>

      {/* §30 + §31 */}
      <div className="grid gap-4 xl:grid-cols-3">
        <RecentActivity activity={pulse?.activity} className="xl:col-span-2" />
        <QuickActions />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function DashboardHeader({
  name,
  rangeKey,
  onRange,
  comparison,
  figuresUpdatedAt,
  refreshing,
  onRefresh,
  sample,
  onSample,
}: {
  name: string;
  rangeKey: string;
  onRange: (key: string) => void;
  comparison: string;
  figuresUpdatedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  sample: boolean;
  onSample: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] leading-tight text-ink">
          {greeting()}, {name}
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Here&rsquo;s what&rsquo;s happening with Boss Clinician today.
          {figuresUpdatedAt && !sample && (
            <>
              {" "}
              <span className="text-ink-soft/80">
                Figures worked out {formatRelative(figuresUpdatedAt)}.
              </span>
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* §11 — the period, and the comparison it implies. */}
        <div
          role="group"
          aria-label="Date range"
          className="flex items-center gap-0.5 rounded-xl border border-hairline bg-surface p-0.5"
        >
          {DASHBOARD_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => onRange(r.key)}
              aria-pressed={rangeKey === r.key}
              className={cn(
                "rounded-[0.6rem] px-3 py-1.5 text-[0.78rem] font-semibold transition-colors",
                rangeKey === r.key
                  ? "bg-accent-solid text-accent-on"
                  : "text-ink-soft hover:bg-raise hover:text-ink",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <span className="hidden text-[0.72rem] text-ink-soft sm:inline">{comparison}</span>

        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing || sample}
          title="Work the figures out again now, without waiting for tonight"
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
          {refreshing ? "Working…" : "Recalculate"}
        </Button>

        <Button
          variant={sample ? "primary" : "ghost"}
          size="sm"
          onClick={() => onSample(!sample)}
          aria-pressed={sample}
          title="Fill the dashboard with example figures so you can see how it works"
        >
          <Sparkles />
          Sample data
        </Button>
      </div>
    </div>
  );
}

/**
 * The banner that must be showing whenever a figure on this page is invented.
 *
 * Not dismissible while sample mode is on, and the only control on it turns
 * sample mode off. A dismissible "this is fake" notice on a screen full of
 * revenue is a trap.
 */
function SampleBanner({ onExit }: { onExit: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3"
    >
      <p className="flex items-center gap-2.5 text-sm font-medium text-warn">
        <Sparkles aria-hidden className="size-4 shrink-0" />
        You&rsquo;re looking at example figures, not your business. Nothing here is real.
      </p>
      <Button variant="secondary" size="sm" onClick={onExit}>
        Show my real figures
      </Button>
    </div>
  );
}

/* ----------------------------------------------------------------- revenue */

const SERIES_LABEL: Record<RevenueSeriesKey, string> = {
  gross: "Gross revenue",
  net: "Net revenue",
  subscriptions: "Subscriptions",
};

function SeriesSwitch({
  value,
  onChange,
}: {
  value: RevenueSeriesKey;
  onChange: (next: RevenueSeriesKey) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Revenue series"
      className="flex items-center gap-0.5 rounded-lg border border-hairline p-0.5"
    >
      {(Object.keys(SERIES_LABEL) as RevenueSeriesKey[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            "rounded-md px-2.5 py-1 text-[0.72rem] font-semibold transition-colors",
            value === key ? "bg-accent-soft text-accent" : "text-ink-soft hover:text-ink",
          )}
        >
          {key === "subscriptions" ? "Subs" : SERIES_LABEL[key].split(" ")[0]}
        </button>
      ))}
    </div>
  );
}

function RevenueSummary({
  summary,
  currency,
}: {
  summary: DashboardMoney["revenue"]["summary"];
  currency: string;
}) {
  const figures = [
    { label: "Gross", value: formatValue(summary.grossCents, "money", currency) },
    { label: "Net", value: formatValue(summary.netCents, "money", currency) },
    { label: "Refunds", value: formatValue(summary.refundCents, "money", currency) },
    { label: "Subscriptions", value: formatValue(summary.subscriptionCents, "money", currency) },
    { label: "Average order", value: formatValue(summary.averageOrderCents, "money", currency) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline/70 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
      {figures.map((f) => (
        <div key={f.label}>
          <dt className="text-[0.72rem] text-ink-soft">{f.label}</dt>
          <dd className="mt-0.5 font-numeric text-[1.05rem] font-semibold text-ink tabular-nums">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BalanceCard({ balance }: { balance: NonNullable<DashboardMoney["balance"]> }) {
  const available = balance.available[0];
  const pending = balance.pending[0];
  return (
    <KPICard
      title="Stripe Balance"
      value={available ? formatCurrency(available.amountCents, available.currency) : "—"}
      hint={pending ? `${formatCurrency(pending.amountCents, pending.currency)} on its way` : undefined}
      icon={<Landmark />}
    />
  );
}

/* --------------------------------------------------------- §19 needs attention */

const SEVERITY_STYLE = {
  critical: { ring: "border-neg/35 bg-neg-soft", text: "text-neg", Icon: AlertTriangle },
  warning: { ring: "border-warn/35 bg-warn-soft", text: "text-warn", Icon: AlertTriangle },
  info: { ring: "border-hairline bg-raise", text: "text-ink-soft", Icon: Info },
} as const;

function NeedsAttention({ items, loading }: { items: AttentionItem[] | null; loading: boolean }) {
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Needs attention"
        subtitle={items && items.length > 0 ? pluralize(items.length, "thing", "things") : undefined}
        icon={<AlertTriangle />}
      />
      {loading && !items ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : !items ? null : items.length === 0 ? (
        <EmptyState
          icon={<Award />}
          title="Nothing needs you right now"
          description="Failed payments, reported posts and anything else that needs a decision will appear here."
        />
      ) : (
        <ul className="divide-y divide-hairline/60">
          {items.map((item) => {
            const style = SEVERITY_STYLE[item.severity];
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-raise"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border [&_svg]:size-4",
                      style.ring,
                      style.text,
                    )}
                  >
                    <style.Icon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[0.86rem] font-semibold text-ink">
                        {item.title}
                      </span>
                      {/* The count is its own element, not colour on the title:
                          §51 forbids leaning on colour, and a number reads at a
                          glance where a red tint does not. */}
                      <span className={cn("shrink-0 font-numeric text-base font-semibold tabular-nums", style.text)}>
                        {item.count}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[0.76rem] leading-snug text-ink-soft">
                      {item.detail}
                    </span>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[0.74rem] font-semibold text-accent">
                      {item.actionLabel}
                      <ArrowRight aria-hidden className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- §20 today */

function TodayPanel({ entries, loading }: { entries: TodayEntry[] | null; loading: boolean }) {
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Today"
        subtitle={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        icon={<CalendarDays />}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/coaching">View calendar</Link>
          </Button>
        }
      />
      {loading && !entries ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : !entries ? null : entries.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title="Nothing scheduled today"
          description="Your coaching sessions, classes and community events will appear here."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/coaching">View calendar</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-hairline/60">
          {entries.map((entry) => (
            <li key={entry.key}>
              <Link
                to={entry.to}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raise"
              >
                <span className="w-[4.25rem] shrink-0 font-numeric text-[0.78rem] font-semibold tabular-nums text-accent">
                  {time(entry.at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.85rem] font-medium text-ink">
                    {entry.title}
                  </span>
                  <span className="block truncate text-[0.75rem] text-ink-soft">{entry.subtitle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* --------------------------------------------------- §21 program performance */

function ProgramPerformance({
  programs,
  className,
}: {
  programs?: DashboardPulse["programs"];
  className?: string;
}) {
  if (!programs) return null;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title="Program performance"
        subtitle="Members, revenue and progress across everything you sell"
        icon={<Sparkles />}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/products">View products</Link>
          </Button>
        }
      />
      {programs.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title="No published products yet"
          description="Publish a course, community or coaching package and its performance shows here."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/products">Create a product</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-hairline/60">
          {programs.map((program) => (
            <li key={program.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="min-w-[10rem] flex-1">
                <Link
                  to="/admin/products"
                  className="text-[0.88rem] font-semibold text-ink hover:text-accent"
                >
                  {program.title}
                </Link>
                <p className="mt-0.5 text-[0.72rem] capitalize text-ink-soft">{program.kind}</p>
              </div>
              <div className="text-right">
                <p className="font-numeric text-[0.95rem] font-semibold tabular-nums text-ink">
                  {formatNumber(program.members)}
                </p>
                <p className="text-[0.68rem] text-ink-soft">Members</p>
              </div>
              <div className="text-right">
                <p className="font-numeric text-[0.95rem] font-semibold tabular-nums text-ink">
                  {formatCurrency(program.revenueCents)}
                </p>
                <p className="text-[0.68rem] text-ink-soft">Revenue</p>
              </div>
              <div className="w-[7.5rem]">
                {/* Null means "this product is not a course", which is not 0%.
                    A full-width empty bar would read as nobody making progress. */}
                {program.completionPercent === null ? (
                  <p className="text-right text-[0.72rem] text-ink-soft">—</p>
                ) : (
                  <ProgressBar percent={program.completionPercent} label="Completion" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[0.68rem] text-ink-soft">{label}</span>
        <span className="font-numeric text-[0.72rem] font-semibold tabular-nums text-ink">{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 overflow-hidden rounded-full bg-raise-strong"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------- §22–§23 sales section */

const SALE_STATUS_TONE: Record<string, "green" | "gold" | "red" | "plum" | "slate"> = {
  paid: "green",
  pending: "gold",
  failed: "red",
  refunded: "red",
};

const PRICING_LABEL: Record<string, string> = {
  one_time: "One-time",
  subscription: "Subscription",
  payment_plan: "Payment plan",
  free: "Free",
  pwyw: "Pay what you want",
};

function SalesSection({
  sales,
  days,
}: {
  sales: NonNullable<DashboardPulse["sales"]>;
  days: number;
}) {
  // §23: "Clicking a row should open order details." A drawer rather than a
  // navigation, per §44 — she is reading the dashboard, and the whole point of
  // glancing at an order is to go straight back to it.
  const [openOrder, setOpenOrder] = useState<RecentSale | null>(null);

  const stats = [
    { label: "Purchases", value: sales.purchases },
    { label: "Refunds", value: sales.refunds },
    { label: "Upsells", value: sales.upsells },
    { label: "Recovered checkouts", value: sales.recoveredCheckouts },
    { label: "Left unfinished", value: sales.abandonedCheckouts },
  ];

  return (
    <Card>
      <CardHeader
        title="Sales"
        subtitle={`Last ${days} days`}
        icon={<ShoppingBag />}
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/sales/payments">View all orders</Link>
          </Button>
        }
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-hairline/60 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-[0.72rem] text-ink-soft">{s.label}</dt>
            <dd className="mt-0.5 font-numeric text-[1.05rem] font-semibold tabular-nums text-ink">
              {formatNumber(s.value)}
            </dd>
          </div>
        ))}
      </dl>

      {sales.recent.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag />}
          title="No orders yet"
          description="Every purchase will appear here the moment it completes."
          action={
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/offers">Create an offer</Link>
            </Button>
          }
        />
      ) : (
        // §49: the table stays readable on a narrow screen by scrolling inside
        // its own container rather than pushing the page sideways.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="sr-only">Your most recent orders</caption>
            <thead>
              <tr className="border-b border-hairline/60 text-[0.7rem] uppercase tracking-[0.08em] text-ink-soft">
                <th scope="col" className="px-5 py-2.5 font-semibold">Customer</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Offer</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Type</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Amount</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/50">
              {sales.recent.map((sale) => (
                <tr
                  key={sale.id}
                  onClick={() => setOpenOrder(sale)}
                  className="cursor-pointer transition-colors hover:bg-raise"
                >
                  <td className="px-5 py-3">
                    {/* The row is clickable, but a row is not focusable and a
                        keyboard user needs something that is — so the customer
                        cell carries a real button that opens the same drawer. */}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenOrder(sale);
                      }}
                      className="rounded font-medium text-ink hover:text-accent"
                    >
                      {sale.customer}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{sale.offer}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {PRICING_LABEL[sale.type] ?? sale.type}
                  </td>
                  <td className="px-5 py-3 text-right font-numeric tabular-nums text-ink">
                    {formatCurrency(sale.amountCents, sale.currency)}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={SALE_STATUS_TONE[sale.status] ?? "slate"}>{sale.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{formatRelative(sale.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OrderDrawer sale={openOrder} onClose={() => setOpenOrder(null)} />
    </Card>
  );
}

/** §44's "Order Details" drawer. */
function OrderDrawer({ sale, onClose }: { sale: RecentSale | null; onClose: () => void }) {
  return (
    <Drawer
      open={sale !== null}
      onOpenChange={(open) => !open && onClose()}
      title={sale ? `Order #${sale.id}` : ""}
      description={sale?.offer}
      footer={
        <Button variant="primary" size="sm" asChild>
          <Link to="/admin/sales/payments">Open in payments</Link>
        </Button>
      }
    >
      {sale && (
        <DrawerFacts
          items={[
            { label: "Customer", value: sale.customer },
            { label: "Email", value: sale.email },
            { label: "Offer", value: sale.offer },
            { label: "Type", value: PRICING_LABEL[sale.type] ?? sale.type },
            {
              label: "Amount",
              value: formatCurrency(sale.amountCents, sale.currency),
            },
            {
              label: "Status",
              value: <Badge tone={SALE_STATUS_TONE[sale.status] ?? "slate"}>{sale.status}</Badge>,
            },
            { label: "Placed", value: formatRelative(sale.at) },
          ]}
        />
      )}
    </Drawer>
  );
}

/* ---------------------------------------------------------- small summaries */

/** The shared shell for the §24–§29 summary tiles. */
function SummaryCard({
  title,
  icon,
  to,
  cta,
  children,
}: {
  title: string;
  icon: ReactNode;
  to: string;
  cta: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={title} icon={icon} />
      <div className="flex-1 px-5 py-4">{children}</div>
      <div className="border-t border-hairline/60 px-5 py-3">
        <Link
          to={to}
          className="inline-flex items-center gap-1 text-[0.78rem] font-semibold text-accent hover:underline"
        >
          {cta}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </Card>
  );
}

function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-3">
          <dt className="text-[0.8rem] text-ink-soft">{item.label}</dt>
          <dd className="font-numeric text-[0.98rem] font-semibold tabular-nums text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MarketingPanel({ marketing }: { marketing?: DashboardPulse["marketing"] }) {
  if (!marketing) return null;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <SummaryCard title="Marketing" icon={<Mail />} to="/admin/marketing/campaigns" cta="View email">
      <StatRow
        items={[
          { label: "Emails sent", value: formatNumber(marketing.sends) },
          { label: "Open rate", value: pct(marketing.openRate) },
          { label: "Click rate", value: pct(marketing.clickRate) },
          { label: "Unsubscribed", value: pct(marketing.unsubscribeRate) },
          { label: "Active sequences", value: formatNumber(marketing.activeSequences) },
          { label: "Active automations", value: formatNumber(marketing.activeAutomations) },
        ]}
      />
    </SummaryCard>
  );
}

function CoursePanel({ courses }: { courses?: DashboardPulse["courses"] }) {
  if (!courses) return null;
  return (
    <SummaryCard title="Courses" icon={<BookOpen />} to="/admin/courses" cta="View courses">
      {courses.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No one is enrolled yet. Average progress appears here once people start learning.
        </p>
      ) : (
        <ul className="space-y-3.5">
          {courses.map((course) => (
            <li key={course.id}>
              <p className="mb-1 truncate text-[0.82rem] font-medium text-ink">{course.title}</p>
              <ProgressBar
                percent={course.completionPercent}
                label={pluralize(course.learners, "learner", "learners")}
              />
            </li>
          ))}
        </ul>
      )}
    </SummaryCard>
  );
}

function CommunityPanel({ community }: { community?: DashboardPulse["community"] }) {
  if (!community) return null;
  return (
    <SummaryCard title="Community" icon={<MessageSquare />} to="/admin/community" cta="View community">
      <StatRow
        items={[
          { label: "Members", value: formatNumber(community.activeMembers) },
          { label: "Posts this week", value: formatNumber(community.postsThisWeek) },
          { label: "Comments this week", value: formatNumber(community.commentsThisWeek) },
          { label: "Reported posts", value: formatNumber(community.reportedPosts) },
        ]}
      />
    </SummaryCard>
  );
}

function ContactsPanel({ contacts }: { contacts?: DashboardPulse["contacts"] }) {
  if (!contacts) return null;
  return (
    <SummaryCard title="Contacts" icon={<Users />} to="/admin/contacts" cta="View contacts">
      <StatRow
        items={[
          { label: "Total contacts", value: formatNumber(contacts.total) },
          { label: "New this period", value: formatNumber(contacts.newThisPeriod) },
          { label: "Members", value: formatNumber(contacts.members) },
          { label: "Email subscribers", value: formatNumber(contacts.subscribed) },
        ]}
      />
      {contacts.topCustomer && (
        <div className="mt-4 rounded-lg border border-hairline bg-raise px-3 py-2.5">
          <p className="text-[0.68rem] uppercase tracking-[0.08em] text-ink-soft">Top customer</p>
          <p className="mt-0.5 truncate text-[0.85rem] font-semibold text-ink">
            {contacts.topCustomer.name}
          </p>
          <p className="font-numeric text-[0.75rem] tabular-nums text-ink-soft">
            {formatCurrency(contacts.topCustomer.lifetimeValueCents)} lifetime
          </p>
        </div>
      )}
    </SummaryCard>
  );
}

function CoachingPanel({ coaching }: { coaching?: DashboardPulse["coaching"] }) {
  if (!coaching) return null;
  return (
    <SummaryCard title="Coaching" icon={<CalendarDays />} to="/admin/coaching" cta="View coaching">
      <StatRow
        items={[
          { label: "Sessions today", value: formatNumber(coaching.today) },
          { label: "This week", value: formatNumber(coaching.thisWeek) },
          { label: "Completed", value: formatNumber(coaching.completed) },
          { label: "Cancelled", value: formatNumber(coaching.cancelled) },
          { label: "Upcoming", value: formatNumber(coaching.upcoming) },
        ]}
      />
      {coaching.next.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[0.68rem] uppercase tracking-[0.08em] text-ink-soft">Next up</p>
          {coaching.next.map((session) => (
            <div key={session.id} className="rounded-lg border border-hairline bg-raise px-3 py-2">
              <p className="truncate text-[0.82rem] font-medium text-ink">{session.member}</p>
              <p className="truncate text-[0.73rem] text-ink-soft">
                {formatRelative(session.at)} · {session.title}
              </p>
            </div>
          ))}
        </div>
      )}
    </SummaryCard>
  );
}

function ApplicationsPanel({ applications }: { applications?: DashboardPulse["applications"] }) {
  if (!applications) return null;
  const total = applications.reduce((sum, row) => sum + row.count, 0);
  return (
    <SummaryCard title="Applications" icon={<FileText />} to="/admin/leads" cta="Review applications">
      {total === 0 ? (
        <p className="text-sm text-ink-soft">
          No enquiries in this period. New applications from your forms appear here.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {applications.map((row) => (
            <li key={row.status}>
              <Badge tone={LEAD_STATUS_TONE[row.status] ?? "slate"}>
                {row.count} {leadStatusLabel(row.status)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </SummaryCard>
  );
}

/* ----------------------------------------------------------- §30 activity */

const ACTIVITY_ICON: Record<string, ReactNode> = {
  order: <ShoppingBag />,
  payment: <CreditCard />,
  refund: <RefreshCw />,
  lesson: <BookOpen />,
  booking: <CalendarDays />,
  form: <FileText />,
  email: <Mail />,
  certificate: <Award />,
  tag: <Ticket />,
  community: <MessageSquare />,
};

function RecentActivity({
  activity,
  className,
}: {
  activity?: DashboardPulse["activity"];
  className?: string;
}) {
  if (!activity) return null;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader title="Recent activity" icon={<Activity />} />
      {activity.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title="Nothing has happened yet"
          description="Purchases, lessons, bookings and sign-ups all show up here as they happen."
        />
      ) : (
        <ul className="divide-y divide-hairline/60">
          {activity.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-5 py-2.5">
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-raise text-ink-soft [&_svg]:size-4"
              >
                {ACTIVITY_ICON[item.kind] ?? <Activity />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.84rem] text-ink">
                  {item.contactId ? (
                    <Link
                      to={`/admin/contacts/${item.contactId}`}
                      className="font-medium hover:text-accent"
                    >
                      {item.person}
                    </Link>
                  ) : (
                    <span className="font-medium">{item.person}</span>
                  )}{" "}
                  <span className="text-ink-soft">{item.title}</span>
                </span>
              </span>
              <time
                dateTime={item.at}
                className="shrink-0 font-numeric text-[0.72rem] tabular-nums text-ink-soft"
              >
                {formatRelative(item.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------ §31 quick actions */

const QUICK_ACTIONS = [
  { to: "/admin/contacts", label: "Add contact", icon: <UserPlus /> },
  { to: "/admin/offers/new", label: "Create offer", icon: <Ticket /> },
  { to: "/admin/products", label: "Create product", icon: <ShoppingBag /> },
  { to: "/admin/marketing/campaigns", label: "Send email", icon: <Mail /> },
  { to: "/admin/marketing/automations-v2", label: "Create automation", icon: <Sparkles /> },
  { to: "/admin/marketing/events-v2", label: "Schedule event", icon: <CalendarDays /> },
];

function QuickActions() {
  return (
    <Card className="flex flex-col">
      <CardHeader title="Quick actions" icon={<Plus />} />
      <div className="grid grid-cols-2 gap-2 p-4">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="flex items-center gap-2.5 rounded-xl border border-hairline bg-raise px-3 py-2.5 text-[0.8rem] font-medium text-ink transition-all hover:-translate-y-0.5 hover:border-accent/45 hover:text-accent motion-reduce:hover:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-soft"
          >
            {action.icon}
            <span className="truncate">{action.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
