import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import {
  auditLogApi,
  type AuditLogEntry,
  type AuditLogFacets,
  type AuditLogFilters,
} from "@/lib/auditLogApi";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { friendlyError, fromDateInput, humaniseKey, pluralize } from "@/pages/admin/ui/friendly";

/**
 * The activity log.
 *
 * Every change made in this admin has been written down since the first day —
 * who, what, to which record, and what it looked like before and after — and
 * until this screen the only way to read any of it was a database console. It
 * answers the questions that come up after the fact: who changed that price,
 * who gave that person access, did anyone view the site as her.
 *
 * Read-only, and it stays that way. A log its subjects can tidy is not a log.
 */

const PAGE_SIZE = 50;

interface FilterForm {
  actor: string;
  action: string;
  entityType: string;
  fromDay: string;
  toDay: string;
}

const NO_FILTERS: FilterForm = { actor: "", action: "", entityType: "", fromDay: "", toDay: "" };

function toFilters(form: FilterForm): AuditLogFilters {
  return {
    actor: form.actor,
    action: form.action.trim(),
    entityType: form.entityType,
    from: fromDateInput(form.fromDay, "start"),
    to: fromDateInput(form.toDay, "end"),
  };
}

/** "offer.grant" → "Offer grant". The exact action sits underneath for anyone who needs it. */
function actionLabel(action: string): string {
  const words = action.replace(/[._]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Something";
}

function hasDetail(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function StateBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        {title}
      </p>
      {hasDetail(value) ? (
        <pre className="max-h-80 overflow-auto rounded-xl border border-hairline bg-night-deep p-3 font-mono text-xs leading-relaxed text-ink">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <p className="rounded-xl border border-hairline/60 px-3 py-2.5 text-xs text-ink-soft">
          Nothing was recorded.
        </p>
      )}
    </div>
  );
}

