import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * The form builder's client.
 *
 * A form is a list of questions, what happens when somebody sends it, and where
 * each answer lands on their contact record. The last of those is the field
 * every builder skips and every owner then asks for: an answer stored under a
 * name nothing else knows is an answer nobody can build a follow-up from.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await sessionFetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const parsed = (await res.json()) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const body = (data: unknown): RequestInit["body"] => JSON.stringify(data);

/* ── Shapes ─────────────────────────────────────────────────────────────── */

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "select"
  | "radio"
  | "checkbox"
  | "checkboxes"
  | "date"
  | "hidden"
  | "file";

export type { ShowIf, ConditionOperator, FileCategory } from "@/lib/formLogic";

export interface FormField {
  /**
   * The name the answers are filed under. Generated from the label once, then
   * left alone — renaming a question must not orphan the answers already given.
   */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  /** Contact detail this answer is saved to, or "" to leave it on the form only. */
  contactField?: string;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string;
  /** Show this question only when an earlier question's answer meets a test. */
  showIf?: import("@/lib/formLogic").ShowIf | null;
  /** File questions: the kinds of file accepted. */
  fileTypes?: import("@/lib/formLogic").FileCategory[];
  /** File questions: the largest file, in MB (10 at most). */
  maxSizeMb?: number;
}

export type PostAction = "message" | "redirect" | "download";

export interface FormSummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  published: boolean;
  views: number;
  submitCount: number;
  postAction: PostAction;
  fieldCount: number;
  submissionCount: number;
  updatedAt: string;
}

export interface FormDetail extends FormSummary {
  descriptionMd: string;
  fields: FormField[];
  submitLabel: string;
  successMessage: string;
  redirectUrl: string;
  downloadProductFileId: number | null;
  downloadFileName: string | null;
  applyTagIds: number[];
  applyTags: { id: number; name: string }[];
  subscribeSequenceId: number | null;
  sequenceName: string | null;
  spamProtection: "honeypot" | "turnstile" | "recaptcha";
  doubleOptIn: boolean;
  createLead: boolean;
}

export interface FormDraft {
  name?: string;
  description?: string;
  descriptionMd?: string;
  fields?: FormField[];
  submitLabel?: string;
  successMessage?: string;
  postAction?: PostAction;
  redirectUrl?: string;
  downloadProductFileId?: number | null;
  applyTagIds?: number[];
  subscribeSequenceId?: number | null;
  doubleOptIn?: boolean;
  createLead?: boolean;
  published?: boolean;
}

export interface FormSubmission {
  id: number;
  data: Record<string, unknown>;
  email: string;
  createdAt: string;
  confirmedAt: string | null;
  contactId: number | null;
  contactName: string | null;
  /** Files this reply brought in. Absent from a server that predates file questions. */
  files?: SentFile[];
}

/**
 * A file somebody sent through a form. `previewUrl` is a signed link minted for
 * this administrator; it stops working after two hours, so fetch it fresh
 * rather than storing it.
 */
export interface SentFile {
  id: number;
  name: string;
  mime: string;
  kind: string;
  sizeBytes: number;
  createdAt: string;
  contactId: number | null;
  submissionId: number | null;
  fieldKey: string;
  formId: number | null;
  formName: string | null;
  previewUrl: string;
}

/**
 * What a write returns: the stored row alone. The tag names, the sequence name,
 * the download's filename and the two counts are joins and subqueries that
 * `get` pays for and a save does not, so merging one of these into the editor's
 * state as if it were the full shape would empty those fields on screen.
 */
export type SavedForm = Omit<
  FormDetail,
  "applyTags" | "sequenceName" | "downloadFileName" | "fieldCount" | "submissionCount"
>;

export const formsApi = {
  list: () => request<FormSummary[]>("/admin/forms-v2"),
  get: (id: number) => request<FormDetail>(`/admin/forms-v2/${id}`),
  create: (draft: FormDraft & { name: string }) =>
    request<SavedForm>("/admin/forms-v2", { method: "POST", body: body(draft) }),
  update: (id: number, draft: FormDraft) =>
    request<SavedForm>(`/admin/forms-v2/${id}`, { method: "PATCH", body: body(draft) }),
  remove: (id: number) => request<void>(`/admin/forms-v2/${id}`, { method: "DELETE" }),

  submissions: (id: number, offset = 0, sinceDays: number | null = null) =>
    request<{ total: number; submissions: FormSubmission[] }>(
      `/admin/forms-v2/${id}/submissions?offset=${offset}${sinceDays ? `&since=${sinceDays}d` : ""}`,
    ),
  removeSubmission: (id: number, submissionId: number) =>
    request<void>(`/admin/forms-v2/${id}/submissions/${submissionId}`, { method: "DELETE" }),

  /** Every file one contact has sent through any form, newest first. */
  contactFiles: (contactId: number) =>
    request<SentFile[]>(`/admin/forms-v2/contacts/${contactId}/files`),

  /**
   * Bypasses `request` because the answer is a spreadsheet, not JSON — the
   * shared helper would try to parse it and throw the file away.
   *
   * Cookie transport refreshes an expired session before saving the file.
   */
  exportCsv: async (id: number): Promise<Blob> => {
    const res = await sessionFetch(`${API_BASE}/admin/forms-v2/${id}/submissions.csv`);
    if (!res.ok) {
      throw new ApiError("That download didn't finish. Please try again in a moment.", res.status);
    }
    return res.blob();
  },
};

/**
 * Hands a fetched spreadsheet to the browser as a save dialog.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * has not started reading it when the click returns, and revoking too early
 * gives a download that silently produces nothing.
 */
export function saveCsv(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ── Wording ────────────────────────────────────────────────────────────── */

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: "Short answer",
  textarea: "Long answer",
  email: "Email address",
  phone: "Phone number",
  number: "A number",
  select: "Choose one from a list",
  radio: "Choose one",
  checkbox: "A single tick box",
  checkboxes: "Tick any that apply",
  date: "A date",
  hidden: "Hidden (filled in for them)",
  file: "Upload a file",
};

/** The contact details an answer can be saved onto, in her words. */
export const CONTACT_FIELD_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Keep it on the form only" },
  { value: "firstName", label: "Their first name" },
  { value: "lastName", label: "Their last name" },
  { value: "email", label: "Their email address" },
  { value: "phone", label: "Their phone number" },
  { value: "timezone", label: "Their timezone" },
];

export const POST_ACTION_LABEL: Record<PostAction, string> = {
  message: "Show them a thank-you message",
  redirect: "Send them to another page",
  download: "Give them a file to download",
};

/**
 * `?since=30d` on the builder's URL → 30, or null for no filter. Same rule as
 * `parseSinceDays` in backend/src/routes/admin/formsV2.ts.
 *
 * The link shape other screens use: /admin/marketing/forms-v2?form=<id>&since=30d
 */
export function sinceDaysFrom(value: string | null): number | null {
  const match = /^(\d{1,4})d$/.exec((value ?? "").trim());
  if (!match) return null;
  const days = Number(match[1]);
  return days >= 1 && days <= 3650 ? days : null;
}

/** Types that need a list of choices before they mean anything. */
export function needsOptions(type: FieldType): boolean {
  return type === "select" || type === "radio" || type === "checkboxes";
}
