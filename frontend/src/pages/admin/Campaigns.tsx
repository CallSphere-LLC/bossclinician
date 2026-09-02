import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ColumnDef } from "@tanstack/react-table";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Megaphone,
  Plus,
  Send,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { Campaign } from "@/types/admin";
import { formatDateTime, formatNumber } from "@/lib/format";
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
  Textarea,
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { isoToWallClock, wallClockToIso } from "@/lib/zonedDateTime";
import {
  friendlyError,
  humanizeKey,
  pluralize,
} from "@/pages/admin/ui/friendly";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  draft: "slate",
  scheduled: "gold",
  sending: "blue",
  sent: "green",
  failed: "red",
};

/**
 * Stored status → what actually happened, in her words. The raw values are
 * one-word machine states; "failed" in particular reads like something she did
 * wrong rather than mail that never went out.
 */
const STATUS_LABEL: Record<string, string> = {
  draft: "Not sent yet",
  scheduled: "Scheduled",
  sending: "Sending now",
  sent: "Sent",
  failed: "Didn't send",
};

const AUDIENCES = [
  { key: "all_subscribers", label: "Everyone on my email list" },
  { key: "all_members", label: "Everyone with a membership" },
  { key: "leads", label: "Everyone who's enquired" },
  { key: "community", label: "Everyone in my community" },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Australia/Sydney",
];

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

function scheduledLabel(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return formatDateTime(iso);
  }
}

/** Falls back to a readable version of a group this list doesn't cover. */
function audienceLabel(key: string): string {
  return AUDIENCES.find((a) => a.key === key)?.label ?? humanizeKey(key);
}

/* --------------------------------------------------- Writing box + toolbar */

type FormatId = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";

/** Formats that wrap whatever is selected. */
const WRAPPERS: Record<"bold" | "italic", { marker: string; placeholder: string }> = {
  bold: { marker: "**", placeholder: "bold words" },
  italic: { marker: "_", placeholder: "italic words" },
};

/** Formats that act on whole lines; a numbered list needs the line's position. */
const LINE_RULES: Record<
  "heading" | "bullets" | "numbers",
  { match: RegExp; prefix: (index: number) => string }
> = {
  heading: { match: /^#{1,6}\s+/, prefix: () => "## " },
  bullets: { match: /^[-*]\s+/, prefix: () => "- " },
  numbers: { match: /^\d+\.\s+/, prefix: (index) => `${index + 1}. ` },
};

interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Writes the formatting into the stored text and says where the cursor should
 * land afterwards. The message is still Markdown on its way to the mailer —
 * that's what turns it into a formatted email — but she never types the syntax.
 *
 * Same rules as the blog editor's toolbar, deliberately: every writing box in
 * the dashboard should behave the same. It lives per screen only because the
 * shared UI kit doesn't carry a writing box yet.
 */
function applyFormat(id: FormatId, value: string, start: number, end: number): TextEdit {
  if (id === "bold" || id === "italic") {
    const { marker, placeholder } = WRAPPERS[id];
    // With nothing selected we drop in an example and select it, so her next
    // keystroke replaces it instead of leaving stray marks behind.
    const selected = value.slice(start, end) || placeholder;
    const inserted = `${marker}${selected}${marker}`;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length + selected.length,
    };
  }

  if (id === "link") {
    const text = value.slice(start, end) || "the words people click";
    const href = "https://";
    const inserted = `[${text}](${href})`;
    // Leave the address half selected: pasting the link is the very next thing
    // she'll want to do.
    const hrefStart = start + text.length + "[](".length;
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      selectionStart: hrefStart,
      selectionEnd: hrefStart + href.length,
    };
  }

  // The rest change whole lines, so grow the range to cover every line the
  // selection touches before rewriting them.
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;

  const rule = LINE_RULES[id];
  const lines = value.slice(lineStart, lineEnd).split("\n");
  // Pressing the same button again takes the formatting off, the way the list
  // button in a word processor does.
  const alreadyApplied = lines.every((line) => rule.match.test(line));
  const rewritten = lines
    .map((line, index) => {
      const bare = line.replace(rule.match, "");
      return alreadyApplied ? bare : rule.prefix(index) + bare;
    })
    .join("\n");

  return {
    value: value.slice(0, lineStart) + rewritten + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + rewritten.length,
  };
}

