import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Megaphone,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { contactsApi, type Segment, type Tag } from "@/lib/contactsApi";
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
  type BadgeProps,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import EmailComposer from "@/components/admin/EmailComposer";
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

function chosenAudience(campaign: Partial<Campaign>): string {
  if (campaign.segmentId) return `segment:${campaign.segmentId}`;
  if (campaign.includeTagIds?.length) return `tag:${campaign.includeTagIds[0]}`;
  return campaign.audience ?? "all_subscribers";
}

function campaignAudienceLabel(campaign: Partial<Campaign>, segments: Segment[], tags: Tag[]): string {
  if (campaign.segmentId) {
    return segments.find((segment) => segment.id === campaign.segmentId)?.name ?? "Saved group";
  }
  if (campaign.includeTagIds?.length) {
    const names = campaign.includeTagIds
      .map((id) => tags.find((tag) => tag.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? `Tagged ${names.join(" or ")}` : "Tagged contacts";
  }
  return audienceLabel(campaign.audience ?? "all_subscribers");
}

/* ------------------------------------------------------------------ Screen */

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Campaign> | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folderFilter, setFolderFilter] = useState("");
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .growthList<Campaign>("campaigns")
      .then(setCampaigns)
      .catch(() => setError("We couldn't load your emails. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    contactsApi.segments().then(setSegments).catch(() => setSegments([]));
    contactsApi.tags().then(setTags).catch(() => setTags([]));
  }, []);

  // Live count of how many people the draft would reach.
  useEffect(() => {
    if (!draft?.audience) {
      setAudienceCount(null);
      return;
    }
    let cancelled = false;
    setAudienceCount(null);
    adminApi
      .audienceCount({
        audience: draft.audience,
        segmentId: draft.segmentId,
        includeTagIds: draft.includeTagIds,
        excludeSegmentIds: draft.excludeSegmentIds,
        excludeTagIds: draft.excludeTagIds,
      })
      .then((r) => !cancelled && setAudienceCount(r.count))
      .catch(() => !cancelled && setAudienceCount(null));
    return () => {
      cancelled = true;
    };
  }, [
    draft?.audience,
    draft?.segmentId,
    draft?.includeTagIds?.join(","),
    draft?.excludeSegmentIds?.join(","),
    draft?.excludeTagIds?.join(","),
  ]);

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
        .audienceCount(campaign)
        .then((r) => r.count)
        .catch(() => null);

      if (count === null) {
        toast.error("We couldn't work out who this would go to — try again in a moment.");
        return;
      }

      const ok = await confirm({
        title: `Send “${campaign.name}”?`,
        description: `This goes to ${pluralize(count, "person", "people")} — ${audienceLabel(
          campaignAudienceLabel(campaign, segments, tags),
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
    [confirm, load, segments, tags],
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
        accessorKey: "folder",
        header: "Folder",
        cell: ({ row }) => row.original.folder
          ? <Badge tone="slate">{row.original.folder}</Badge>
          : <span className="text-sm text-ink-soft">Unfiled</span>,
      },
      {
        accessorKey: "audience",
        header: "Who gets it",
        cell: ({ row }) => (
          <Badge tone="plum">
            <Users className="size-3" />
            {campaignAudienceLabel(row.original, segments, tags)}
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
    [send, remove, segments, tags],
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
        data={folderFilter ? campaigns?.filter((campaign) => campaign.folder === folderFilter) ?? null : campaigns}
        searchPlaceholder="Search your emails…"
        itemNoun={{ one: "email", many: "emails" }}
        minWidth="960px"
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

      {(campaigns?.some((campaign) => campaign.folder) || folderFilter) && (
        <div className="flex items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] p-3">
          <label className="text-sm font-medium text-ink" htmlFor="campaign-folder-filter">Folder</label>
          <select
            id="campaign-folder-filter"
            className={`${selectStyles} max-w-xs`}
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
          >
            <option value="">Every folder</option>
            {[...new Set((campaigns ?? []).map((campaign) => campaign.folder).filter(Boolean))]
              .sort()
              .map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        </div>
      )}

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

            <Field label="Folder" hint="optional — emails with the same folder can be filtered together">
              <Input
                value={draft.folder ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, folder: event.target.value }))}
                placeholder="Launch emails"
              />
            </Field>

            <Field label="Who should get this?">
              <select
                value={chosenAudience(draft)}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((current) => {
                    if (value.startsWith("segment:")) {
                      return {
                        ...current,
                        segmentId: Number(value.slice(8)),
                        includeTagIds: [],
                      };
                    }
                    if (value.startsWith("tag:")) {
                      return {
                        ...current,
                        segmentId: null,
                        includeTagIds: [Number(value.slice(4))],
                      };
                    }
                    return { ...current, audience: value, segmentId: null, includeTagIds: [] };
                  });
                }}
                className={selectStyles}
              >
                <optgroup label="Built-in audiences">
                  {AUDIENCES.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </optgroup>
                {segments.length > 0 && (
                  <optgroup label="Saved groups">
                    {segments.map((segment) => (
                      <option key={segment.id} value={`segment:${segment.id}`}>{segment.name}</option>
                    ))}
                  </optgroup>
                )}
                {tags.length > 0 && (
                  <optgroup label="People with a tag">
                    {tags.map((tag) => (
                      <option key={tag.id} value={`tag:${tag.id}`}>{tag.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </Field>

            {(segments.length > 0 || tags.length > 0) && (
              <div className="rounded-xl border border-hairline bg-white/[0.03] p-4">
                <p className="text-sm font-semibold text-ink">Leave these people out</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Exclusions are applied after the audience above, to both the count and the send.
                </p>
                {segments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {segments.map((segment) => (
                      <label key={segment.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-hairline text-plum"
                          checked={(draft.excludeSegmentIds ?? []).includes(segment.id)}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            excludeSegmentIds: event.target.checked
                              ? [...(current?.excludeSegmentIds ?? []), segment.id]
                              : (current?.excludeSegmentIds ?? []).filter((id) => id !== segment.id),
                          }))}
                        />
                        Group: {segment.name}
                      </label>
                    ))}
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {tags.map((tag) => (
                      <label key={tag.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          className="size-4 rounded border-hairline text-plum"
                          checked={(draft.excludeTagIds ?? []).includes(tag.id)}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            excludeTagIds: event.target.checked
                              ? [...(current?.excludeTagIds ?? []), tag.id]
                              : (current?.excludeTagIds ?? []).filter((id) => id !== tag.id),
                          }))}
                        />
                        Tag: {tag.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

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

            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-hairline px-3 text-sm text-ink">
              <input
                type="checkbox"
                className="size-5 rounded border-hairline text-plum focus-visible:ring-plum/30"
                checked={(draft.abSplitPercent ?? 0) > 0}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  abSplitPercent: event.target.checked ? 50 : 0,
                  subjectB: event.target.checked ? current?.subjectB ?? "" : "",
                }))}
              />
              Test a second subject line
            </label>

            {(draft.abSplitPercent ?? 0) > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Field label="Subject line B" hint="compare this with the original subject">
                  <Input
                    value={draft.subjectB ?? ""}
                    onChange={(event) => setDraft((current) => ({ ...current, subjectB: event.target.value }))}
                    placeholder="A different way to say it"
                    required
                  />
                </Field>
                <Field label="Gets version B">
                  <select
                    className={selectStyles}
                    value={draft.abSplitPercent ?? 50}
                    onChange={(event) => setDraft((current) => ({ ...current, abSplitPercent: Number(event.target.value) }))}
                  >
                    <option value={25}>25%</option>
                    <option value={50}>50%</option>
                    <option value={75}>75%</option>
                  </select>
                </Field>
              </div>
            )}

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
              <EmailComposer
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
