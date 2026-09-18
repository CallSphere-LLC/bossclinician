import { useNewProductRequest } from "./ui/useNewProductRequest";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, Headphones, Link2, NotebookPen, Paperclip, Plus, Trash2, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { coachingAdminApi, type CoachingSessionFile } from "@/lib/coachingAdminApi";
import type { CoachingOffer, CoachingSession, MediaAsset } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import {
  friendlyError,
  fromDateTimeInput,
  humanizeKey,
  orNone,
  pluralize,
  publishLabel,
  slugify,
  toDateTimeInput,
  uniqueKey,
} from "@/pages/admin/ui/friendly";

const SESSION_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  scheduled: "blue",
  completed: "green",
  cancelled: "slate",
  no_show: "red",
};

/** Stored session state → how she'd describe it to a client. */
const SESSION_LABEL: Record<string, string> = {
  scheduled: "Booked",
  completed: "Done",
  cancelled: "Cancelled",
  no_show: "Didn't show",
};

const SESSION_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];

/**
 * The session as the form edits it.
 *
 * The list endpoint returns every column, so these two have always arrived;
 * the shared `CoachingSession` type simply never named them, because until now
 * there was no box to type them into.
 */
type SessionDraft = Partial<CoachingSession> & {
  recordingUrl?: string;
  sharedNotes?: string;
};

interface CoachingClient {
  kind: "member" | "contact";
  id: number;
  name: string;
  email: string;
}

/** How the coaching is run, said plainly rather than as the stored word. */
const FORMAT_LABEL: Record<string, string> = {
  individual: "One to one",
  group: "Group",
};

const EMPTY_OFFER = {
  title: "",
  description: "",
  sessionCount: 1,
  durationMinutes: 60,
  priceCents: 0,
  format: "individual",
  bookingUrl: "",
  published: true,
};

/**
 * What she types in the price box → the cents the database stores.
 * "497", "$497.00" and "1,200" all work, so she never has to think in cents.
 */
function dollarsToCents(input: string): number {
  const dollars = Number.parseFloat(input.replace(/[^0-9.]/g, ""));
  return Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0;
}

/** The stored cents back in the box, without a pointless ".00". */
function centsToInput(cents: number | null | undefined): string {
  if (!cents) return "";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

export default function Coaching() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Coaching"
        description="Sell your coaching packages, then keep every booked session, agenda and private note in one place."
      />

      <Tabs.Root defaultValue="offers">
        <Tabs.List className="flex gap-1 rounded-xl border border-hairline/70 bg-surface p-1.5">
          {[
            { value: "offers", label: "Offers", icon: Headphones },
            { value: "sessions", label: "Sessions", icon: CalendarClock },
          ].map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-plum data-[state=active]:bg-brand-gradient data-[state=active]:text-white"
            >
              <tab.icon className="size-4" />
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <div className="mt-5">
          <Tabs.Content value="offers">
            <OffersTab />
          </Tabs.Content>
          <Tabs.Content value="sessions">
            <SessionsTab />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  );
}

