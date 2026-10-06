import type { Campaign } from "@/types/admin";
import type { SequenceSummary } from "@/lib/marketingApi";

/**
 * Sheet row 67. Broadcasts, sequences and event emails as one list — the
 * Kajabi "Email Campaigns" page.
 *
 * Email Sequences used to be a page of its own; the client asked for one list
 * where "New Email Campaign" offers the two kinds, the way Kajabi does it. The
 * rows, the status words (Kajabi's: Draft, Scheduled, Active, In Progress,
 * Sent, Delivered) and the URL filters all live here, pure and DOM-free.
 */

/* ------------------------------------------------------------------ Types */

/**
 * A campaign as the list route actually returns it. The route is `SELECT *`
 * camelCased, so the columns the Kajabi import adds arrive without any change
 * to the shared `Campaign` type. `kajabiId` is a bigint, which node-postgres
 * hands over as a string.
 */
export interface CampaignRecord extends Campaign {
  kajabiId?: string | number | null;
  kajabiType?: "EmailBroadcast" | "EventOccurrenceAction" | "EmailSequence" | string | null;
  source?: "kajabi" | string | null;
  unsubscribedCount?: number | null;
}

/**
 * A sequence as the list route returns it. The route has no send statistics
 * today; if the import (or a later migration) adds them as columns they flow
 * through `SELECT q.*` and fill the stat cells, otherwise the cells read "—".
 */
export interface SequenceRecord extends SequenceSummary {
  kajabiId?: string | number | null;
  source?: "kajabi" | string | null;
  recipientCount?: number | null;
  openedCount?: number | null;
  clickedCount?: number | null;
  unsubscribedCount?: number | null;
}

export const EMAIL_KINDS = ["broadcast", "sequence", "event"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  broadcast: "Email Broadcast",
  sequence: "Email Sequence",
  event: "Event email",
};

export const EMAIL_STATUSES = [
  "draft",
  "scheduled",
  "active",
  "in_progress",
  "sent",
  "paused",
  "failed",
  "archived",
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  active: "Active",
  in_progress: "In Progress",
  sent: "Sent",
  paused: "Paused",
  failed: "Didn't send",
  archived: "Archived",
};

/** The pill's words for one row: an event email that went out is "Delivered", as in Kajabi. */
export function statusLabelFor(row: Pick<EmailRow, "kind" | "status">): string {
  if (row.kind === "event" && row.status === "sent") return "Delivered";
  return EMAIL_STATUS_LABEL[row.status];
}

/** Which statuses each kind can actually be in, so the filter never offers an empty one. */
const STATUSES_BY_KIND: Record<EmailKind, EmailStatus[]> = {
  broadcast: ["draft", "scheduled", "in_progress", "sent", "failed"],
  sequence: ["draft", "active", "paused", "archived"],
  event: ["draft", "scheduled", "active", "in_progress", "sent", "failed"],
};

export function statusOptionsFor(kind: EmailKind | ""): EmailStatus[] {
  if (!kind) return [...EMAIL_STATUSES];
  return STATUSES_BY_KIND[kind];
}

export interface EmailStats {
  /** null where the row has no figures at all (a sequence, a draft). */
  sends: number | null;
  opened: number | null;
  clicked: number | null;
  unsubscribed: number | null;
}

export type EmailRow =
  | {
      key: string;
      source: "campaign";
      kind: EmailKind;
      name: string;
      folder: string;
      status: EmailStatus;
      /** For ordering: the most recent thing that happened to it. */
      sortAt: string;
      /** Imported history from Kajabi that has already gone out: view, never edit or send. */
      readOnly: boolean;
      imported: boolean;
      stats: EmailStats;
      campaign: CampaignRecord;
    }
  | {
      key: string;
      source: "sequence";
      kind: "sequence";
      name: string;
      folder: string;
      status: EmailStatus;
      sortAt: string;
      readOnly: false;
      imported: boolean;
      stats: EmailStats;
      sequence: SequenceRecord;
    };

/* ---------------------------------------------------------------- Mapping */

export function isImported(record: { source?: string | null; kajabiId?: string | number | null }): boolean {
  return record.source === "kajabi" || (record.kajabiId !== null && record.kajabiId !== undefined);
}

