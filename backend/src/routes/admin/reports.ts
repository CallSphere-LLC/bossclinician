import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { badRequest, notFound } from "../../utils/httpError";
import { rowsToCamel, rowToCamel } from "../../utils/case";
import { enqueue, PRIORITY } from "../../jobs/queue";
import {
  REPORT_GROUPS,
  findReport,
  reportCatalogue,
  type ReportParams,
  type ReportResult,
} from "../../services/reports/queries";
import { daysBetween, lastRollupAt, reportDay, shiftDay } from "../../services/reports/rollup";

/**
 * The reports API — mounted at /admin/reports.
 *
 * Every report answers in one shape, so this file has one runner rather than
 * thirty-eight endpoints. What varies is the report id; what never varies is
 * the range handling, the comparison period, the CSV escaping and the fact that
 * a date arriving from a query string is user input and is treated as such.
 */
export const adminReportsRouter = Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = 30;
/** Two years of daily points is already more than any chart can show usefully. */
const MAX_RANGE_DAYS = 800;

const rangeQuery = z.object({
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  compare: z.enum(["previous", "none"]).optional(),
  // Only ever one of the report's own declared breakdown keys.
  dimension: z.string().max(40).regex(/^[a-z_]*$/).optional(),
  currency: z.string().length(3).regex(/^[a-z]{3}$/i).optional(),
});

interface ResolvedRange {
  from: string;
  to: string;
  compareFrom?: string;
  compareTo?: string;
}

/**
 * Turns the query string into a range, defaulting to the trailing 30 days.
 *
 * The comparison period is the same number of days ending the day before `from`,
 * which is the only definition under which "up 12%" means anything: comparing a
 * 30-day window against a 7-day one would report a collapse every time somebody
 * narrowed the range.
 */
function resolveRange(query: z.infer<typeof rangeQuery>): ResolvedRange {
  const today = reportDay();
  const to = query.to ?? today;
  const from = query.from ?? shiftDay(to, -(DEFAULT_DAYS - 1));

  if (from > to) throw badRequest("The start date is after the end date");
  const length = daysBetween(from, to);
  if (length > MAX_RANGE_DAYS) {
    throw badRequest("That date range is too long — pick a shorter one");
  }

  if (query.compare !== "previous") return { from, to };
  return {
    from,
    to,
    compareFrom: shiftDay(from, -length),
    compareTo: shiftDay(from, -1),
  };
}

function paramsFor(query: z.infer<typeof rangeQuery>): ReportParams {
  const range = resolveRange(query);
  return {
    ...range,
    dimension: query.dimension,
    currency: query.currency?.toLowerCase(),
  };
}

/* ------------------------------------------------------------- the catalogue */

adminReportsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    // Refreshed nightly, so the screen can say when the figures last moved
    // rather than leaving her to wonder whether today is included.
    const updatedAt = await lastRollupAt();
    res.json({
      groups: REPORT_GROUPS,
      reports: reportCatalogue(),
      figuresUpdatedAt: updatedAt ? updatedAt.toISOString() : null,
    });
  })
);

/* ------------------------------------------------------------- saved views */

const savedBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  reportId: z.string().min(1).max(80),
  /** A trailing window, so a saved view stays current instead of freezing. */
  days: z.number().int().min(1).max(MAX_RANGE_DAYS).optional(),
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  compare: z.enum(["previous", "none"]).default("none"),
  dimension: z.string().max(40).regex(/^[a-z_]*$/).optional(),
});

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** Makes a slug unique without a round trip per candidate. */
async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  const stem = base || "view";
  const taken = await pool.query<{ slug: string }>(
    `SELECT slug FROM saved_reports
      WHERE slug IS NOT NULL AND slug::text ~ $1 AND ($2::int IS NULL OR id <> $2)`,
    [`^${stem}(-[0-9]+)?$`, excludeId ?? null]
  );
  const used = new Set(taken.rows.map((r) => r.slug.toLowerCase()));
  if (!used.has(stem)) return stem;
  for (let n = 2; n < 200; n += 1) {
    if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
  }
  return `${stem}-${Date.now()}`;
}

