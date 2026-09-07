import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Bookmark, Download, TrendingDown, TrendingUp } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  RANGE_PRESETS,
  formatValue,
  reportsApi,
  shiftDay,
  today,
  type ReportBreakdownRow,
  type ReportResult,
  type SavedView,
  type ValueFormat,
} from "@/lib/reportsApi";
import { cn } from "@/lib/cn";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { DataTable } from "@/pages/admin/ui/DataTable";
import { Modal } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { CHART_COLORS, ComparisonLineChart, TrendAreaChart } from "@/pages/admin/ui/Charts";

/**
 * One screen for all thirty-eight reports.
 *
 * Every report answers in the same shape, so there is one component rather than
 * thirty-eight. What changes per report is only its wording, its breakdown
 * column headings and whether it has a chart at all — a list of what people
 * wrote when they cancelled has nothing to plot, and drawing an empty axis for
 * it would be worse than saying so.
 *
 * The totals row is not decoration: it is the chart's text alternative. Anyone
 * who cannot see the shape of the line still gets every number the line encodes.
 */

const SERIES_COLORS = [
  CHART_COLORS.plum,
  CHART_COLORS.gold,
  CHART_COLORS.green,
  CHART_COLORS.lilac,
];

interface RangeState {
  preset: string;
  from: string;
  to: string;
  compare: boolean;
}

function presetRange(days: number): { from: string; to: string } {
  const to = today();
  return { from: shiftDay(to, -(days - 1)), to };
}

