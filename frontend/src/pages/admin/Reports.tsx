import { useEffect, useMemo, useState } from "react";
import { Download, FileStack, Split, TrendingDown, Users } from "lucide-react";
import { adminApi } from "@/lib/api";
import type {
  AudienceReport,
  ContentReport,
  FunnelReport,
  SubscriptionReport,
} from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { humanizeKey, pluralize } from "@/pages/admin/ui/friendly";
import { CHART_COLORS, MiniBarChart, TrendAreaChart } from "@/pages/admin/ui/Charts";

/**
 * What each journey was set up to do, in her words. Deliberately the same
 * wording as the picker on the Funnels screen — a journey should not be called
 * one thing where she builds it and another where she reads its numbers.
 */
const JOURNEY_PURPOSE: Record<string, string> = {
  opt_in: "Collecting email addresses",
  webinar: "Filling a webinar",
  sales: "Selling something",
  launch: "Running a launch",
};

export default function Reports() {
  const [subs, setSubs] = useState<SubscriptionReport | null>(null);
  const [audience, setAudience] = useState<AudienceReport | null>(null);
  const [funnels, setFunnels] = useState<FunnelReport[] | null>(null);
  const [content, setContent] = useState<ContentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      adminApi.reportSubscriptions(),
      adminApi.reportAudience(),
      adminApi.reportFunnels(),
      adminApi.reportContent(),
    ])
      .then(([s, a, f, c]) => {
        setSubs(s);
        setAudience(a);
        setFunnels(f);
        setContent(c);
      })
      .catch(() => setError("We couldn't load your numbers. Try refreshing the page."));
  }, []);

  const contentBars = useMemo(
    () =>
      content
        ? [
            // The bar chart labels its tooltip with the field name, so the field
            // is spelled the way she should read it rather than as "value".
            { name: "Blog posts", "How many": content.posts },
            { name: "Lessons", "How many": content.lessons },
            { name: "Episodes", "How many": content.episodes },
            { name: "Newsletters", "How many": content.issuesSent },
            { name: "Community", "How many": content.communityPosts },
            { name: "Files", "How many": content.mediaAssets },
          ]
        : [],
    [content],
  );

  /**
   * Every number on this page as one spreadsheet.
   *
   * The first column is the same sentence she reads on screen — a file full of
   * `mrr_usd` and `churn_rate_pct` is unreadable the moment it leaves this
   * dashboard, which is the only place those short names ever made sense.
   */
  function downloadSpreadsheet() {
    if (!subs || !audience || !content) return;
    const rows: [string, string | number][] = [
      ["People paying you every month", subs.activeCount],
      ["Money every month (US dollars)", (subs.mrrCents / 100).toFixed(2)],
      ["Average each person pays per month (US dollars)", (subs.arpuCents / 100).toFixed(2)],
      ["Share of people who left in the last 30 days (%)", subs.churnRate],
      ["People who left in the last 30 days", subs.churned30d],
      ["People who joined a plan in the last 30 days", subs.new30d],
      ["People cancelling when their month runs out", subs.pendingCancel],
      ["People on your email list", audience.totals.subscribers],
      ["Members", audience.totals.members],
      ["Enquiries", audience.totals.leads],
      ["Form replies", audience.totals.formSubmissions],
      ["People in your community", audience.totals.communityMembers],
      ["Blog posts live on your site", content.posts],
      ["Lessons", content.lessons],
      ["Podcast episodes", content.episodes],
      ["Newsletters sent", content.issuesSent],
      ["Community posts", content.communityPosts],
      ["Files in your library", content.mediaAssets],
    ];

    const csv = `"Your numbers","Amount"\n${rows.map(([k, v]) => `"${k}","${v}"`).join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `your-numbers-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Analytics" title="Reports" />
        <ErrorNotice message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="The numbers behind your business — who's paying you, how your audience is growing, how people move through your sign-up journeys, and everything you've published."
        actions={
          <Button variant="secondary" size="sm" onClick={downloadSpreadsheet} disabled={!subs}>
            <Download />
            Download as spreadsheet (opens in Excel)
          </Button>
        }
      />

      {/* Money coming in every month */}
      <Card>
        <CardHeader
          title="Active subscriptions"
          subtitle="How your plans and memberships are doing right now"
        />
        <div className="grid gap-px bg-hairline/60 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="People paying you"
            hint="on a plan right now"
            value={subs && formatNumber(subs.activeCount)}
          />
          <Metric
            label="Money every month"
            hint="what those plans add up to"
            value={subs && formatCurrency(subs.mrrCents)}
            accent
          />
          <Metric
            label="Average per person"
            hint="each month"
            value={subs && formatCurrency(subs.arpuCents)}
          />
          <Metric
            label="People leaving"
            hint="share who cancelled in the last 30 days"
            value={subs && `${subs.churnRate}%`}
            tone={subs && subs.churnRate > 5 ? "bad" : "good"}
          />
        </div>
        <div className="grid gap-px border-t border-hairline/60 bg-hairline/60 sm:grid-cols-3">
          <Metric
            label="Joined"
            hint="in the last 30 days"
            value={subs && formatNumber(subs.new30d)}
            small
          />
          <Metric
            label="Left"
            hint="in the last 30 days"
            value={subs && formatNumber(subs.churned30d)}
            small
          />
          <Metric
            label="Cancelling soon"
            hint="still have access until their month runs out"
            value={subs && formatNumber(subs.pendingCancel)}
            small
          />
        </div>
        {subs && subs.activeCount === 0 && (
          <p className="border-t border-hairline/60 px-5 py-3 text-xs text-ink-soft">
            Nobody is on a paid plan yet — these numbers fill in as soon as someone subscribes.
          </p>
        )}
      </Card>

      {/* Audience */}
      <Card>
        <CardHeader
          title="Audience growth"
          subtitle="Everyone in your world, and how many joined each day over the last 30 days"
          icon={<Users className="size-4" />}
        />
        <div className="grid gap-px bg-hairline/60 sm:grid-cols-3 xl:grid-cols-5">
          <Metric
            label="On your email list"
            value={audience && formatNumber(audience.totals.subscribers)}
            small
          />
          <Metric label="Members" value={audience && formatNumber(audience.totals.members)} small />
          <Metric label="Enquiries" value={audience && formatNumber(audience.totals.leads)} small />
          <Metric
            label="Form replies"
            value={audience && formatNumber(audience.totals.formSubmissions)}
            small
          />
          <Metric
            label="In your community"
            value={audience && formatNumber(audience.totals.communityMembers)}
            small
          />
        </div>
        <div className="px-3 py-5 sm:px-5">
          {audience === null ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <TrendAreaChart
              data={audience.series}
              height={240}
              emptyMessage="Nothing yet — this fills in as people join your list."
              series={[
                { key: "subscribers", label: "Joined your email list", color: CHART_COLORS.plum },
                { key: "members", label: "Became members", color: CHART_COLORS.green },
              ]}
            />
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Sign-up journeys */}
        <Card>
          <CardHeader
            title="Signup journey"
            subtitle="How many people who land on a journey make it all the way through"
            icon={<Split className="size-4" />}
          />
          {funnels === null ? (
            <Skeleton className="m-5 h-40" />
          ) : funnels.length === 0 ? (
            <EmptyState
              icon={<Split />}
              title="No journeys yet"
              description="Build one and you'll see how many people make it through each stage."
            />
          ) : (
            <ul className="divide-y divide-hairline/60">
              {funnels.map((f) => {
                const rate =
                  f.views > 0 ? Math.round((f.conversions / f.views) * 1000) / 10 : null;
                return (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{f.name}</p>
                      <p className="text-xs text-ink-soft">
                        {pluralize(f.stepCount, "stage")} · {formatNumber(f.views)}{" "}
                        {f.views === 1 ? "person saw it" : "people saw it"}
                      </p>
                    </div>
                    <Badge tone="neutral">{JOURNEY_PURPOSE[f.kind] ?? humanizeKey(f.kind)}</Badge>
                    <div className="text-right">
                      {rate === null ? (
                        <span className="text-xs text-ink-soft">Nobody has visited yet</span>
                      ) : (
                        <>
                          <span className="font-display text-lg text-plum">{rate}%</span>
                          <p className="text-[0.65rem] text-ink-soft">made it to the end</p>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Content */}
        <Card>
          <CardHeader
            title="Content performance"
            subtitle="How much you've published, everywhere it lives"
            icon={<FileStack className="size-4" />}
          />
          <div className="p-5">
            {content === null ? (
              <Skeleton className="h-[180px] w-full" />
            ) : (
              <MiniBarChart
                data={contentBars}
                dataKey="How many"
                color={CHART_COLORS.gold}
                emptyMessage="Nothing published yet — this fills in as you write and upload."
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * One number in a grid. `hint` carries the period or the qualifier — "23"
 * means nothing without "in the last 30 days" sitting under it.
 */
function Metric({
  label,
  hint,
  value,
  small,
  accent,
  tone,
}: {
  label: string;
  hint?: string;
  value: string | null;
  small?: boolean;
  accent?: boolean;
  tone?: "good" | "bad" | null;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {label}
        {tone === "bad" && <TrendingDown className="size-3 text-red-300" />}
      </p>
      {value === null ? (
        <Skeleton className={cn("mt-2", small ? "h-5 w-16" : "h-7 w-24")} />
      ) : (
        <p
          className={cn(
            "mt-1.5 font-display leading-none",
            small ? "text-lg" : "text-[1.6rem]",
            accent ? "text-plum" : tone === "bad" ? "text-red-300" : "text-ink",
          )}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1.5 text-[0.7rem] leading-snug text-ink-soft/85">{hint}</p>}
    </div>
  );
}
