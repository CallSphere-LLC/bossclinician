import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import type { ColumnDef } from "@tanstack/react-table";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  BookOpen,
  Check,
  Download,
  Eye,
  KeyRound,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Enrollment, Member } from "@/types/admin";
import type { Course } from "@/types";
import { formatDate, formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { friendlyError, humaniseKey, pluralize } from "@/pages/admin/ui/friendly";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  active: "green",
  invited: "blue",
  suspended: "gold",
  cancelled: "slate",
  deleted: "slate",
};

/**
 * The stored states in her words. "Cancelled" is ambiguous on its own — it's
 * the access that ended, not the person — so the badge says so, and a paused
 * account reads as paused rather than as a punishment.
 */
const STATUS_LABEL: Record<string, string> = {
  active: "Has access",
  invited: "Invited",
  suspended: "Paused",
  cancelled: "Access ended",
  deleted: "Removed",
};

/** The states worth filtering by, in the order she thinks about people. */
const STATUS_FILTERS = ["active", "invited", "suspended", "cancelled"];

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? humaniseKey(status);
}

/** Their name if we have one — empty when all we hold is an email address. */
function fullName(member: Member): string {
  const parts = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
  return parts || (member.name?.trim() ?? "");
}

/** What to call them in a sentence: their name, or the address we reach them at. */
function memberName(member: Member): string {
  return fullName(member) || member.email;
}

/** Matches the Input primitive so the filter row reads as one set of controls. */
const SELECT_CLASS =
  "h-11 shrink-0 rounded-xl border border-hairline bg-surface px-3 text-sm text-ink outline-none transition-colors focus-visible:border-gold/60 focus-visible:ring-4 focus-visible:ring-gold/15";

/**
 * How many people we hold on screen at once. Everything below the toolbar —
 * sorting, paging — happens in the browser over this slice, so it needs to be
 * big enough that she almost never notices the ceiling, and the count from the
 * server is what tells her when she has hit it.
 */
const HOLD_ON_SCREEN = 200;

/* ------------------------------------------------- Reading her spreadsheet */

type ImportResult = Awaited<ReturnType<typeof adminApi.membersImport>>;
type ImportError = ImportResult["errors"][number];
type ImportRow = Record<string, string>;

/** Column headings she might have used, mapped to the fields we store. */
const IMPORT_HEADINGS: Record<string, string> = {
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
};

/**
 * Splits pasted spreadsheet text into rows of cells.
 *
 * Hand-rolled rather than pulled from a package because the only thing harder
 * here than `split(",")` is quoted cells: a name like "Howard, Yvette" comes
 * out of Excel wrapped in quotes with its comma intact, and a naive split
 * silently shifts every column after it onto the wrong person.
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
  rows: ImportRow[];
  /** Lines with nothing that looks like an email address on them. */
  unusable: number;
}

/**
 * Pasted text → the people in it.
 *
 * Deliberately forgiving, because the file is whatever her old system gave
 * her: copying straight out of a spreadsheet produces tabs rather than commas,
 * the headings might be missing entirely, and the columns arrive in any order.
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
    ? table[0].map((cell) => IMPORT_HEADINGS[cell.trim().toLowerCase()] ?? null)
    : null;
  // Headings we don't recognise are no better than none: fall back to reading
  // each line by eye rather than filing every column under nothing.
  const headings = mapped?.includes("email") ? mapped : null;
  const body = hasHeadings ? table.slice(1) : table;

  const rows: ImportRow[] = [];
  let unusable = 0;

  for (const line of body) {
    const row: ImportRow = {};
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

/** One rejected line, as a sentence rather than a blank bullet. */
function importErrorText(entry: ImportError): string {
  if (typeof entry === "string") return entry;
  const who = entry.email || (entry.row ? `Line ${entry.row}` : "One line");
  return `${who} — ${entry.message ?? "we couldn't use this one."}`;
}

/** The result in the numbers she cares about: who came in, who didn't. */
function importSummary(result: ImportResult): string {
  const parts: string[] = [];
  if (result.created) parts.push(`${pluralize(result.created, "person", "people")} added`);
  if (result.updated) parts.push(`${pluralize(result.updated, "person", "people")} updated`);
  if (result.skipped) parts.push(`${pluralize(result.skipped, "line", "lines")} skipped`);
  if (parts.length === 0) return "Nothing changed — everyone on that list was already here.";
  return `${parts.join(", ")}.`;
}

