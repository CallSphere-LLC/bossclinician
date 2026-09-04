import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { BarChart3, Download, Gift, MailPlus, Plus, Tags as TagsIcon, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import {
  EMAIL_STATUS_LABEL,
  EMAIL_STATUS_TONE,
  contactsApi,
  emailStatusLabel,
  money,
  type Contact,
  type ContactFilters,
  type EmailStatus,
  type ImportOutcome,
  type SegmentOptions,
  type Tag,
} from "@/lib/contactsApi";
import {
  Badge,
  Button,
  Card,
  Chip,
  chipRowStyles,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { DataTable } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, orNone, pluralize } from "@/pages/admin/ui/friendly";

/**
 * People — the one list.
 *
 * The three lists this replaces (enquiries, subscribers, members) are all still
 * there and all still right about their own thing; this is the screen that
 * answers "who is this person and what have they done", which none of them
 * could. Nothing here shows an identifier, a status code or a number of cents.
 */

/** How many rows one fetch brings back. Beyond this the screen says so. */
const PAGE_SIZE = 200;

const STATUS_FILTERS: { value: EmailStatus | "all"; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "subscribed", label: EMAIL_STATUS_LABEL.subscribed },
  { value: "opted_out", label: EMAIL_STATUS_LABEL.opted_out },
  { value: "bounced", label: EMAIL_STATUS_LABEL.bounced },
  { value: "unconfirmed", label: EMAIL_STATUS_LABEL.unconfirmed },
];

const SORT_OPTIONS: { value: NonNullable<ContactFilters["sort"]>; label: string }[] = [
  { value: "recent", label: "Most recently active" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "By name" },
  { value: "value", label: "Biggest spenders" },
  { value: "orders", label: "Most purchases" },
];

/* ------------------------------------------------- Reading her spreadsheet */

/** Column headings she might have used, mapped to what we keep. */
const HEADINGS: Record<string, string> = {
  email: "email",
  "email address": "email",
  "e-mail": "email",
  name: "name",
  "full name": "name",
  "first name": "firstName",
  firstname: "firstName",
  "given name": "firstName",
  "last name": "lastName",
  lastname: "lastName",
  surname: "lastName",
  phone: "phone",
  "phone number": "phone",
  mobile: "phone",
  tags: "tags",
  tag: "tags",
};

/**
 * Splits pasted spreadsheet text into rows of cells.
 *
 * Hand-rolled because the only thing harder here than `split(",")` is quoted
 * cells: a name like "Howard, Yvette" comes out of Excel wrapped in quotes with
 * its comma intact, and a naive split silently shifts every column after it
 * onto the wrong person.
 */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value !== ""));
}

interface ParsedSpreadsheet {
  rows: Record<string, string>[];
  /** Lines with nothing that looks like an email address on them. */
  unusable: number;
}

/**
 * Pasted text → the people in it.
 *
 * Deliberately forgiving, because the file is whatever her old system gave her:
 * copying straight out of a spreadsheet produces tabs rather than commas, the
 * headings might be missing entirely, and the columns arrive in any order.
 * Anything we can't place is counted rather than dropped silently, so the
 * numbers she sees back add up to the file she handed over.
 */
function readSpreadsheet(text: string): ParsedSpreadsheet {
  if (!text.trim()) return { rows: [], unusable: 0 };

  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
  const table = parseDelimited(text, delimiter);
  if (table.length === 0) return { rows: [], unusable: 0 };

  const hasHeadings = !table[0].some((cell) => cell.includes("@"));
  const mapped = hasHeadings
    ? table[0].map((cell) => HEADINGS[cell.trim().toLowerCase()] ?? null)
    : null;
  // Headings we don't recognise are no better than none: fall back to reading
  // each line by eye rather than filing every column under nothing.
  const headings = mapped?.includes("email") ? mapped : null;
  const body = hasHeadings ? table.slice(1) : table;

  const rows: Record<string, string>[] = [];
  let unusable = 0;

  for (const line of body) {
    const row: Record<string, string> = {};
    line.forEach((cell, index) => {
      if (!cell) return;
      const key = headings ? headings[index] : cell.includes("@") ? "email" : "name";
      if (key) row[key] = cell;
    });
    if (row.email) rows.push(row);
    else unusable += 1;
  }

  return { rows, unusable };
}