export default function AuditLog() {
  const [form, setForm] = useState<FilterForm>(NO_FILTERS);
  const [applied, setApplied] = useState<FilterForm>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AuditLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<AuditLogFacets>({ entityTypes: [], actors: [] });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    auditLogApi
      .facets()
      .then(setFacets)
      // The filters still work as free choices without the lists behind them.
      .catch(() => setFacets({ entityTypes: [], actors: [] }));
  }, []);

  const load = useCallback((filters: FilterForm, pageNumber: number) => {
    setRows(null);
    setOpen(null);
    auditLogApi
      .list(toFilters(filters), pageNumber, PAGE_SIZE)
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => {
        setRows([]);
        setTotal(0);
        setError(friendlyError(err, "activity log"));
      });
  }, []);

  useEffect(() => {
    load(applied, page);
  }, [applied, page, load]);

  function apply(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setApplied(form);
  }

  function clear() {
    setForm(NO_FILTERS);
    setPage(1);
    setApplied(NO_FILTERS);
  }

  const filtered = Object.values(applied).some((value) => value !== "");
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          All settings
        </Link>
        <PageHeader
          eyebrow="Settings"
          title="Activity log"
          description="Everything that has been changed in this admin — who did it, when, and what the record looked like before and after. Nothing here can be edited or removed."
        />
      </div>

      <Card>
        <form onSubmit={apply} className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Who">
            <Select
              value={form.actor}
              onChange={(e) => setForm((f) => ({ ...f, actor: e.target.value }))}
            >
              <option value="">Anyone</option>
              {facets.actors.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What they did" hint="starts with">
            <Input
              value={form.action}
              onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
              placeholder="offer. or member.impersonate"
            />
          </Field>
          <Field label="Kind of record">
            <Select
              value={form.entityType}
              onChange={(e) => setForm((f) => ({ ...f, entityType: e.target.value }))}
            >
              <option value="">Any kind</option>
              {facets.entityTypes.map((type) => (
                <option key={type} value={type}>
                  {humaniseKey(type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={form.fromDay}
              max={form.toDay || undefined}
              onChange={(e) => setForm((f) => ({ ...f, fromDay: e.target.value }))}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={form.toDay}
              min={form.fromDay || undefined}
              onChange={(e) => setForm((f) => ({ ...f, toDay: e.target.value }))}
            />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5">
            <Button type="submit" size="sm">
              Show these
            </Button>
            {(filtered || Object.values(form).some((value) => value !== "")) && (
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
        </form>
      </Card>

      {error && <ErrorNotice message={error} />}

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.8)]">
        <div className="overflow-x-auto">
          <table className="admin-data-table w-full text-left text-sm" style={{ minWidth: "760px" }}>
            <thead className="bg-sand">
              <tr>
                {["When", "Who", "What they did", "Which record"].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="whitespace-nowrap px-5 py-3 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft"
                  >
                    {heading}
                  </th>
                ))}
                <th scope="col" className="w-14 px-3 py-3">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {rows === null ? (
                Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }, (_cell, ci) => (
                      <td key={ci} className="h-11 px-5 py-2">
                        <Skeleton className={cn("h-4", ci === 4 ? "w-6" : "w-24")} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyState
                      icon={<ScrollText />}
                      title={filtered ? "Nothing matches" : "Nothing yet"}
                      description={
                        filtered
                          ? "Try a wider date range, or clear the filters to see everything."
                          : "Changes made in this admin will be listed here as they happen."
                      }
                    />
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const expanded = open === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr className="transition-colors hover:bg-surface-raised">
                        <td className="whitespace-nowrap px-5 py-2.5 align-middle text-xs text-ink-soft">
                          {formatDateTime(row.createdAt)}
                        </td>
                        {/* Each cell's content sits in one wrapper: on a phone the cell is a
                            flex row (label left, value right), and two loose children
                            would line up side by side instead of stacking. */}
                        <td data-label="Who" className="px-5 py-2.5 align-middle">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">
                              {row.adminName || row.adminEmail || "Someone no longer here"}
                            </p>
                            {row.adminName && row.adminEmail && (
                              <p className="truncate text-xs text-ink-soft">{row.adminEmail}</p>
                            )}
                          </div>
                        </td>
                        <td data-label="What they did" className="px-5 py-2.5 align-middle">
                          <div className="min-w-0">
                            <p className="text-ink">{actionLabel(row.action)}</p>
                            <p className="font-mono text-[0.68rem] text-ink-soft/80">{row.action}</p>
                          </div>
                        </td>
                        <td data-label="Which record" className="px-5 py-2.5 align-middle text-ink">
                          <div className="min-w-0">
                            {row.entityType ? humaniseKey(row.entityType) : "Not recorded"}
                            {row.entityId && (
                              <span className="ml-1.5 font-mono text-xs text-ink-soft">
                                #{row.entityId}
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Details" className="px-3 py-1.5 text-right align-middle">
                          <Button
                            type="button"
                            variant="ghost"
                            size="iconSm"
                            aria-expanded={expanded}
                            aria-controls={`audit-detail-${row.id}`}
                            aria-label={
                              expanded
                                ? "Hide the details of this change"
                                : "Show the details of this change"
                            }
                            onClick={() => setOpen(expanded ? null : row.id)}
                          >
                            <ChevronDown
                              className={cn("transition-transform", expanded && "rotate-180")}
                            />
                          </Button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr id={`audit-detail-${row.id}`} className="bg-white/[0.02]">
                          <td colSpan={5} className="px-5 py-4">
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <StateBlock title="Before" value={row.beforeState} />
                              <StateBlock title="After" value={row.afterState} />
                            </div>
                            <p className="mt-3 text-xs text-ink-soft">
                              {row.ip ? `Done from ${row.ip}. ` : ""}
                              Entry {row.id}.
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {rows !== null && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline/60 px-4 py-3">
            <p className="text-xs text-ink-soft">
              Showing {first}–{last} of {pluralize(total, "entry", "entries")}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft />
                Newer
              </Button>
              <span className="text-xs text-ink-soft">
                Page {page} of {pageCount}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                Older
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