adminReportsRouter.get(
  "/saved",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT id, name, slug, description, kind, config, created_at, updated_at
         FROM saved_reports
        ORDER BY name`
    );
    res.json(rowsToCamel(result.rows));
  })
);

adminReportsRouter.post(
  "/saved",
  asyncHandler(async (req, res) => {
    const body = savedBody.parse(req.body);
    const report = findReport(body.reportId);
    if (!report) throw notFound("That report doesn't exist");

    const config = {
      reportId: body.reportId,
      days: body.days ?? null,
      from: body.from ?? null,
      to: body.to ?? null,
      compare: body.compare,
      dimension: body.dimension ?? null,
    };

    const result = await pool.query(
      `INSERT INTO saved_reports (name, slug, description, kind, config, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, description, kind, config, created_at, updated_at`,
      [
        body.name,
        await uniqueSlug(slugify(body.name)),
        body.description ?? "",
        report.group.toLowerCase(),
        JSON.stringify(config),
        req.user?.sub ?? null,
      ]
    );
    res.status(201).json(rowToCamel(result.rows[0]));
  })
);

adminReportsRouter.patch(
  "/saved/:id",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = savedBody.partial({ reportId: true }).parse(req.body);

    const existing = await pool.query<{ config: Record<string, unknown> }>(
      "SELECT config FROM saved_reports WHERE id = $1",
      [id]
    );
    if (existing.rowCount === 0) throw notFound("That saved view doesn't exist");

    const reportId = body.reportId ?? String(existing.rows[0].config.reportId ?? "");
    const report = findReport(reportId);
    if (!report) throw notFound("That report doesn't exist");

    const config = {
      reportId,
      days: body.days ?? null,
      from: body.from ?? null,
      to: body.to ?? null,
      compare: body.compare,
      dimension: body.dimension ?? null,
    };

    const result = await pool.query(
      `UPDATE saved_reports
          SET name = $2, description = $3, kind = $4, config = $5,
              slug = $6, updated_at = now()
        WHERE id = $1
        RETURNING id, name, slug, description, kind, config, created_at, updated_at`,
      [
        id,
        body.name,
        body.description ?? "",
        report.group.toLowerCase(),
        JSON.stringify(config),
        await uniqueSlug(slugify(body.name), id),
      ]
    );
    res.json(rowToCamel(result.rows[0]));
  })
);

adminReportsRouter.delete(
  "/saved/:id",
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const result = await pool.query("DELETE FROM saved_reports WHERE id = $1", [id]);
    if (result.rowCount === 0) throw notFound("That saved view doesn't exist");
    res.status(204).end();
  })
);

/* ---------------------------------------------------------------- refreshing */

/**
 * Recomputes the figures behind a range, on demand.
 *
 * Queued rather than run inline: a rebuild of two years is not something a
 * browser request should be holding open, and the dedupe key means leaning on
 * the button does not start ten of them.
 */
adminReportsRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const body = z
      .object({ from: z.string().regex(DATE).optional(), to: z.string().regex(DATE).optional() })
      .parse(req.body ?? {});

    const to = body.to ?? reportDay();
    const from = body.from ?? shiftDay(to, -(DEFAULT_DAYS - 1));
    if (from > to) throw badRequest("The start date is after the end date");
    if (daysBetween(from, to) > MAX_RANGE_DAYS) {
      throw badRequest("That date range is too long — pick a shorter one");
    }

    const jobId = await enqueue({
      kind: "reports.rebuild",
      payload: { from, to },
      priority: PRIORITY.normal,
      dedupeKey: `reports.rebuild:${from}:${to}`,
    });

    res.status(202).json({ queued: jobId !== null, from, to });
  })
);

/* ------------------------------------------------------------ running a report */

adminReportsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const report = findReport(req.params.id);
    if (!report) throw notFound("That report doesn't exist");

    const query = rangeQuery.parse(req.query);
    const params = paramsFor(query);
    const result = await report.run(params);

    res.json({
      id: report.id,
      name: report.name,
      group: report.group,
      description: report.description,
      dimensions: report.dimensions ?? [],
      dimension: params.dimension ?? report.dimensions?.[0]?.key ?? null,
      from: params.from,
      to: params.to,
      ...result,
    });
  })
);

/* ------------------------------------------------------------------ CSV export */

/**
 * One CSV cell.
 *
 * Every value is quoted, which handles commas, quotes and newlines. The leading
 * apostrophe is the part that matters: a cell beginning `=`, `+`, `-` or `@` is
 * a formula to Excel, Numbers and Sheets alike, and an offer title somebody
 * typed is not something to hand a spreadsheet as code.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}

/** Cents to a plain decimal — a spreadsheet wants a number, not a currency symbol. */
function csvNumber(value: number, format: string): string {
  if (format === "money") return (value / 100).toFixed(2);
  return String(value);
}

export function toCsv(name: string, range: ResolvedRange, result: ReportResult): string {
  const lines: string[] = [];
  lines.push(csvRow(["Report", name]));
  lines.push(csvRow(["From", range.from]));
  lines.push(csvRow(["To", range.to]));
  if (result.currency !== "usd") lines.push(csvRow(["Currency", result.currency.toUpperCase()]));
  if (result.note) lines.push(csvRow(["Note", result.note]));
  lines.push("");

  const totals = Object.values(result.totals);
  if (totals.length > 0) {
    lines.push(csvRow(["Total", "Value"]));
    for (const total of totals) {
      lines.push(csvRow([total.label, csvNumber(total.value, total.format)]));
    }
    lines.push("");
  }

  const charted = result.series.filter((s) => s.points.length > 0);
  if (charted.length > 0) {
    lines.push(csvRow(["Date", ...charted.map((s) => s.label)]));
    for (let i = 0; i < charted[0].points.length; i += 1) {
      lines.push(
        csvRow([
          charted[0].points[i].date,
          ...charted.map((s) => csvNumber(s.points[i]?.value ?? 0, s.format)),
        ])
      );
    }
    lines.push("");
  }

  if (result.breakdown && result.breakdown.length > 0) {
    const format = result.breakdownFormat ?? "count";
    const countFormat = result.breakdownCountFormat ?? "count";
    // A report whose second column would only ever be zero does not declare a
    // heading for it, and the spreadsheet should not carry the column either.
    const withCount = Boolean(result.breakdownCountLabel);

    lines.push(
      csvRow([
        result.breakdownLabel ?? "Breakdown",
        result.breakdownValueLabel ?? "Value",
        ...(withCount ? [result.breakdownCountLabel] : []),
      ])
    );
    for (const row of result.breakdown) {
      lines.push(
        csvRow([
          row.label,
          csvNumber(row.value, format),
          ...(withCount ? [csvNumber(row.count, countFormat)] : []),
        ])
      );
    }
  }

  // CRLF, because that is what every spreadsheet expects from a .csv.
  return lines.join("\r\n");
}

adminReportsRouter.get(
  "/:id/export.csv",
  asyncHandler(async (req, res) => {
    const report = findReport(req.params.id);
    if (!report) throw notFound("That report doesn't exist");

    const query = rangeQuery.parse(req.query);
    const params = paramsFor(query);
    const result = await report.run(params);

    // The id comes from our own catalogue, so the filename cannot be shaped by
    // anything a caller sends.
    const filename = `${report.id}-${params.from}-to-${params.to}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Excel on Windows reads a CSV as the system codepage unless it sees this.
    res.send(`\ufeff${toCsv(report.name, params, result)}`);
  })
);
