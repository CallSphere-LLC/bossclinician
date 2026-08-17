import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Inbox, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Lead } from "@/types";
import type { AdminForm, Funnel } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  LEAD_STATUS_TONE,
  PageHeader,
  leadStatusLabel,
} from "@/pages/admin/ui/primitives";
import { friendlyError, humaniseKey } from "@/pages/admin/ui/friendly";
import { DataTable } from "@/pages/admin/ui/DataTable";
import { Modal } from "@/pages/admin/ui/Dialog";

const STATUSES = ["new", "contacted", "qualified", "closed", "archived"];

/**
 * Every place on the public site that can create an enquiry, named the way she
 * refers to it. The stored value is a short tag the form sends along ("apply",
 * "work-with-me"); nothing on this screen ever shows that tag.
 */
const SOURCE_LABEL: Record<string, string> = {
  apply: "Application form",
  contact: "Contact form",
  "work-with-me": "Work With Me page",
  "income-calculator": "Income calculator",
  resources: "Free resources page",
  "practice-reset-planner": "Practice Reset Planner page",
  footer: "Website footer",
  automation: "Added automatically",
};

/**
 * The tag on an enquiry → words.
 *
 * Forms and funnels tag their enquiries `form:<web-address>` /
 * `funnel:<web-address>`, which only becomes readable once we know what she
 * called that form — hence `named`, built from her own forms and funnels. If
 * the form has since been renamed or deleted we still never show the prefix:
 * the tail is tidied into a sentence instead.
 */
function sourceLabel(source: string, named: Map<string, string>): string {
  const tag = source?.trim();
  if (!tag) return "Somewhere on your site";

  const known = SOURCE_LABEL[tag] ?? named.get(tag);
  if (known) return known;

  const separator = tag.indexOf(":");
  if (separator > -1) {
    const tail = tag.slice(separator + 1);
    if (tail) return humaniseKey(tail);
  }
  return humaniseKey(tag);
}

/** One line in the details panel — `depth` is how far it sits inside its parent. */
interface DetailRow {
  id: string;
  label: string;
  value: string;
  depth: number;
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== "object";
}

/** A single answer, written out. Never a `true`, never a `null`, never braces. */
function formatAnswer(value: unknown): string {
  if (value === null || value === undefined) return "Not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    // Thousands separators help on money and hurt on years, so only the big
    // numbers get them — "$120,000" reads well, "2,024" does not.
    return Math.abs(value) >= 10_000 ? formatNumber(value) : String(value);
  }
  const text = String(value).trim();
  return text || "Not answered";
}

/**
 * Whatever the capturing surface attached — a calculator scenario, a whole
 * form submission, something nested inside that — walked into flat label/value
 * rows she can read down.
 *
 * Nested objects become a heading row plus their contents one indent in, and
 * lists of plain answers collapse onto one line ("Interests: coaching,
 * supervision"), because the alternative on this screen used to be printing
 * the raw structure with its brackets.
 */
