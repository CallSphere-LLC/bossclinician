import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Gift,
  MailPlus,
  MoreHorizontal,
  Plus,
  Search,
  Tags as TagsIcon,
  Trash2,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import {
  EMAIL_STATUS_LABEL,
  contactsApi,
  emailStatusLabel,
  hasActivity,
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
import { saveCsv } from "@/lib/formsApi";
import { readSpreadsheet, type ImportRow } from "@/lib/peopleSpreadsheet";
import { DataTable } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import ContactQuickView from "@/pages/admin/ContactQuickView";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * People — the one list.
 *
 * The three lists this replaces (enquiries, subscribers, members) are all still
 * there and all still right about their own thing; this is the screen that
 * answers "who is this person and what have they done", which none of them
 * could. Nothing here shows an identifier, a status code or a number of cents.
 */

/** Kajabi's "25 / page" choices. The server caps a page at 200. */
const PER_PAGE_OPTIONS = [25, 50, 100, 200] as const;

/** Column widths, so the checkbox and ⋯ stay narrow and names aren't cut short. */
const COLUMN_WIDTHS: Record<string, string> = {
  choose: "44px",
  name: "22%",
  email: "25%",
  status: "15%",
  lifetimeValueCents: "11%",
  createdAt: "12%",
  lastActivityAt: "12%",
  actions: "52px",
};

const STATUS_FILTERS: { value: EmailStatus | "all"; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "subscribed", label: EMAIL_STATUS_LABEL.subscribed },
  { value: "opted_out", label: EMAIL_STATUS_LABEL.opted_out },
  { value: "bounced", label: EMAIL_STATUS_LABEL.bounced },
  // Insights' "Marked as spam" row opens ?status=complained. Without a chip the
  // list was filtered with nothing on screen saying so, and read as everyone.
  { value: "complained", label: EMAIL_STATUS_LABEL.complained },
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

/** The short words Kajabi used in this column, which is what she reads down it. */
const MARKETING_LABEL: Record<EmailStatus, string> = {
  subscribed: "Subscribed",
  opted_out: "Unsubscribed",
  bounced: "Bounced",
  complained: "Marked as spam",
  unconfirmed: "Unconfirmed",
};

function personName(person: Contact): string {
  return person.name || `${person.firstName} ${person.lastName}`.trim();
}

/** The ⋯ at the end of a row: the few things worth doing without opening them. */
function RowMenu({
  person,
  onOpen,
  onDelete,
}: {
  person: Contact;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const label = personName(person) || person.email;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="iconSm" aria-label={`More you can do for ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[13rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
        >
          <RowMenuItem icon={<UserRound />} onSelect={onOpen}>
            Open their profile
          </RowMenuItem>
          <RowMenuItem
            icon={<Copy />}
            onSelect={() => {
              void navigator.clipboard
                ?.writeText(person.email)
                .then(() => toast.success("Email address copied"))
                .catch(() => toast.error("Your browser wouldn't let us copy that"));
            }}
          >
            Copy email address
          </RowMenuItem>
          <RowMenuItem icon={<Trash2 />} onSelect={onDelete} destructive>
            Delete
          </RowMenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function RowMenuItem({
  icon,
  children,
  onSelect,
  destructive,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none [&_svg]:size-4",
        destructive
          ? "text-red-400 data-[highlighted]:bg-red-500/10"
          : "text-ink data-[highlighted]:bg-white/[0.07] [&_svg]:text-ink-soft",
      )}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
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
  const [communityOnly, setCommunityOnly] = useState(searchParams.get("community") === "true");
  const [tagFilter, setTagFilter] = useState(searchParams.get("tag") ?? "");
  const [sort, setSort] = useState<NonNullable<ContactFilters["sort"]>>("newest");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(25);
  const [peeking, setPeeking] = useState<Contact | null>(null);

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
      community: communityOnly || undefined,
      audience,
      optOut,
      engagement,
      sort,
      page,
      limit: perPage,
    }),
    [search, status, tagFilter, communityOnly, sort, audience, optOut, engagement, page, perPage],
  );

  // A new search or filter starts back on the first page, as Kajabi's does.
  useEffect(() => {
    setPage(1);
  }, [search, status, tagFilter, communityOnly, sort, audience, optOut, engagement, perPage]);

  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const firstShown = total === 0 ? 0 : (page - 1) * perPage + 1;
  const lastShown = Math.min(page * perPage, total);

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
      // The columns her Kajabi contact list had, in its order: who, where to
      // reach them, whether she may email them, what they're worth, and when.
      {
        id: "name",
        accessorFn: (person) => personName(person),
        header: "Name",
        cell: ({ row }) => {
          const name = personName(row.original);
          // Kajabi's tick on the avatar marks a customer: somebody who has paid.
          const customer = row.original.orderCount > 0;
          return (
            <button
              type="button"
              onClick={() => setPeeking(row.original)}
              className="group/name flex w-full min-w-0 items-center gap-3 text-left"
              title="Quick view"
            >
              <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-plum-deep">
                <UserRound className="size-4" aria-hidden />
                {customer && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-ink text-surface ring-2 ring-surface"
                    title="Customer"
                  >
                    <Check className="size-2.5" strokeWidth={3} aria-hidden />
                    <span className="sr-only">Customer</span>
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "block truncate group-hover/name:underline",
                  name ? "font-semibold text-ink" : "text-ink-soft",
                )}
              >
                {name || "No name yet"}
              </span>
            </button>
          );
        },
      },
      {
        id: "email",
        accessorFn: (person) => person.email,
        header: "Email",
        cell: ({ row }) => (
          <span className="block truncate text-sm text-ink-soft" title={row.original.email}>
            {row.original.email}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (person) => MARKETING_LABEL[person.emailMarketingStatus] ?? "",
        header: "Email Marketing",
        /*
         * Two facts, independent of each other: whether we may email somebody,
         * and whether they have confirmed the address. Somebody can be
         * subscribed and still be locked out of posting because their account
         * was never confirmed, so the second one keeps its own badge.
         */
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-sm">
            <span
              className={cn(
                row.original.emailMarketingStatus === "subscribed" ? "text-ink-soft" : "font-semibold text-ink",
              )}
              title={emailStatusLabel(row.original.emailMarketingStatus)}
            >
              {MARKETING_LABEL[row.original.emailMarketingStatus] ?? "Not known"}
            </span>
            {row.original.accountMemberId !== null &&
              row.original.accountEmailVerifiedAt === null && (
                <Badge tone="gold">Not confirmed</Badge>
              )}
          </div>
        ),
      },
      {
        accessorKey: "lifetimeValueCents",
        header: "Lifetime Value",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink">
            {money(row.original.lifetimeValueCents)}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Added date",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">{formatDate(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: "lastActivityAt",
        header: "Last activity",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {hasActivity(row.original) ? formatDate(row.original.lastActivityAt as string) : "—"}
          </span>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        header: () => <span className="sr-only">More</span>,
        cell: ({ row }) => (
          <RowMenu
            person={row.original}
            onOpen={() => navigate(`/admin/contacts/${row.original.id}`)}
            onDelete={() => void deleteOne(row.original)}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteOne is re-created each render; load and confirm are what it reads
    [allSelected, people, selected, toggle, navigate, load, confirm],
  );

  async function download() {
    setBusy(true);
    try {
      const blob = await contactsApi.exportCsv(filters);
      saveCsv(blob, `people-${new Date().toISOString().slice(0, 10)}.csv`);
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
      saveCsv(blob, `chosen-people-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("Your chosen people are downloading");
    } catch (err) {
      toast.error(friendlyError(err, "list"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(person: Contact) {
    const ok = await confirm({
      title: `Delete ${personName(person) || person.email}?`,
      description:
        "Their contact card and marketing history will be erased. Payment records are kept for accounting.",
      confirmLabel: "Delete this person",
      destructive: true,
    });
    if (!ok) return;
    try {
      await contactsApi.remove(person.id);
      toast.success("Deleted");
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(person.id);
        return next;
      });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
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
        title="Contacts"
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/contacts/insights">
                <BarChart3 />
                Insights
              </Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={download} disabled={busy}>
              <Download />
              Export
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImporting(true)}>
              <Upload />
              Import contacts
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add contacts
            </Button>
          </>
        }
      />

      <nav aria-label="Contacts sections" className="-mt-2 flex gap-6 border-b border-hairline">
        <span
          aria-current="page"
          className="-mb-px border-b-2 border-ink pb-2.5 text-sm font-semibold text-ink"
        >
          All Contacts
        </span>
        <Link
          to="/admin/tags"
          className="-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2.5 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
        >
          <TagsIcon className="size-4" aria-hidden />
          Manage tags
        </Link>
      </nav>

      {error && <ErrorNotice message={error} />}

      {insightFilterLabel && (
        <Card className="flex min-h-12 flex-wrap items-center gap-3 px-4 py-2.5">
          <p className="text-sm font-semibold text-ink">Showing: {insightFilterLabel}</p>
          <Button className="ml-auto" variant="ghost" size="sm" onClick={clearInsightFilter}>
            Clear this filter
          </Button>
        </Card>
      )}

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
        minWidth="980px"
        // The server pages; the table shows every row it was handed.
        initialPageSize={PER_PAGE_OPTIONS[PER_PAGE_OPTIONS.length - 1]}
        columnWidths={COLUMN_WIDTHS}
        countLabel={
          <div className="flex w-full flex-wrap items-center gap-2.5 border-t border-hairline/60 pt-3">
            <p className="text-sm text-ink-soft" aria-live="polite">
              {people === null
                ? "Loading…"
                : `Displaying ${firstShown}–${lastShown} of ${pluralize(total, "contact", "contacts")}`}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="secondary"
                size="iconSm"
                aria-label="Previous page"
                disabled={page <= 1 || people === null}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="secondary"
                size="iconSm"
                aria-label="Next page"
                disabled={page >= pageCount || people === null}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <ChevronRight />
              </Button>
              <select
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
                aria-label="Contacts per page"
                className={cn(selectStyles, "h-9 w-auto min-w-[8.5rem] pr-9")}
              >
                {PER_PAGE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as NonNullable<ContactFilters["sort"]>)}
                aria-label="Sort contacts"
                className={cn(selectStyles, "h-9 w-auto min-w-[8.5rem] pr-9")}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2.5">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as EmailStatus | "all")}
              aria-label="Show contacts by email marketing status"
              className={cn(selectStyles, "w-auto")}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === "all" ? "All contacts" : option.label}
                </option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft/60"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Contacts..."
                aria-label="Search contacts"
                className="h-11 pl-10"
              />
            </div>
            <select
              value={communityOnly ? "community" : "everyone"}
              onChange={(e) => {
                const community = e.target.value === "community";
                setCommunityOnly(community);
                const next = new URLSearchParams(searchParams);
                if (community) next.set("community", "true");
                else next.delete("community");
                setSearchParams(next, { replace: true });
              }}
              aria-label="Filter contacts by membership"
              className={cn(selectStyles, "w-auto")}
            >
              <option value="everyone">Everyone</option>
              <option value="community">Community members</option>
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Show only contacts with a tag"
              className={cn(selectStyles, "w-auto max-w-56")}
            >
              <option value="">Any tag</option>
              {tags.map((tag) => (
                <option key={tag.slug} value={tag.slug}>
                  {tag.name}
                </option>
              ))}
            </select>
          </div>
        }
        emptyState={
          <EmptyState
            icon={<Users />}
            title={search || tagFilter || communityOnly || status !== "all" || insightFilterLabel ? "Nobody matches that" : "No people yet"}
            description={
              search || tagFilter || communityOnly || status !== "all" || insightFilterLabel
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

      <ContactQuickView
        person={peeking}
        onClose={() => setPeeking(null)}
        onDelete={(person) => {
          setPeeking(null);
          void deleteOne(person);
        }}
      />

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
      <form id="add-person" onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
  /** The rows the result's line numbers index into, kept in case the text is edited after. */
  const [sentRows, setSentRows] = useState<ImportRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setChosen([]);
    setResult(null);
    setSentRows([]);
  }, [open]);

  const parsed = useMemo(() => readSpreadsheet(text), [text]);
  const preview = parsed.rows.slice(0, 5);

  async function run() {
    setSaving(true);
    try {
      const rows = parsed.rows;
      const outcome = await contactsApi.importPeople(rows, chosen);
      setSentRows(rows);
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
                {/*
                  * `row` counts the people sent, not the lines of the file: the
                  * heading and any line without an address were dropped first,
                  * so "Line 3" pointed at the wrong line. Name the address read
                  * from that row instead, which is what she can search for.
                  */}
                {result.errors.slice(0, 10).map((entry, i) => (
                  <li key={i}>
                    {entry.email || sentRows[entry.row - 1]?.email || `Person ${entry.row}`} — {entry.message}
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