/* --------------------------------------------------------------- Row menu */

function MenuItem({
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

/* ------------------------------------------------------------------ Screen */

export default function Members() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [total, setTotal] = useState(0);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "" });
  const [editing, setEditing] = useState<Member | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  const [manage, setManage] = useState<Member | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [courseToAdd, setCourseToAdd] = useState("");

  const [downloading, setDownloading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [reloadToken, setReloadToken] = useState(0);
  const [confirm, confirmDialog] = useConfirm();

  /**
   * Bumping a counter rather than calling a fetch function keeps `reload`
   * identical for the life of the screen, so the row buttons — which are built
   * once and reused — always refresh against the filters that are on now
   * rather than the ones that were on when the table was first drawn.
   */
  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // A keystroke shouldn't be a request; she gets to finish typing a name first.
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let dropped = false;
    adminApi
      .membersSearch({
        q: searchTerm || undefined,
        status: statusFilter || undefined,
        courseId: courseFilter ? Number(courseFilter) : undefined,
        limit: HOLD_ON_SCREEN,
      })
      .then((page) => {
        if (dropped) return;
        setMembers(page.items);
        setTotal(page.total);
        setError(null);
      })
      .catch(() => {
        if (dropped) return;
        setMembers((current) => current ?? []);
        setError("We couldn't load your people. Try refreshing the page.");
      });
    return () => {
      dropped = true;
    };
  }, [searchTerm, statusFilter, courseFilter, reloadToken]);

  useEffect(() => {
    adminApi.coursesList().then(setCourses).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!manage) return;
    setEnrollments(null);
    adminApi.memberEnrollments(manage.id).then(setEnrollments).catch(() => undefined);
  }, [manage]);

  const filtering = Boolean(searchTerm || statusFilter || courseFilter);

  function clearFilters() {
    setSearch("");
    setSearchTerm("");
    setStatusFilter("");
    setCourseFilter("");
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.email.trim()) return;
    try {
      await adminApi.memberCreate(form);
      toast.success("Member added");
      setCreating(false);
      setForm({ email: "", name: "" });
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  function startEdit(member: Member) {
    setEditing(member);
    setEditName(fullName(member));
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await adminApi.memberUpdate(editing.id, { name: editName.trim() });
      toast.success("Saved");
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    } finally {
      setSaving(false);
    }
  }

  async function sendReset(member: Member) {
    const ok = await confirm({
      title: `Email ${memberName(member)} a way back in?`,
      description:
        "They'll get an email with a link to pick a new password. Their old one keeps working until they use it.",
      confirmLabel: "Yes, send it",
    });
    if (!ok) return;
    try {
      await adminApi.memberResetPassword(member.id);
      toast.success(`Sent to ${member.email}`);
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function viewAsMember(member: Member) {
    const name = memberName(member);
    const ok = await confirm({
      title: `View the site as ${name}?`,
      description: `You'll see the site exactly as ${name} sees it. They won't be notified.`,
      confirmLabel: "Yes, show me",
    });
    if (!ok) return;
    try {
      const { accessToken } = await adminApi.memberImpersonate(member.id);
      // A tab opened from here starts life with a copy of this tab's session
      // storage, which is how the sign-in is handed over — so it has to be
      // written before the open, and the open can't be told to sever the link
      // to this tab, which would leave the copy behind.
      // TODO: the member app reads bc_member_impersonation on boot and signs in
      // with it; that half is wired up with the member session work.
      sessionStorage.setItem("bc_member_impersonation", accessToken);
      const opened = window.open("/library", "_blank");
      if (!opened) {
        toast.error("Your browser stopped the new tab opening. Allow pop-ups here and try again.");
        return;
      }
      toast.success(`Opened the site as ${name}`);
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function pauseAccess(member: Member) {
    const ok = await confirm({
      title: `Pause ${memberName(member)}'s access?`,
      description:
        "They won't be able to sign in or open anything they've bought. Nothing is deleted, and you can give their access back whenever you like.",
      confirmLabel: "Yes, pause them",
    });
    if (!ok) return;
    try {
      await adminApi.memberSuspend(member.id);
      toast.success("Their access is paused");
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function restoreAccess(member: Member) {
    try {
      await adminApi.memberReactivate(member.id);
      toast.success(`${memberName(member)} can sign in again`);
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function remove(member: Member) {
    const ok = await confirm({
      title: `Remove ${memberName(member)}?`,
      description:
        "They lose access to every course and community straight away. If they've bought anything, we keep the payment records and remove their personal details. You can't undo this.",
      confirmLabel: "Yes, remove them",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.memberDelete(member.id);
      toast.success("Member removed");
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function enroll(e: FormEvent) {
    e.preventDefault();
    if (!manage || !courseToAdd) return;
    try {
      await adminApi.memberEnroll(manage.id, Number(courseToAdd));
      const fresh = await adminApi.memberEnrollments(manage.id);
      setEnrollments(fresh);
      setCourseToAdd("");
      toast.success("Added to the course");
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    }
  }

  async function unenroll(courseId: number) {
    if (!manage) return;
    try {
      await adminApi.memberUnenroll(manage.id, courseId);
      setEnrollments((prev) => prev?.filter((e) => e.courseId !== courseId) ?? prev);
      toast.success("Taken off the course");
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    }
  }

  async function downloadEveryone() {
    setDownloading(true);
    try {
      const blob = await adminApi.membersExportCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Your spreadsheet is downloading");
    } catch (err) {
      toast.error(friendlyError(err, "list"));
    } finally {
      setDownloading(false);
    }
  }

  function openImport() {
    setImportText("");
    setImportResult(null);
    setImportOpen(true);
  }

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clearing the box lets her pick the same file again after a correction.
    e.target.value = "";
    if (!file) return;
    setImportText(await file.text());
    setImportResult(null);
  }

  const parsedImport = useMemo(() => readSpreadsheet(importText), [importText]);

  async function runImport() {
    if (parsedImport.rows.length === 0) return;
    setImportBusy(true);
    try {
      setImportResult(await adminApi.membersImport(parsedImport.rows));
      reload();
    } catch (err) {
      toast.error(friendlyError(err, "list"));
    } finally {
      setImportBusy(false);
    }
  }

  const columns = useMemo<ColumnDef<Member, unknown>[]>(
    () => [
      {
        id: "name",
        // Sorted on the words in the cell, address included — she looks people
        // up by email as often as by name.
        accessorFn: (member) => `${fullName(member)} ${member.email}`,
        header: "Who",
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              {member.avatarUrl ? (
                <img
                  src={member.avatarUrl}
                  alt=""
                  loading="lazy"
                  className="size-9 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
                  {memberName(member).slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">
                  {fullName(member) || "No name given"}
                </p>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
                  <span className="truncate">{member.email}</span>
                  {member.emailVerifiedAt ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-green-bright">
                      <Check className="size-3" aria-hidden="true" />
                      confirmed
                    </span>
                  ) : (
                    <span className="shrink-0 text-gold">not confirmed yet</span>
                  )}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        id: "status",
        // Sorted on the words on the badge, not the state behind them.
        accessorFn: (member) => statusLabel(member.status),
        header: "Access",
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status] ?? "neutral"}>
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "enrollmentCount",
        header: "Courses they're in",
        cell: ({ row }) =>
          row.original.enrollmentCount > 0 ? (
            <span className="tabular-nums text-ink">{row.original.enrollmentCount}</span>
          ) : (
            <span className="text-sm text-ink-soft">None yet</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: "Joined",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "lastLogin",
        // Sorted on the moment itself; "3 days ago" would sort alphabetically.
        accessorFn: (member) => (member.lastLoginAt ? Date.parse(member.lastLoginAt) : 0),
        header: "Last signed in",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {row.original.lastLoginAt ? formatRelative(row.original.lastLoginAt) : "Not yet"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => {
          const member = row.original;
          const paused = member.status === "suspended";
          return (
            <RowActions>
              <Button variant="ghost" size="sm" onClick={() => setManage(member)}>
                <BookOpen />
                Courses
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={`More you can do for ${memberName(member)}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="z-50 min-w-[15rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
                  >
                    <MenuItem icon={<Pencil />} onSelect={() => startEdit(member)}>
                      Edit their details
                    </MenuItem>
                    <MenuItem icon={<KeyRound />} onSelect={() => sendReset(member)}>
                      Email them a new password
                    </MenuItem>
                    <MenuItem icon={<Eye />} onSelect={() => viewAsMember(member)}>
                      View the site as them
                    </MenuItem>
                    <MenuItem
                      icon={paused ? <Play /> : <Pause />}
                      onSelect={() => (paused ? restoreAccess(member) : pauseAccess(member))}
                    >
                      {paused ? "Give their access back" : "Pause their access"}
                    </MenuItem>
                    <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
                    <MenuItem icon={<Trash2 />} destructive onSelect={() => remove(member)}>
                      Remove them
                    </MenuItem>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </RowActions>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const enrolledIds = new Set((enrollments ?? []).map((e) => e.courseId));
  const availableCourses = courses.filter((c) => !enrolledIds.has(Number(c.id)));
  const previewRows = parsedImport.rows.slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title="Members"
        description="Everyone with an account — what they're in, and when you last saw them."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={openImport}>
              <Upload />
              Add from a spreadsheet
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={downloadEveryone}
              disabled={downloading || (!filtering && members !== null && members.length === 0)}
            >
              <Download />
              {downloading ? "Getting it ready…" : "Download everyone"}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <UserPlus />
              Add a member
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={members}
        itemNoun={{ one: "person", many: "people" }}
        minWidth="1020px"
        toolbar={
          <>
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft/60"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email"
                aria-label="Search by name or email"
                className="h-11 w-full rounded-xl border border-hairline bg-white/[0.04] pl-10 pr-3 text-sm text-ink outline-none transition-all placeholder:text-ink-soft/55 focus-visible:border-gold/60 focus-visible:bg-white/[0.07] focus-visible:ring-4 focus-visible:ring-gold/15"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Who to show"
              className={SELECT_CLASS}
            >
              <option value="">Everyone</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Enrolled in…"
              className={SELECT_CLASS}
            >
              <option value="">In any course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </>
        }
        emptyState={
          filtering ? (
            <EmptyState
              icon={<Search />}
              title="Nobody matches that"
              description="Try a shorter search, or show everyone again."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Show everyone
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Users />}
              title="Nobody here yet"
              description="This fills up on its own — everyone who signs up or buys something from you appears here, with what they're in and when they last visited. You can also add someone yourself."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  Add a member
                </Button>
              }
            />
          )
        }
      />

      {members !== null && total > members.length && (
        <p className="text-xs text-ink-soft">
          Showing the first {members.length} of {pluralize(total, "person", "people")}. Search above
          to find someone in particular.
        </p>
      )}

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Add a member"
        description="They'll get access to whichever courses you put them in."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Never mind
            </Button>
            <Button size="sm" type="submit" form="new-member">
              Add member
            </Button>
          </>
        }
      >
        <form id="new-member" onSubmit={create} className="space-y-4">
          <Field label="Email address" htmlFor="member-email" hint="how they sign in">
            <Input
              id="member-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              autoFocus
            />
          </Field>
          <Field label="Their name" htmlFor="member-name" hint="optional">
            <Input
              id="member-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Edit ${memberName(editing)}` : ""}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="edit-member" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="edit-member" onSubmit={saveEdit} className="space-y-4">
            <Field label="Their name" htmlFor="edit-member-name">
              <Input
                id="edit-member-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
            </Field>
            <div className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3 text-sm text-ink-soft">
              <p>
                They sign in with <span className="font-semibold text-ink">{editing.email}</span>.
              </p>
              <p className="mt-1">
                {editing.emailVerifiedAt
                  ? "They've confirmed that address."
                  : "They haven't confirmed that address yet, so some emails may not reach them."}
              </p>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={manage !== null}
        onOpenChange={(open) => !open && setManage(null)}
        title={manage ? `Courses ${memberName(manage)} is enrolled in` : ""}
        size="lg"
      >
        <div className="space-y-5">
          <form onSubmit={enroll} className="flex flex-wrap items-end gap-3">
            <Field label="Put them in a course" className="min-w-0 flex-1">
              <select
                value={courseToAdd}
                onChange={(e) => setCourseToAdd(e.target.value)}
                className="h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-sm outline-none focus-visible:border-plum focus-visible:ring-4 focus-visible:ring-plum/12"
              >
                <option value="">
                  {availableCourses.length === 0
                    ? "They're already in all of your courses"
                    : "Choose a course…"}
                </option>
                {availableCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" size="md" disabled={!courseToAdd}>
              <Plus />
              Give them access
            </Button>
          </form>

          {enrollments === null ? (
            <Skeleton className="h-24 w-full" />
          ) : enrollments.length === 0 ? (
            <EmptyState
              icon={<BookOpen />}
              title="Not in any courses yet"
              description="Pick a course above and they'll be able to watch it straight away."
            />
          ) : (
            <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline">
              {enrollments.map((enrollment) => (
                <li key={enrollment.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{enrollment.courseTitle}</p>
                    <p className="text-xs text-ink-soft">
                      Added {formatDate(enrollment.createdAt)} · {enrollment.progress}% watched
                    </p>
                  </div>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={() => unenroll(enrollment.courseId)}
                  >
                    Take them out
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={(open) => !open && setImportOpen(false)}
        title="Add people from a spreadsheet"
        description={
          importResult
            ? undefined
            : "Paste your list below, or choose a file. Everyone needs an email address; a name is a bonus."
        }
        size="lg"
        footer={
          importResult ? (
            <Button size="sm" onClick={() => setImportOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(false)}>
                Never mind
              </Button>
              <Button
                size="sm"
                onClick={runImport}
                disabled={importBusy || parsedImport.rows.length === 0}
              >
                {importBusy
                  ? "Adding them…"
                  : parsedImport.rows.length === 0
                    ? "Add them"
                    : `Add ${pluralize(parsedImport.rows.length, "person", "people")}`}
              </Button>
            </>
          )
        }
      >
        {importResult ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-ink">{importSummary(importResult)}</p>
            {importResult.errors.length > 0 && (
              <div className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3">
                <p className="text-sm font-semibold text-ink">These ones need a second look</p>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-soft">
                  {importResult.errors.slice(0, 8).map((entry, i) => (
                    <li key={i}>{importErrorText(entry)}</li>
                  ))}
                </ul>
                {importResult.errors.length > 8 && (
                  <p className="mt-2 text-xs text-ink-soft">
                    …and {importResult.errors.length - 8} more like that.
                  </p>
                )}
              </div>
            )}
            <p className="text-sm text-ink-soft">
              Anyone new starts with no courses — put them in one from their row.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              label="Your list"
              htmlFor="import-text"
              hint="one person per line, email first"
            >
              <Textarea
                id="import-text"
                rows={6}
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportResult(null);
                }}
                placeholder={"Email address, Name\nsam@example.com, Sam Fletcher"}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={chooseFile}
                className="hidden"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                <Upload />
                Choose a file instead
              </Button>
              {parsedImport.unusable > 0 && (
                <p className="text-xs text-ink-soft">
                  {pluralize(parsedImport.unusable, "line", "lines")} with no email address will be
                  left out.
                </p>
              )}
            </div>

            {previewRows.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">
                  Here's what we read — check the first few look right
                </p>
                <div className="overflow-hidden rounded-xl border border-hairline">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-cream/70">
                      <tr>
                        <th className="px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft">
                          Email address
                        </th>
                        <th className="px-4 py-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft">
                          Name
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline/60">
                      {previewRows.map((row, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2 text-ink">{row.email}</td>
                          <td className="px-4 py-2 text-ink-soft">
                            {[row.firstName, row.lastName].filter(Boolean).join(" ") ||
                              row.name ||
                              "No name given"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsedImport.rows.length > previewRows.length && (
                  <p className="mt-2 text-xs text-ink-soft">
                    …and {pluralize(parsedImport.rows.length - previewRows.length, "more person", "more people")} below that.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
