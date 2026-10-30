import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Search, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { contactAccessApi } from "@/lib/contactAccessApi";
import { formatDate, formatRelative } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Skeleton,
  selectStyles,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { courseHubApi, type CourseCustomer, type CourseOffer } from "./courseHubApi";
import {
  courseTabPath,
  grantSourceLabel,
  matchesCustomer,
  progressPercent,
  splitCustomers,
} from "./courseHub";

/**
 * Kajabi's course "Customers" tab: everybody who has this course, how they got
 * it, and how far through they are. Progress is finished published lessons out
 * of all published lessons, counted live (routes/admin/courseHub.ts).
 *
 * Giving and taking away access go through an offer, exactly as on a contact's
 * page, so the welcome email, bundles and expiry all behave the same.
 */
export function CourseCustomersTab({ courseId }: { courseId: number }) {
  const [data, setData] = useState<{ lessonsTotal: number; customers: CourseCustomer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showFormer, setShowFormer] = useState(false);
  const [offers, setOffers] = useState<CourseOffer[] | null>(null);
  const [granting, setGranting] = useState(false);
  const [grantOfferId, setGrantOfferId] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [sendCourseEmails, setSendCourseEmails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exemptionCustomer, setExemptionCustomer] = useState<CourseCustomer | null>(null);
  const [exemptionReason, setExemptionReason] = useState("");
  const [savingExemption, setSavingExemption] = useState(false);
  async function saveExemption(event: FormEvent) {
    event.preventDefault();
    if (!exemptionCustomer || savingExemption) return;
    setSavingExemption(true);
    try {
      await courseHubApi.setWatchExemption(courseId, exemptionCustomer.memberId, !exemptionCustomer.watchExempt, exemptionReason.trim());
      toast.success(exemptionCustomer.watchExempt ? "Viewing exemption revoked" : "Prior viewing exemption recorded");
      setExemptionCustomer(null);
      load();
    } catch (err) { toast.error(friendlyError(err, "viewing exemption")); }
    finally { setSavingExemption(false); }
  }
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    courseHubApi
      .customers(courseId)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch(() => setError("We couldn't load this course's customers. Try refreshing the page."));
  }, [courseId]);

  useEffect(load, [load]);

  function startGrant() {
    setGrantEmail("");
    setSendCourseEmails(true);
    setGranting(true);
    courseHubApi
      .offers(courseId)
      .then((next) => {
        // A bundle offer is listed with its bundle's name: it gives them the
        // rest of the bundle as well, which she should see before choosing it.
        const usable = next.offers.filter((offer) => offer.status !== "archived");
        setOffers(usable);
        setGrantOfferId(usable[0] ? String(usable[0].id) : "");
      })
      .catch(() => setOffers([]));
  }

  async function grant(e: FormEvent) {
    e.preventDefault();
    const email = grantEmail.trim();
    const offerId = Number(grantOfferId);
    if (!email || !offerId || busy) return;
    setBusy(true);
    try {
      const outcome = await contactAccessApi.grant(offerId, { email }, { sendCourseEmails });
      toast.success(
        outcome.welcomeSent
          ? `${outcome.email} has the course — we've emailed them how to get in.`
          : `${outcome.email} has the course. The welcome email didn't go, so let them know yourself.`,
      );
      setGranting(false);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "offer"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(customer: CourseCustomer) {
    if (!customer.offerId) return;
    const ok = await confirm({
      title: `Take the course away from ${customer.name}?`,
      description: `This removes what “${customer.offerTitle ?? "the offer"}” gave them. It doesn't refund anything.`,
      confirmLabel: "Yes, remove access",
      destructive: true,
    });
    if (!ok) return;
    try {
      await contactAccessApi.revoke(customer.offerId, { memberId: customer.memberId }, "Removed from the course's Customers tab");
      toast.success("Access removed");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "access"));
    }
  }

  const { current, former } = splitCustomers(data?.customers ?? []);
  const visible = (showFormer ? [...current, ...former] : current).filter((customer) =>
    matchesCustomer(customer, query),
  );
  const total = data?.lessonsTotal ?? 0;
  const finished = current.filter((customer) => total > 0 && customer.lessonsCompleted >= total).length;
  const started = current.filter((customer) => customer.lessonsCompleted > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Have the course" value={current.length} />
        <Stat label="Started" value={started} />
        <Stat label="Finished every lesson" value={finished} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            className="pl-10"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search customers"
          />
        </div>
        {former.length > 0 && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={showFormer}
              onChange={(e) => setShowFormer(e.target.checked)}
              className="size-4 rounded border-hairline text-plum"
            />
            Show people whose access ended (<span className="font-bold tabular-nums">{former.length}</span>)
          </label>
        )}
        <Button size="sm" onClick={startGrant}>
          <UserPlus />
          Give someone access
        </Button>
      </div>

      {error && <ErrorNotice message={error} />}

      {data === null && !error ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users />}
            title={query ? "Nobody matches that search" : "Nobody has this course yet"}
            description={
              query
                ? "Try part of their name or email address."
                : "People appear here as soon as they buy one of this course's offers, or you give them access."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-hairline/60 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft">
              <tr>
                <th scope="col" className="px-5 py-3">Customer</th>
                <th scope="col" className="px-3 py-3">Progress</th>
                <th scope="col" className="px-3 py-3">Has it since</th>
                <th scope="col" className="px-3 py-3">Last active</th>
                <th scope="col" className="px-3 py-3">How</th>
                <th scope="col" className="px-3 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/60">
              {visible.map((customer) => {
                const percent = progressPercent(customer.lessonsCompleted, total);
                return (
                  <tr key={customer.memberId} className={customer.status === "active" ? "" : "opacity-70"}>
                    <td className="px-5 py-3">
                      {customer.contactId ? (
                        <Link
                          to={`/admin/contacts/${customer.contactId}`}
                          className="block truncate font-medium text-ink hover:text-plum hover:underline"
                        >
                          {customer.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-medium text-ink">{customer.name}</span>
                      )}
                      <span className="block truncate text-xs text-ink-soft">{customer.email}</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.08]"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-label={`${customer.name}'s progress`}
                        >
                          <span className="block h-full rounded-full bg-gold" style={{ width: `${percent}%` }} />
                        </span>
                        <span className="font-bold tabular-nums text-ink">{percent}%</span>
                      </div>
                      <span className="text-xs text-ink-soft">
                        <span className="tabular-nums">{customer.lessonsCompleted}</span> of{" "}
                        <span className="tabular-nums">{total}</span> {total === 1 ? "lesson" : "lessons"}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink-soft">{formatDate(customer.grantedAt)}</td>
                    <td className="px-3 py-3 text-ink-soft">
                      {customer.lastActiveAt ? formatRelative(customer.lastActiveAt) : "Not started"}
                    </td>
                    <td className="px-3 py-3 text-ink-soft">
                      <span className="block max-w-[14rem] truncate" title={grantSourceLabel(customer)}>
                        {grantSourceLabel(customer)}
                      </span>
                      {customer.status !== "active" && (
                        <Badge tone="slate">{customer.status === "expired" ? "Access expired" : "Access removed"}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {(customer.status === "active" || customer.watchExempt) && (
                        <Button variant="ghost" size="sm" onClick={() => {
                          setExemptionCustomer(customer); setExemptionReason("");
                        }}>
                          {customer.watchExempt ? "Revoke viewing exemption" : "Recognize prior Kajabi viewing"}
                        </Button>
                      )}
                      {customer.status === "active" && customer.offerId && (
                        <Button variant="ghost" size="sm" onClick={() => void revoke(customer)}>
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={exemptionCustomer !== null}
        onOpenChange={(open) => { if (!open && !savingExemption) setExemptionCustomer(null); }}
        title={exemptionCustomer?.watchExempt ? "Revoke viewing exemption" : "Recognize prior Kajabi viewing"}
        description={`${exemptionCustomer?.name ?? ""} (${exemptionCustomer?.email ?? ""}) — this course only. This changes viewing requirements only. Lessons, quizzes and evaluations still need completion. It does not create progress, issue a certificate or send email.`}
        footer={<Button type="submit" form="watch-exemption" disabled={savingExemption || exemptionReason.trim().length < 10}>
          {savingExemption ? "Saving…" : exemptionCustomer?.watchExempt ? "Revoke exemption" : "Record exemption for this student"}
        </Button>}
      >
        <form id="watch-exemption" onSubmit={(event) => void saveExemption(event)}>
          <label className="block text-sm font-medium" htmlFor="watch-exemption-reason">Reason and evidence of prior viewing</label>
          <Input id="watch-exemption-reason" value={exemptionReason} maxLength={2000}
            onChange={(event) => setExemptionReason(event.target.value)} required minLength={10} />
          <p className="mt-2 text-xs text-ink-soft">Your identity, this reason and the change are recorded in the audit log.</p>
        </form>
      </Modal>

      <Modal
        open={granting}
        onOpenChange={setGranting}
        title="Give someone this course"
        description="They get it free through the offer you choose, and we email them how to sign in."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setGranting(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="grant-course" disabled={busy || !grantOfferId}>
              {busy ? "Giving access…" : "Give access"}
            </Button>
          </>
        }
      >
        {offers === null ? (
          <Skeleton className="h-24 w-full" />
        ) : offers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-soft">
            This course isn't in any offer yet, and access is always given through one.{" "}
            <Link to={courseTabPath(courseId, "offers")} className="font-semibold text-plum hover:underline" onClick={() => setGranting(false)}>
              Add an offer on the Offers tab
            </Link>{" "}
            first.
          </p>
        ) : (
          <form id="grant-course" onSubmit={grant} className="space-y-4">
            <Field label="Their email address" hint="a new address gets an account made for it">
              <Input
                type="email"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                placeholder="name@example.com"
                required
                autoFocus
              />
            </Field>
            <Field
              label="Through which offer"
              hint={offers.length > 1 ? `${pluralize(offers.length, "offer")} include this course; they get everything in the one you choose` : "they get everything in this offer"}
            >
              <select
                className={selectStyles}
                value={grantOfferId}
                onChange={(e) => setGrantOfferId(e.target.value)}
                aria-label="Offer to give access through"
              >
                {offers.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.internalTitle || offer.title}
                    {offer.viaBundle ? ` (bundle: ${offer.viaBundle})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft">
              <input
                type="checkbox"
                checked={sendCourseEmails}
                onChange={(e) => setSendCourseEmails(e.target.checked)}
                className="size-4 rounded border-hairline text-plum"
              />
              Send the course emails attached to this offer
            </label>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
    </Card>
  );
}
