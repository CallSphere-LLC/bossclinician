import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  KeyRound,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  teamApi,
  describeDevice,
  timeAgo,
  type AdminInvite,
  type AdminPerson,
  type AdminRole,
  type MySecurity,
  type RoleDescriptor,
} from "@/lib/settingsApi";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { friendlyError } from "@/pages/admin/ui/friendly";
import type { ColumnDef } from "@tanstack/react-table";

/**
 * Who can get into this admin, and how you keep your own account safe.
 *
 * Roles are shown as sentences about what a person can do — "Answers customers.
 * Can look things up and ask for a refund, nothing more." — because a
 * permission matrix is a thing you read to a developer, not a thing you choose
 * from.
 *
 * NOTE for whoever wires this phase up: turning two-step sign-in on requires the
 * sign-in screen to have a box for the code. The API is ready (POST
 * /api/admin/login accepts `code` and answers `{ mfaRequired: true }` when it
 * needs one); until `lib/api.ts`, `useAuth` and `Login.tsx` pass it through,
 * nobody should switch two-step on, because there would be nowhere to type it.
 */

const selectStyles =
  "h-11 w-full rounded-xl border border-hairline bg-white/[0.04] px-3 text-sm text-ink outline-none transition-all hover:border-white/20 focus-visible:border-gold/60 focus-visible:bg-white/[0.07] focus-visible:ring-4 focus-visible:ring-gold/15";

const STATUS_TONE: Record<string, "green" | "gold" | "slate"> = {
  active: "green",
  invited: "gold",
  suspended: "slate",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Has access",
  invited: "Waiting to accept",
  suspended: "Access paused",
};

/* ───────────────────────────────────────────────────────── your own account */

