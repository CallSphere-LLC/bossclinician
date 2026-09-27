import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Combine,
  CreditCard,
  DollarSign,
  Download,
  Gift,
  Inbox,
  KeyRound,
  Mail,
  MailPlus,
  Pencil,
  Receipt,
  Send,
  ShieldAlert,
  StickyNote,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  EMAIL_STATUS_LABEL,
  activityLabel,
  contactsApi,
  emailStatusLabel,
  hasActivity,
  money,
  sourceLabel,
  type Contact,
  type ContactDetail as Person,
  type ContactOrder,
  type EmailStatus,
  type Tag,
} from "@/lib/contactsApi";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Skeleton,
  selectStyles,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, humaniseKey, orNone, pluralize } from "@/pages/admin/ui/friendly";
import { saveCsv } from "@/lib/formsApi";
import ContactFilesCard from "@/pages/admin/ContactFilesCard";
import ContactAccessCard from "@/pages/admin/ContactAccessCard";

/**
 * One person, and everything they have ever done.
 *
 * The timeline is the reason this screen exists: the same human enquiring in
 * January, joining the list in March and buying in June used to be three rows
 * in three places, and no screen could say they were the same person.
 */

/** What one purchase's state means, in words. */
const ORDER_STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  pending: "Not finished",
  refunded: "Refunded",
  failed: "Payment failed",
  expired: "Abandoned",
};

