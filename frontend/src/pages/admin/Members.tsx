import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BookOpen, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Enrollment, Member } from "@/types/admin";
import type { Course } from "@/types";
import { formatDate } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { friendlyError, humaniseKey } from "@/pages/admin/ui/friendly";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  active: "green",
  invited: "blue",
  cancelled: "slate",
};

/**
 * The stored states in her words. "Cancelled" is ambiguous on its own — it's
 * the access that ended, not the person — so the badge says so.
 */
const STATUS_LABEL: Record<string, string> = {
  active: "Has access",
  invited: "Invited",
  cancelled: "Access ended",
};

/** The person's name if we have one, otherwise the address we reach them at. */
function memberName(member: Member): string {
  return member.name?.trim() || member.email;
}

export default function Members() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "" });
  const [manage, setManage] = useState<Member | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [courseToAdd, setCourseToAdd] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .membersList()
      .then(setMembers)
      .catch(() => setError("We couldn't load your members. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    adminApi.coursesList().then(setCourses).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!manage) return;
    setEnrollments(null);
    adminApi.memberEnrollments(manage.id).then(setEnrollments).catch(() => undefined);
  }, [manage]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!form.email.trim()) return;
    try {
      await adminApi.memberCreate(form);
      toast.success("Member added");
      setCreating(false);
      setForm({ email: "", name: "" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "member"));
    }
  }

  async function remove(member: Member) {
    const ok = await confirm({
      title: `Remove ${memberName(member)}?`,
      description:
        "They'll lose access to every course and community straight away. You can't undo this.",
      confirmLabel: "Yes, remove them",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.memberDelete(member.id);
      toast.success("Member removed");
      load();
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
      load();
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
      load();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    }
  }

  const columns = useMemo<ColumnDef<Member, unknown>[]>(
    () => [
      {
        id: "name",
        // Search reads whatever the column reports, so the email goes in too —
        // she looks people up by address as often as by name.
        accessorFn: (member) => `${member.name} ${member.email}`,
        header: "Who",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-lilac-tint text-xs font-bold text-plum-deep">
              {(row.original.name || row.original.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">
                {row.original.name || "No name given"}
              </p>
              <p className="truncate text-xs text-ink-soft">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: "status",
        // Sorted and searched by the words on the badge, not the stored state.
        accessorFn: (member) => STATUS_LABEL[member.status] ?? humaniseKey(member.status),
        header: "Access",
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status] ?? "neutral"}>
            {STATUS_LABEL[row.original.status] ?? humaniseKey(row.original.status)}
          </Badge>
        ),
      },
      {
        accessorKey: "enrollmentCount",
        header: "Courses they're in",
        cell: ({ row }) => (
          <span className="tabular-nums text-ink">{row.original.enrollmentCount}</span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Member since",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button variant="ghost" size="sm" onClick={() => setManage(row.original)}>
              <BookOpen />
              Courses
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Remove ${memberName(row.original)}`}
              onClick={() => remove(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const enrolledIds = new Set((enrollments ?? []).map((e) => e.courseId));
  const availableCourses = courses.filter((c) => !enrolledIds.has(Number(c.id)));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title="Members"
        description="People with access to your courses and communities."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <UserPlus />
            Add a member
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={members}
        searchPlaceholder="Search your members…"
        itemNoun={{ one: "member", many: "members" }}
        minWidth="720px"
        emptyState={
          <EmptyState
            icon={<Users />}
            title="No members yet"
            description="Anyone who buys a course lands here automatically — or you can add someone yourself."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Add a member
              </Button>
            }
          />
        }
      />

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

      {confirmDialog}
    </div>
  );
}
