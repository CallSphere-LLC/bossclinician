import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { CreditCard, Eye, KeyRound, Mail, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  AdminApiError,
  adminQuestionnaireFileUrl,
  adminRetreatsApi,
  formatCents,
  formatRetreatDate,
  TASK_STATUS_LABEL,
  type AccessEmailPreview,
  type AccountMatch,
  type AdminAnswerRow,
  type AdminGuestDetail,
  type AdminGuestQuestionnaire,
  type AdminGuestRow,
  type RoomType,
  type TaskKey,
} from "@/lib/retreatsApi";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  chipRowStyles,
} from "@/pages/admin/ui/primitives";
import { BalancePlanBadge, RetreatBalancePlanModal, useBalancePlans } from "./RetreatBalancePlan";
import { STATUS_TONE, isReviewable, roomTypeLabel } from "./retreatAdminRules";

type Filter = "all" | "access" | "booking_only" | "needs_follow_up";

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "");

/**
 * Guest Manager — who has this retreat's dashboard, what each guest has done,
 * and the per-guest actions: give or remove dashboard access, set her room,
 * preview and send the access email.
 *
 * Giving access never charges anyone, never changes a payment plan or balance,
 * never sends an email and never starts an automation (routes/admin/retreatExtras.ts).
 * The access email is its own explicit action, one guest at a time.
 */
