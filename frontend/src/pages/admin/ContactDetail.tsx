import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  BadgeCheck,
  Clock,
  Combine,
  Download,
  Mail,
  Pencil,
  Phone,
  Receipt,
  Send,
  ShieldAlert,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import {
  EMAIL_STATUS_LABEL,
  EMAIL_STATUS_TONE,
  SETTABLE_STATUSES,
  activityLabel,
  contactsApi,
  emailStatusLabel,
  money,
  sourceLabel,
  type Contact,
  type ContactDetail as Person,
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
  PageHeader,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, humaniseKey, orNone, pluralize } from "@/pages/admin/ui/friendly";
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

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const contactId = Number(id);

  const [person, setPerson] = useState<Person | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [note, setNote] = useState("");
  const [addingTag, setAddingTag] = useState("");
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

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
    () => Object.entries(person?.customFields ?? {}).filter(([, value]) => value !== null),
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

  async function addTag(slug: string) {
    if (!person || !slug.trim()) return;
    setTagBusy(slug.trim());
    try {
      await contactsApi.addTags(person.id, [slug.trim()]);
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
    if (!person || !note.trim()) return;
    try {
      await contactsApi.addNote(person.id, note.trim());
      setNote("");
      toast.success("Note saved");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "note"));
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
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(person.name || person.email || "person")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-data.json`;
      anchor.click();
      URL.revokeObjectURL(url);
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

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        eyebrow="Contacts"
        title={displayName}
        description={
          person.lastActivityAt
            ? `Last heard from ${formatRelative(person.lastActivityAt)}. First seen ${formatDate(person.createdAt)}.`
            : `First seen ${formatDate(person.createdAt)}.`
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit details
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMerging(true)}>
              <Combine />
              Same as someone else
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void exportPerson()}>
              <Download />
              Export their data
            </Button>
            <Button variant="dangerGhost" size="sm" onClick={remove}>
              <Trash2 />
              Remove
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <SummaryTile
          label="Spent with you"
          value={person.lifetimeValueCents > 0 ? money(person.lifetimeValueCents) : "Nothing yet"}
        />
        <SummaryTile
          label="Purchases"
          value={person.orderCount > 0 ? String(person.orderCount) : "None yet"}
        />
        <SummaryTile label="First came from" value={sourceLabel(person.source)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="What's happened" icon={<Clock />} />
            {person.activity.length === 0 ? (
              <EmptyState
                icon={<Clock />}
                title="Nothing yet"
                description="Everything this person does will show up here as it happens."
              />
            ) : (
              <ol className="space-y-0 px-5 py-4">
                {person.activity.map((entry) => (
                  <li key={entry.id} className="relative flex gap-4 pb-5 last:pb-0">
                    <span className="mt-1.5 grid size-2.5 shrink-0 place-items-center rounded-full bg-gold" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                        {activityLabel(entry.kind)}
                      </p>
                      <p className="font-semibold text-ink">{entry.title}</p>
                      {entry.body && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                          {entry.body}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-ink-soft/80">
                        {formatDateTime(entry.occurredAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader title="What they've bought" icon={<Receipt />} />
            {person.orders.length === 0 ? (
              <EmptyState
                icon={<Receipt />}
                title="Nothing yet"
                description="Purchases appear here the moment a payment goes through."
              />
            ) : (
              <ul className="divide-y divide-hairline/60">
                {person.orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">
                        {order.title || "A purchase"}
                      </p>
                      <p className="text-xs text-ink-soft">{formatDate(order.createdAt)}</p>
                    </div>
                    <span className="font-semibold text-ink">
                      {money(order.totalCents, order.currency)}
                    </span>
                    <Badge tone={order.status === "paid" ? "green" : "slate"}>
                      {ORDER_STATUS_LABEL[order.status] ?? "Not known"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ContactAccessCard
            contactId={contactId}
            email={person.email}
            displayName={displayName}
            onChanged={load}
          />

          <ContactFilesCard contactId={contactId} />

          <Card>
            <CardHeader title="Add a note" icon={<StickyNote />} />
            <form onSubmit={saveNote} className="space-y-3 px-5 py-4">
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What you talked about, what you promised, anything you want to remember."
                aria-label="Your note"
              />
              <Button size="sm" type="submit" disabled={!note.trim()}>
                Save this note
              </Button>
            </form>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Their details" icon={<Phone />} />
            <dl className="space-y-3 px-5 py-4 text-sm">
              <DetailLine label="Email" value={person.email} />
              <DetailLine label="Phone" value={orNone(person.phone, "Not given")} />
              <DetailLine label="Time zone" value={person.timezone} />
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
              {person.notes && <DetailLine label="Notes" value={person.notes} />}
              {custom.map(([key, value]) => (
                <DetailLine key={key} label={humaniseKey(key)} value={String(value)} />
              ))}
            </dl>
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

          <Card>
            <CardHeader title="Emails" icon={<Mail />} />
            <div className="space-y-3 px-5 py-4">
              <Badge tone={EMAIL_STATUS_TONE[person.emailMarketingStatus] ?? "neutral"}>
                {emailStatusLabel(person.emailMarketingStatus)}
              </Badge>
              {person.emailMarketingStatus === "bounced" ||
              person.emailMarketingStatus === "complained" ? (
                <p className="text-xs text-ink-soft">
                  {person.emailMarketingStatus === "bounced"
                    ? "Their inbox refused your last email, so nothing more is being sent to this address."
                    : "They marked one of your emails as spam. Sending to them again would put your other emails at risk, so nothing more is going out."}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {SETTABLE_STATUSES.filter(
                    (status) => status !== person.emailMarketingStatus,
                  ).map((status) => (
                    <Button
                      key={status}
                      variant="secondary"
                      size="sm"
                      onClick={() => setStatus(status)}
                    >
                      {status === "subscribed"
                        ? "Start sending them emails"
                        : "Stop sending them emails"}
                    </Button>
                  ))}
                </div>
              )}
              {person.optedOutAt && person.emailMarketingStatus === "opted_out" && (
                <p className="text-xs text-ink-soft">
                  They asked to stop on {formatDate(person.optedOutAt)}.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Tags" />
            <div className="space-y-3 px-5 py-4">
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

              <div className="flex flex-wrap gap-1.5">
                {tags
                  .filter((tag) => !person.tags.some((t) => t.slug === tag.slug))
                  .slice(0, 8)
                  .map((tag) => (
                    <button
                      key={tag.slug}
                      type="button"
                      disabled={tagBusy !== null}
                      onClick={() => addTag(tag.slug)}
                      className="min-h-9 rounded-full border border-hairline bg-surface px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:border-plum/40 hover:text-plum disabled:cursor-wait disabled:opacity-60"
                    >
                      {tagBusy === tag.slug ? "Adding…" : `+ ${tag.name}`}
                    </button>
                  ))}
              </div>

              <div className="flex gap-2">
                <Input
                  value={addingTag}
                  onChange={(e) => setAddingTag(e.target.value)}
                  placeholder="Type a brand-new tag…"
                  aria-label="Type a brand-new tag"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    void addTag(addingTag);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!addingTag.trim() || tagBusy !== null}
                  onClick={() => addTag(addingTag)}
                >
                  Add
                </Button>
              </div>
            </div>
          </Card>
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

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
    </Card>
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