function importSummary(result: ImportOutcome): string {
  const parts: string[] = [];
  if (result.created) parts.push(`${pluralize(result.created, "person", "people")} added`);
  if (result.updated) parts.push(`${pluralize(result.updated, "person", "people")} updated`);
  if (result.skipped) parts.push(`${pluralize(result.skipped, "line", "lines")} skipped`);
  if (parts.length === 0) return "Nothing changed — everyone on that list was already here.";
  return `${parts.join(", ")}.`;
}

/* ------------------------------------------------------------------ Screen */

export default function Contacts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [people, setPeople] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  const requestedStatus = searchParams.get("status");
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState<EmailStatus | "all">(
    EMAIL_STATUS_LABEL[requestedStatus as EmailStatus] ? requestedStatus as EmailStatus : "all",
  );
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [sort, setSort] = useState<NonNullable<ContactFilters["sort"]>>("recent");

  const audience = (["new", "subscribed", "new_subscriber", "customer", "new_customer"] as const)
    .find((value) => value === searchParams.get("audience"));
  const optOut = (["manual", "self"] as const).find((value) => value === searchParams.get("optOut"));
  const engagement = (["healthy", "passive", "unengaged", "inactive"] as const)
    .find((value) => value === searchParams.get("engagement"));

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tagging, setTagging] = useState<"add" | "remove" | null>(null);
  const [bulkPicker, setBulkPicker] = useState<"sequence" | "offer" | null>(null);
  const [bulkOptions, setBulkOptions] = useState<SegmentOptions>({ tags: [], offers: [], sequences: [] });
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const filters = useMemo<ContactFilters>(
    () => ({
      q: search.trim() || undefined,
      status: status === "all" ? undefined : status,
      tag: tagFilter || undefined,
      audience,
      optOut,
      engagement,
      sort,
      limit: PAGE_SIZE,
    }),
    [search, status, tagFilter, sort, audience, optOut, engagement],
  );

  const insightFilterLabel = audience
    ? ({ new: "New contacts in the last 30 days", subscribed: "Subscribed contacts", new_subscriber: "New subscribers", customer: "Customers", new_customer: "New customers" } as const)[audience]
    : optOut
      ? optOut === "manual" ? "Unsubscribed by an administrator" : "People who opted out themselves"
      : engagement
        ? ({ healthy: "Healthy subscribers", passive: "Passive subscribers", unengaged: "Unengaged subscribers", inactive: "Inactive subscribers" } as const)[engagement]
        : null;

  function clearInsightFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("audience");
    next.delete("optOut");
    next.delete("engagement");
    setSearchParams(next, { replace: true });
  }

  const load = useCallback(() => {
    let current = true;
    contactsApi
      .list(filters)
      .then((page) => {
        if (!current) return;
        setPeople(page.items);
        setTotal(page.total);
        setError(null);
        // A row that scrolled out of the results should not stay quietly
        // selected and then be tagged by a later bulk action.
        setSelected((prev) => {
          const visible = new Set(page.items.map((person) => person.id));
          return new Set([...prev].filter((id) => visible.has(id)));
        });
      })
      .catch(() => {
        if (current) setError("We couldn't load your people. Try refreshing the page.");
      });
    return () => {
      current = false;
    };
  }, [filters]);

  // Typing in the search box shouldn't fire a request per keystroke.
  useEffect(() => {
    // The canceller `load` returns has to be kept, or a slow earlier search
    // lands after a newer one and fills the table with the wrong people.
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      cancel = load();
    }, 250);
    return () => {
      clearTimeout(timer);
      cancel?.();
    };
  }, [load]);

  const loadTags = useCallback(() => {
    contactsApi
      .tags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  useEffect(loadTags, [loadTags]);

  useEffect(() => {
    contactsApi.segmentOptions().then(setBulkOptions).catch(() => undefined);
  }, []);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = people !== null && people.length > 0 && selected.size === people.length;

  const columns = useMemo<ColumnDef<Contact, unknown>[]>(
    () => [
      {
        id: "choose",
        enableSorting: false,
        header: () => (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set((people ?? []).map((p) => p.id)))
            }
            aria-label="Choose everyone in this list"
            className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
            aria-label={`Choose ${row.original.name || row.original.email}`}
            className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
          />
        ),
      },
      {
        id: "who",
        accessorFn: (person) => `${person.name} ${person.email}`,
        header: "Who",
        cell: ({ row }) => (
          <Link
            to={`/admin/contacts/${row.original.id}`}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
              {(row.original.name || row.original.email).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">
                {row.original.name || "No name yet"}
              </span>
              <span className="block truncate text-xs text-ink-soft">{row.original.email}</span>
            </span>
          </Link>
        ),
      },
      {
        id: "tags",
        enableSorting: false,
        header: "Tags",
        cell: ({ row }) =>
          row.original.tags.length === 0 ? (
            <span className="text-xs text-ink-soft">None yet</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {row.original.tags.slice(0, 3).map((tag) => (
                <Badge key={tag.slug} tone="plum">
                  {tag.name}
                </Badge>
              ))}
              {row.original.tags.length > 3 && (
                <span className="text-xs text-ink-soft">
                  and {row.original.tags.length - 3} more
                </span>
              )}
            </div>
          ),
      },
      {
        accessorKey: "lifetimeValueCents",
        header: "Spent with you",
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-semibold text-ink">
            {row.original.lifetimeValueCents > 0 ? money(row.original.lifetimeValueCents) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "orderCount",
        header: "Purchases",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">{row.original.orderCount || "None yet"}</span>
        ),
      },
      {
        accessorKey: "lastActivityAt",
        header: "Last heard from",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {orNone(
              row.original.lastActivityAt ? formatRelative(row.original.lastActivityAt) : null,
              "Nothing yet",
            )}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (person) => emailStatusLabel(person.emailMarketingStatus),
        header: "Emails",
        cell: ({ row }) => (
          <Badge tone={EMAIL_STATUS_TONE[row.original.emailMarketingStatus] ?? "neutral"}>
            {emailStatusLabel(row.original.emailMarketingStatus)}
          </Badge>
        ),
      },
    ],
    [allSelected, people, selected, toggle],
  );

  async function download() {
    setBusy(true);
    try {
      const blob = await contactsApi.exportCsv(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `people-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Your spreadsheet is downloading");
    } catch (err) {
      toast.error(friendlyError(err, "list"));
    } finally {
      setBusy(false);
    }
  }

  async function exportChosen() {
    setBusy(true);
    try {
      const blob = await contactsApi.bulkExport([...selected]);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `chosen-people-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Your chosen people are downloading");
    } catch (err) {
      toast.error(friendlyError(err, "list"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteChosen() {
    const ids = [...selected];
    const ok = await confirm({
      title: `Delete ${pluralize(ids.length, "person", "people")}?`,
      description:
        "Their contact card and marketing history will be erased. Payment records are kept for accounting.",
      confirmLabel: "Delete chosen people",
      destructive: true,
    });
    if (!ok) return;
    try {
      const result = await contactsApi.bulkDelete(ids);
      toast.success(`${pluralize(result.deleted, "person", "people")} deleted`);
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error(friendlyError(err, "people"));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title="People"
        description="Everyone you know — whoever enquired, joined your list, signed up or bought something, all on one card each."
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/contacts/insights">
                <BarChart3 />
                Insights
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/tags">
                <TagsIcon />
                Tags
              </Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              <Upload />
              Import a list
            </Button>
            <Button variant="secondary" size="sm" onClick={download} disabled={busy}>
              <Download />
              Download
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add someone
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {insightFilterLabel && (
        <Card className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2.5">
          <p className="text-sm font-semibold text-ink">Showing: {insightFilterLabel}</p>
          <Button className="ml-auto" variant="ghost" size="sm" onClick={clearInsightFilter}>
            Clear this filter
          </Button>
        </Card>
      )}

      <div className={chipRowStyles}>
        {STATUS_FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={status === option.value}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <p className="text-sm font-semibold text-ink">
            {pluralize(selected.size, "person", "people")} chosen
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setTagging("add")}>
              Add a tag to them
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setTagging("remove")}>
              Take a tag off them
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setBulkPicker("sequence")}>
              <MailPlus /> Start a sequence
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setBulkPicker("offer")}>
              <Gift /> Grant an offer
            </Button>
            <Button variant="secondary" size="sm" onClick={exportChosen} disabled={busy}>
              <Download /> Export chosen
            </Button>
            <Button variant="dangerGhost" size="sm" onClick={() => void deleteChosen()}>
              <Trash2 /> Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={people}
        itemNoun={{ one: "person", many: "people" }}
        minWidth="960px"
        initialPageSize={25}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2.5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or phone…"
              aria-label="Search your people"
              className="h-11 min-w-0 flex-1 sm:max-w-xs"
            />
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Show only people with a tag"
              className={cn(selectStyles, "w-auto")}
            >
              <option value="">Any tag</option>
              {tags.map((tag) => (
                <option key={tag.slug} value={tag.slug}>
                  {tag.name}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as NonNullable<ContactFilters["sort"]>)}
              aria-label="Order the list"
              className={cn(selectStyles, "w-auto")}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        }
        emptyState={
          <EmptyState
            icon={<Users />}
            title={search || tagFilter || status !== "all" || insightFilterLabel ? "Nobody matches that" : "No people yet"}
            description={
              search || tagFilter || status !== "all" || insightFilterLabel
                ? "Try a shorter search, or clear the filters above."
                : "People appear here as they enquire, join your list, sign up or buy something."
            }
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Add someone
              </Button>
            }
          />
        }
      />

      {people !== null && total > people.length && (
        <p className="text-xs text-ink-soft">
          Showing the first {people.length} of {pluralize(total, "person", "people")}. Narrow it
          down with the search box or a tag to see the rest.
        </p>
      )}

      <AddPersonModal
        open={adding}
        tags={tags}
        onClose={() => setAdding(false)}
        onSaved={(id) => {
          setAdding(false);
          navigate(`/admin/contacts/${id}`);
        }}
      />

      <ImportModal
        open={importing}
        tags={tags}
        onClose={() => setImporting(false)}
        onDone={() => {
          load();
          loadTags();
        }}
      />

      <BulkTagModal
        action={tagging}
        tags={tags}
        count={selected.size}
        onClose={() => setTagging(null)}
        onApply={async (slugs) => {
          try {
            const result = await contactsApi.bulkTags([...selected], slugs, tagging ?? "add");
            toast.success(
              tagging === "remove"
                ? `Tag taken off ${pluralize(result.contacts, "person", "people")}`
                : `Tag added to ${pluralize(result.contacts, "person", "people")}`,
            );
            setTagging(null);
            setSelected(new Set());
            load();
            loadTags();
          } catch (err) {
            toast.error(friendlyError(err, "tag"));
          }
        }}
      />
      <BulkPickModal
        kind={bulkPicker}
        count={selected.size}
        options={bulkOptions}
        onClose={() => setBulkPicker(null)}
        onApply={async (id) => {
          try {
            if (bulkPicker === "sequence") {
              const result = await contactsApi.bulkSequence([...selected], id);
              toast.success(`${pluralize(result.enrolled, "person", "people")} started the sequence`);
            } else {
              const result = await contactsApi.bulkOffer([...selected], id);
              toast.success(`${pluralize(result.granted, "person", "people")} granted access`);
            }
            setBulkPicker(null);
            setSelected(new Set());
            load();
          } catch (err) {
            toast.error(friendlyError(err, bulkPicker === "sequence" ? "sequence" : "offer"));
          }
        }}
      />
      {confirmDialog}
    </div>
  );
}

function BulkPickModal({ kind, count, options, onClose, onApply }: {
  kind: "sequence" | "offer" | null;
  count: number;
  options: SegmentOptions;
  onClose: () => void;
  onApply: (id: number) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const choices = kind === "sequence"
    ? options.sequences.map((entry) => ({ id: entry.id, label: entry.name }))
    : options.offers.map((entry) => ({ id: entry.id, label: entry.title }));
  useEffect(() => setValue(""), [kind]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value) return;
    setSaving(true);
    try {
      await onApply(Number(value));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={kind !== null}
      onOpenChange={(open) => !open && onClose()}
      title={kind === "sequence" ? "Start an email sequence" : "Grant an offer"}
      description={`This will apply to ${pluralize(count, "chosen person", "chosen people")}.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" type="submit" form="bulk-pick-form" disabled={!value || saving}>
            {saving ? "Working…" : "Apply"}
          </Button>
        </>
      }
    >
      <form id="bulk-pick-form" onSubmit={submit}>
        <Field label={kind === "sequence" ? "Which sequence?" : "Which offer?"}>
          <select
            className={selectStyles}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            autoFocus
          >
            <option value="">Choose…</option>
            {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------- Add someone */

function AddPersonModal({
  open,
  tags,
  onClose,
  onSaved,
}: {
  open: boolean;
  tags: Tag[];
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setChosen([]);
  }, [open]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const person = await contactsApi.create({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        tagSlugs: chosen,
      });
      toast.success("Added");
      onSaved(person.id);
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Add someone"
      description="If you already have them, this just fills in what's missing."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="add-person" disabled={saving}>
            {saving ? "Saving…" : "Add them"}
          </Button>
        </>
      }
    >
      <form id="add-person" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Email address" className="sm:col-span-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="yvette@example.com"
            required
            autoFocus
          />
        </Field>
        <Field label="First name">
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Last name">
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Phone" hint="optional" className="sm:col-span-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Tags" hint="optional" className="sm:col-span-2">
          <TagPicker tags={tags} chosen={chosen} onChange={setChosen} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ Tag chooser */

function TagPicker({
  tags,
  chosen,
  onChange,
  allowNew = true,
}: {
  tags: Tag[];
  chosen: string[];
  onChange: (slugs: string[]) => void;
  allowNew?: boolean;
}) {
  const [typed, setTyped] = useState("");

  function toggle(slug: string) {
    onChange(chosen.includes(slug) ? chosen.filter((s) => s !== slug) : [...chosen, slug]);
  }

  return (
    <div className="space-y-2.5">
      <div className={chipRowStyles}>
        {tags.map((tag) => (
          <Chip
            key={tag.slug}
            selected={chosen.includes(tag.slug)}
            onClick={() => toggle(tag.slug)}
          >
            {tag.name}
          </Chip>
        ))}
        {tags.length === 0 && <p className="text-xs text-ink-soft">You don't have any tags yet.</p>}
      </div>

      {allowNew && (
        <div className="flex gap-2">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Or type a brand-new tag…"
            aria-label="Type a brand-new tag"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Inside a form, Enter would otherwise submit it.
              e.preventDefault();
              if (!typed.trim()) return;
              onChange([...chosen, typed.trim()]);
              setTyped("");
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!typed.trim()}
            onClick={() => {
              onChange([...chosen, typed.trim()]);
              setTyped("");
            }}
          >
            Add
          </Button>
        </div>
      )}

      {chosen.length > 0 && (
        <p className="text-xs text-ink-soft">
          Chosen: {chosen.join(", ")}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Bulk tagging */

function BulkTagModal({
  action,
  tags,
  count,
  onClose,
  onApply,
}: {
  action: "add" | "remove" | null;
  tags: Tag[];
  count: number;
  onClose: () => void;
  onApply: (slugs: string[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (action) setChosen([]);
  }, [action]);

  return (
    <Modal
      open={action !== null}
      onOpenChange={(next) => !next && onClose()}
      title={action === "remove" ? "Take a tag off these people" : "Add a tag to these people"}
      description={`This affects the ${pluralize(count, "person", "people")} you chose.`}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Never mind
          </Button>
          <Button
            size="sm"
            disabled={chosen.length === 0 || saving}
            onClick={async () => {
              setSaving(true);
              await onApply(chosen);
              setSaving(false);
            }}
          >
            {saving ? "Working…" : action === "remove" ? "Take it off" : "Add it"}
          </Button>
        </>
      }
    >
      <TagPicker tags={tags} chosen={chosen} onChange={setChosen} allowNew={action === "add"} />
    </Modal>
  );
}

/* --------------------------------------------------------------- Importing */

function ImportModal({
  open,
  tags,
  onClose,
  onDone,
}: {
  open: boolean;
  tags: Tag[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setChosen([]);
    setResult(null);
  }, [open]);

  const parsed = useMemo(() => readSpreadsheet(text), [text]);
  const preview = parsed.rows.slice(0, 5);

  async function run() {
    setSaving(true);
    try {
      const outcome = await contactsApi.importPeople(parsed.rows, chosen);
      setResult(outcome);
      toast.success(importSummary(outcome));
      onDone();
    } catch (err) {
      toast.error(friendlyError(err, "list"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Import a list of people"
      description="Choose a file from your computer, or paste straight out of a spreadsheet."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={run} disabled={saving || parsed.rows.length === 0}>
            {saving
              ? "Adding…"
              : parsed.rows.length === 0
                ? "Nothing to add yet"
                : `Add ${pluralize(parsed.rows.length, "person", "people")}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          aria-label="Choose a spreadsheet file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file.text().then(setText);
          }}
          className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-xl file:border file:border-hairline file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold file:text-ink"
        />

        <Field label="Or paste it here" hint="one person per line, with their email address">
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Email, First name, Last name\nyvette@example.com, Yvette, Howard"}
          />
        </Field>

        <Field label="Tag everyone on this list" hint="optional, but it makes them easy to find later">
          <TagPicker tags={tags} chosen={chosen} onChange={setChosen} />
        </Field>

        {parsed.unusable > 0 && (
          <p className="text-xs text-ink-soft">
            {pluralize(parsed.unusable, "line", "lines")} with no email address will be left out.
          </p>
        )}

        {preview.length > 0 && (
          <div className="rounded-xl border border-hairline bg-white/[0.03] p-3">
            <p className="mb-2 text-xs font-semibold text-ink">A quick look at what we read</p>
            <ul className="space-y-1 text-xs text-ink-soft">
              {preview.map((row, i) => (
                <li key={i}>
                  {row.email}
                  {row.name || row.firstName ? ` — ${row.name ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()}` : ""}
                </li>
              ))}
            </ul>
            {parsed.rows.length > preview.length && (
              <p className="mt-2 text-xs text-ink-soft">
                …and {pluralize(parsed.rows.length - preview.length, "more person", "more people")}{" "}
                below that.
              </p>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-2 rounded-xl border border-hairline bg-white/[0.03] p-3">
            <p className="text-sm font-semibold text-ink">{importSummary(result)}</p>
            {result.errors.length > 0 && (
              <ul className="space-y-1 text-xs text-ink-soft">
                {result.errors.slice(0, 10).map((entry, i) => (
                  <li key={i}>
                    {entry.email ? entry.email : `Line ${entry.row}`} — {entry.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