function SecurityCard() {
  const [security, setSecurity] = useState<MySecurity | null>(null);
  const [enrolling, setEnrolling] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    teamApi
      .mySecurity()
      .then(setSecurity)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  async function startEnrolment() {
    try {
      setEnrolling(await teamApi.startMfa());
      setCode("");
    } catch (err) {
      toast.error(friendlyError(err, "account"));
    }
  }

  async function finishEnrolment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await teamApi.confirmMfa(code);
      setEnrolling(null);
      setRecoveryCodes(result.recoveryCodes);
      toast.success("Two-step sign-in is on");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "code"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await teamApi.disableMfa(code);
      setTurningOff(false);
      setCode("");
      toast.success("Two-step sign-in is off");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "code"));
    } finally {
      setBusy(false);
    }
  }

  async function endSession(id: number) {
    const ok = await confirm({
      title: "Sign this device out?",
      description: "Whoever is using it will have to sign in again.",
      confirmLabel: "Yes, sign it out",
      destructive: true,
    });
    if (!ok) return;
    try {
      await teamApi.endSession(id);
      toast.success("Signed out");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "sign-in"));
    }
  }

  if (!security) return <Skeleton className="h-56 w-full" />;

  return (
    <>
      <Card>
        <CardHeader
          icon={<ShieldCheck />}
          title="Your sign-in"
          subtitle="Keeping your own account safe."
        />

        <div className="space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-ink">Ask for a code as well as my password</p>
              <p className="mt-1 max-w-xl text-sm text-ink-soft">
                Your password alone stops being enough. You'll type a six-digit code from an app on
                your phone — so somebody who learns your password still can't get in.
              </p>
              {security.mfaEnabled && (
                <p className="mt-2 text-xs text-ink-soft">
                  {security.recoveryCodesLeft} backup{" "}
                  {security.recoveryCodesLeft === 1 ? "code" : "codes"} left for if you lose your
                  phone.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <Badge tone={security.mfaEnabled ? "green" : "slate"}>
                {security.mfaEnabled ? "On" : "Off"}
              </Badge>
              {security.mfaEnabled ? (
                <Button variant="secondary" size="sm" onClick={() => setTurningOff(true)}>
                  Turn it off
                </Button>
              ) : (
                <Button size="sm" onClick={startEnrolment}>
                  Turn it on
                </Button>
              )}
            </div>
          </div>

          <div className="border-t border-hairline/60 pt-5">
            <p className="font-medium text-ink">Where you're signed in</p>
            <p className="mt-1 text-sm text-ink-soft">
              If you don't recognise one of these, sign it out and change your password.
            </p>
            <ul className="mt-3 space-y-2">
              {security.sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-white/[0.03] px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">
                      {describeDevice(session.userAgent)}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-soft">
                      <Clock className="size-3.5" />
                      Last used {timeAgo(session.lastUsedAt ?? session.createdAt).toLowerCase()}
                      {session.ip && ` · from ${session.ip}`}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => endSession(session.id)}>
                    <LogOut />
                    Sign out
                  </Button>
                </li>
              ))}
              {security.sessions.length === 0 && (
                <li className="text-sm text-ink-soft">Only this one.</li>
              )}
            </ul>
          </div>
        </div>
      </Card>

      <Modal
        open={enrolling !== null}
        onOpenChange={(open) => !open && setEnrolling(null)}
        title="Turn on the extra code"
        description="You'll need an authenticator app on your phone — Google Authenticator, 1Password or similar."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEnrolling(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="mfa-form" disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Finish"}
            </Button>
          </>
        }
      >
        <form id="mfa-form" onSubmit={finishEnrolment} className="space-y-5">
          <div>
            <p className="text-sm text-ink">
              1. In your authenticator app, choose "add account" and type this in:
            </p>
            <p className="mt-2 select-all break-all rounded-xl border border-hairline bg-white/[0.04] px-4 py-3 font-mono text-sm tracking-[0.12em] text-ink">
              {enrolling?.secret}
            </p>
            <p className="mt-2 text-xs text-ink-soft">
              On your phone?{" "}
              <a href={enrolling?.otpauthUrl} className="text-gold underline">
                Tap here to add it automatically.
              </a>
            </p>
          </div>
          <Field label="2. Type the six-digit code your app now shows" htmlFor="mfa-code">
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="max-w-[10rem] tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={turningOff}
        onOpenChange={(open) => {
          if (!open) {
            setTurningOff(false);
            setCode("");
          }
        }}
        title="Turn off the extra code?"
        description="Your password alone will be enough to get in again."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setTurningOff(false)}>
              Never mind
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="submit"
              form="mfa-off-form"
              disabled={busy || code.length < 6}
            >
              {busy ? "Checking…" : "Turn it off"}
            </Button>
          </>
        }
      >
        <form id="mfa-off-form" onSubmit={turnOff}>
          <Field label="Type a code from your app to confirm it's you" htmlFor="mfa-off-code">
            <Input
              id="mfa-off-code"
              inputMode="numeric"
              maxLength={10}
              className="max-w-[10rem] tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value.trim())}
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={recoveryCodes !== null}
        onOpenChange={(open) => !open && setRecoveryCodes(null)}
        title="Save these backup codes"
        description="If you ever lose your phone, one of these gets you back in. Each one works once."
        footer={
          <Button size="sm" onClick={() => setRecoveryCodes(null)}>
            I've saved them
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
          {(recoveryCodes ?? []).map((c) => (
            <span
              key={c}
              className="select-all rounded-lg border border-hairline bg-white/[0.04] px-3 py-2 text-center tracking-wider text-ink"
            >
              {c}
            </span>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          Print them, or put them somewhere only you can get to. We can't show them to you again.
        </p>
      </Modal>

      {confirmDialog}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────── the team */

export default function AdminUsers() {
  const { user } = useAuth();
  const [people, setPeople] = useState<AdminPerson[] | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [roles, setRoles] = useState<RoleDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ name: "", email: "", role: "support" as AdminRole });
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<AdminPerson | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const isOwner = user?.role === "owner";

  const load = useCallback(() => {
    teamApi
      .list()
      .then((res) => {
        setPeople(res.people);
        setInvites(res.invites);
        setError(null);
      })
      .catch(() => setError("We couldn't load your team. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    teamApi
      .roles()
      .then((res) => setRoles(res.roles))
      .catch(() => undefined);
  }, []);

  const roleOf = (role: AdminRole) => roles.find((r) => r.role === role);
  const roleLabel = (role: AdminRole) => roleOf(role)?.label ?? role;

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await teamApi.invite({
        name: invite.name,
        email: invite.email,
        role: invite.role as Exclude<AdminRole, "owner">,
      });
      toast.success(`We've emailed ${invite.email} a link to set their password.`);
      setInviting(false);
      setInvite({ name: "", email: "", role: "support" });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "invitation"));
    } finally {
      setSending(false);
    }
  }

  async function changeRole(person: AdminPerson, role: AdminRole) {
    try {
      await teamApi.update(person.id, { role });
      toast.success(`${person.name || person.email} is now ${roleLabel(role).toLowerCase()}.`);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    }
  }

  async function togglePause(person: AdminPerson) {
    const pausing = person.status !== "suspended";
    const ok = await confirm({
      title: pausing
        ? `Pause ${person.name || person.email}'s access?`
        : `Give ${person.name || person.email} access again?`,
      description: pausing
        ? "They'll be signed out straight away and won't be able to sign back in until you undo this."
        : "They'll be able to sign in again with the password they already have.",
      confirmLabel: pausing ? "Yes, pause it" : "Yes, give it back",
      destructive: pausing,
    });
    if (!ok) return;

    try {
      await (pausing ? teamApi.suspend(person.id) : teamApi.restore(person.id));
      toast.success(pausing ? "Access paused" : "Access restored");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    }
  }

  async function remove(person: AdminPerson) {
    const ok = await confirm({
      title: `Remove ${person.name || person.email}?`,
      description: "They lose access immediately. Anything they created stays where it is.",
      confirmLabel: "Yes, remove them",
      destructive: true,
    });
    if (!ok) return;

    try {
      await teamApi.remove(person.id);
      toast.success("Removed");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    }
  }

  async function withdrawInvite(pending: AdminInvite) {
    try {
      await teamApi.withdrawInvite(pending.id);
      toast.success("Invitation withdrawn");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "invitation"));
    }
  }

  const columns: ColumnDef<AdminPerson, unknown>[] = [
    {
      accessorKey: "name",
      header: "Person",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.original.name || "No name yet"}</p>
          <p className="truncate text-xs text-ink-soft">{row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "What they can do",
      cell: ({ row }) => (
        <div className="min-w-0 max-w-xs">
          <p className="font-medium text-ink">{roleLabel(row.original.role)}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
            {roleOf(row.original.role)?.summary}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1.5">
          <Badge tone={STATUS_TONE[row.original.status] ?? "slate"}>
            {STATUS_LABEL[row.original.status] ?? row.original.status}
          </Badge>
          {row.original.mfaEnabled && (
            <span className="inline-flex items-center gap-1 text-[0.68rem] text-ink-soft">
              <ShieldCheck className="size-3.5" />
              Uses a code too
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "lastLoginAt",
      header: "Last signed in",
      cell: ({ row }) => (
        <span className="text-sm text-ink-soft">{timeAgo(row.original.lastLoginAt)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const person = row.original;
        // `AdminUser.id` is typed as a string in @/types while the API sends a
        // number, so these are compared as text rather than one being trusted.
        const isMe = user !== null && String(person.id) === String(user.id);
        if (!isOwner || isMe) {
          return <RowActions>{isMe && <span className="text-xs text-ink-soft">You</span>}</RowActions>;
        }
        return (
          <RowActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(person)}
              aria-label={`Change what ${person.email} can do`}
            >
              <MoreHorizontal />
              Change
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              onClick={() => remove(person)}
              aria-label={`Remove ${person.email}`}
            >
              <Trash2 />
            </Button>
          </RowActions>
        );
      },
    },
  ];

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
          title="Who can get in"
          description="The people who can sign in to this admin, and what each of them is allowed to do."
          actions={
            isOwner && (
              <Button size="sm" onClick={() => setInviting(true)}>
                <UserPlus />
                Invite someone
              </Button>
            )
          }
        />
      </div>

      {error && <ErrorNotice message={error} />}

      <SecurityCard />

      <DataTable
        columns={columns}
        data={people}
        itemNoun={{ one: "person", many: "people" }}
        searchPlaceholder="Search by name or email…"
        minWidth="900px"
        emptyState={
          <EmptyState
            icon={<UserPlus />}
            title="It's just you"
            description="Invite someone when you're ready to share the load."
          />
        }
      />

      {invites.length > 0 && (
        <Card>
          <CardHeader
            icon={<Mail />}
            title="Waiting to accept"
            subtitle="They've been emailed a link to set their password."
          />
          <ul className="divide-y divide-hairline/60">
            {invites.map((pending) => (
              <li
                key={pending.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{pending.email}</span>
                  <span className="block text-xs text-ink-soft">
                    {roleLabel(pending.role)} · invited {timeAgo(pending.createdAt).toLowerCase()}
                  </span>
                </span>
                {isOwner && (
                  <Button variant="ghost" size="sm" onClick={() => withdrawInvite(pending)}>
                    Withdraw
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={inviting}
        onOpenChange={setInviting}
        title="Invite someone"
        description="We'll email them a link to set their own password."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="invite-form" disabled={sending}>
              {sending ? "Sending…" : "Send the invitation"}
            </Button>
          </>
        }
      >
        <form id="invite-form" onSubmit={sendInvite} className="space-y-4">
          <Field label="Their name" htmlFor="invite-name">
            <Input
              id="invite-name"
              value={invite.name}
              onChange={(e) => setInvite((v) => ({ ...v, name: e.target.value }))}
              placeholder="Sam Rivera"
              autoFocus
            />
          </Field>
          <Field label="Their email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite((v) => ({ ...v, email: e.target.value }))}
              placeholder="sam@example.com"
            />
          </Field>
          <Field label="What should they be able to do?" htmlFor="invite-role">
            <select
              id="invite-role"
              className={selectStyles}
              value={invite.role}
              onChange={(e) => setInvite((v) => ({ ...v, role: e.target.value as AdminRole }))}
            >
              {roles
                .filter((r) => r.role !== "owner")
                .map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
            </select>
          </Field>

          <RoleExplainer role={roleOf(invite.role)} />
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `${editing.name || editing.email}` : ""}
        description="Change what they can do, pause their access, or sign them out everywhere."
        footer={
          <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
            Done
          </Button>
        }
      >
        {editing && (
          <div className="space-y-5">
            <Field label="What they can do" htmlFor="edit-role">
              <select
                id="edit-role"
                className={selectStyles}
                value={editing.role}
                onChange={(e) => changeRole(editing, e.target.value as AdminRole)}
              >
                {roles.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>

            <RoleExplainer role={roleOf(editing.role)} />

            <div className="flex flex-wrap gap-2.5 border-t border-hairline/60 pt-4">
              <Button variant="secondary" size="sm" onClick={() => togglePause(editing)}>
                {editing.status === "suspended" ? "Give access back" : "Pause their access"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await teamApi.signOutEverywhere(editing.id);
                    toast.success(
                      res.signedOut > 0 ? "Signed out everywhere" : "They weren't signed in anywhere",
                    );
                  } catch (err) {
                    toast.error(friendlyError(err, "person"));
                  }
                }}
              >
                <KeyRound />
                Sign them out everywhere
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

/** The role, spelled out as two lists of sentences. Never a permission grid. */
function RoleExplainer({ role }: { role: RoleDescriptor | undefined }) {
  if (!role) return null;
  return (
    <div className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3.5">
      <p className="text-sm text-ink">{role.summary}</p>
      <ul className="mt-2.5 space-y-1 text-sm text-ink-soft">
        {role.canDo.map((item) => (
          <li key={item} className="flex gap-2">
            <Plus className="mt-0.5 size-3.5 shrink-0 text-green-bright" />
            {item}
          </li>
        ))}
        {role.cannotDo.map((item) => (
          <li key={item} className="flex gap-2 opacity-70">
            <span aria-hidden="true" className="mt-0.5 w-3.5 shrink-0 text-center text-red-300">
              —
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
