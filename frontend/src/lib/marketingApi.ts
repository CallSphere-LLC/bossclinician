import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * Email sequences, automations and system templates — the marketing console's
 * own client.
 *
 * Kept off `lib/api.ts` for the same reason `adminCommerceApi.ts` is: that file
 * is imported by every screen in the console, and these shapes are read by four.
 *
 * The types here are written the way the screens talk, not the way the database
 * stores things. A wait is days and hours, never a minute count; a trigger
 * carries the sentence the server composed for it, so the builder never has to
 * turn an id back into a name.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? "";
    } catch {
      // A response with no JSON body still has a status, which is the part
      // `friendlyError` actually reads.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ── Sequences ──────────────────────────────────────────────────────────── */

export interface SequenceSummary {
  id: number;
  name: string;
  slug: string;
  description: string;
  status: "draft" | "active" | "paused" | "archived";
  topic: string;
  emailCount: number;
  activeCount: number;
  completedCount: number;
  updatedAt: string;
  /** 3.1 folders; present on every row since 034. */
  folder?: string;
  /** A3: emails that actually go out, and the sum of their waits in minutes. */
  enabledEmailCount?: number;
  totalDelayMinutes?: number;
}

export interface SequenceEmail {
  id: number;
  sequenceId: number;
  position: number;
  delayMinutes: number;
  subject: string;
  previewText: string;
  bodyMd: string;
  fromName: string;
  fromEmail: string;
  enabled: boolean;
}

export interface Sequence extends SequenceSummary {
  skipWeekends: boolean;
  sendWindowStartMinute: number | null;
  sendWindowEndMinute: number | null;
  useContactTimezone: boolean;
  timezone: string;
  exitOnPurchase: boolean;
  exitTagId: number | null;
  completionTagId: number | null;
  allowReentry: boolean;
  emails: SequenceEmail[];
}

export interface SequenceSubscriber {
  id: number;
  contactId: number;
  email: string;
  name: string;
  status: string;
  position: number;
  nextSendAt: string | null;
  enteredAt: string;
  completedAt: string | null;
  exitReason: string;
}

export interface SequenceEmailStats {
  id: number;
  position: number;
  subject: string;
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
}

export interface SequenceDraft {
  name?: string;
  description?: string;
  status?: string;
  topic?: string;
  skipWeekends?: boolean;
  sendWindowStartMinute?: number | null;
  sendWindowEndMinute?: number | null;
  useContactTimezone?: boolean;
  timezone?: string;
  exitOnPurchase?: boolean;
  exitTagId?: number | null;
  completionTagId?: number | null;
  allowReentry?: boolean;
}

export interface SequenceEmailDraft {
  subject?: string;
  previewText?: string;
  bodyMd?: string;
  waitDays?: number;
  waitHours?: number;
  fromName?: string;
  fromEmail?: string;
  enabled?: boolean;
}

/* ── Automations ────────────────────────────────────────────────────────── */

export interface TriggerDescriptor {
  type: string;
  label: string;
  subjectKey: string;
  subjectSource: string;
  subjectLabel: string;
}

export interface ActionDescriptor {
  type: string;
  label: string;
}

export interface NamedOption {
  id: number;
  name: string;
}

export interface BuilderOptions {
  triggers: TriggerDescriptor[];
  actions: ActionDescriptor[];
  lists: Record<string, NamedOption[]>;
}

export interface AutomationAction {
  id: number;
  automationId: number;
  actionType: string;
  config: Record<string, unknown>;
  delayMinutes: number;
  conditions: Record<string, unknown>;
  sort: number;
  sentence: string;
}

export interface AutomationSummary {
  id: number;
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: Record<string, unknown>;
  status: "active" | "paused";
  runCount: number;
  lastRunAt: string | null;
  lastError: string;
  maxRunsPerContactPerDay: number;
  actionCount: number;
  triggerSentence: string;
  actionSentences: string[];
}

export interface Automation extends Omit<AutomationSummary, "actionSentences" | "actionCount"> {
  actions: AutomationAction[];
}

export interface AutomationRun {
  id: number;
  status: string;
  subjectEmail: string;
  contactName: string | null;
  log: string[];
  isTest: boolean;
  createdAt: string;
}

export interface AutomationDraft {
  name?: string;
  description?: string;
  triggerType?: string;
  triggerConfig?: Record<string, string | number | boolean | null>;
  conditions?: unknown;
  status?: string;
  maxRunsPerContactPerDay?: number;
}

export interface ActionDraft {
  actionType?: string;
  config?: Record<string, unknown>;
  delayMinutes?: number;
  conditions?: unknown;
}

/* ── Templates ──────────────────────────────────────────────────────────── */

export interface EmailTemplate {
  id: number;
  key: string;
  name: string;
  description: string;
  subject: string;
  bodyMd: string;
  enabled: boolean;
  updatedAt: string;
}

/* ── Marketing overview ─────────────────────────────────────────────────── */

/** GET /api/admin/marketing-overview — see backend routes/admin/marketingOverview.ts. */
export interface MarketingOverview {
  windowDays: number;
  generatedAt: string;
  emails: {
    sent: number;
    bySource: { broadcast: number; sequence: number; automation: number };
    broadcastUnlisted: number;
    opened: number;
    clicked: number;
    openRate: number | null;
    clickRate: number | null;
    notSent: number;
    notSentBySource: { broadcast: number; sequence: number; automation: number };
    notSentPeople: number;
    notSentEmails: number;
    notSentLaterSent: number;
    queued: number;
    campaignsSent: number;
    campaignsScheduled: number;
    trackingSeen: boolean;
  };
  sequences: {
    active: number;
    total: number;
    enrolled: number;
    people: number;
    top: { id: number; name: string; enrolled: number }[];
  };
  forms: {
    replies: number;
    previousReplies: number;
    formsWithReplies: number;
    top: { id: number; name: string; replies: number }[];
  };
  automations: {
    active: number;
    ran: number;
    runs: number;
    problemRuns: number;
    failedRuns: number;
    withProblems: number;
    skippedRuns: number;
    problemAutomations: { id: number; name: string; problemRuns: number }[];
  };
  events: {
    upcoming: number;
    upcomingPublished: number;
    upcomingDrafts: number;
    alwaysOn: number;
    registrations: number;
    communityUpcoming: number;
    next: { id: number; title: string; startsAt: string; published: boolean; registrations: number }[];
  };
}

/* ── The client ─────────────────────────────────────────────────────────── */

const body = (data: unknown): RequestInit["body"] => JSON.stringify(data);

export const marketingApi = {
  overview: () => request<MarketingOverview>("/admin/marketing-overview"),
  sequences: () => request<SequenceSummary[]>("/admin/sequences"),
  sequence: (id: number) => request<Sequence>(`/admin/sequences/${id}`),
  createSequence: (draft: SequenceDraft & { name: string }) =>
    request<Sequence>("/admin/sequences", { method: "POST", body: body(draft) }),
  updateSequence: (id: number, draft: SequenceDraft) =>
    request<Sequence>(`/admin/sequences/${id}`, { method: "PATCH", body: body(draft) }),
  deleteSequence: (id: number) =>
    request<void>(`/admin/sequences/${id}`, { method: "DELETE" }),

  addSequenceEmail: (id: number, draft: SequenceEmailDraft) =>
    request<SequenceEmail>(`/admin/sequences/${id}/emails`, { method: "POST", body: body(draft) }),
  updateSequenceEmail: (id: number, emailId: number, draft: SequenceEmailDraft) =>
    request<SequenceEmail>(`/admin/sequences/${id}/emails/${emailId}`, {
      method: "PATCH",
      body: body(draft),
    }),
  deleteSequenceEmail: (id: number, emailId: number) =>
    request<void>(`/admin/sequences/${id}/emails/${emailId}`, { method: "DELETE" }),
  reorderSequenceEmails: (id: number, order: number[]) =>
    request<SequenceEmail[]>(`/admin/sequences/${id}/emails/reorder`, {
      method: "POST",
      body: body({ order }),
    }),
  testSequenceEmail: (id: number, emailId: number, email: string) =>
    request<{ ok: true; sentTo: string }>(`/admin/sequences/${id}/emails/${emailId}/test`, {
      method: "POST",
      body: body({ email }),
    }),

  sequenceSubscribers: (id: number, status?: string) =>
    request<SequenceSubscriber[]>(
      `/admin/sequences/${id}/subscribers${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  sequenceStats: (id: number) => request<SequenceEmailStats[]>(`/admin/sequences/${id}/stats`),
  enrolInSequence: (id: number, email: string, name?: string) =>
    request<{ outcome: string }>(`/admin/sequences/${id}/enroll`, {
      method: "POST",
      body: body({ email, name }),
    }),
  removeFromSequence: (id: number, contactId: number) =>
    request<{ ok: boolean }>(`/admin/sequences/${id}/exit`, {
      method: "POST",
      body: body({ contactId }),
    }),

  builderOptions: () => request<BuilderOptions>("/admin/automations/options"),
  automations: () => request<AutomationSummary[]>("/admin/automations"),
  automation: (id: number) => request<Automation>(`/admin/automations/${id}`),
  createAutomation: (draft: AutomationDraft & { name: string; triggerType: string }) =>
    request<AutomationSummary>("/admin/automations", { method: "POST", body: body(draft) }),
  updateAutomation: (id: number, draft: AutomationDraft) =>
    request<AutomationSummary>(`/admin/automations/${id}`, { method: "PATCH", body: body(draft) }),
  deleteAutomation: (id: number) =>
    request<void>(`/admin/automations/${id}`, { method: "DELETE" }),

  addAction: (id: number, draft: ActionDraft & { actionType: string }) =>
    request<AutomationAction>(`/admin/automations/${id}/actions`, {
      method: "POST",
      body: body(draft),
    }),
  updateAction: (id: number, actionId: number, draft: ActionDraft) =>
    request<AutomationAction>(`/admin/automations/${id}/actions/${actionId}`, {
      method: "PATCH",
      body: body(draft),
    }),
  deleteAction: (id: number, actionId: number) =>
    request<void>(`/admin/automations/${id}/actions/${actionId}`, { method: "DELETE" }),
  reorderActions: (id: number, order: number[]) =>
    request<AutomationAction[]>(`/admin/automations/${id}/actions/reorder`, {
      method: "POST",
      body: body({ order }),
    }),

  automationRuns: (id: number) => request<AutomationRun[]>(`/admin/automations/${id}/runs`),
  testAutomation: (id: number, email: string, live = false) =>
    request<{ status: string; log: string[] }>(`/admin/automations/${id}/test`, {
      method: "POST",
      body: body({ email, live }),
    }),

  emailTemplates: () => request<EmailTemplate[]>("/admin/email-templates"),
  updateEmailTemplate: (
    key: string,
    draft: { subject?: string; bodyMd?: string; enabled?: boolean },
  ) =>
    request<EmailTemplate>(`/admin/email-templates/${key}`, {
      method: "PATCH",
      body: body(draft),
    }),
};

/* ── Small shared helpers the screens all need ──────────────────────────── */

/** Minutes → "3 days" / "6 hours" / "straight away". Never a raw number. */
export function describeWait(minutes: number): string {
  if (minutes <= 0) return "straight away";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} later`;
  }
  const days = Math.round(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"} later`;
}

/** Minutes past midnight → "9:00am". The owner never sees a minute count. */
export function describeTimeOfDay(minute: number | null): string {
  if (minute === null) return "any time";
  const hour24 = Math.floor(minute / 60);
  const minutes = String(minute % 60).padStart(2, "0");
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minutes}${suffix}`;
}

/** "09:00" ↔ minutes, for the two time inputs on the sequence settings form. */
export function minutesToTimeInput(minute: number | null): string {
  if (minute === null) return "";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function splitWait(minutes: number): { days: number; hours: number } {
  return { days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60) };
}
