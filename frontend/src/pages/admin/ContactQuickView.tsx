import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Check, ChevronRight, Copy, Gift, Maximize2, Pencil, Tag as TagIcon, Trash2, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";
import { contactsApi, money, type Contact, type ContactDetail } from "@/lib/contactsApi";
import { Badge, Skeleton } from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * Kajabi's contact drawer: click a row and the person slides in from the right
 * with the numbers she checks most, without leaving the list.
 *
 * It opens on the row the list already has and fills in the rest (sign-ins,
 * confirmation) from the full record, so the top of it never waits.
 */

const MARKETING: Record<string, string> = {
  subscribed: "Subscribed",
  opted_out: "Unsubscribed",
  bounced: "Bounced",
  complained: "Marked as spam",
  unconfirmed: "Unconfirmed",
};

function field(detail: ContactDetail | null, key: string): string | null {
  const value = detail?.customFields?.[key];
  return value === undefined || value === null || value === "" ? null : String(value);
}

export default function ContactQuickView({
  person,
  onClose,
  onDelete,
}: {
  person: Contact | null;
  onClose: () => void;
  onDelete: (person: Contact) => void;
}) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);

  useEffect(() => {
    setDetail(null);
    if (!person) return;
    let current = true;
    contactsApi
      .get(person.id)
      .then((row) => current && setDetail(row))
      .catch((err) => current && toast.error(friendlyError(err, "person")));
    return () => {
      current = false;
    };
  }, [person]);

  const open = person !== null;
  const name = person ? person.name || `${person.firstName} ${person.lastName}`.trim() : "";
  const profile = person ? `/admin/contacts/${person.id}` : "";
  const lastSignIn = field(detail, "Last Sign In At");
  const signIns = field(detail, "Sign In Count");
  const customer = (person?.orderCount ?? 0) > 0;
  const status = customer ? "Customer" : person?.accountMemberId ? "Member" : "Lead";

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="theme-console fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="theme-console fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-hairline bg-surface shadow-[-24px_0_60px_-24px_rgba(0,0,0,0.6)] outline-none"
        >
          {person && (
            <>
              <div className="flex items-center justify-between border-b border-hairline/60 px-5 py-3">
                <Link
                  to={profile}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-ink-soft transition-colors hover:text-plum"
                >
                  <Maximize2 className="size-4" aria-hidden />
                  Open full profile
                </Link>
                <RadixDialog.Close
                  className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-ink"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </RadixDialog.Close>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
                  <span className="relative grid size-16 place-items-center rounded-full bg-lilac-tint text-plum-deep">
                    <UserRound className="size-7" aria-hidden />
                    {customer && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-ink text-surface ring-2 ring-surface"
                        title="Customer"
                      >
                        <Check className="size-3" strokeWidth={3} aria-hidden />
                      </span>
                    )}
                  </span>
                  <RadixDialog.Title className="mt-3 font-display text-xl text-ink">
                    {name || "No name yet"}
                  </RadixDialog.Title>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(person.email)
                        .then(() => toast.success("Email address copied"))
                        .catch(() => toast.error("Your browser wouldn't let us copy that"))
                    }
                    className="mt-1 inline-flex max-w-full items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
                    title="Copy email address"
                  >
                    <span className="truncate">{person.email}</span>
                    <Copy className="size-3.5 shrink-0" aria-hidden />
                  </button>

                  <div className="mt-5 flex items-center gap-2">
                    <IconLink to={profile} label="Edit contact" icon={<Pencil />} />
                    <IconLink to={profile} label="Add tag" icon={<TagIcon />} />
                    <IconLink to={`${profile}?tab=products`} label="Grant offer" icon={<Gift />} />
                    <button
                      type="button"
                      onClick={() => onDelete(person)}
                      aria-label="Delete contact"
                      title="Delete contact"
                      className="grid size-10 place-items-center rounded-full border border-hairline text-red-400 transition-colors hover:bg-red-500/10 [&_svg]:size-4"
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>

                <dl className="divide-y divide-hairline/60 border-t border-hairline/60 px-5 text-sm">
                  <Group>
                    <Row label="Lifetime value" value={money(person.lifetimeValueCents)} />
                    <Row label="Total purchases" value={String(person.orderCount)} />
                    <div className="flex justify-end">
                      <Link
                        to={`${profile}?tab=purchases`}
                        className="inline-flex items-center gap-0.5 text-xs font-semibold text-ink-soft hover:text-plum"
                      >
                        View more
                        <ChevronRight className="size-3.5" aria-hidden />
                      </Link>
                    </div>
                  </Group>
                  <Group>
                    <Row label="Last sign-in" value={detail ? (lastSignIn ? formatDate(lastSignIn) : "—") : null} />
                    <Row label="Total sign-ins" value={detail ? (signIns ?? "0") : null} />
                  </Group>
                  <Group>
                    <Row
                      label="Contact status"
                      value={<Badge tone={customer ? "plum" : "slate"}>{status}</Badge>}
                    />
                    <Row label="Marketing status" value={MARKETING[person.emailMarketingStatus] ?? "Not known"} />
                    <Row label="Contact added" value={formatDate(person.createdAt)} />
                    <Row
                      label="Opt-in status"
                      value={
                        detail
                          ? detail.confirmation?.state === "no_account"
                            ? "No account yet"
                            : detail.confirmation?.confirmed
                              ? "Confirmed"
                              : "Unconfirmed"
                          : null
                      }
                    />
                  </Group>
                </dl>
              </div>
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5 py-4">{children}</div>;
}

function Row({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <div className="grid grid-cols-2 items-center gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-semibold text-ink">{value === null ? <Skeleton className="h-4 w-20" /> : value}</dd>
    </div>
  );
}

function IconLink({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-full border border-hairline text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-ink [&_svg]:size-4"
    >
      {icon}
    </Link>
  );
}
