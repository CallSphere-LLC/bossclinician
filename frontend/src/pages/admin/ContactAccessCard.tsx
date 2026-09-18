import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { contactsApi } from "@/lib/contactsApi";
import {
  contactAccessApi,
  type AccessGrant,
  type ContactAccess,
  type MemberRef,
} from "@/lib/contactAccessApi";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Field,
  Skeleton,
  selectStyles,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";
import { useAuth } from "@/hooks/useAuth";

/**
 * What this person can get into — and the way to give or take it away.
 *
 * Both actions have existed on the server since offers did, with no screen that
 * called them: giving one person a course meant ticking them on the People list
 * and using the bulk action, and taking access away could not be done at all
 * without a database console.
 *
 * Access is taken away by offer, not by product, because that is how it was
 * given. Revoking "the toolkit bundle" removes what that bundle granted and
 * leaves alone anything the same person also holds through a second offer.
 */

const SOURCE_LABEL: Record<string, string> = {
  purchase: "Bought",
  manual: "Given by you",
  automation: "Given by an automation",
  bundle: "Part of a bundle",
  affiliate: "Through a partner",
  import: "Brought over from your old site",
};

interface OfferGroup {
  key: string;
  memberId: number;
  offerId: number | null;
  title: string;
  grants: AccessGrant[];
}

function groupByOffer(grants: AccessGrant[]): OfferGroup[] {
  const groups = new Map<string, OfferGroup>();
  for (const grant of grants) {
    const key = `${grant.memberId}:${grant.offerId ?? "none"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.grants.push(grant);
    } else {
      groups.set(key, {
        key,
        memberId: grant.memberId,
        offerId: grant.offerId,
        title: grant.offerTitle || "Not tied to an offer",
        grants: [grant],
      });
    }
  }
  return [...groups.values()];
}

export default function ContactAccessCard({
  contactId,
  email,
  displayName,
  onChanged,
}: {
  contactId: number;
  email: string;
  displayName: string;
  /** Giving access can create their account, which the rest of the page shows. */
  onChanged: () => void;
}) {
  const [access, setAccess] = useState<ContactAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<{ id: number; title: string }[]>([]);
  const [granting, setGranting] = useState(false);
  const [offerId, setOfferId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  // Giving and taking away are changes to offers, which only the owner and a
  // manager may make. Everyone else who can open this page still sees the list —
  // they just aren't shown buttons the server would refuse.
  const { user } = useAuth();
  const canManage = user?.role === "owner" || user?.role === "admin";

  const load = useCallback(() => {
    if (!Number.isInteger(contactId)) return;
    contactAccessApi
      .get(contactId)
      .then((res) => {
        setAccess(res);
        setError(null);
      })
      .catch(() => setError("We couldn't load what they have access to just now."));
  }, [contactId]);

  useEffect(load, [load]);

  useEffect(() => {
    contactsApi
      .segmentOptions()
      .then((options) => setOffers(options.offers))
      .catch(() => setOffers([]));
  }, []);

  const active = useMemo(
    () => groupByOffer((access?.grants ?? []).filter((grant) => grant.status === "active")),
    [access],
  );
  const ended = useMemo(
    () => (access?.grants ?? []).filter((grant) => grant.status !== "active"),
    [access],
  );

  // Their account when they have one; otherwise the address, which makes one.
  const account = access?.members[0];
  const who: MemberRef | null = account
    ? { memberId: account.id }
    : email
      ? { email }
      : null;

  function openGrant() {
    setOfferId("");
    setGranting(true);
  }

  async function grant(e: FormEvent) {
    e.preventDefault();
    if (!offerId || !who) return;
    setBusy(true);
    try {
      const outcome = await contactAccessApi.grant(Number(offerId), who);
      toast.success(
        outcome.welcomeSent
          ? "Access given — we've emailed them how to get in"
          : "Access given. No welcome email went out, so you may want to let them know.",
      );
      setGranting(false);
      load();
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "offer"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(group: OfferGroup) {
    if (group.offerId === null) return;
    const ok = await confirm({
      title: `Take away ${displayName}'s access to ${group.title}?`,
      description: `They'll lose ${pluralize(group.grants.length, "product")} straight away. Anything they also have through another offer stays, and you can give this back whenever you like.`,
      confirmLabel: "Yes, take it away",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const outcome = await contactAccessApi.revoke(group.offerId, { memberId: group.memberId });
      toast.success(
        outcome.revokedCount > 0 ? "Access taken away" : "There was nothing left to take away",
      );
      load();
      onChanged();
    } catch (err) {
      toast.error(friendlyError(err, "offer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Access"
        icon={<KeyRound />}
        action={
          canManage &&
          // Not until we know whether they already have an account: granting by
          // address to someone whose account uses a different one would make a
          // second account rather than add to the first.
          <Button
            variant="secondary"
            size="sm"
            onClick={openGrant}
            disabled={access === null || who === null}
          >
            <Plus />
            Grant an offer
          </Button>
        }
      />

      {error ? (
        <div className="px-5 py-4">
          <ErrorNotice message={error} />
        </div>
      ) : access === null ? (
        <div className="px-5 py-4">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : active.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-soft">
          {who === null
            ? "They need an email address before you can give them anything."
            : canManage
              ? "They don't have access to anything yet. Grant an offer to give them a course, download or membership without a payment."
              : "They don't have access to anything yet."}
        </p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {active.map((group) => (
            <li key={group.key} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{group.title}</p>
                <ul className="mt-1 space-y-1">
                  {group.grants.map((grant) => (
                    <li key={grant.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                      <span className="text-ink">{grant.productTitle}</span>
                      <span>
                        {SOURCE_LABEL[grant.source] ?? "Given"} on {formatDate(grant.grantedAt)}
                        {grant.expiresAt ? ` · ends ${formatDate(grant.expiresAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {group.offerId === null && (
                  <p className="mt-1.5 text-xs text-ink-soft/80">
                    This isn't linked to an offer any more, so it can't be taken away from here.
                  </p>
                )}
              </div>
              {canManage && group.offerId !== null && (
                <Button
                  variant="dangerGhost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void revoke(group)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ended.length > 0 && (
        <div className="border-t border-hairline/60 px-5 py-3.5">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
            No longer has
          </p>
          <ul className="mt-2 space-y-1.5">
            {ended.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span className="text-ink">{grant.productTitle}</span>
                <Badge tone="slate">{grant.status === "expired" ? "Ran out" : "Taken away"}</Badge>
                {grant.revokedAt && <span>{formatDate(grant.revokedAt)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={granting}
        onOpenChange={(open) => !open && setGranting(false)}
        title="Grant an offer"
        description={`${displayName} gets everything in the offer straight away, without paying. If the offer sends a welcome email, they'll get that too.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setGranting(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="contact-grant-form" disabled={!offerId || busy}>
              {busy ? "Working…" : "Give them access"}
            </Button>
          </>
        }
      >
        <form id="contact-grant-form" onSubmit={grant}>
          <Field label="Which offer?">
            <select
              className={selectStyles}
              value={offerId}
              onChange={(e) => setOfferId(e.target.value)}
              required
              autoFocus
            >
              <option value="">Choose…</option>
              {offers.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.title}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Modal>

      {confirmDialog}
    </Card>
  );
}