function detailRows(value: unknown, label: string, id: string, depth: number): DetailRow[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [{ id, label, value: "None", depth }];
    if (value.every(isScalar)) {
      return [{ id, label, value: value.map(formatAnswer).join(", "), depth }];
    }
    return value.flatMap((entry, i) =>
      detailRows(entry, `${label} ${i + 1}`, `${id}.${i}`, depth),
    );
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [{ id, label, value: "Nothing recorded", depth }];
    return [
      { id, label, value: "", depth },
      ...entries.flatMap(([key, child]) =>
        detailRows(child, humaniseKey(key), `${id}.${key}`, depth + 1),
      ),
    ];
  }

  return [{ id, label, value: formatAnswer(value), depth }];
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [detail, setDetail] = useState<Lead | null>(null);
  const [sourceNames, setSourceNames] = useState<Map<string, string>>(new Map());

  const load = useCallback(() => {
    adminApi
      .leadsList()
      .then(setLeads)
      .catch(() => setError("We couldn't load your enquiries. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  // Enquiries from a form or funnel are tagged with its web address rather than
  // its name, so we look the names up once. A failure here is silent on
  // purpose: the badge falls back to a tidied tag, which is still readable.
  useEffect(() => {
    let current = true;
    void Promise.all([
      adminApi.growthList<AdminForm>("forms").catch(() => [] as AdminForm[]),
      adminApi.growthList<Funnel>("funnels").catch(() => [] as Funnel[]),
    ]).then(([forms, funnels]) => {
      if (!current) return;
      const named = new Map<string, string>();
      for (const form of forms) named.set(`form:${form.slug}`, form.name);
      for (const funnel of funnels) named.set(`funnel:${funnel.slug}`, funnel.name);
      setSourceNames(named);
    });
    return () => {
      current = false;
    };
  }, []);

  const changeStatus = useCallback(
    async (id: string, status: string) => {
      // Optimistic — the select should feel instant.
      setLeads((prev) => prev?.map((l) => (l.id === id ? { ...l, status } : l)) ?? prev);
      try {
        await adminApi.leadUpdate(id, status);
      } catch (err) {
        toast.error(friendlyError(err, "enquiry"));
        load();
      }
    },
    [load],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of leads ?? []) map.set(lead.status, (map.get(lead.status) ?? 0) + 1);
    return map;
  }, [leads]);

  const visible = useMemo(() => {
    if (!leads) return null;
    return filter === "all" ? leads : leads.filter((l) => l.status === filter);
  }, [leads, filter]);

  // Most enquiries carry nothing extra, so the detail panel only grows an
  // answers block when the form that captured them actually attached something.
  const answerRows = useMemo(
    () =>
      Object.entries(detail?.meta ?? {}).flatMap(([key, value]) =>
        detailRows(value, humaniseKey(key), key, 0),
      ),
    [detail],
  );

  const columns = useMemo<ColumnDef<Lead, unknown>[]>(
    () => [
      {
        id: "name",
        // Search reads whatever the column reports, so the email goes in too —
        // she looks people up by address as often as by name.
        accessorFn: (lead) => `${lead.name} ${lead.email}`,
        header: "Who",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => setDetail(row.original)}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
              {row.original.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{row.original.name}</span>
              <span className="block truncate text-xs text-ink-soft">{row.original.email}</span>
            </span>
          </button>
        ),
      },
      {
        id: "source",
        // The friendly label rather than the stored tag, so sorting and the
        // search box both work on the words she can actually see.
        accessorFn: (lead) => sourceLabel(lead.source, sourceNames),
        header: "Came from",
        cell: ({ row }) => (
          <Badge tone="plum">{sourceLabel(row.original.source, sourceNames)}</Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {formatRelative(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (lead) => leadStatusLabel(lead.status),
        header: "Where it's up to",
        cell: ({ row }) => (
          <select
            value={row.original.status}
            onChange={(e) => changeStatus(row.original.id, e.target.value)}
            aria-label={`Where things stand with ${row.original.name}`}
            className="rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink outline-none transition-colors focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {leadStatusLabel(s)}
              </option>
            ))}
          </select>
        ),
      },
    ],
    [changeStatus, sourceNames],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title="Enquiries"
        description="Everyone who has reached out through your website — applications, contact forms and anything else people fill in."
      />

      {error && <ErrorNotice message={error} />}

      <div className="flex flex-wrap gap-1.5">
        {["all", ...STATUSES].map((status) => {
          const active = filter === status;
          const count = status === "all" ? (leads?.length ?? 0) : (counts.get(status) ?? 0);
          return (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-brand-gradient text-white"
                  : "border border-hairline bg-surface text-ink-soft hover:border-plum/40 hover:text-plum",
              )}
            >
              {status === "all" ? "Everyone" : leadStatusLabel(status)}
              <span className={cn("ml-1.5", active ? "text-white/70" : "text-ink-soft/60")}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columns}
        data={visible}
        searchPlaceholder="Search your enquiries…"
        itemNoun={{ one: "enquiry", many: "enquiries" }}
        // The status dropdown now holds phrases rather than one-word states, so
        // the table needs a little more room before it starts scrolling.
        minWidth="740px"
        emptyState={
          <EmptyState
            icon={<Inbox />}
            title={
              filter === "all"
                ? "No enquiries yet"
                : `Nothing filed under “${leadStatusLabel(filter)}”`
            }
            description={
              filter === "all"
                ? "When someone fills in a form on your website, they'll appear here as they come in."
                : `Change an enquiry to “${leadStatusLabel(filter)}” and it will show up here.`
            }
          />
        }
      />

      <Modal
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.name ?? ""}
        description={detail ? `Came in ${formatDateTime(detail.createdAt)}` : undefined}
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="plum">{sourceLabel(detail.source, sourceNames)}</Badge>
              <Badge tone={LEAD_STATUS_TONE[detail.status] ?? "neutral"}>
                {leadStatusLabel(detail.status)}
              </Badge>
            </div>

            <div className="space-y-2 rounded-xl border border-hairline bg-cream/50 p-4">
              <a
                href={`mailto:${detail.email}`}
                className="flex items-center gap-2.5 text-sm font-medium text-plum hover:underline"
              >
                <Mail className="size-4" />
                {detail.email}
              </a>
              {detail.phone && (
                <a
                  href={`tel:${detail.phone}`}
                  className="flex items-center gap-2.5 text-sm font-medium text-plum hover:underline"
                >
                  <Phone className="size-4" />
                  {detail.phone}
                </a>
              )}
            </div>

            {detail.message && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
                  What they wrote
                </p>
                <p className="whitespace-pre-wrap rounded-xl border border-hairline p-4 text-sm leading-relaxed text-ink-soft">
                  {detail.message}
                </p>
              </div>
            )}

            {answerRows.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
                  What else they told you
                </p>
                <dl className="divide-y divide-hairline/60 rounded-xl border border-hairline">
                  {answerRows.map((row) => (
                    <div key={row.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5">
                      <dt
                        className="w-36 shrink-0 text-sm font-semibold text-ink-soft"
                        // Nested answers step in rather than sitting flush, so a
                        // group and its contents read as one thing.
                        style={row.depth > 0 ? { paddingLeft: row.depth * 14 } : undefined}
                      >
                        {row.label}
                      </dt>
                      <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-ink">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <Button asChild size="sm" className="w-full">
              <a href={`mailto:${detail.email}`}>
                <Mail />
                Reply by email
              </a>
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
