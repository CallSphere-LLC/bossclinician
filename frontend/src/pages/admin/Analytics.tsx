import { useEffect, useMemo, useState } from "react";
import { BarChart3, GraduationCap, Inbox } from "lucide-react";
import { adminApi } from "@/lib/api";
import type { DashboardOverview, RevenueSummary } from "@/types/admin";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
  leadStatusLabel,
} from "@/pages/admin/ui/primitives";
import {
  CHART_COLORS,
  DonutChart,
  MiniBarChart,
  TrendAreaChart,
} from "@/pages/admin/ui/Charts";

export default function Analytics() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.overview(), adminApi.revenue()])
      .then(([o, r]) => {
        setOverview(o);
        setRevenue(r);
      })
      .catch(() => setError("We couldn't load your numbers. Try refreshing the page."));
  }, []);

  const activityData = useMemo(
    () =>
      (overview?.series ?? []).map((point) => ({
        date: point.date,
        leads: point.leads,
        subscribers: point.subscribers,
      })),
    [overview],
  );

  const revenueData = useMemo(
    () =>
      (revenue?.series ?? []).map((point) => ({
        date: point.date,
        oneTime: point.oneTimeCents,
        subscription: point.subscriptionCents,
      })),
    [revenue],
  );

  const leadDonut = useMemo(() => {
    const palette: Record<string, string> = {
      new: "#3B82F6",
      contacted: CHART_COLORS.gold,
      qualified: CHART_COLORS.green,
      closed: CHART_COLORS.plum,
      archived: CHART_COLORS.slate,
    };
    return (overview?.leadsByStatus ?? []).map((s) => ({
      // Slice, tooltip and legend all read the owner's wording for the stored
      // status rather than the one-word machine state behind it.
      name: leadStatusLabel(s.status),
      value: s.count,
      color: palette[s.status] ?? CHART_COLORS.slate,
    }));
  }, [overview]);

  const courseBars = useMemo(
    () =>
      (overview?.topCourses ?? []).map((c) => ({
        name: c.title.length > 16 ? `${c.title.slice(0, 15)}…` : c.title,
        // The bar chart labels its tooltip with the field name, so the field is
        // spelled the way she should read it rather than as "enrollments".
        "Students enrolled": c.enrollments,
      })),
    [overview],
  );

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Analytics" title="Overview" />
        <ErrorNotice message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Overview"
        description="How your money, your audience and your enquiries are doing. The totals below are all time; every chart covers the last 30 days."
        actions={<Badge tone="plum">Charts show the last 30 days</Badge>}
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Money coming in"
          hint="Everything people have paid you"
          value={revenue && formatCurrency(revenue.grossCents)}
        />
        <Kpi
          label="Money every month"
          hint="From people on a plan"
          value={revenue && formatCurrency(revenue.mrrCents)}
        />
        <Kpi
          label="Enquiries"
          hint="People who've got in touch"
          value={overview && formatNumber(overview.totals.leads)}
        />
        <Kpi
          label="On your email list"
          hint="People signed up to hear from you"
          value={overview && formatNumber(overview.totals.subscribers)}
        />
      </div>

      <Card>
        <CardHeader
          title="Money coming in"
          subtitle="One-off purchases next to monthly plan payments, day by day"
        />
        <div className="px-3 py-5 sm:px-5">
          {revenueData.length === 0 ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <TrendAreaChart
              data={revenueData}
              currency
              height={280}
              series={[
                { key: "oneTime", label: "One-off purchases", color: CHART_COLORS.plum },
                { key: "subscription", label: "Monthly plans", color: CHART_COLORS.gold },
              ]}
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Audience growth"
          subtitle="How many people got in touch, and how many joined your email list, each day"
        />
        <div className="px-3 py-5 sm:px-5">
          {activityData.length === 0 ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <TrendAreaChart
              data={activityData}
              series={[
                { key: "leads", label: "New enquiries", color: CHART_COLORS.plum },
                { key: "subscribers", label: "Email sign-ups", color: CHART_COLORS.green },
              ]}
            />
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Where your enquiries are up to"
            subtitle="Everyone who's got in touch, grouped by what you've done next"
            icon={<Inbox className="size-4" />}
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
              <DonutChart data={leadDonut} totalLabel="Enquiries" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Most popular courses"
            subtitle="How many students are in each one"
            icon={<GraduationCap className="size-4" />}
          />
          <div className="p-5">
            {overview === null ? (
              <Skeleton className="h-[180px] w-full" />
            ) : courseBars.length === 0 ? (
              <EmptyState
                icon={<BarChart3 />}
                title="No students enrolled yet"
                description="Course sign-ups will show up here."
              />
            ) : (
              <MiniBarChart data={courseBars} dataKey="Students enrolled" />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * One headline number. `hint` says what it counts — a bare "$12,400" invites
 * the question "since when?", which is exactly the question this screen exists
 * to answer.
 */
function Kpi({ label, hint, value }: { label: string; hint?: string; value: string | null }) {
  return (
    <Card className="p-5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {label}
      </p>
      {value === null ? (
        <Skeleton className="mt-2.5 h-7 w-24" />
      ) : (
        <p className="mt-2 font-display text-[1.6rem] leading-none text-ink">{value}</p>
      )}
      {hint && <p className="mt-1.5 text-xs text-ink-soft/85">{hint}</p>}
    </Card>
  );
}