/**
 * Broadcast, sequence or event email.
 *
 * An event email is one Kajabi sent from an event's reminders
 * (`EventOccurrenceAction`), or one of ours timed against an event — the
 * `event_start` / `event_registration` anchors are the same idea. A Kajabi
 * `EmailSequence` stored as a campaign row lists as a sequence.
 */
export function campaignKind(campaign: CampaignRecord): EmailKind {
  if (campaign.kajabiType === "EventOccurrenceAction") return "event";
  if (campaign.kajabiType === "EmailSequence") return "sequence";
  const anchor = campaign.anchorKind ?? "";
  if (anchor === "event" || anchor.startsWith("event_")) return "event";
  return "broadcast";
}

/**
 * Kajabi history that has already gone out is a record, not a draft: it opens
 * read-only and is never offered Send. A Kajabi sequence held as a campaign row
 * has no editor here either. Imported drafts edit like any other.
 */
export function isReadOnlyCampaign(campaign: CampaignRecord): boolean {
  if (!isImported(campaign)) return false;
  return campaign.status === "sent" || campaignKind(campaign) === "sequence";
}

export function campaignStatus(campaign: CampaignRecord): EmailStatus {
  switch (campaign.status) {
    case "scheduled":
      return "scheduled";
    case "sending":
      // A live "upon registration" email sits on `sending` for as long as it
      // is switched on — from where she sits that is Active, not mid-send.
      return campaign.anchorKind === "event_registration" ? "active" : "in_progress";
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    default:
      return "draft";
  }
}

export function sequenceStatus(status: string): EmailStatus {
  if (status === "active") return "active";
  if (status === "paused") return "paused";
  if (status === "archived") return "archived";
  return "draft";
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function campaignStats(campaign: CampaignRecord): EmailStats {
  const sends = count(campaign.recipientCount);
  // A draft that has never gone anywhere has no figures, not zero of them.
  if (sends === 0 && campaign.status !== "sent" && campaign.status !== "sending") {
    return { sends: null, opened: null, clicked: null, unsubscribed: null };
  }
  return {
    sends,
    opened: count(campaign.openedCount),
    clicked: count(campaign.clickedCount),
    unsubscribed: count(campaign.unsubscribedCount),
  };
}

function sequenceStats(sequence: SequenceRecord): EmailStats {
  if (sequence.recipientCount === undefined || sequence.recipientCount === null) {
    return { sends: null, opened: null, clicked: null, unsubscribed: null };
  }
  return {
    sends: count(sequence.recipientCount),
    opened: count(sequence.openedCount),
    clicked: count(sequence.clickedCount),
    unsubscribed: count(sequence.unsubscribedCount),
  };
}

/** "45.2%" of sends, or "—" when there were none to divide by. */
export function percentOf(part: number | null, sends: number | null): string {
  if (part === null || sends === null || sends <= 0) return "—";
  const value = (part / sends) * 100;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

export function mergeEmails(campaigns: CampaignRecord[], sequences: SequenceRecord[]): EmailRow[] {
  const rows: EmailRow[] = [
    ...campaigns.map((campaign): EmailRow => {
      return {
        key: `campaign:${campaign.id}`,
        source: "campaign",
        kind: campaignKind(campaign),
        name: campaign.name || campaign.subject || "Untitled email",
        folder: campaign.folder ?? "",
        status: campaignStatus(campaign),
        sortAt: campaign.sentAt ?? campaign.scheduledAt ?? campaign.createdAt ?? "",
        readOnly: isReadOnlyCampaign(campaign),
        imported: isImported(campaign),
        stats: campaignStats(campaign),
        campaign,
      };
    }),
    ...sequences.map((sequence): EmailRow => ({
      key: `sequence:${sequence.id}`,
      source: "sequence",
      kind: "sequence",
      name: sequence.name,
      folder: sequence.folder ?? "",
      status: sequenceStatus(sequence.status),
      sortAt: sequence.updatedAt ?? "",
      readOnly: false,
      imported: isImported(sequence),
      stats: sequenceStats(sequence),
      sequence,
    })),
  ];
  // Newest first. ISO strings compare correctly as strings; a missing date sorts last.
  return rows.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0));
}