const TOOLBAR: { id: FormatId; label: string; Icon: LucideIcon }[] = [
  { id: "bold", label: "Bold", Icon: Bold },
  { id: "italic", label: "Italic", Icon: Italic },
  { id: "heading", label: "Heading", Icon: Heading2 },
  { id: "bullets", label: "Bulleted list", Icon: List },
  { id: "numbers", label: "Numbered list", Icon: ListOrdered },
  { id: "link", label: "Add a link", Icon: Link2 },
];

function BodyEditor({
  value,
  onChange,
  rows = 12,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState(false);

  // A controlled textarea puts the caret back at the end after every re-render,
  // which would throw her cursor to the bottom each time she used the toolbar.
  useLayoutEffect(() => {
    const range = pendingSelection.current;
    const el = ref.current;
    if (!range || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(range[0], range[1]);
  });

  function runFormat(id: FormatId) {
    const el = ref.current;
    if (!el) return;
    const edit = applyFormat(id, el.value, el.selectionStart, el.selectionEnd);
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    onChange(edit.value);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-hairline bg-white/[0.04] p-1">
        {!preview &&
          TOOLBAR.map(({ id, label, Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              size="iconSm"
              title={label}
              aria-label={label}
              onClick={() => runFormat(id)}
            >
              <Icon />
            </Button>
          ))}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant={preview ? "ghost" : "secondary"}
            size="sm"
            onClick={() => setPreview(false)}
          >
            Write
          </Button>
          <Button
            type="button"
            variant={preview ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPreview(true)}
          >
            See how it looks
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="prose-boss min-h-[14rem] rounded-xl border border-hairline bg-white/[0.03] p-4">
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="text-sm text-ink-soft">
              Nothing written yet — switch to Write and start typing.
            </p>
          )}
        </div>
      ) : (
        <Textarea
          ref={ref}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Screen */

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Campaign> | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .growthList<Campaign>("campaigns")
      .then(setCampaigns)
      .catch(() => setError("We couldn't load your emails. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  // Live count of how many people the draft would reach.
  useEffect(() => {
    if (!draft?.audience) {
      setAudienceCount(null);
      return;
    }
    let cancelled = false;
    setAudienceCount(null);
    adminApi
      .audienceCount(draft.audience)
      .then((r) => !cancelled && setAudienceCount(r.count))
      .catch(() => !cancelled && setAudienceCount(null));
    return () => {
      cancelled = true;
    };
  }, [draft?.audience]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft?.name?.trim()) return;
    if (
      draft.scheduledAt &&
      (!Number.isFinite(Date.parse(draft.scheduledAt)) ||
        Date.parse(draft.scheduledAt) <= Date.now() + 60_000)
    ) {
      toast.error("Choose a send time at least one minute from now.");
      return;
    }
    try {
      const { scheduledAt, status: _status, ...content } = draft;
      let campaign: Campaign;
      if (draft.id) campaign = await adminApi.growthUpdate<Campaign>("campaigns", draft.id, content);
      else {
        campaign = await adminApi.growthCreate<Campaign>("campaigns", { ...content, status: "draft" });
        // If the scheduling request fails after creation, a retry updates this
        // draft instead of creating a second email with the same content.
        setDraft((current) => current ? { ...current, id: campaign.id, status: "draft" } : current);
      }

      if (scheduledAt) {
        const timezone = draft.timezone || DEFAULT_TIMEZONE;
        await adminApi.campaignSchedule(campaign.id, scheduledAt, timezone);
        toast.success(`Email scheduled for ${scheduledLabel(scheduledAt, timezone)}`);
      } else if (draft.id && draft.status === "scheduled") {
        await adminApi.campaignCancelSchedule(draft.id);
        toast.success("Scheduled send cancelled; the email is a draft again");
      } else {
        toast.success("Email saved");
      }
      setDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "email"));
    }
  }

  async function sendTest() {
    if (!draft?.subject?.trim()) {
      toast.error("Add a subject before sending a test.");
      return;
    }
    try {
      const result = await adminApi.campaignTest({
        subject: draft.subject,
        bodyMd: draft.bodyMd ?? "",
      });
      toast.success(`Test sent to ${result.to}`);
    } catch (err) {
      toast.error(friendlyError(err, "test email"));
    }
  }

  const send = useCallback(
    async (campaign: Campaign) => {
      // A failed lookup used to read as zero, which put "Send to 0 people" on
       // the button of a send that goes to the whole list.
      const count = await adminApi
        .audienceCount(campaign.audience)
        .then((r) => r.count)
        .catch(() => null);

      if (count === null) {
        toast.error("We couldn't work out who this would go to — try again in a moment.");
        return;
      }

      const ok = await confirm({
        title: `Send “${campaign.name}”?`,
        description: `This goes to ${pluralize(count, "person", "people")} — ${audienceLabel(
          campaign.audience,
        ).toLowerCase()}. Once it's gone you can't take it back.`,
        confirmLabel: `Send to ${pluralize(count, "person", "people")}`,
      });
      if (!ok) return;

      try {
        const result = await adminApi.campaignSend(campaign.id);
        toast.success(
          `Sending to ${pluralize(result.queued, "person", "people")} — this takes a few minutes.`,
        );
        load();
        // The numbers below fill in as the sending works through the list.
        window.setTimeout(load, 4000);
      } catch (err) {
        toast.error(friendlyError(err, "email"));
      }
    },
    [confirm, load],
  );

  const remove = useCallback(
    async (campaign: Campaign) => {
      const ok = await confirm({
        title: `Delete “${campaign.name}”?`,
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;
      try {
        await adminApi.growthDelete("campaigns", campaign.id);
        toast.success("Email deleted");
        load();
      } catch (err) {
        toast.error(friendlyError(err, "email"));
      }
    },
    [confirm, load],
  );

  const columns = useMemo<ColumnDef<Campaign, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Email",
        cell: ({ row }) => (
          <button type="button" onClick={() => setDraft(row.original)} className="min-w-0 text-left">
            <span className="block truncate font-semibold text-ink">{row.original.name}</span>
            <span className="block truncate text-xs text-ink-soft">
              {row.original.subject || "No subject line yet"}
            </span>
          </button>
        ),
      },
      {
        accessorKey: "audience",
        header: "Who gets it",
        cell: ({ row }) => (
          <Badge tone="plum">
            <Users className="size-3" />
            {audienceLabel(row.original.audience)}
          </Badge>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={STATUS_TONE[row.original.status] ?? "neutral"}>
            {STATUS_LABEL[row.original.status] ?? humanizeKey(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "delivery",
        header: "How it went",
        cell: ({ row }) =>
          row.original.status === "sent" ? (
            <span className="text-sm text-ink-soft">
              <strong className="text-ink">{formatNumber(row.original.deliveredCount)}</strong>{" "}
              arrived
              {row.original.failedCount > 0 && (
                <span className="text-red-300">
                  {" "}
                  · {formatNumber(row.original.failedCount)} didn't
                </span>
              )}
            </span>
          ) : row.original.status === "scheduled" && row.original.scheduledAt ? (
            <span className="text-sm text-gold">
              Sends {scheduledLabel(row.original.scheduledAt, row.original.timezone || DEFAULT_TIMEZONE)}
            </span>
          ) : (
            <span className="text-xs text-ink-soft/70">Not sent yet</span>
          ),
      },
      {
        accessorKey: "sentAt",
        header: "Date sent",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-ink-soft">
            {row.original.sentAt ? formatDateTime(row.original.sentAt) : "Not sent yet"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            {row.original.status !== "sent" && row.original.status !== "sending" && (
              <Button size="sm" onClick={() => send(row.original)}>
                <Send />
                Send
              </Button>
            )}
            {row.original.status === "scheduled" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await adminApi.campaignCancelSchedule(row.original.id);
                    toast.success("Scheduled send cancelled");
                    load();
                  } catch (err) {
                    toast.error(friendlyError(err, "email"));
                  }
                }}
              >
                Cancel schedule
              </Button>
            )}
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete ${row.original.name}`}
              onClick={() => remove(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    [send, remove],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Email Campaigns"
        description="Write one email and send it to your subscribers, members or enquiries."
        actions={
          <Button size="sm" onClick={() => setDraft({ audience: "all_subscribers", status: "draft", timezone: DEFAULT_TIMEZONE })}>
            <Plus />
            Write an email
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={campaigns}
        searchPlaceholder="Search your emails…"
        itemNoun={{ one: "email", many: "emails" }}
        minWidth="880px"
        emptyState={
          <EmptyState
            icon={<Megaphone />}
            title="No emails yet"
            description="Write one and send it to your subscribers, members or enquiries."
            action={
              <Button
                size="sm"
                onClick={() => setDraft({ audience: "all_subscribers", status: "draft", timezone: DEFAULT_TIMEZONE })}
              >
                Write an email
              </Button>
            }
          />
        }
      />

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? "Edit email" : "New email"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="campaign-form">
              Save email
            </Button>
          </>
        }
      >
        {draft && (
          <form id="campaign-form" onSubmit={save} className="space-y-4">
            <Field
              label="Name it for yourself"
              hint="just so you can find it — nobody else sees this"
            >
              <Input
                value={draft.name ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="March launch — waitlist"
                required
                autoFocus
              />
            </Field>

            <Field label="Who should get this?">
              <select
                value={draft.audience ?? "all_subscribers"}
                onChange={(e) => setDraft((d) => ({ ...d, audience: e.target.value }))}
                className={selectStyles}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="rounded-xl border border-hairline bg-cream/60 px-4 py-3 text-sm">
              {audienceCount === null ? (
                <span className="text-ink-soft">Working out how many people…</span>
              ) : (
                <span className="text-ink">
                  <strong className="font-display text-lg text-plum">
                    {formatNumber(audienceCount)}
                  </strong>{" "}
                  <span className="text-ink-soft">
                    {audienceCount === 1 ? "person will get this" : "people will get this"}
                  </span>
                </span>
              )}
            </div>

            <Field label="Subject line" hint="what people see in their inbox">
              <Input
                value={draft.subject ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                placeholder="Doors are open"
              />
            </Field>

            <Field
              label="Preview line"
              hint="the grey line under the subject in their inbox"
            >
              <Input
                value={draft.previewText ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, previewText: e.target.value }))}
              />
            </Field>

            <Field label="Your message">
              <BodyEditor
                value={draft.bodyMd ?? ""}
                onChange={(next) => setDraft((d) => ({ ...d, bodyMd: next }))}
                placeholder={"Hi there,\n\nI wanted to tell you about…"}
              />
            </Field>

            <Field
              label="Send later"
              hint="optional"
            >
              <Input
                type="datetime-local"
                min={isoToWallClock(
                  new Date(Date.now() + 60_000).toISOString(),
                  draft.timezone || DEFAULT_TIMEZONE,
                )}
                value={isoToWallClock(draft.scheduledAt, draft.timezone || DEFAULT_TIMEZONE)}
                onChange={(e) =>
                  setDraft((d) => {
                    if (!e.target.value) return { ...d, scheduledAt: null };
                    const scheduledAt = wallClockToIso(
                      e.target.value,
                      d?.timezone || DEFAULT_TIMEZONE,
                    );
                    if (!scheduledAt) {
                      toast.error("That local time does not exist because the clock changes then.");
                      return d;
                    }
                    return { ...d, scheduledAt };
                  })
                }
              />
            </Field>

            <Field label="Send timezone">
              <select
                className={selectStyles}
                value={draft.timezone || DEFAULT_TIMEZONE}
                onChange={(event) => {
                  const oldZone = draft.timezone || DEFAULT_TIMEZONE;
                  const wallClock = isoToWallClock(draft.scheduledAt, oldZone);
                  const timezone = event.target.value;
                  setDraft((current) => ({
                    ...current,
                    timezone,
                    scheduledAt: wallClock ? wallClockToIso(wallClock, timezone) : null,
                  }));
                }}
              >
                {(TIMEZONES.includes(draft.timezone || DEFAULT_TIMEZONE)
                  ? TIMEZONES
                  : [draft.timezone || DEFAULT_TIMEZONE, ...TIMEZONES]
                ).map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
              </select>
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white/[0.03] p-3">
              <span className="text-sm text-ink-soft">
                Check the subject and formatting in your own inbox before sending.
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => void sendTest()}>
                <Send />
                Send me a test
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">What happens when you send</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
          Sending takes a few minutes for a big list, and the numbers above fill in as it goes. It's
          safe to close this page — sending carries on without you.
        </p>
      </Card>

      {confirmDialog}
    </div>
  );
}