export function RetreatGuests({ retreatId }: { retreatId: number }) {
  const [guests, setGuests] = useState<AdminGuestRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [emailFor, setEmailFor] = useState<AdminGuestRow | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  // Payment plans (card on file + automatic monthly charges): one load for the retreat, looked up per guest.
  const balancePlans = useBalancePlans(retreatId);
  const [planForId, setPlanForId] = useState<number | null>(null);
  const planGuest = planForId === null ? null : (guests ?? []).find((g) => g.memberId === planForId) ?? null;

  const load = useCallback(async () => {
    try {
      setGuests((await adminRetreatsApi.guests(retreatId)).guests);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load guests.");
    }
  }, [retreatId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (guests ?? []).filter((g) => {
      if (q && !`${g.name} ${g.email} ${g.bookingEmail}`.toLowerCase().includes(q)) return false;
      if (filter === "access") return g.hasDashboardAccess;
      if (filter === "booking_only") return !g.hasDashboardAccess;
      if (filter === "needs_follow_up") return g.paymentsStatus === "incomplete" || g.checklist.some((c) => c.status === "needs_attention");
      return true;
    });
  }, [guests, filter, query]);

  async function remove(g: AdminGuestRow) {
    const ok = await confirm({
      title: `Remove ${g.name || g.email}'s dashboard access?`,
      description:
        "She will no longer be able to open this retreat dashboard. Her answers, agreement, booking and payment records are kept, and nothing is emailed. You can give access back at any time.",
      confirmLabel: "Yes, remove access",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminRetreatsApi.removeAccess(retreatId, g.memberId);
      toast.success("Dashboard access removed");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove access.");
    }
  }

  async function giveBack(g: AdminGuestRow) {
    try {
      await grantWithMismatchCheck(retreatId, { memberId: g.memberId }, confirm);
      void load();
    } catch {
      /* toast already shown */
    }
  }

  async function setRoom(g: AdminGuestRow, value: string) {
    const roomType = value === "" ? null : (value as RoomType);
    try {
      await adminRetreatsApi.setRoomType(retreatId, g.memberId, roomType);
      toast.success("Room saved");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the room.");
    }
  }

  return (
    <div className="space-y-5">
      {confirmDialog}
      {error && <ErrorNotice message={error} />}
      {balancePlans.error && <ErrorNotice message={`Payment plans: ${balancePlans.error}`} />}
      <GrantAccessCard retreatId={retreatId} onGranted={() => void load()} confirm={confirm} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={chipRowStyles}>
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
          <Chip selected={filter === "access"} onClick={() => setFilter("access")}>Has dashboard</Chip>
          <Chip selected={filter === "booking_only"} onClick={() => setFilter("booking_only")}>No dashboard yet</Chip>
          <Chip selected={filter === "needs_follow_up"} onClick={() => setFilter("needs_follow_up")}>Needs follow-up</Chip>
        </div>
        <Input className="max-w-xs" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search guests" />
      </div>
      <Card>
        <CardHeader icon={<Users />} title="Guest Manager" subtitle="Statuses come from real records; open a guest to see her answers and verify or ask for a correction" />
        {guests === null && !error ? (
          <div className="p-5"><Skeleton className="h-24" /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<Users />} title="No guests here" description="Guests appear once they hold the booking product or have been given the dashboard." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.08em] text-ink-soft">
                <tr className="border-b border-hairline">
                  <th className="px-5 py-3 font-semibold">Guest</th>
                  <th className="px-3 py-3 font-semibold">Checklist</th>
                  <th className="px-3 py-3 font-semibold">Room</th>
                  <th className="px-3 py-3 font-semibold">Payments</th>
                  <th className="px-3 py-3 font-semibold">Access email</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.memberId} className="border-b border-hairline/60 align-top">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-ink">{g.name || g.email}</p>
                      <p className="text-xs text-ink-soft">{g.email}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {g.hasDashboardAccess ? (
                          <Badge tone="green">Dashboard access</Badge>
                        ) : g.accessRemovedAt ? (
                          <Badge tone="red">Access removed</Badge>
                        ) : (
                          <Badge tone="gold">No dashboard yet</Badge>
                        )}
                        {!g.hasPassword && <Badge tone="slate">No password yet</Badge>}
                        {g.bookingEmail && g.bookingEmail.toLowerCase() !== g.email.toLowerCase() && (
                          <Badge tone="gold" title={`Booking email: ${g.bookingEmail}`}>Booking email differs</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex max-w-[22rem] flex-wrap gap-1">
                        {g.checklist.map((item) => (
                          <Badge key={item.key} tone={STATUS_TONE[item.status]} title={`${item.label}: ${TASK_STATUS_LABEL[item.status]}`}>
                            {item.label}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Select
                        aria-label={`Room for ${g.name || g.email}`}
                        className="min-w-[9rem]"
                        value={g.roomTypeSetByOrganizer ?? ""}
                        onChange={(e) => void setRoom(g, e.target.value)}
                      >
                        <option value="">{g.roomTypeSetByOrganizer === null && g.roomType !== "unknown" ? `From booking: ${roomTypeLabel(g.roomType)}` : "Not set"}</option>
                        <option value="private">Private room</option>
                        <option value="shared">Shared room</option>
                      </Select>
                    </td>
                    <td className="px-3 py-3">
                      {g.paymentsStatus === "complete" ? (
                        <Badge tone="green">Recorded</Badge>
                      ) : (
                        <span className="text-xs text-ink-soft">Not recorded on this site (e.g. billed in Kajabi)</span>
                      )}
                      {!balancePlans.error && (
                        <div className="mt-1.5">
                          <BalancePlanBadge plan={balancePlans.byMember?.get(g.memberId)} loading={balancePlans.byMember === null} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-soft">
                      {g.welcomeSentAt ? (
                        <p>
                          Sent {dateTime(g.welcomeSentAt)}
                          {g.welcomeSendCount > 1 && <span className="font-sans font-bold tabular-nums"> ({g.welcomeSendCount}×)</span>}
                        </p>
                      ) : (
                        <p>Not sent</p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-stretch gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setOpenId(g.memberId)}>Open</Button>
                        <Button size="sm" variant="secondary" disabled={balancePlans.byMember === null} onClick={() => setPlanForId(g.memberId)}>
                          <CreditCard aria-hidden /> {balancePlans.byMember?.has(g.memberId) ? "Payment plan" : "Set up payments"}
                        </Button>
                        {g.hasDashboardAccess ? (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setEmailFor(g)}><Mail aria-hidden /> Access email</Button>
                            <Button size="sm" variant="dangerGhost" onClick={() => void remove(g)}>Remove access</Button>
                          </>
                        ) : (
                          <Button size="sm" onClick={() => void giveBack(g)}><KeyRound aria-hidden /> Give dashboard access</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {openId !== null && (
        <GuestDetailModal retreatId={retreatId} memberId={openId} onClose={() => { setOpenId(null); void load(); }} />
      )}
      {emailFor && <AccessEmailModal retreatId={retreatId} guest={emailFor} onClose={() => { setEmailFor(null); void load(); }} />}
      {planGuest && (
        <RetreatBalancePlanModal
          retreatId={retreatId}
          guest={planGuest}
          plan={balancePlans.byMember?.get(planGuest.memberId) ?? null}
          onChanged={balancePlans.reload}
          onClose={() => setPlanForId(null)}
        />
      )}
    </div>
  );
}

type ConfirmFn = ReturnType<typeof useConfirm>[0];

/**
 * Grants, and on the server's "booking email differs" answer asks the owner
 * to confirm it is the same person before linking the booking to the account.
 */
async function grantWithMismatchCheck(
  retreatId: number,
  body: Parameters<typeof adminRetreatsApi.grantAccess>[1],
  confirm: ConfirmFn,
): Promise<{ memberId: number; created: boolean } | null> {
  try {
    const result = await adminRetreatsApi.grantAccess(retreatId, body);
    toast.success(result.created ? "Account created and dashboard access given. Nothing was emailed." : "Dashboard access given. Nothing was emailed.");
    return result;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 409 && e.details?.code === "email_mismatch") {
      const other = e.details.bookingEmailAccount as { email: string; name: string } | null;
      const ok = await confirm({
        title: "The booking email and the account email are different",
        description: [
          `Booking email: ${String(e.details.bookingEmail)}.`,
          `Website account: ${String(e.details.accountEmail)}.`,
          other ? `Note: a different account (${other.name || other.email}) already uses the booking email — check you have the right person.` : "",
          "Only continue if you have confirmed they are the same person.",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: "Same person — link and give access",
      });
      if (!ok) return null;
      const result = await adminRetreatsApi.grantAccess(retreatId, { ...body, acceptEmailMismatch: true });
      toast.success("Dashboard access given. Nothing was emailed.");
      return result;
    }
    toast.error(e instanceof Error ? e.message : "Could not give access.");
    throw e;
  }
}

function GrantAccessCard({ retreatId, onGranted, confirm }: { retreatId: number; onGranted: () => void; confirm: ConfirmFn }) {
  const [email, setEmail] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [name, setName] = useState("");
  const [roomType, setRoomType] = useState<"" | RoomType>("");
  const [match, setMatch] = useState<{ email: string; account: AccountMatch | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Enter her full email address.");
      return;
    }
    setBusy(true);
    try {
      const { account } = await adminRetreatsApi.lookupAccount(retreatId, value);
      setMatch({ email: value, account });
      if (!bookingEmail) setBookingEmail(value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not look up that email.");
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    if (!match) return;
    const ok = await confirm({
      title: match.account ? `Give ${match.account.name || match.account.email} this retreat's dashboard?` : `Create an account for ${match.email} and give her the dashboard?`,
      description:
        "This gives the retreat dashboard only — no other program. It does not charge her, change her payment plan or balance, send any email, or start any automation. Send her the access email afterwards from her row.",
      confirmLabel: "Give dashboard access",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await grantWithMismatchCheck(
        retreatId,
        {
          ...(match.account ? { memberId: match.account.memberId } : { email: match.email, name: name.trim() || undefined }),
          bookingEmail: bookingEmail.trim() || undefined,
          roomType: roomType || null,
        },
        confirm,
      );
      if (result) {
        setEmail("");
        setBookingEmail("");
        setName("");
        setRoomType("");
        setMatch(null);
        onGranted();
      }
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  }

  const account = match?.account ?? null;
  const differs = Boolean(match && bookingEmail.trim() && bookingEmail.trim().toLowerCase() !== (account?.email ?? match.email).toLowerCase());

  return (
    <Card>
      <CardHeader
        icon={<UserPlus />}
        title="Give a guest dashboard access"
        subtitle="For an existing reservation: matches her website account by email (no duplicates). No charge, no payment change, no email."
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Guest's email address" hint="The email on her website account, if she has one">
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setMatch(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void find();
                }
              }}
            />
            <Button variant="secondary" disabled={busy} onClick={() => void find()}>Find account</Button>
          </div>
        </Field>
        <Field label="Email on her booking" hint="From her booking or receipt. If it differs you'll be asked to confirm before linking.">
          <Input type="email" value={bookingEmail} onChange={(e) => setBookingEmail(e.target.value)} />
        </Field>
        {match && (
          <div className="sm:col-span-2 rounded-xl border border-hairline p-4 text-sm">
            {account ? (
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <ShieldCheck aria-hidden className="size-4 text-gold" /> Existing account: {account.name || "(no name)"} · {account.email}
                </p>
                <div className="flex flex-wrap gap-1">
                  {account.holdsBooking ? <Badge tone="green">Holds the retreat booking</Badge> : <Badge tone="gold">No booking record on this site</Badge>}
                  {account.holdsDashboard && <Badge tone="green">Already has the dashboard</Badge>}
                  {account.hasPassword ? <Badge tone="neutral">Has a password</Badge> : <Badge tone="slate">No password yet — the access email will include a set-password link</Badge>}
                  {account.status !== "active" && <Badge tone="red">Account {account.status}</Badge>}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-ink">No website account uses {match.email}. One will be created the usual way (no password); the access email will include her set-password link.</p>
                <Field label="Her name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
            )}
            {differs && (
              <p className="mt-2 text-xs font-semibold text-gold">
                The booking email ({bookingEmail.trim()}) is different from the account email. You'll be asked to confirm they're the same person.
              </p>
            )}
          </div>
        )}
        <Field label="Room" hint="Shared-room guests see the shared-room question">
          <Select value={roomType} onChange={(e) => setRoomType(e.target.value as "" | RoomType)}>
            <option value="">Not set (use her booking)</option>
            <option value="private">Private room</option>
            <option value="shared">Shared room</option>
          </Select>
        </Field>
        <div className="flex items-end justify-end">
          <Button disabled={busy || !match || (account?.holdsDashboard ?? false)} onClick={() => void grant()}>
            <KeyRound aria-hidden /> Give dashboard access
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AccessEmailModal({ retreatId, guest, onClose }: { retreatId: number; guest: AdminGuestRow; onClose: () => void }) {
  const [preview, setPreview] = useState<AccessEmailPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminRetreatsApi
      .accessEmailPreview(retreatId, guest.memberId)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the email."));
  }, [retreatId, guest.memberId]);

  async function send() {
    setBusy(true);
    try {
      const result = await adminRetreatsApi.sendAccessEmail(retreatId, guest.memberId);
      toast.success(result.includesPasswordSetup ? "Access email sent, with her set-password link" : "Access email sent");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Dashboard access email"
      description={`To ${guest.name || guest.email}. Sent only when you press Send.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" disabled={busy || !preview || preview.blockers.length > 0} onClick={() => void send()}>
            <Mail aria-hidden /> {guest.welcomeSentAt ? "Send again" : "Send to her"}
          </Button>
        </>
      }
    >
      {error && <ErrorNotice message={error} />}
      {!preview && !error && <Skeleton className="h-40" />}
      {preview && (
        <div className="space-y-4 text-sm">
          {preview.blockers.length > 0 && (
            <div className="rounded-xl border border-gold/40 bg-gold/[0.08] p-3 text-xs text-gold">
              {preview.blockers.map((b) => <p key={b}>{b}</p>)}
            </div>
          )}
          <dl className="grid grid-cols-[6rem_1fr] gap-1 text-xs">
            <dt className="text-ink-soft">To</dt><dd className="text-ink">{preview.to}</dd>
            <dt className="text-ink-soft">Reply-to</dt><dd className="text-ink">{preview.replyTo}</dd>
            <dt className="text-ink-soft">Subject</dt><dd className="text-ink">{preview.subject}</dd>
          </dl>
          {preview.includesPasswordSetup && (
            <p className="text-xs text-ink-soft">
              She hasn't set a password yet, so the email includes a one-time set-password link (valid 24 hours). The link below is a marked sample; the real one is created only when you send.
            </p>
          )}
          <pre className="whitespace-pre-wrap rounded-xl border border-hairline bg-white/[0.03] p-4 font-sans text-sm text-ink">{preview.text}</pre>
        </div>
      )}
    </Modal>
  );
}

function GuestDetailModal({ retreatId, memberId, onClose }: { retreatId: number; memberId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminGuestDetail | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(() => {
    adminRetreatsApi
      .guest(retreatId, memberId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this guest."));
  }, [retreatId, memberId]);

  useEffect(() => reload(), [reload]);

  async function reviewTask(key: TaskKey, status: "verified" | "needs_attention" | "clear") {
    const note = notes[key] ?? "";
    if (status === "needs_attention" && note.trim() === "") {
      toast.error("Say what needs attention — the guest sees this note.");
      return;
    }
    setBusyKey(key);
    try {
      setDetail(await adminRetreatsApi.reviewTask(retreatId, memberId, key, status, note));
      toast.success("Review saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the review.");
    } finally {
      setBusyKey(null);
    }
  }

  async function reviewQuestionnaire(q: AdminGuestQuestionnaire, status: "verified" | "needs_attention" | "clear") {
    const key = `q:${q.id}`;
    const note = notes[key] ?? "";
    if (status === "needs_attention" && note.trim() === "") {
      toast.error("Say what needs attention — the guest sees this note.");
      return;
    }
    setBusyKey(key);
    try {
      await adminRetreatsApi.reviewQuestionnaire(retreatId, memberId, q.id, status, note);
      toast.success("Review saved");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the review.");
    } finally {
      setBusyKey(null);
    }
  }

  const fixedTasks = detail?.checklist.filter((item) => !item.key.startsWith("questionnaire:")) ?? [];

  return (
    <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={detail ? detail.name || detail.email : "Guest"} description={detail?.email} size="xl">
      {error && <ErrorNotice message={error} />}
      {!detail && !error && <Skeleton className="h-40" />}
      {detail && (
        <div className="space-y-6 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={detail.hasDashboardAccess ? "green" : "gold"}>{detail.hasDashboardAccess ? "Has dashboard access" : "No dashboard access"}</Badge>
            <Badge tone="neutral">Room: {roomTypeLabel(detail.roomType)}</Badge>
            {detail.access?.bookingEmail && <Badge tone="neutral">Booking email: {detail.access.bookingEmail}</Badge>}
            <Button size="sm" variant="secondary" asChild>
              <Link to={`/admin/retreats/${retreatId}/preview?memberId=${memberId}`}><Eye aria-hidden /> View her dashboard (read-only)</Link>
            </Button>
          </div>
          <p className="text-xs text-ink-soft">
            Only the owner and administrators can see these answers. Health answers are marked; share only what a provider needs to arrange the support she asked for.
          </p>

          <section className="space-y-3">
            <h3 className="font-display text-base text-ink">Questionnaires</h3>
            {detail.questionnaires.map((q) => (
              <div key={q.id} className="rounded-xl border border-hairline p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {q.title}
                    {q.archived && <span className="text-ink-soft"> · archived</span>}
                  </p>
                  <Badge tone={STATUS_TONE[q.status]}>{TASK_STATUS_LABEL[q.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {q.state === "none"
                    ? "Not started"
                    : `${q.state === "submitted" ? `Submitted ${dateTime(q.submittedAt)}` : "Draft"} · last saved ${dateTime(q.updatedAt)} · answered on version ${q.version ?? "—"} (current ${q.currentVersion})`}
                </p>
                {q.state !== "none" && <AnswerList retreatId={retreatId} rows={q.answers} />}
                {q.history.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-plum-deep underline">Earlier submissions ({q.history.length})</summary>
                    {q.history.map((h, i) => (
                      <div key={i} className="mt-2 border-t border-hairline pt-2">
                        <p className="text-xs text-ink-soft">{dateTime(h.submittedAt)} · version {h.version}</p>
                        <AnswerList retreatId={retreatId} rows={h.answers} />
                      </div>
                    ))}
                  </details>
                )}
                {q.state !== "none" && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Textarea
                      rows={1}
                      className="min-w-[14rem] flex-1"
                      placeholder="Note for the guest (required for Needs attention)"
                      value={notes[`q:${q.id}`] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [`q:${q.id}`]: e.target.value }))}
                      aria-label={`Review note for ${q.title}`}
                    />
                    <Button size="sm" disabled={busyKey === `q:${q.id}`} onClick={() => void reviewQuestionnaire(q, "verified")}>Verify</Button>
                    <Button size="sm" variant="secondary" disabled={busyKey === `q:${q.id}`} onClick={() => void reviewQuestionnaire(q, "needs_attention")}>Needs attention</Button>
                    <Button size="sm" variant="ghost" disabled={busyKey === `q:${q.id}`} onClick={() => void reviewQuestionnaire(q, "clear")}>Clear review</Button>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section>
            <h3 className="font-display text-base text-ink">Other checklist items</h3>
            <ul className="mt-2 space-y-3">
              {fixedTasks.map((item) => (
                <li key={item.key} className="rounded-xl border border-hairline p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{item.label}</p>
                    <Badge tone={STATUS_TONE[item.status]}>{TASK_STATUS_LABEL[item.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{item.detail}</p>
                  {item.reviewNote && <p className="mt-1 text-xs text-gold">Your note: {item.reviewNote}</p>}
                  {isReviewable(item.key) ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Textarea
                        rows={1}
                        className="min-w-[14rem] flex-1"
                        placeholder="Note for the guest (required for Needs attention)"
                        value={notes[item.key] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [item.key]: e.target.value }))}
                        aria-label={`Review note for ${item.label}`}
                      />
                      <Button size="sm" disabled={busyKey === item.key} onClick={() => void reviewTask(item.key as TaskKey, "verified")}>Verify</Button>
                      <Button size="sm" variant="secondary" disabled={busyKey === item.key} onClick={() => void reviewTask(item.key as TaskKey, "needs_attention")}>Needs attention</Button>
                      <Button size="sm" variant="ghost" disabled={busyKey === item.key} onClick={() => void reviewTask(item.key as TaskKey, "clear")}>Clear review</Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-soft">Follows the signed agreement record only; it can't be marked by hand.</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-hairline p-3">
              <h3 className="font-display text-base text-ink">Agreement</h3>
              {detail.agreement.assignments.length === 0 ? (
                <p className="text-xs text-ink-soft">No agreement assigned to her yet (Products › Contracts).</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {detail.agreement.assignments.map((a) => (
                    <li key={a.id}>Assignment #{a.id}: {a.status === "signed" ? `signed ${dateTime(a.signedAt)}` : "awaiting signature"}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-hairline p-3">
              <h3 className="font-display text-base text-ink">Payments</h3>
              {detail.payments.status === "incomplete" ? (
                <p className="text-xs text-ink-soft">Not recorded on this site (e.g. billed in Kajabi). She sees “Contact us about your payment schedule”.</p>
              ) : (
                <dl className="mt-1 grid grid-cols-2 gap-1 text-xs">
                  <dt className="text-ink-soft">Agreed</dt><dd className="font-sans font-bold tabular-nums">{formatCents(detail.payments.agreedCents, detail.payments.currency)}</dd>
                  <dt className="text-ink-soft">Paid</dt><dd className="font-sans font-bold tabular-nums">{formatCents(detail.payments.paidCents, detail.payments.currency)}</dd>
                  <dt className="text-ink-soft">Balance</dt><dd className="font-sans font-bold tabular-nums">{formatCents(detail.payments.balanceCents, detail.payments.currency)}</dd>
                  <dt className="text-ink-soft">Next payment</dt>
                  <dd className="font-sans font-bold tabular-nums">{detail.payments.nextPayment ? `${formatCents(detail.payments.nextPayment.amountCents, detail.payments.currency)} on ${formatRetreatDate(detail.payments.nextPayment.dueDate)}` : "—"}</dd>
                  <dt className="text-ink-soft">Final deadline</dt><dd className="font-sans font-bold tabular-nums">{detail.payments.finalPaymentDue ? formatRetreatDate(detail.payments.finalPaymentDue) : "—"}</dd>
                </dl>
              )}
            </div>
            <div className="rounded-xl border border-hairline p-3">
              <h3 className="font-display text-base text-ink">Group call</h3>
              <p className="text-xs text-ink-soft">RSVP: {detail.groupCallRsvp ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-hairline p-3">
              <h3 className="font-display text-base text-ink">Interest and consent</h3>
              <p className="text-xs text-ink-soft">Interest: {detail.interest.interest ? detail.interest.interest.replace(/_/g, " ") : "—"}</p>
              {detail.interest.destinations && <p className="text-xs text-ink-soft">Destinations: {detail.interest.destinations}</p>}
              <p className="text-xs text-ink-soft">Marketing opt-in: {detail.interest.marketingOptIn ? "yes" : "no"}</p>
              <p className="text-xs text-ink-soft">Reflection: {detail.feedback.state === "none" ? "—" : detail.feedback.state}</p>
            </div>
          </section>

          {detail.media.length > 0 && (
            <section>
              <h3 className="font-display text-base text-ink">Her gallery uploads</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {detail.media.map((m) => (
                  <div key={m.id} className="overflow-hidden rounded-lg border border-hairline">
                    {m.kind === "photo" ? <img src={m.url} alt={m.caption || "Guest upload"} className="aspect-square w-full object-cover" loading="lazy" /> : <video src={m.url} preload="metadata" className="aspect-square w-full object-cover" />}
                    <p className="px-1.5 py-1 text-[0.65rem] text-ink-soft">{m.status}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function formatAnswer(row: AdminAnswerRow): string {
  const v = row.value;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (row.type === "yes_no") return v === "yes" ? "Yes" : v === "no" ? "No" : String(v ?? "");
  if (row.type === "date" && typeof v === "string") return formatRetreatDate(v);
  return v === null || v === undefined ? "" : String(v);
}

/** Answers as she gave them, under the wording she was shown (stored snapshot). */
function AnswerList({ retreatId, rows }: { retreatId: number; rows: AdminAnswerRow[] }) {
  if (rows.length === 0) return <p className="mt-1 text-xs text-ink-soft">No answers yet.</p>;
  return (
    <dl className="mt-2 space-y-1.5 text-xs">
      {rows.map((row) => (
        <div key={row.questionId}>
          <dt className="text-ink-soft">
            {row.label}
            {row.sensitive && <span className="ml-1.5 font-semibold text-gold">Health · organizer only</span>}
            {row.removedFromQuestionnaire && <span className="ml-1.5 italic">(question since removed)</span>}
          </dt>
          <dd className="whitespace-pre-wrap break-words text-ink">
            {row.type === "file" && typeof row.value === "number" ? <FileLink retreatId={retreatId} fileId={row.value} /> : formatAnswer(row)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FileLink({ retreatId, fileId }: { retreatId: number; fileId: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-plum-deep underline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await adminQuestionnaireFileUrl(retreatId, fileId);
          window.open(url, "_blank", "noopener");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not open the file.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Opening…" : "Open uploaded file"}
    </button>
  );
}