export default function ReportView() {
  const { reportId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const savedViewId = searchParams.get("view");

  const [range, setRange] = useState<RangeState>(() => ({
    preset: "30",
    ...presetRange(30),
    compare: false,
  }));
  const [dimension, setDimension] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savePanel, setSavePanel] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewNote, setViewNote] = useState("");
  const [downloading, setDownloading] = useState(false);

  /* A saved shortcut arrives as a query string; apply it before the first load. */
  useEffect(() => {
    if (!savedViewId) return;
    let cancelled = false;

    reportsApi
      .savedViews()
      .then((views: SavedView[]) => {
        const view = views.find((v) => String(v.id) === savedViewId);
        if (cancelled || !view) return;
        const config = view.config;
        setRange({
          preset: config.days ? String(config.days) : "custom",
          ...(config.days
            ? presetRange(config.days)
            : { from: config.from ?? presetRange(30).from, to: config.to ?? today() }),
          compare: config.compare === "previous",
        });
        setDimension(config.dimension ?? undefined);
        setViewName(view.name);
        setViewNote(view.description);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [savedViewId]);

  const load = useCallback(() => {
    let cancelled = false;
    setReport(null);

    reportsApi
      .run(reportId, {
        from: range.from,
        to: range.to,
        compare: range.compare ? "previous" : "none",
        dimension,
      })
      .then((result) => {
        if (cancelled) return;
        setReport(result);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, "report"));
      });

    return () => {
      cancelled = true;
    };
  }, [reportId, range.from, range.to, range.compare, dimension]);

  useEffect(load, [load]);

  function choosePreset(key: string, days: number) {
    setRange((current) => ({ ...current, preset: key, ...presetRange(days) }));
  }

  async function download() {
    if (!report) return;
    setDownloading(true);
    try {
      await reportsApi.downloadCsv(report.id, report.name, {
        from: range.from,
        to: range.to,
        compare: range.compare ? "previous" : "none",
        dimension,
      });
    } catch (err) {
      toast.error(friendlyError(err, "report"));
    } finally {
      setDownloading(false);
    }
  }

  async function saveView(event: FormEvent) {
    event.preventDefault();
    if (!report || !viewName.trim()) return;
    setSaving(true);
    try {
      await reportsApi.saveView({
        name: viewName.trim(),
        description: viewNote.trim() || undefined,
        reportId: report.id,
        ...(range.preset === "custom"
          ? { from: range.from, to: range.to }
          : { days: Number(range.preset) }),
        compare: range.compare ? "previous" : "none",
        dimension,
      });
      toast.success("Saved. You'll find it at the top of your reports.");
      setSavePanel(false);
    } catch (err) {
      toast.error(friendlyError(err, "saved view"));
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- chart */

  const charted = useMemo(
    () => (report?.series ?? []).filter((s) => s.points.length > 0),
    [report],
  );

  /** Current against the same number of days immediately before. */
  const comparisonData = useMemo(() => {
    const previous = report?.comparison?.points;
    if (!previous || charted.length === 0) return null;
    return charted[0].points.map((point, i) => ({
      date: point.date,
      current: point.value,
      previous: previous[i] ?? 0,
    }));
  }, [report, charted]);

  /**
   * Rows keyed `s0`, `s1`, … rather than by the series' own label.
   *
   * The chart builds SVG gradient ids out of the key, and a label like "The
   * period before" would put spaces inside a `url(#…)` reference and silently
   * drop the fill.
   */
  const chartData = useMemo(
    () =>
      charted.length === 0
        ? []
        : charted[0].points.map((point, i) => {
            const row: Record<string, string | number> = { date: point.date };
            charted.forEach((series, index) => {
              row[`s${index}`] = series.points[i]?.value ?? 0;
            });
            return row;
          }),
    [charted],
  );

  const breakdownColumns = useMemo<ColumnDef<ReportBreakdownRow, unknown>[]>(() => {
    if (!report) return [];
    const valueFormat: ValueFormat = report.breakdownFormat ?? "count";
    const countFormat: ValueFormat = report.breakdownCountFormat ?? "count";
    const columns: ColumnDef<ReportBreakdownRow, unknown>[] = [
      {
        accessorKey: "label",
        header: report.breakdownLabel ?? "Breakdown",
        cell: ({ row }) => (
          <span className="font-medium text-ink">{row.original.label}</span>
        ),
      },
      {
        accessorKey: "value",
        header: report.breakdownValueLabel ?? "Value",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatValue(row.original.value, valueFormat, report.currency)}
          </span>
        ),
      },
    ];

    // Some reports have only one number per row; a second column of zeros would
    // read as a figure rather than as an absence.
    if (report.breakdownCountLabel) {
      columns.push({
        accessorKey: "count",
        header: report.breakdownCountLabel,
        cell: ({ row }) => (
          <span className="tabular-nums text-ink-soft">
            {formatValue(row.original.count, countFormat, report.currency)}
          </span>
        ),
      });
    }

    return columns;
  }, [report]);

  const totals = Object.entries(report?.totals ?? {});

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {report && (
            <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-gold/85">
              {report.group}
            </p>
          )}
          <h1 className="font-display text-[1.75rem] leading-tight text-ink">
            {report?.name ?? "Loading your numbers…"}
          </h1>
          {report && (
            <p className="mt-1.5 max-w-2xl text-sm text-ink-soft">{report.description}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" size="sm" onClick={() => setSavePanel(true)} disabled={!report}>
            <Bookmark />
            Save this view
          </Button>
          <Button size="sm" onClick={download} disabled={!report || downloading}>
            <Download />
            {downloading ? "Getting it ready…" : "Download as a spreadsheet"}
          </Button>
        </div>
      </div>

      {/* Shown above the pickers rather than instead of them: a date range the
          server refuses used to replace the whole screen, taking with it the
          very boxes she needed to correct it. */}
      {error && <ErrorNotice message={error} />}

      {/* Controls */}
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <div
          role="group"
          aria-label="Choose a period"
          className="flex flex-wrap items-center gap-1.5"
        >
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              size="sm"
              variant={range.preset === preset.key ? "primary" : "secondary"}
              aria-pressed={range.preset === preset.key}
              onClick={() => choosePreset(preset.key, preset.days)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-ink-soft" htmlFor="report-from">
            From
          </label>
          <Input
            id="report-from"
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) =>
              setRange((current) => ({ ...current, preset: "custom", from: e.target.value }))
            }
            className="h-9 w-auto text-xs"
          />
          <label className="text-xs text-ink-soft" htmlFor="report-to">
            to
          </label>
          <Input
            id="report-to"
            type="date"
            value={range.to}
            min={range.from}
            max={today()}
            onChange={(e) =>
              setRange((current) => ({ ...current, preset: "custom", to: e.target.value }))
            }
            className="h-9 w-auto text-xs"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={range.compare}
            onChange={(e) => setRange((current) => ({ ...current, compare: e.target.checked }))}
            className="size-4 rounded border-hairline bg-raise accent-plum-bright"
          />
          Compare with the period before
        </label>

        {(report?.dimensions?.length ?? 0) > 1 && (
          <div className="flex items-center gap-1.5">
            {report?.dimensions?.map((option) => (
              <Button
                key={option.key}
                size="sm"
                variant={
                  (dimension ?? report.dimensions?.[0]?.key) === option.key
                    ? "primary"
                    : "secondary"
                }
                aria-pressed={(dimension ?? report.dimensions?.[0]?.key) === option.key}
                onClick={() => setDimension(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}

        {report && report.currency === "mixed" && (
          <Badge tone="gold">More than one currency</Badge>
        )}
        {report && report.currency !== "mixed" && (
          <Badge tone="neutral">{report.currency.toUpperCase()}</Badge>
        )}
      </Card>

      {report?.note && (
        <p className="rounded-xl border border-hairline bg-raise px-4 py-3 text-sm leading-relaxed text-ink-soft">
          {report.note}
        </p>
      )}
      {report?.currency === "mixed" && (
        <p className="text-xs text-ink-soft">
          These takings were paid in more than one currency, so the totals are shown as plain
          numbers rather than converted into one.
        </p>
      )}

      {/* Totals — also the chart's text alternative */}
      {report === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : totals.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {totals.map(([key, total]) => {
            const delta = report.comparison?.change[key] ?? null;
            const before = report.comparison?.totals[key];
            return (
              <Card key={key} className="p-5">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  {total.label}
                </p>
                <p className="mt-2 font-display text-[1.6rem] leading-none text-ink">
                  {formatValue(total.value, total.format, report.currency)}
                </p>
                {before && (
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                    {delta !== null && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 font-bold",
                          delta >= 0 ? "text-green-bright" : "text-red-300",
                        )}
                      >
                        {delta >= 0 ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {Math.abs(delta)}%
                      </span>
                    )}
                    <span>
                      was {formatValue(before.value, before.format, report.currency)} in the
                      period before
                    </span>
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Chart */}
      {report === null ? (
        <Skeleton className="h-[300px] w-full" />
      ) : charted.length === 0 ? null : (
        <Card>
          <CardHeader
            title={
              comparisonData
                ? "This period against the one before"
                : charted.map((s) => s.label).join(" · ")
            }
            subtitle={`${report.from} to ${report.to}`}
          />
          <div className="px-1 py-5 sm:px-4">
            {comparisonData && charted[0].format === "money" ? (
              // The comparison chart labels its axis in money, so a count report
              // gets the same two lines drawn as an area chart instead — "$300"
              // over three hundred sign-ups is worse than no comparison at all.
              <ComparisonLineChart data={comparisonData} />
            ) : (
              <TrendAreaChart
                data={comparisonData ?? chartData}
                currency={charted[0].format === "money"}
                series={
                  comparisonData
                    ? [
                        { key: "current", label: "This period", color: SERIES_COLORS[0] },
                        { key: "previous", label: "The period before", color: CHART_COLORS.slate },
                      ]
                    : charted.map((series, i) => ({
                        key: `s${i}`,
                        label: series.label,
                        color: SERIES_COLORS[i % SERIES_COLORS.length],
                      }))
                }
              />
            )}
          </div>
          <p className="border-t border-hairline/60 px-5 py-3 text-xs text-ink-soft">
            Every number in this chart is written out in the totals above and in the table below,
            so nothing here is only visible in the picture.
          </p>
        </Card>
      )}

      {/* Breakdown */}
      {report?.breakdown && report.breakdown.length > 0 && (
        <Card>
          <CardHeader
            title={report.breakdownLabel ?? "The detail"}
            subtitle="Sorted by the biggest first — click a heading to sort another way"
          />
          <DataTable
            columns={breakdownColumns}
            data={report.breakdown}
            searchPlaceholder="Search this table…"
            itemNoun={{ one: "row", many: "rows" }}
            emptyState={
              <EmptyState
                icon={<Download />}
                title="Nothing to break down yet"
                description="This fills in as things happen."
              />
            }
          />
        </Card>
      )}

      {report && charted.length === 0 && (report.breakdown?.length ?? 0) === 0 && (
        <Card>
          <EmptyState
            icon={<Bookmark />}
            title="Nothing here yet"
            description={
              report.note ?? "This report fills in as people buy, sign up and take part."
            }
          />
        </Card>
      )}

      {/* Save this view */}
      <Modal
        open={savePanel}
        onOpenChange={setSavePanel}
        title="Save this view"
        description="Give it a name and it'll sit at the top of your reports, set up exactly like this."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSavePanel(false)}>
              Never mind
            </Button>
            <Button
              size="sm"
              type="submit"
              form="save-report-view"
              disabled={saving || !viewName.trim()}
            >
              {saving ? "Saving…" : "Save it"}
            </Button>
          </>
        }
      >
        <form id="save-report-view" onSubmit={saveView} className="space-y-4">
          <Field label="Call it" htmlFor="view-name">
            <Input
              id="view-name"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="Money coming in, last 3 months"
              autoFocus
            />
          </Field>
          <Field label="A note to yourself" hint="Optional" htmlFor="view-note">
            <Textarea
              id="view-note"
              rows={2}
              value={viewNote}
              onChange={(e) => setViewNote(e.target.value)}
              placeholder="What you check this for"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/analytics/reports"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
    >
      <ArrowLeft className="size-3.5" />
      All your numbers
    </Link>
  );
}