function OffersTab() {
  const [offers, setOffers] = useState<CoachingOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CoachingOffer> | null>(null);
  useNewProductRequest(() => { setDraft({ ...EMPTY_OFFER }); setPriceInput(""); });
  // The price box holds what she typed ("497", "1,200.50") while the draft
  // holds the cents; keeping them apart lets her type freely mid-number.
  const [priceInput, setPriceInput] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .growthList<CoachingOffer>("coaching/offers")
      .then(setOffers)
      .catch(() => setError("We couldn't load your coaching offers. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  function openOffer(offer?: CoachingOffer) {
    setDraft(offer ?? { ...EMPTY_OFFER });
    setPriceInput(centsToInput(offer?.priceCents));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft?.title?.trim()) return;
    // The web address is derived from the name and never shown; an existing
    // offer keeps the one it already has so shared links keep working.
    const takenAddresses = (offers ?? []).filter((o) => o.id !== draft.id).map((o) => o.slug);
    const payload = {
      ...draft,
      // `|| "offer"` covers a name that leaves nothing behind once it's cleaned
      // up, which would otherwise give the offer a blank address.
      slug: draft.slug || uniqueKey(slugify(draft.title) || "offer", takenAddresses, "-"),
    };
    try {
      if (draft.id) await adminApi.growthUpdate("coaching/offers", draft.id, payload);
      else await adminApi.growthCreate("coaching/offers", payload);
      toast.success(draft.id ? "Offer saved" : "Offer created");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "offer"));
    }
  }

  async function remove(offer: CoachingOffer) {
    const ok = await confirm({
      title: `Delete “${offer.title}”?`,
      description:
        "Sessions you've already booked stay in your list, but they'll no longer be attached to this offer.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.growthDelete("coaching/offers", offer.id);
      toast.success("Offer deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "offer"));
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNotice message={error} />}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => openOffer()}>
          <Plus />
          New offer
        </Button>
      </div>

      {offers === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 w-full" />
          ))}
        </div>
      ) : offers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Headphones />}
            title="No coaching offers yet"
            description="Create a package — one to one or group — and start booking sessions into it."
            action={
              <Button size="sm" onClick={() => openOffer()}>
                Create an offer
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {offers.map((offer) => (
            <Card key={offer.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-lg text-ink">{offer.title}</h3>
                <Badge tone={offer.format === "group" ? "plum" : "neutral"}>
                  {offer.format === "group" ? (
                    <Users className="size-3" />
                  ) : (
                    <Headphones className="size-3" />
                  )}
                  {FORMAT_LABEL[offer.format] ?? humanizeKey(offer.format)}
                </Badge>
              </div>
              {!offer.published && (
                <p className="mt-2">
                  <Badge tone="slate">{publishLabel(false)}</Badge>
                </p>
              )}
              <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-ink-soft">
                {offer.description || "No description yet."}
              </p>
              <p className="mt-3 font-display text-[1.5rem] leading-none text-plum">
                {offer.priceCents ? formatCurrency(offer.priceCents, offer.currency) : "No price set"}
              </p>
              <p className="mt-1.5 text-xs text-ink-soft">
                {pluralize(offer.sessionCount, "session")} · {offer.durationMinutes} minutes each
              </p>
              <div className="mt-auto flex gap-2 pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => openOffer(offer)}
                >
                  Edit
                </Button>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Delete ${offer.title}`}
                  onClick={() => remove(offer)}
                >
                  <Trash2 />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? "Edit offer" : "New coaching offer"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="offer-form">
              Save offer
            </Button>
          </>
        }
      >
        {draft && (
          <form id="offer-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="What's it called?" className="sm:col-span-2">
              <Input
                value={draft.title ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="90-Day Practice Accelerator"
                required
                autoFocus
              />
            </Field>
            <Field
              label="Description"
              hint="what people read about it on your site"
              className="sm:col-span-2"
            >
              <Textarea
                rows={3}
                value={draft.description ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field label="How many sessions?" hint="0 if it's open-ended">
              <Input
                type="number"
                min={0}
                value={draft.sessionCount ?? 1}
                onChange={(e) => setDraft((d) => ({ ...d, sessionCount: Number(e.target.value) }))}
              />
            </Field>
            <Field label="How long is each session?" hint="in minutes">
              <Input
                type="number"
                min={15}
                value={draft.durationMinutes ?? 60}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, durationMinutes: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label="Price" hint="leave blank if you're not selling this online">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink-soft">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  className="pl-8"
                  value={priceInput}
                  onChange={(e) => {
                    setPriceInput(e.target.value);
                    setDraft((d) => ({ ...d, priceCents: dollarsToCents(e.target.value) }));
                  }}
                  placeholder="497"
                />
              </div>
            </Field>
            <Field label="How do you run it?">
              <select
                value={draft.format ?? "individual"}
                onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value }))}
                className={selectStyles}
              >
                <option value="individual">One to one</option>
                <option value="group">Group</option>
              </select>
            </Field>
            <Field
              label="Booking link"
              hint="Calendly, Acuity, or wherever people book with you"
              className="sm:col-span-2"
            >
              <Input
                value={draft.bookingUrl ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, bookingUrl: e.target.value }))}
                placeholder="https://calendly.com/…"
              />
            </Field>
            <div className="flex items-end sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={draft.published !== false}
                  onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum"
                />
                {publishLabel(draft.published !== false)}
              </label>
            </div>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

function SessionsTab() {
  const [sessions, setSessions] = useState<CoachingSession[] | null>(null);
  const [offers, setOffers] = useState<CoachingOffer[]>([]);
  const [clients, setClients] = useState<CoachingClient[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [clientChoice, setClientChoice] = useState("");
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<CoachingSessionFile[]>([]);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  // Files belong to a saved session, so they load when one is opened and are
  // attached and removed straight away rather than with "Save session".
  const draftId = draft?.id ?? null;
  useEffect(() => {
    setFiles([]);
    setLinkTitle("");
    setLinkUrl("");
    if (!draftId) return;
    let cancelled = false;
    coachingAdminApi
      .sessionFiles(draftId)
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch(() => {
        if (!cancelled) toast.error("We couldn't load this session's files. Close it and open it again.");
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  async function attachFile(data: { mediaId?: number | null; title: string; url: string }) {
    if (!draftId) return false;
    try {
      const file = await coachingAdminApi.sessionFileAdd(draftId, data);
      setFiles((current) => [...current, file]);
      toast.success("Shared with your client");
      return true;
    } catch (err) {
      toast.error(friendlyError(err, "file"));
      return false;
    }
  }

  function attachUpload(asset: MediaAsset) {
    void attachFile({
      mediaId: asset.id,
      title: asset.title || asset.originalName,
      url: asset.url,
    });
  }

  async function attachLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Paste the full link, starting with https://");
      return;
    }
    const added = await attachFile({ title: linkTitle.trim() || url, url });
    if (added) {
      setLinkTitle("");
      setLinkUrl("");
    }
  }

  async function removeFile(file: CoachingSessionFile) {
    if (!draftId) return;
    try {
      await coachingAdminApi.sessionFileDelete(draftId, file.id);
      setFiles((current) => current.filter((item) => item.id !== file.id));
      toast.success("File removed");
    } catch (err) {
      toast.error(friendlyError(err, "file"));
    }
  }

  const load = useCallback(() => {
    adminApi
      .coachingSessions()
      .then(setSessions)
      .catch(() => setError("We couldn't load your sessions. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    adminApi.growthList<CoachingOffer>("coaching/offers").then(setOffers).catch(() => undefined);
    adminApi.coachingClients().then((page) => setClients(page.clients)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (contactSearch.trim().length === 1) return;
    const timer = window.setTimeout(() => {
      adminApi
        .coachingClients(contactSearch.trim())
        .then((page) => setClients(page.clients))
        .catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [contactSearch]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    try {
      let memberId = draft.memberId ?? null;
      let contactId = draft.contactId ?? null;
      if (clientChoice.startsWith("member:")) {
        memberId = Number(clientChoice.slice("member:".length));
        contactId = null;
      } else if (clientChoice.startsWith("contact:")) {
        contactId = Number(clientChoice.slice("contact:".length));
        memberId = null;
      }
      const payload = { ...draft, memberId, contactId };
      if (draft.id) await adminApi.growthUpdate("coaching/sessions", draft.id, payload);
      else await adminApi.growthCreate("coaching/sessions", payload);
      toast.success(draft.id ? "Session saved" : "Session booked");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "session"));
    }
  }

  const columns = useMemo<ColumnDef<CoachingSession, unknown>[]>(
    () => [
      {
        accessorKey: "memberName",
        header: "Client",
        cell: ({ row }) => (
          <button type="button" onClick={() => { setDraft(row.original); setClientChoice(row.original.memberId ? `member:${row.original.memberId}` : row.original.contactId ? `contact:${row.original.contactId}` : ""); }} className="min-w-0 text-left">
            <span className="block truncate font-semibold text-ink">
              {row.original.memberName || row.original.memberEmail || "No client chosen"}
            </span>
            <span className="block truncate text-xs text-ink-soft">
              {row.original.offerTitle ?? "Not part of an offer"}
            </span>
          </button>
        ),
      },
      {
        accessorKey: "scheduledAt",
        header: "When",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {orNone(formatDateTime(row.original.scheduledAt), "No date yet")}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={SESSION_TONE[row.original.status] ?? "neutral"}>
            {SESSION_LABEL[row.original.status] ?? humanizeKey(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "notes",
        header: "Notes",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.privateNotes ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-plum">
              <NotebookPen className="size-3.5" />
              Notes saved
            </span>
          ) : (
            <span className="text-xs text-ink-soft/70">None yet</span>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            {row.original.meetingUrl && (
              <Button asChild variant="ghost" size="iconSm" aria-label="Join the call">
                <a href={row.original.meetingUrl} target="_blank" rel="noreferrer">
                  <Video />
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setDraft(row.original)}>
              Open
            </Button>
          </RowActions>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      {error && <ErrorNotice message={error} />}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => { setDraft({ status: "scheduled", durationMinutes: 60 }); setClientChoice(""); }}
        >
          <Plus />
          Book a session
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={sessions}
        searchPlaceholder="Search your sessions…"
        itemNoun={{ one: "session", many: "sessions" }}
        minWidth="720px"
        emptyState={
          <EmptyState
            icon={<CalendarClock />}
            title="No sessions booked yet"
            description="Book a session with one of your clients and it'll show up here, with what you'll cover and your private notes."
          />
        }
      />

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? "Coaching session" : "Book a session"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="session-form">
              Save session
            </Button>
          </>
        }
      >
        {draft && (
          <form id="session-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" hint="any person in your contacts or members">
              <div className="space-y-2">
              <Input
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
                placeholder="Search all contacts by name or email…"
                aria-label="Search contacts"
              />
              <select
                value={clientChoice || (draft.memberId ? `member:${draft.memberId}` : draft.contactId ? `contact:${draft.contactId}` : "")}
                onChange={(e) => setClientChoice(e.target.value)}
                className={selectStyles}
              >
                <option value="">Choose a client…</option>
                {clients.map((client) => (
                  <option key={`${client.kind}:${client.id}`} value={`${client.kind}:${client.id}`}>
                    {client.name ? `${client.name} — ${client.email}` : client.email}
                  </option>
                ))}
              </select>
              </div>
            </Field>
            <Field label="Which offer is this part of?">
              <select
                value={String(draft.offerId ?? "")}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, offerId: e.target.value ? Number(e.target.value) : null }))
                }
                className={selectStyles}
              >
                <option value="">Not part of an offer</option>
                {offers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="When is it?">
              <Input
                type="datetime-local"
                /* Converted both ways: the stored moment is UTC, and the box
                   speaks the clock on her wall. Slicing the raw text showed her
                   a 2pm session as 6pm, and saving what she typed booked her
                   client four hours out. */
                value={toDateTimeInput(draft.scheduledAt ?? null)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, scheduledAt: fromDateTimeInput(e.target.value) }))
                }
              />
            </Field>
            <Field label="Status">
              <select
                value={draft.status ?? "scheduled"}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                className={selectStyles}
              >
                {SESSION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SESSION_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Meeting link"
              hint="Zoom, Google Meet — wherever you're meeting"
              className="sm:col-span-2"
            >
              <Input
                value={draft.meetingUrl ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, meetingUrl: e.target.value }))}
                placeholder="https://zoom.us/j/…"
              />
            </Field>
            <Field label="What you'll cover" hint="your client can see this" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={draft.agenda ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, agenda: e.target.value }))}
              />
            </Field>
            <Field
              label="Private notes"
              hint="just for you — your client never sees this"
              className="sm:col-span-2"
            >
              <Textarea
                rows={5}
                value={draft.privateNotes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, privateNotes: e.target.value }))}
                className={cn("bg-gold-light/40")}
              />
            </Field>

            <div className="sm:col-span-2">
              <p className="border-t border-hairline/60 pt-4 text-[0.8rem] font-semibold text-ink">
                After the session
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Everything below appears on your client's session page.
              </p>
            </div>
            <Field
              label="Notes to share"
              hint="a recap, the homework, what you agreed — your client can read this"
              className="sm:col-span-2"
            >
              <Textarea
                rows={4}
                value={draft.sharedNotes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, sharedNotes: e.target.value }))}
              />
            </Field>
            <Field
              label="Recording link"
              hint="a Zoom, Loom or YouTube link. If you've got the recording as a file, add it under Files instead"
              className="sm:col-span-2"
            >
              <Input
                inputMode="url"
                value={draft.recordingUrl ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, recordingUrl: e.target.value }))}
                placeholder="https://zoom.us/rec/share/…"
              />
            </Field>
            <Field
              label="Files"
              hint="handouts, worksheets or the recording itself — only this client can open them"
              className="sm:col-span-2"
            >
              {draft.id ? (
                <div className="space-y-3">
                  <UploadDropzone
                    compact
                    visibility="protected"
                    scope={`coaching-files:${draft.id}`}
                    onUploaded={attachUpload}
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
                    <Input
                      value={linkTitle}
                      onChange={(e) => setLinkTitle(e.target.value)}
                      placeholder="Name, e.g. Session slides"
                      aria-label="Name for the link"
                    />
                    <Input
                      inputMode="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="Or paste a link — https://…"
                      aria-label="Link to share"
                      onKeyDown={(e) => {
                        // Enter here would otherwise submit the whole session form.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void attachLink();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-full min-h-10"
                      disabled={!linkUrl.trim()}
                      onClick={() => void attachLink()}
                    >
                      Add link
                    </Button>
                  </div>
                  {files.length > 0 && (
                    <ul className="space-y-2">
                      {files.map((file) => {
                        const isLink = /^https?:\/\//i.test(file.url);
                        const name = file.title || (isLink ? file.url : "Untitled file");
                        return (
                          <li
                            key={file.id}
                            className="flex min-h-11 items-center gap-3 rounded-xl border border-hairline px-3 py-2"
                          >
                            {isLink ? (
                              <Link2 className="size-4 shrink-0 text-ink-soft" />
                            ) : (
                              <Paperclip className="size-4 shrink-0 text-ink-soft" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
                            <span className="shrink-0 text-xs text-ink-soft">
                              {isLink ? "Link" : "Uploaded file"}
                            </span>
                            <Button
                              type="button"
                              variant="dangerGhost"
                              size="iconSm"
                              aria-label={`Remove ${name}`}
                              onClick={() => void removeFile(file)}
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-soft">
                  Save the session once, then open it again to add files.
                </p>
              )}
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}
