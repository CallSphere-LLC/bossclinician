import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, shortDay } from "@/lib/format";

/**
 * Recharts wrappers pinned to the brand palette.
 *
 * Every chart here is presentational — callers pass already-shaped data. Axis
 * chrome is deliberately minimal (no gridlines, no axis lines) so the data ink
 * dominates, which is what makes these read as premium rather than as a
 * default chart library dump.
 */

export const CHART_COLORS = {
  plum: "#9B7DD4",
  plumDeep: "#7B5EA7",
  gold: "#D8B676",
  green: "#6BA891",
  lilac: "#C3AEE0",
  ink: "#E9E4F2",
  slate: "#7E7391",
} as const;

const axisProps = {
  stroke: "#8B7FA0",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

/**
 * A chart with nothing in it is a blank rectangle, which reads as broken
 * rather than as "this hasn't happened yet". Every chart below falls back to a
 * sentence that says what will fill it.
 */
function ChartEmpty({ message, height }: { message: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center px-6 text-center text-sm text-ink-soft"
      style={{ height }}
    >
      {message}
    </div>
  );
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  currency?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-hairline bg-night-raised/95 px-3 py-2 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.85)] backdrop-blur">
      {label != null && (
        <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
          {typeof label === "string" && /^\d{4}-\d{2}-\d{2}$/.test(label) ? shortDay(label) : label}
        </p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-sm font-medium text-ink">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: entry.color ?? CHART_COLORS.plum }}
          />
          <span className="text-ink-soft">{entry.name}</span>
          <span className="ml-auto tabular-nums">
            {currency ? formatCurrency(Number(entry.value ?? 0)) : Number(entry.value ?? 0)}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Filled area trend — the dashboard's primary revenue/activity chart. */
export function TrendAreaChart({
  data,
  series,
  height = 260,
  currency = false,
  emptyMessage = "Nothing to show yet — this fills in as things happen.",
}: {
  data: Record<string, unknown>[];
  series: { key: string; label: string; color: string }[];
  height?: number;
  currency?: boolean;
  emptyMessage?: string;
}) {
  const gradientId = useId();

  if (data.length === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <XAxis
          dataKey="date"
          {...axisProps}
          tickFormatter={(v: string) => shortDay(v)}
          minTickGap={28}
        />
        <YAxis
          {...axisProps}
          width={54}
          allowDecimals={false}
          // With an all-zero series Recharts emits five identical ticks ($0 $0
          // $0…). Flooring the max keeps the scale readable before any revenue
          // or signups exist.
          domain={[0, (dataMax: number) => Math.max(dataMax, currency ? 400 : 4)]}
          tickFormatter={(v: number) => (currency ? `$${Math.round(v / 100)}` : String(v))}
        />
        <Tooltip content={<ChartTooltip currency={currency} />} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2.25}
            fill={`url(#${gradientId}-${s.key})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#0A0713" }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Axis-free micro chart for stat tiles. */
export function Sparkline({
  data,
  dataKey,
  color = CHART_COLORS.plum,
  height = 40,
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  const gradientId = useId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Comparison line chart (this period vs the one before) — Kajabi-style. */
export function ComparisonLineChart({
  data,
  height = 260,
  emptyMessage = "No sales to compare yet — this fills in once money starts coming in.",
}: {
  data: { date: string; current: number; previous: number }[];
  height?: number;
  emptyMessage?: string;
}) {
  if (data.length === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDay} minTickGap={28} />
        <YAxis {...axisProps} width={54} tickFormatter={(v: number) => `$${Math.round(v / 100)}`} />
        <Tooltip content={<ChartTooltip currency />} />
        <Line
          type="monotone"
          dataKey="previous"
          name="The period before"
          stroke={CHART_COLORS.slate}
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="current"
          name="This period"
          stroke={CHART_COLORS.plum}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#0A0713" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  height = 200,
  /** The word under the number in the middle — say what is being counted. */
  totalLabel = "Total",
  emptyMessage = "Nothing to show yet.",
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
  totalLabel?: string;
  emptyMessage?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  // An all-zero donut draws no ring at all, so it needs the same fallback as
  // an empty one.
  if (data.length === 0 || total === 0) {
    return <ChartEmpty message={emptyMessage} height={height} />;
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl text-ink">{total}</span>
        <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-ink-soft">
          {totalLabel}
        </span>
      </div>
    </div>
  );
}

export function MiniBarChart({
  data,
  dataKey,
  color = CHART_COLORS.plum,
  height = 180,
  emptyMessage = "Nothing to show yet.",
}: {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
  emptyMessage?: string;
}) {
  if (data.length === 0) return <ChartEmpty message={emptyMessage} height={height} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} width={40} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(92,69,125,0.06)" }} />
        <Bar dataKey={dataKey} fill={color} radius={[6, 6, 0, 0]} maxBarSize={38} />
      </BarChart>
    </ResponsiveContainer>
  );
}
