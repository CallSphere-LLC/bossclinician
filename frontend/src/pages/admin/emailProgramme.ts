import type { Campaign } from "@/types/admin";
import type { SequenceSummary } from "@/lib/marketingApi";

/**
 * A3. Broadcasts and sequences as one list — the whole email programme.
 *
 * They were split across two pages, so "what is going out to people" could not
 * be seen in one place. The rows here are the merge, with one status
 * vocabulary across both kinds, and the filters are read from and written to
 * the URL so a link (the Marketing Overview's tiles, a bookmark) can open the
 * list already narrowed.
 *
 * Pure and DOM-free, so the node test suite can pin it.
 */

export const PROGRAMME_TYPES = ["broadcast", "sequence"] as const;
export type ProgrammeType = (typeof PROGRAMME_TYPES)[number];

export const PROGRAMME_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "paused",
  "failed",
  "archived",
] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

export const PROGRAMME_TYPE_LABEL: Record<ProgrammeType, string> = {
  broadcast: "Broadcast",
  sequence: "Sequence",
};

export const PROGRAMME_STATUS_LABEL: Record<ProgrammeStatus, string> = {
  draft: "Not sent yet",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  paused: "Paused",
  failed: "Didn't send",
  archived: "Put away",
};

/** Which statuses each kind can actually be in, so the filter never offers an empty one. */
const STATUSES_BY_TYPE: Record<ProgrammeType, ProgrammeStatus[]> = {
  broadcast: ["draft", "scheduled", "sending", "sent", "failed"],
  sequence: ["draft", "sending", "paused", "archived"],
};

export function statusOptionsFor(type: ProgrammeType | ""): ProgrammeStatus[] {
  if (!type) return [...PROGRAMME_STATUSES];
  return STATUSES_BY_TYPE[type];
}

export type ProgrammeRow =
  | {
      key: string;
      type: "broadcast";
      name: string;
      folder: string;
      status: ProgrammeStatus;
      /** For ordering: the most recent thing that happened to it. */
      sortAt: string;
      campaign: Campaign;
    }
  | {
      key: string;
      type: "sequence";
      name: string;
      folder: string;
      status: ProgrammeStatus;
      sortAt: string;
      sequence: SequenceSummary;
    };

export function campaignProgrammeStatus(status: string): ProgrammeStatus {
  return (["draft", "scheduled", "sending", "sent", "failed"] as const).includes(
    status as "draft",
  )
    ? (status as ProgrammeStatus)
    : "draft";
}

/** A sequence that is switched on is, from where she sits, sending. */
export function sequenceProgrammeStatus(status: string): ProgrammeStatus {
  if (status === "active") return "sending";
  if (status === "paused") return "paused";
  if (status === "archived") return "archived";
  return "draft";
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * "6 emails over 11 days" — how a sequence reads inline among broadcasts.
 *
 * Counts the emails that actually go out and adds up their waits (each wait is
 * from the email before, so the sum is the span from joining to the last one).
 */
export function sequenceSpan(sequence: Pick<SequenceSummary, "emailCount"> & {
  enabledEmailCount?: number;
  totalDelayMinutes?: number;
}): string {
  const count = sequence.enabledEmailCount ?? sequence.emailCount;
  const minutes = Math.max(0, sequence.totalDelayMinutes ?? 0);
  if (count === 0) {
    return sequence.emailCount > 0
      ? `${plural(sequence.emailCount, "email", "emails")}, all switched off`
      : "No emails yet";
  }
  const emails = plural(count, "email", "emails");
  if (minutes === 0) return count === 1 ? `${emails}, sent when they join` : `${emails}, all on day one`;
  if (minutes < 1440) return `${emails} over ${plural(Math.max(1, Math.round(minutes / 60)), "hour", "hours")}`;
  return `${emails} over ${plural(Math.round(minutes / 1440), "day", "days")}`;
}

export function mergeProgramme(
  campaigns: Campaign[],
  sequences: SequenceSummary[],
): ProgrammeRow[] {
  const rows: ProgrammeRow[] = [
    ...campaigns.map((campaign) => ({
      key: `broadcast:${campaign.id}`,
      type: "broadcast" as const,
      name: campaign.name,
      folder: campaign.folder ?? "",
      status: campaignProgrammeStatus(campaign.status),
      sortAt: campaign.sentAt ?? campaign.scheduledAt ?? campaign.createdAt ?? "",
      campaign,
    })),
    ...sequences.map((sequence) => ({
      key: `sequence:${sequence.id}`,
      type: "sequence" as const,
      name: sequence.name,
      folder: sequence.folder ?? "",
      status: sequenceProgrammeStatus(sequence.status),
      sortAt: sequence.updatedAt ?? "",
      sequence,
    })),
  ];
  // Newest first. ISO strings compare correctly as strings; a missing date sorts last.
  return rows.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0));
}

export interface ProgrammeFilters {
  type: ProgrammeType | "";
  status: ProgrammeStatus | "";
  folder: string;
}

export function filterProgramme(rows: ProgrammeRow[], filters: ProgrammeFilters): ProgrammeRow[] {
  return rows.filter(
    (row) =>
      (!filters.type || row.type === filters.type) &&
      (!filters.status || row.status === filters.status) &&
      (!filters.folder || row.folder === filters.folder),
  );
}

export function programmeFolders(rows: ProgrammeRow[]): string[] {
  return [...new Set(rows.map((row) => row.folder).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Reads `?type=&status=&folder=`. Unknown values are ignored rather than
 * producing an empty list nobody can explain. A few obvious aliases are
 * accepted, because a deep link written from outside this file will guess.
 */
export function readProgrammeFilters(params: URLSearchParams): ProgrammeFilters {
  const rawType = (params.get("type") ?? "").toLowerCase();
  const type: ProgrammeType | "" =
    rawType === "broadcast" || rawType === "broadcasts" || rawType === "campaign" || rawType === "campaigns"
      ? "broadcast"
      : rawType === "sequence" || rawType === "sequences"
        ? "sequence"
        : "";
  const rawStatus = (params.get("status") ?? "").toLowerCase();
  const status: ProgrammeStatus | "" =
    rawStatus === "active"
      ? "sending"
      : (PROGRAMME_STATUSES as readonly string[]).includes(rawStatus)
        ? (rawStatus as ProgrammeStatus)
        : "";
  return { type, status, folder: params.get("folder") ?? "" };
}

/**
 * The inverse of readProgrammeFilters, leaving out whatever is unset.
 *
 * Writes the URL contract other screens link with (the Marketing Overview's
 * tiles): `type=campaign|sequence`, `status=<ProgrammeStatus>`, `folder=<name>`.
 * "Broadcast" is the label on screen; `campaign` is the word in the address,
 * because the route is /campaigns.
 */
export function writeProgrammeFilters(
  params: URLSearchParams,
  filters: ProgrammeFilters,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const values = {
    type: filters.type === "broadcast" ? "campaign" : filters.type,
    status: filters.status,
    folder: filters.folder,
  };
  for (const key of ["type", "status", "folder"] as const) {
    if (values[key]) next.set(key, values[key]);
    else next.delete(key);
  }
  return next;
}

/**
 * `?status=` on the sequences page, in that page's own status words.
 * Accepts the combined list's vocabulary too, so one link shape works on both.
 */
export function readSequenceStatusParam(
  params: URLSearchParams,
): "draft" | "active" | "paused" | "archived" | "" {
  const raw = (params.get("status") ?? "").toLowerCase();
  if (raw === "active" || raw === "sending") return "active";
  if (raw === "draft" || raw === "paused" || raw === "archived") return raw;
  return "";
}
