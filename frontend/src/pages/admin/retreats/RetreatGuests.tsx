import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Eye, Users } from "lucide-react";
import { toast } from "sonner";
import {
  adminRetreatsApi,
  formatCents,
  formatRetreatDate,
  TASK_STATUS_LABEL,
  type AdminGuestDetail,
  type AdminGuestRow,
  type FormKey,
  type TaskKey,
} from "@/lib/retreatsApi";
import { Modal } from "@/pages/admin/ui/Dialog";
import { Badge, Button, Card, CardHeader, Chip, EmptyState, ErrorNotice, Input, Skeleton, Textarea, chipRowStyles } from "@/pages/admin/ui/primitives";
import { STATUS_TONE, TASK_LABELS, TASK_ORDER, isReviewable } from "./retreatAdminRules";

type Filter = "all" | "access" | "booking_only" | "needs_follow_up";

const COVERAGE_LABEL: Record<string, string> = {
  not_purchased: "Not purchased yet",
  researching: "Researching",
  purchased: "Purchased",
  decline_or_support: "Declined / needs support",
};

const FORM_LABEL: Record<FormKey, string> = { flight_preferences: "Flight Preferences", travel_insurance: "Travel Insurance" };

export function RetreatGuests({ retreatId }: { retreatId: number }) {
  const [guests, setGuests] = useState<AdminGuestRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

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
      if (q && !`${g.name} ${g.email}`.toLowerCase().includes(q)) return false;
      if (filter === "access") return g.hasDashboardAccess;
      if (filter === "booking_only") return !g.hasDashboardAccess;
      if (filter === "needs_follow_up")
        return g.coverageStatus !== "purchased" || g.paymentsStatus === "incomplete" || g.checklist.some((c) => c.status === "needs_attention");
      return true;
    });
  }, [guests, filter, query]);

  return (
    <div className="space-y-5">
      {error && <ErrorNotice message={error} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={chipRowStyles}>
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
          <Chip selected={filter === "access"} onClick={() => setFilter("access")}>Has dashboard</Chip>
          <Chip selected={filter === "booking_only"} onClick={() => setFilter("booking_only")}>Booking only</Chip>
          <Chip selected={filter === "needs_follow_up"} onClick={() => setFilter("needs_follow_up")}>Needs follow-up</Chip>
        </div>
        <Input className="max-w-xs" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search guests" />
      </div>
      <Card>
        <CardHeader icon={<Users />} title="Guest Manager" subtitle="Statuses come from real records; you can verify or ask for a correction per task" />
        {guests === null && !error ? (
          <div className="p-5"><Skeleton className="h-24" /></div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<Users />} title="No guests here" description="Guests appear once they hold the booking product or the dashboard product." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.08em] text-ink-soft">
                <tr className="border-b border-hairline">
                  <th className="px-5 py-3 font-semibold">Guest</th>
                  <th className="px-3 py-3 font-semibold">Checklist</th>
                  <th className="px-3 py-3 font-semibold">Insurance</th>
                  <th className="px-3 py-3 font-semibold">Payments</th>
                  <th className="px-3 py-3 font-semibold">Alumni</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.memberId} className="border-b border-hairline/60 align-top">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-ink">{g.name || g.email}</p>
                      <p className="text-xs text-ink-soft">{g.email}</p>
                      {!g.hasDashboardAccess && (
                        <p className="mt-1 max-w-[16rem] text-xs text-gold">
                          Holds the booking product only — give them the dashboard product from Members when you go live.
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex max-w-[22rem] flex-wrap gap-1">
                        {TASK_ORDER.map((key) => {
                          const status = g.checklist.find((c) => c.key === key)?.status ?? "not_started";
                          return (
                            <Badge key={key} tone={STATUS_TONE[status]} title={`${TASK_LABELS[key]}: ${TASK_STATUS_LABEL[status]}`}>
                              {TASK_LABELS[key]}
                            </Badge>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {g.coverageStatus ? COVERAGE_LABEL[g.coverageStatus] : "No response"}
                      {g.coverageStatus !== "purchased" && <p className="text-xs text-gold">Private follow-up</p>}
                    </td>
                    <td className="px-3 py-3">
                      {g.paymentsStatus === "complete" ? (
                        <Badge tone="green">Recorded</Badge>
                      ) : (
                        <span className="text-xs text-ink-soft">Not recorded on this site (e.g. billed in Kajabi)</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-soft">
                      <p>Feedback: {g.feedbackSubmitted ? "submitted" : "—"}</p>
                      <p>Interest: {g.interest ? g.interest.replace(/_/g, " ") : "—"}</p>
                      <p>Marketing opt-in: {g.marketingOptIn === null ? "—" : g.marketingOptIn ? "yes" : "no"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Button size="sm" variant="secondary" onClick={() => setOpenId(g.memberId)}>Open</Button>
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
    </div>
  );
}

function GuestDetailModal({ retreatId, memberId, onClose }: { retreatId: number; memberId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminGuestDetail | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Partial<Record<TaskKey, string>>>({});
  const [busyKey, setBusyKey] = useState<TaskKey | null>(null);

  useEffect(() => {
    adminRetreatsApi
      .guest(retreatId, memberId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this guest."));
  }, [retreatId, memberId]);

  async function review(key: TaskKey, status: "verified" | "needs_attention" | "clear") {
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

  return (
    <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title={detail ? detail.name || detail.email : "Guest"} description={detail?.email} size="xl">
      {error && <ErrorNotice message={error} />}
      {!detail && !error && <Skeleton className="h-40" />}
      {detail && (
        <div className="space-y-6 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={detail.hasDashboardAccess ? "green" : "gold"}>{detail.hasDashboardAccess ? "Has dashboard access" : "Booking product only"}</Badge>
            <Button size="sm" variant="secondary" asChild>
              <Link to={`/admin/retreats/${retreatId}/preview?memberId=${memberId}`}><Eye aria-hidden /> View her dashboard (read-only)</Link>
            </Button>
          </div>

          <section>
            <h3 className="font-display text-base text-ink">Checklist</h3>
            <ul className="mt-2 space-y-3">
              {detail.checklist.map((item) => (
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
                      <Button size="sm" disabled={busyKey === item.key} onClick={() => void review(item.key, "verified")}>Verify</Button>
                      <Button size="sm" variant="secondary" disabled={busyKey === item.key} onClick={() => void review(item.key, "needs_attention")}>Needs attention</Button>
                      <Button size="sm" variant="ghost" disabled={busyKey === item.key} onClick={() => void review(item.key, "clear")}>Clear review</Button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-soft">Follows the signed agreement record only; it can't be marked by hand.</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(FORM_LABEL) as FormKey[]).map((key) => {
              const form = detail.forms[key];
              return (
                <div key={key} className="rounded-xl border border-hairline p-3">
                  <h3 className="font-display text-base text-ink">{FORM_LABEL[key]}</h3>
                  <p className="text-xs text-ink-soft">
                    {form.state === "none" ? "Not started" : form.state === "draft" ? `Draft saved ${form.updatedAt ? new Date(form.updatedAt).toLocaleString() : ""}` : `Submitted ${form.submittedAt ? new Date(form.submittedAt).toLocaleString() : ""}`}
                  </p>
                  {form.state !== "none" && <AnswerList data={form.data} />}
                  {form.history.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-plum-deep underline">Earlier submissions ({form.history.length})</summary>
                      {form.history.map((h, i) => (
                        <div key={i} className="mt-2 border-t border-hairline pt-2">
                          <p className="text-xs text-ink-soft">{new Date(h.submittedAt).toLocaleString()}</p>
                          <AnswerList data={h.data} />
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              );
            })}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-hairline p-3">
              <h3 className="font-display text-base text-ink">Agreement</h3>
              {detail.agreement.assignments.length === 0 ? (
                <p className="text-xs text-ink-soft">No agreement assigned to her yet (Products › Contracts).</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {detail.agreement.assignments.map((a) => (
                    <li key={a.id}>Assignment #{a.id}: {a.status === "signed" ? `signed ${a.signedAt ? new Date(a.signedAt).toLocaleString() : ""}` : "awaiting signature"}</li>
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
                  <dt className="text-ink-soft">Final deadline</dt><dd>{detail.payments.finalPaymentDue ? formatRetreatDate(detail.payments.finalPaymentDue) : "—"}</dd>
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
              <h3 className="font-display text-base text-ink">Her uploads</h3>
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

function AnswerList({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  if (entries.length === 0) return <p className="mt-1 text-xs text-ink-soft">No answers yet.</p>;
  return (
    <dl className="mt-2 space-y-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-ink-soft">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
          <dd className="whitespace-pre-wrap break-words text-ink">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