/** The tabs of a profile, in the order her Kajabi contact page had them. */
const TABS = [
  { id: "lifecycle", label: "Lifecycle" },
  { id: "info", label: "Info" },
  { id: "purchases", label: "Purchases" },
  { id: "products", label: "Products" },
  { id: "notes", label: "Notes" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Matches the server's cap on the timeline it sends. */
const FEED_LIMIT = 500;

/**
 * Custom fields that are bookkeeping, not something she'd read: the Kajabi
 * row ids, and the sign-in facts the Info tab already prints in their own place.
 */
const HIDDEN_FIELDS = new Set([
  "ID",
  "Member ID",
  "External User ID",
  "Sign In Count",
  "Last Sign In At",
  "Member Created At",
  "Products",
]);

/** Kajabi's "Additional info" block, in its order. */
const ADDRESS_FIELDS = ["Address", "Address Line 2", "City", "State", "Country", "Zip Code"];

/** Kajabi's order number for an imported payment, else ours. */
function orderNumber(order: ContactOrder): string {
  const kajabi = order.customFieldData?.kajabiOrderNumber;
  return typeof kajabi === "string" || typeof kajabi === "number" ? String(kajabi) : String(order.id);
}

function orderTotal(order: ContactOrder): number {
  return Math.max(order.totalCents, order.amountCents ?? 0);
}

/** Kajabi's "Subscribed on September 26, 2026 03:38 PM" line, for every state. */
function marketingLine(person: Person): string {
  switch (person.emailMarketingStatus) {
    case "subscribed":
      return `Subscribed on ${formatDateTime(person.optedInAt ?? person.createdAt)}`;
    case "opted_out":
      return person.optedOutAt ? `Unsubscribed on ${formatDateTime(person.optedOutAt)}` : "Unsubscribed";
    case "bounced":
      return "Bounced — their inbox refused your last email, so nothing more is sent";
    case "complained":
      return "Marked your email as spam — nothing more is sent";
    default:
      return "Hasn't confirmed their subscription yet";
  }
}

/** Sign-ins as Kajabi counted them, carried over on import. */
function signInCount(person: Person): string {
  const counted = person.customFields?.["Sign In Count"];
  if (counted !== undefined && counted !== null && counted !== "") return String(counted);
  return "0";
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const contactId = Number(id);

  const [person, setPerson] = useState<Person | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [buying, setBuying] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [addingTag, setAddingTag] = useState("");
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  // In the address, so a reload or a shared link opens the same tab.
  const tab: TabId = TABS.find((item) => item.id === searchParams.get("tab"))?.id ?? "lifecycle";
  const setTab = (next: TabId) =>
    setSearchParams(
      (params) => {
        const updated = new URLSearchParams(params);
        if (next === "lifecycle") updated.delete("tab");
        else updated.set("tab", next);
        return updated;
      },
      { replace: true },
    );

  const load = useCallback(() => {
    if (!Number.isInteger(contactId)) {
      setError("We couldn't find that person.");
      return;
    }
    contactsApi
      .get(contactId)
      .then((row) => {
        setPerson(row);
        setError(null);
      })
      .catch((err) => setError(friendlyError(err, "person")));
  }, [contactId]);

  useEffect(load, [load]);

  useEffect(() => {
    contactsApi
      .tags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  const displayName = person?.name || person?.email || "";

  const custom = useMemo(
    () =>
      Object.entries(person?.customFields ?? {}).filter(
        ([key, value]) =>
          value !== null && value !== "" && !HIDDEN_FIELDS.has(key) && !ADDRESS_FIELDS.includes(key),
      ),
    [person],
  );

  async function setStatus(status: EmailStatus) {
    if (!person) return;
    try {
      await contactsApi.update(person.id, { emailMarketingStatus: status });
      toast.success(
        status === "subscribed" ? "They'll receive your emails again" : "They won't be emailed",
      );
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    }
  }

  /**
   * Confirm this person's email address by hand.
   *
   * The escape hatch the product could not run without: confirmation gates
   * posting, commenting and every point a member can earn, and until now the
   * only key was a link in an email. When mail is not arriving there was no way
   * through it — not for the member, and not for anybody trying to help them.
   */
  async function confirmEmail() {
    if (!person) return;
    const ok = await confirm({
      title: `Confirm ${displayName}'s email yourself?`,
      description:
        "You're vouching that this address really is theirs. They'll be able to post, comment and " +
        "earn points straight away, without clicking a link. It's recorded against your name.",
      confirmLabel: "Yes, confirm it",
    });
    if (!ok) return;
    setConfirmBusy(true);
    try {
      const result = await contactsApi.confirmEmail(person.id);
      toast.success(
        result.changed
          ? "Confirmed — they can post and comment now"
          : "That address was already confirmed",
      );
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    } finally {
      setConfirmBusy(false);
    }
  }

  /** Send the confirmation email again, and say what actually happened to it. */
  async function resendConfirmation() {
    if (!person) return;
    setConfirmBusy(true);
    try {
      const result = await contactsApi.resendConfirmation(person.id);
      if (result.state === "sent") {
        toast.success(`Confirmation email sent to ${result.to}`);
      } else if (result.state === "throttled") {
        toast.warning(
          "They've been sent several already in the last few minutes. Give the last one a moment to arrive.",
        );
      } else {
        // The mail server's own words. "535 Authentication Credentials Invalid"
        // is the whole answer, and paraphrasing it throws the answer away.
        toast.error(`It couldn't be sent: ${result.error}`, { duration: 12000 });
      }
      load();
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function addTag(typed: string) {
    if (!person || !typed.trim()) return;
    // Picked from the list by its name, or typed fresh: an existing tag is
    // matched by name so choosing "Did Attend" never creates a second one.
    const existing = tags.find(
      (tag) => tag.name.toLowerCase() === typed.trim().toLowerCase() || tag.slug === typed.trim(),
    );
    const slug = existing?.slug ?? typed.trim();
    setTagBusy(slug);
    try {
      await contactsApi.addTags(person.id, [slug]);
      setAddingTag("");
      toast.success("Tag added");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "tag"));
    } finally {
      setTagBusy(null);
    }
  }

  async function dropTag(slug: string) {
    if (!person) return;
    setTagBusy(slug);
    try {
      await contactsApi.removeTag(person.id, slug);
      toast.success("Tag removed");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "tag"));
    } finally {
      setTagBusy(null);
    }
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault();
    // A second click while the first is in flight used to post the note twice.
    if (!person || !note.trim() || savingNote) return;
    setSavingNote(true);
    try {
      await contactsApi.addNote(person.id, note.trim());
      setNote("");
      toast.success("Note saved");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "note"));
    } finally {
      setSavingNote(false);
    }
  }

  async function sendPassword() {
    if (!person || person.memberId === null) return;
    const ok = await confirm({
      title: `Email ${displayName} a way back in?`,
      description:
        "They'll get an email with a link to pick a new password. Their old one keeps working until they use it.",
      confirmLabel: "Yes, send it",
    });
    if (!ok) return;
    try {
      await adminApi.memberResetPassword(person.memberId);
      toast.success(`Sent to ${person.email}`);
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    }
  }

  async function remove() {
    if (!person) return;
    const ok = await confirm({
      title: `Remove ${displayName} from your list?`,
      description:
        "Their card and its history go. Anything they bought and any account they have stay exactly as they are. You can't undo this.",
      confirmLabel: "Yes, remove them",
      destructive: true,
    });
    if (!ok) return;
    try {
      await contactsApi.remove(person.id);
      toast.success("Removed");
      navigate("/admin/contacts");
    } catch (err) {
      toast.error(friendlyError(err, "person"));
    }
  }

  async function exportPerson() {
    if (!person) return;
    try {
      const payload = await contactsApi.export(person.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      // The shared saver, not a bare anchor: a link never added to the document,
      // whose object URL is revoked before the click returns, is a button that
      // silently produces nothing in Safari. (It saves any blob, not only CSV.)
      saveCsv(
        blob,
        `${(person.name || person.email || "person")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-data.json`,
      );
      toast.success("Person data downloaded");
    } catch (err) {
      toast.error(friendlyError(err, "download"));
    }
  }

  if (error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <ErrorNotice message={error} />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="space-y-6">
        <BackLink />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const firstPaid = person.orders
    .filter((order) => order.status === "paid")
    .reduce<string | null>((earliest, order) => (!earliest || order.createdAt < earliest ? order.createdAt : earliest), null);
  const notes = person.activity.filter((entry) => entry.kind === "note");

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link to="/admin/contacts" className="font-semibold text-ink-soft transition-colors hover:text-plum">
          Contacts
        </Link>
        <span className="text-ink-soft" aria-hidden>
          /
        </span>
        <span className="truncate font-semibold text-ink" aria-current="page">
          {displayName}
        </span>
      </nav>

      <div className="space-y-4">
        <h1 className="font-display text-3xl text-ink">{displayName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            Edit Details
          </Button>
          {person.memberId !== null && (
            <Button variant="ghost" size="sm" onClick={() => void sendPassword()}>
              <KeyRound />
              Send Password
            </Button>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm">
                More Actions
                <ChevronDown />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="z-50 min-w-[15rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-[0_24px_54px_-18px_rgba(0,0,0,0.85)]"
              >
                {/* Kajabi's menu, in its order, less the two that need a
                    community feature this site doesn't have (Mute, Hide). */}
                <MenuItem icon={<DollarSign />} onSelect={() => setBuying(true)}>
                  Create a manual purchase
                </MenuItem>
                <MenuItem icon={<Gift />} onSelect={() => setTab("products")}>
                  Grant offer
                </MenuItem>
                {person.memberId !== null && (
                  <>
                    <DropdownMenu.Separator className="my-1.5 h-px bg-hairline" />
                    <MenuItem icon={<KeyRound />} onSelect={() => void sendPassword()}>
                      Change password
                    </MenuItem>
                  </>
                )}
                <DropdownMenu.Separator className="my-1.5 h-px bg-hairline" />
                <MenuItem icon={<Combine />} onSelect={() => setMerging(true)}>
                  Merge with another contact
                </MenuItem>
                <MenuItem icon={<Download />} onSelect={() => void exportPerson()}>
                  Export their data
                </MenuItem>
                <DropdownMenu.Separator className="my-1.5 h-px bg-hairline" />
                <MenuItem icon={<Trash2 />} onSelect={() => void remove()} destructive>
                  Delete contact…
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
            <span className="grid size-24 shrink-0 place-items-center rounded-2xl bg-lilac-tint text-plum-deep">
              <UserRound className="size-12" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                {displayName}
                {person.memberId !== null && <Badge tone="green">Has an account</Badge>}
              </p>
              <a href={`mailto:${person.email}`} className="block break-all text-plum hover:underline">
                {person.email}
              </a>
              {person.phone && <p className="text-ink-soft">{person.phone}</p>}
              <p className="text-ink-soft">
                Added on <span className="font-semibold text-ink">{formatDateTime(person.createdAt)}</span>
              </p>
              {firstPaid && (
                <p className="text-ink-soft">
                  Customer since <span className="font-semibold text-ink">{formatDateTime(firstPaid)}</span>
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div
              role="tablist"
              aria-label="About this person"
              className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-hairline px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`panel-${item.id}`}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "-mb-px whitespace-nowrap border-b-2 px-3 py-3.5 text-sm font-semibold transition-colors",
                    tab === item.id
                      ? "border-ink text-ink"
                      : "border-transparent text-ink-soft hover:text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-5 p-5">
              {tab === "lifecycle" && <Lifecycle person={person} />}

              {tab === "info" && (
                <>
                  {/* Kajabi's Info panel: the six facts in two columns, then Additional Info. */}
                  <div className="space-y-5 rounded-xl border border-hairline bg-white/[0.02] p-5">
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                      <DetailLine label="Added on" value={formatDateTime(person.createdAt)} />
                      <DetailLine
                        label="Became a Customer on"
                        value={firstPaid ? formatDateTime(firstPaid) : "Not a customer yet"}
                      />
                      <DetailLine label="Net Revenue" value={`${money(person.lifetimeValueCents)} USD`} />
                      <DetailLine label="Sign in count" value={signInCount(person)} />
                      <div>
                        <dt className="text-xs font-semibold text-ink-soft">Email Marketing</dt>
                        <dd className="mt-0.5 text-ink">{marketingLine(person)}</dd>
                        {person.emailMarketingStatus === "subscribed" ? (
                          <button
                            type="button"
                            onClick={() => void setStatus("opted_out")}
                            className="mt-1 text-sm font-semibold text-plum hover:underline"
                          >
                            Unsubscribe
                          </button>
                        ) : person.emailMarketingStatus === "opted_out" ||
                          person.emailMarketingStatus === "unconfirmed" ? (
                          <button
                            type="button"
                            onClick={() => void setStatus("subscribed")}
                            className="mt-1 text-sm font-semibold text-plum hover:underline"
                          >
                            Resubscribe
                          </button>
                        ) : null}
                      </div>
                      <DetailLine
                        label="Last activity at"
                        value={hasActivity(person) ? formatDateTime(person.lastActivityAt as string) : "No activity yet"}
                      />
                    </dl>

                    <div className="border-t border-hairline pt-4">
                      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
                        Additional info
                      </h2>
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                        <DetailLine label="First name" value={orNone(person.firstName, "Not given")} />
                        <DetailLine label="Last name" value={orNone(person.lastName, "Not given")} />
                        <DetailLine label="Phone" value={orNone(person.phone, "Not given")} />
                        <DetailLine label="Time zone" value={person.timezone} />
                        {ADDRESS_FIELDS.map((key) => {
                          const value = person.customFields?.[key];
                          return value === null || value === undefined || value === "" ? null : (
                            <DetailLine key={key} label={key} value={String(value)} />
                          );
                        })}
                        <DetailLine label="First came from" value={sourceLabel(person.source)} />
                        <DetailLine
                          label="On your site"
                          value={[
                            person.memberId ? "Has an account" : null,
                            person.subscribed ? "On the mailing list" : null,
                            person.leadCount > 0
                              ? `${pluralize(person.leadCount, "enquiry", "enquiries")} sent`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Nothing yet"}
                        />
                      </dl>
                    </div>

                    {custom.length > 0 && (
                      <div className="border-t border-hairline pt-4">
                        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">
                          Form answers
                        </h2>
                        <dl className="space-y-4 text-sm">
                          {custom.map(([key, value]) => (
                            // A key with spaces is a heading off an imported spreadsheet and
                            // already reads as she wrote it; only machine keys need humanising.
                            <DetailLine key={key} label={/\s/.test(key) ? key : humaniseKey(key)} value={String(value)} />
                          ))}
                        </dl>
                      </div>
                    )}
                  </div>
                  <ContactFilesCard contactId={contactId} />
                </>
              )}

              {tab === "purchases" &&
                (person.orders.length === 0 ? (
                  <EmptyState
                    icon={<Receipt />}
                    title="No purchases yet"
                    description="Purchases appear here the moment a payment goes through, or when you record one by hand."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => setBuying(true)}>
                        <DollarSign />
                        Create a manual purchase
                      </Button>
                    }
                  />
                ) : (
                  <ul className="space-y-4">
                    {person.orders.map((order) => (
                      <PurchaseCard key={order.id} order={order} />
                    ))}
                  </ul>
                ))}

              {tab === "products" && (
                <>
                  {typeof person.customFields?.Products === "string" && person.customFields.Products && (
                    <div className="rounded-xl border border-hairline px-4 py-3.5 text-sm">
                      <p className="text-xs font-semibold text-ink-soft">Bought on your old site</p>
                      <p className="mt-1 text-ink">{person.customFields.Products}</p>
                    </div>
                  )}
                  <ContactAccessCard
                    contactId={contactId}
                    email={person.email}
                    displayName={displayName}
                    onChanged={load}
                  />
                  <div>
                    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
                      <Users className="size-4 text-ink-soft" aria-hidden />
                      Communities
                    </h2>
                    {(person.communities ?? []).length === 0 ? (
                      <p className="text-sm text-ink-soft">Not in any community yet.</p>
                    ) : (
                      <ul className="divide-y divide-hairline/60 rounded-xl border border-hairline">
                        {person.communities.map((community) => (
                          <li key={community.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                            <div className="min-w-0 flex-1">
                              <Link to={`/admin/community/${community.communityId}`} className="font-semibold text-plum hover:underline">
                                {community.name}
                              </Link>
                              <p className="text-xs text-ink-soft">Joined {formatDate(community.joinedAt)}</p>
                            </div>
                            <Badge tone={community.banned || !community.memberActive ? "slate" : "green"}>
                              {community.banned ? "Banned" : !community.memberActive ? "Account inactive" : community.role === "admin" ? "Admin" : community.role === "moderator" ? "Moderator" : "Member"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {tab === "notes" && (
                <>
                  <form onSubmit={saveNote} className="space-y-3">
                    <Textarea
                      rows={5}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Write your note here"
                      aria-label="Your note"
                    />
                    <Button size="sm" type="submit" disabled={!note.trim() || savingNote}>
                      {savingNote ? "Adding…" : "Add Note"}
                    </Button>
                  </form>
                  {person.notes && (
                    <div className="rounded-xl border border-hairline px-4 py-3.5 text-sm">
                      <p className="text-xs font-semibold text-ink-soft">Notes on their card</p>
                      <p className="mt-1 whitespace-pre-wrap text-ink">{person.notes}</p>
                    </div>
                  )}
                  {notes.length === 0 ? (
                    <p className="rounded-xl border border-hairline bg-white/[0.02] px-4 py-3.5 text-sm font-semibold text-ink">
                      This person has no notes.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {notes.map((entry) => (
                        <li key={entry.id} className="rounded-xl border border-hairline px-4 py-3.5">
                          <p className="whitespace-pre-wrap text-sm text-ink">{entry.body || entry.title}</p>
                          <p className="mt-1.5 text-xs text-ink-soft">{formatDateTime(entry.occurredAt)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Tags"
              action={
                <Link to="/admin/tags" className="text-sm font-semibold text-ink-soft hover:text-plum">
                  View All Tags
                </Link>
              }
            />
            <div className="space-y-3 px-5 py-4">
              {/*
                * Kajabi's "Select Tag": one box that searches her tags and, when
                * nothing matches, makes the one she typed.
                */}
              <div className="flex gap-2">
                <Input
                  list="contact-tag-options"
                  value={addingTag}
                  onChange={(e) => setAddingTag(e.target.value)}
                  placeholder="Select Tag"
                  aria-label="Select a tag to add, or type a new one"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void addTag(addingTag);
                  }}
                />
                <datalist id="contact-tag-options">
                  {tags
                    .filter((tag) => !person.tags.some((t) => t.slug === tag.slug))
                    .map((tag) => (
                      <option key={tag.slug} value={tag.name} />
                    ))}
                </datalist>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!addingTag.trim() || tagBusy !== null}
                  onClick={() => addTag(addingTag)}
                >
                  {tagBusy !== null ? "Adding…" : "Add"}
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {person.tags.length === 0 && (
                  <p className="text-xs text-ink-soft">No tags on this person yet.</p>
                )}
                {person.tags.map((tag) => (
                  <span
                    key={tag.slug}
                    className="inline-flex items-center gap-1.5 rounded-full border border-plum-bright/40 bg-plum-bright/[0.16] px-2.5 py-1 text-xs font-semibold text-lilac"
                  >
                    {tag.name}
                    <button
                      type="button"
                      disabled={tagBusy !== null}
                      onClick={() => dropTag(tag.slug)}
                      aria-label={`Take the ${tag.name} tag off ${displayName}`}
                      className="rounded-full hover:text-white"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </Card>
          {/*
            * Email confirmation, above the mailing-list card and deliberately
            * separate from it.
            *
            * These are two different questions with two different stores behind
            * them, and this screen used to answer only one: whether we may email
            * them. A member who has never confirmed their address is blocked from
            * posting, commenting and earning points — and their card still read
            * "Happy to hear from you", because their consent row said subscribed.
            */}
          {person.confirmation && person.confirmation.state !== "no_account" && (
            <Card>
              <CardHeader
                title="Email confirmation"
                icon={person.confirmation.confirmed ? <BadgeCheck /> : <ShieldAlert />}
              />
              <div className="space-y-3 px-5 py-4">
                <Badge tone={person.confirmation.confirmed ? "green" : "gold"}>
                  {person.confirmation.label}
                </Badge>
                <p className="text-xs leading-relaxed text-ink-soft">
                  {person.confirmation.detail}
                </p>
                {person.confirmation.accountConfirmedAt && (
                  <p className="text-xs text-ink-soft">
                    Confirmed on {formatDate(person.confirmation.accountConfirmedAt)}.
                  </p>
                )}
                {!person.confirmation.confirmed && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={confirmEmail} disabled={confirmBusy}>
                      <BadgeCheck />
                      Mark as confirmed
                    </Button>
                    {person.confirmation.memberId !== null && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={resendConfirmation}
                        disabled={confirmBusy}
                      >
                        <Send />
                        Send the email again
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}


        </div>
      </div>

      <EditModal
        person={person}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load();
        }}
      />

      <ManualPurchaseModal
        person={person}
        open={buying}
        onClose={() => setBuying(false)}
        onSaved={() => {
          setBuying(false);
          setTab("purchases");
          load();
        }}
      />

      <MergeModal
        person={person}
        open={merging}
        onClose={() => setMerging(false)}
        onMerged={() => {
          setMerging(false);
          load();
        }}
      />

      {confirmDialog}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/contacts"
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition-colors hover:text-plum"
    >
      <ArrowLeft className="size-4" />
      Back to everyone
    </Link>
  );
}

/** What each kind of moment looks like in the feed. */
const EVENT_ICON: Record<string, LucideIcon> = {
  purchase: CreditCard,
  "email.sent": Send,
  "email.opened": Send,
  "email.clicked": Send,
  "event.registered": CalendarCheck,
  note: StickyNote,
  imported: UserPlus,
  created: UserPlus,
  "account.created": KeyRound,
  "lead.created": Inbox,
  subscribed: MailPlus,
  email_preference: Mail,
  "email.confirmed": BadgeCheck,
  merged: Combine,
  "assessment.completed": ClipboardCheck,
  sequence_started: Mail,
  sequence_completed: Mail,
};

/** "about 7 hours", "3 days", "about 2 years": how long they've been with her. */
function lifespan(since: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60_000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return pluralize(minutes, "minute", "minutes");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `about ${pluralize(hours, "hour", "hours")}`;
  const days = Math.round(hours / 24);
  if (days < 30) return pluralize(days, "day", "days");
  const months = Math.round(days / 30.44);
  if (months < 12) return `about ${pluralize(months, "month", "months")}`;
  return `about ${pluralize(Math.round(days / 365.25), "year", "years")}`;
}

/** The Lifecycle tab: the three numbers, then everything that has happened, newest first. */
function Lifecycle({ person }: { person: Person }) {
  const [kind, setKind] = useState("all");
  const kinds = useMemo(
    () => [...new Set(person.activity.map((entry) => activityLabel(entry.kind)))].sort(),
    [person],
  );
  const shown =
    kind === "all" ? person.activity : person.activity.filter((entry) => activityLabel(entry.kind) === kind);

  return (
    <>
      <div className="grid grid-cols-1 divide-y divide-hairline rounded-xl border border-hairline text-center sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Lifespan" value={lifespan(person.createdAt)} />
        <Stat label="Purchases" value={String(person.orderCount)} />
        <Stat label="Net Revenue" value={money(person.lifetimeValueCents)} />
      </div>

      <div className="space-y-2">
        <label htmlFor="event-type" className="block text-sm font-semibold text-ink">
          Filter by event type
        </label>
        <select
          id="event-type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={cn(selectStyles, "sm:max-w-64")}
        >
          <option value="all">All types</option>
          {kinds.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-soft">This feed is limited to the {FEED_LIMIT} most recent events.</p>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title="Nothing yet"
          description="Everything this person does will show up here as it happens."
        />
      ) : (
        <ol className="space-y-3">
          {shown.map((entry) => {
            const Icon = EVENT_ICON[entry.kind] ?? Clock;
            return (
              <li key={entry.id} className="flex gap-4 rounded-xl border border-hairline p-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-ink-soft">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                    {activityLabel(entry.kind)}
                  </p>
                  <p className="font-semibold text-ink">{entry.title}</p>
                  {entry.body && <p className="whitespace-pre-wrap text-sm text-ink-soft">{entry.body}</p>}
                  <p className="text-xs text-ink-soft/80">{formatDateTime(entry.occurredAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/**
 * One purchase, drawn the way Kajabi's Purchases tab draws it: a grey band with
 * when, how much and which order, then what was bought.
 */
function PurchaseCard({ order }: { order: ContactOrder }) {
  const total = orderTotal(order);
  const refunded = order.refundedCents > 0;
  const kajabi = order.source === "kajabi";
  const plan = typeof order.customFieldData?.kajabiType === "string" ? order.customFieldData.kajabiType : null;
  return (
    <li className="overflow-hidden rounded-xl border border-hairline">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 bg-white/[0.05] px-4 py-3">
        <div>
          <p className="text-xs text-ink-soft">{order.status === "paid" || refunded ? "Paid on" : "Started on"}</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{formatDate(order.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-soft">Total</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {money(total, order.currency)} {order.currency.toUpperCase()}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-ink-soft">Order #{orderNumber(order)}</p>
          {kajabi ? (
            <p className="mt-0.5 text-xs text-ink-soft">From Kajabi</p>
          ) : order.source === "manual" ? (
            <p className="mt-0.5 text-xs text-ink-soft">Recorded by hand</p>
          ) : (
            <Link
              to="/admin/sales/payments"
              className="mt-0.5 inline-block text-xs font-semibold text-ink-soft underline hover:text-plum"
            >
              View Details
            </Link>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 text-sm sm:px-8">
        <dt className="text-ink-soft">Offer</dt>
        <dd className="font-semibold text-ink">
          {order.offerId ? (
            <Link to={`/admin/offers/${order.offerId}`} className="underline hover:text-plum">
              {order.title || "An offer"}
            </Link>
          ) : (
            order.title || "A purchase"
          )}
        </dd>
        <dt className="text-ink-soft">Price</dt>
        <dd className="text-ink">
          {money(total, order.currency)} {order.currency.toUpperCase()}
          {plan && plan !== "One-time" && <span className="text-ink-soft"> · {plan}</span>}
        </dd>
        <dt className="text-ink-soft">Quantity</dt>
        <dd className="text-ink">1</dd>
        {(order.status !== "paid" || refunded) && (
          <>
            <dt className="text-ink-soft">Status</dt>
            <dd>
              <Badge tone={refunded ? "slate" : "gold"}>
                {refunded
                  ? `Refunded ${money(order.refundedCents, order.currency)}`
                  : (ORDER_STATUS_LABEL[order.status] ?? "Not known")}
              </Badge>
            </dd>
          </>
        )}
        {order.notes && (
          <>
            <dt className="text-ink-soft">Note</dt>
            <dd className="whitespace-pre-wrap text-ink">{order.notes}</dd>
          </>
        )}
      </dl>
    </li>
  );
}

/* ------------------------------------------------ Recording a purchase by hand */

function ManualPurchaseModal({
  person,
  open,
  onClose,
  onSaved,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = () => new Date().toLocaleDateString("en-CA");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setAmount("");
    setPaidOn(today());
    setNote("");
  }, [open]);

  const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
  const valid = title.trim().length > 0 && amount.trim() !== "" && Number.isFinite(cents) && cents >= 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      // Today means now. An earlier day is stamped at noon local time, so the
      // date she picked is the date that shows in every time zone near hers.
      const paidAt = paidOn === today() ? new Date().toISOString() : new Date(`${paidOn}T12:00:00`).toISOString();
      await contactsApi.addPurchase(person.id, { title: title.trim(), amountCents: cents, paidAt, note: note.trim() });
      toast.success("Purchase recorded");
      onSaved();
    } catch (err) {
      toast.error(friendlyError(err, "purchase"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Create a manual purchase"
      description={`Record a payment ${person.name || person.email} made outside your checkout. It counts toward their lifetime value. To give them access to what they bought, use Grant offer.`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="manual-purchase" disabled={!valid || saving}>
            {saving ? "Saving…" : "Create purchase"}
          </Button>
        </>
      }
    >
      <form id="manual-purchase" onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="What they bought" className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 90 day 1:1 Coaching" autoFocus />
        </Field>
        <Field label="Amount paid (USD)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Paid on">
          <Input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="Note" hint="optional — only you see this" className="sm:col-span-2">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid by bank transfer" />
        </Field>
      </form>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-5">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">{value}</p>
    </div>
  );
}

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

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-soft">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value}</dd>
    </div>
  );
}

/* ----------------------------------------------------------- Editing them */

function EditModal({
  person,
  open,
  onClose,
  onSaved,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(person.firstName);
  const [lastName, setLastName] = useState(person.lastName);
  const [phone, setPhone] = useState(person.phone);
  const [notes, setNotes] = useState(person.notes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFirstName(person.firstName);
    setLastName(person.lastName);
    setPhone(person.phone);
    setNotes(person.notes);
  }, [open, person]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await contactsApi.update(person.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        // Sent explicitly so a corrected first name is reflected in the name
        // shown everywhere else, rather than leaving the old full name behind.
        name: `${firstName.trim()} ${lastName.trim()}`.trim() || person.name,
        phone: phone.trim(),
        notes: notes.trim(),
      });
      toast.success("Saved");
      onSaved();
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
      title="Edit their details"
      description="Their email address is how everything is joined up, so it can't be changed here."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="edit-person" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="edit-person" onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Phone" className="sm:col-span-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Notes" hint="only you see these" className="sm:col-span-2">
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------- Merging two */

function MergeModal({
  person,
  open,
  onClose,
  onMerged,
}: {
  person: Person;
  open: boolean;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setMatches([]);
    setPicked(null);
  }, [open]);

  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      contactsApi
        .list({ q: search.trim(), limit: 8 })
        .then((page) => setMatches(page.items.filter((row) => row.id !== person.id)))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, search, person.id]);

  async function merge() {
    if (!picked) return;
    setSaving(true);
    try {
      await contactsApi.merge(person.id, picked.id);
      toast.success("Combined into one person");
      onMerged();
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
      title="Is this the same person as someone else?"
      description={`Everything from the other card moves onto ${person.name || person.email}, and the other card goes.`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Never mind
          </Button>
          <Button size="sm" disabled={!picked || saving} onClick={merge}>
            {saving ? "Combining…" : "Combine them"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Find the other card" hint="search by name or email">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Start typing…"
            autoFocus
          />
        </Field>

        <ul className="space-y-1.5">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                onClick={() => setPicked(match)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                  picked?.id === match.id
                    ? "border-gold/60 bg-gold/[0.10]"
                    : "border-hairline bg-white/[0.03] hover:border-plum/40",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">
                    {match.name || "No name yet"}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">{match.email}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-soft">
                  {match.orderCount > 0
                    ? `${pluralize(match.orderCount, "purchase")}`
                    : "No purchases"}
                </span>
              </button>
            </li>
          ))}
          {search.trim().length >= 2 && matches.length === 0 && (
            <li className="text-sm text-ink-soft">Nobody else matches that.</li>
          )}
        </ul>

        {picked && (
          <div className="rounded-xl border border-gold/40 bg-gold/[0.08] px-4 py-3 text-sm text-ink">
            <p className="font-semibold">
              {picked.name || picked.email} will be combined into{" "}
              {person.name || person.email}.
            </p>
            <p className="mt-1 text-ink-soft">
              Their purchases, tags and history all move across. If either of them asked to stop
              receiving emails, the combined person keeps that. You can't undo this.
            </p>
            {EMAIL_STATUS_LABEL[picked.emailMarketingStatus] && (
              <p className="mt-1 text-xs text-ink-soft">
                Right now that card says: {emailStatusLabel(picked.emailMarketingStatus)}.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