/* ---------------------------------------------------------------- Filters */

export type EmailView = "all" | "folders";

export interface EmailFilters {
  view: EmailView;
  kind: EmailKind | "";
  status: EmailStatus | "";
  folder: string;
}

export const NO_FILTERS: Omit<EmailFilters, "view"> = { kind: "", status: "", folder: "" };

/** The name "Unfiled" stands for in the folder filter. */
export const UNFILED = "__unfiled__";

export function filterEmails(rows: EmailRow[], filters: EmailFilters): EmailRow[] {
  return rows.filter(
    (row) =>
      (!filters.kind || row.kind === filters.kind) &&
      (!filters.status || row.status === filters.status) &&
      (!filters.folder ||
        (filters.folder === UNFILED ? row.folder === "" : row.folder === filters.folder)),
  );
}

export interface FolderSummary {
  name: string;
  total: number;
  byKind: Record<EmailKind, number>;
}

/** Every folder with what is in it, A–Z, and "Unfiled" (key UNFILED) last when anything is. */
export function folderSummaries(rows: EmailRow[]): FolderSummary[] {
  const map = new Map<string, FolderSummary>();
  for (const row of rows) {
    const name = row.folder || UNFILED;
    const entry = map.get(name) ?? {
      name,
      total: 0,
      byKind: { broadcast: 0, sequence: 0, event: 0 },
    };
    entry.total += 1;
    entry.byKind[row.kind] += 1;
    map.set(name, entry);
  }
  return [...map.values()].sort((a, b) => {
    if (a.name === UNFILED) return 1;
    if (b.name === UNFILED) return -1;
    return a.name.localeCompare(b.name);
  });
}

export function folderNames(rows: EmailRow[]): string[] {
  return [...new Set(rows.map((row) => row.folder).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Reads `?view=&type=&status=&folder=`. Unknown values are ignored rather
 * than producing an empty list nobody can explain, and the older words other
 * screens link with still work: `type=campaign` (the Marketing Overview),
 * `status=sending` (the first combined list), `status=active` (the old
 * sequences page).
 */
export function readEmailFilters(params: URLSearchParams): EmailFilters {
  const rawType = (params.get("type") ?? "").toLowerCase();
  const kind: EmailKind | "" =
    rawType === "broadcast" || rawType === "broadcasts" || rawType === "campaign" || rawType === "campaigns"
      ? "broadcast"
      : rawType === "sequence" || rawType === "sequences"
        ? "sequence"
        : rawType === "event" || rawType === "events" || rawType === "event_email" || rawType === "event-email"
          ? "event"
          : "";
  const rawStatus = (params.get("status") ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const status: EmailStatus | "" =
    rawStatus === "sending" || rawStatus === "inprogress"
      ? "in_progress"
      : rawStatus === "delivered"
        ? "sent"
        : (EMAIL_STATUSES as readonly string[]).includes(rawStatus)
          ? (rawStatus as EmailStatus)
          : "";
  const view: EmailView = params.get("view") === "folders" ? "folders" : "all";
  return { view, kind, status, folder: params.get("folder") ?? "" };
}

/** The inverse of readEmailFilters, leaving out whatever is unset. */
export function writeEmailFilters(params: URLSearchParams, filters: EmailFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const values: Record<"view" | "type" | "status" | "folder", string> = {
    view: filters.view === "folders" ? "folders" : "",
    type: filters.kind,
    status: filters.status,
    folder: filters.folder,
  };
  for (const key of ["view", "type", "status", "folder"] as const) {
    if (values[key]) next.set(key, values[key]);
    else next.delete(key);
  }
  return next;
}

/* ------------------------------------------------------------------ Dates */

/** "September 26, 2026 05:00 AM" — the way Kajabi writes it under a sent email. */
export function longDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    return `${day} ${time}`;
  } catch {
    return date.toLocaleString("en-US");
  }
}

/** Whether a stored body is HTML (Kajabi's) rather than the composer's Markdown. */
export function looksLikeHtml(body: string): boolean {
  return /<(html|body|table|div|p|span|br|img|a|h[1-6]|ul|ol|td|center)\b[^>]*>/i.test(body);
}
