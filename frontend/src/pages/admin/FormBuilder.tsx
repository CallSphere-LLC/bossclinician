import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  Inbox,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  DEFAULT_FILE_CATEGORIES,
  DEFAULT_MAX_SIZE_MB,
  FILE_CATEGORIES,
  FILE_CATEGORY_LABEL,
  FORM_UPLOAD_HARD_CAP_MB,
  MAX_FILE_QUESTIONS,
  canTrigger,
  logicProblem,
  operatorsFor,
  type ConditionOperator,
  type ShowIf,
} from "@/lib/formLogic";
import {
  CONTACT_FIELD_CHOICES,
  FIELD_TYPE_LABEL,
  POST_ACTION_LABEL,
  formsApi,
  needsOptions,
  saveCsv,
  sinceDaysFrom,
  type FieldType,
  type FormDetail,
  type FormField,
  type FormSubmission,
  type FormSummary,
  type PostAction,
} from "@/lib/formsApi";
import { contactsApi, type Tag } from "@/lib/contactsApi";
import { marketingApi, type SequenceSummary } from "@/lib/marketingApi";
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
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  fieldKey,
  friendlyError,
  pluralize,
  publishLabel,
  uniqueKey,
  webAddress,
} from "@/pages/admin/ui/friendly";

/**
 * Forms: the questions people answer, what happens when they send it, and every
 * reply that has come in.
 *
 * A form saves as one piece — the questions are a single stored list, not rows
 * — so this screen edits a working copy and writes it back on Save, rather than
 * firing a request per keystroke and leaving half a form behind if one fails.
 */

const checkboxStyles = "size-4 rounded border-hairline text-plum focus-visible:ring-plum/30";

const FIELD_TYPES = Object.keys(FIELD_TYPE_LABEL) as FieldType[];
const POST_ACTIONS = Object.keys(POST_ACTION_LABEL) as PostAction[];

/** Marks the "type a detail of your own" row in the save-to menu. */
const OWN_DETAIL = "__own__";

/**
 * Ready-made answer rules, so nobody has to write a pattern by hand.
 *
 * The stored value is a pattern the browser and the server both check; the menu
 * is the only place it is ever spelled out.
 */
const FORMAT_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Anything" },
  { value: "^[0-9]+$", label: "Numbers only" },
  { value: "^[A-Za-z' -]+$", label: "Letters only" },
  { value: "^[0-9]{5}$", label: "A five-digit ZIP code" },
];

/** What one answer looks like in a table cell. */
function answerText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    // A file answer is stored as a small record; its name is what reads.
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return String(value);
}

/** The largest-file choices offered. The server caps every one at 10 MB. */
const FILE_SIZE_CHOICES = [1, 2, 5, 10];

/* ── Showing a question only sometimes ──────────────────────────────────── */

const OPERATOR_WORDS: Record<ConditionOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  answered: "has any answer",
  one_of: "is any of",
};

function operatorWords(operator: ConditionOperator, type: FieldType | undefined): string {
  if (type === "checkbox" && operator === "answered") return "is ticked";
  if (type === "file" && operator === "answered") return "has a file attached";
  return OPERATOR_WORDS[operator];
}

function choicesOf(field: FormField | undefined): string[] {
  return (field?.options ?? []).map((option) => option.trim()).filter(Boolean);
}

/** A rule that already makes sense for this trigger, to start from. */
function startingRule(trigger: FormField): ShowIf {
  const operator = operatorsFor(trigger.type)[0];
  if (operator === "answered") return { field: trigger.key, operator };
  if (trigger.type === "checkbox") return { field: trigger.key, operator, value: "yes" };
  return { field: trigger.key, operator, value: choicesOf(trigger)[0] ?? "" };
}

/** The rule read back as a sentence, so she can check it says what she meant. */
function ruleSummary(rule: ShowIf, trigger: FormField | undefined): string {
  if (!trigger) return "The question this depended on isn't above it any more — choose another.";
  const name = `“${trigger.label || "that question"}”`;
  if (rule.operator === "answered") return `Shows once ${name} ${operatorWords(rule.operator, trigger.type)}.`;
  if (trigger.type === "checkbox") {
    return `Shows when ${name} is ${rule.value === "no" ? "not ticked" : "ticked"}.`;
  }
  if (rule.operator === "one_of") {
    const values = (rule.values ?? []).map((entry) => entry.trim()).filter(Boolean);
    return values.length > 0
      ? `Shows when ${name} is any of: ${values.join(", ")}.`
      : "Pick the answers that show this question.";
  }
  const value = (rule.value ?? "").trim();
  return value
    ? `Shows when ${name} ${operatorWords(rule.operator, trigger.type)} “${value}”.`
    : "Fill in the answer to compare with.";
}

/**
 * "Only show this question when…" — one earlier question, one test, one value.
 *
 * Only questions ABOVE this one are offered, because a visitor answers in
 * order: a question that depended on one further down would appear after they
 * had already scrolled past where it goes.
 */
function ShowIfEditor({
  field,
  earlier,
  onChange,
}: {
  field: FormField;
  earlier: FormField[];
  onChange: (changes: Partial<FormField>) => void;
}) {
  const triggers = earlier.filter(canTrigger);
  const rule = field.showIf ?? null;
  const trigger = rule ? triggers.find((candidate) => candidate.key === rule.field) : undefined;
  const choices = trigger && needsOptions(trigger.type) ? choicesOf(trigger) : [];
  const label = field.label || "this question";

  const setRule = (changes: Partial<ShowIf>) => {
    if (rule) onChange({ showIf: { ...rule, ...changes } });
  };

  return (
    <div className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3">
      <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          className={checkboxStyles}
          checked={rule !== null}
          disabled={rule === null && triggers.length === 0}
          onChange={(event) => {
            // The question right above is the likeliest trigger.
            const nearest = triggers[triggers.length - 1];
            onChange({ showIf: event.target.checked && nearest ? startingRule(nearest) : null });
          }}
        />
        Only show this question when…
      </label>

      {rule === null && triggers.length === 0 && (
        <p className="mt-1.5 text-xs text-ink-soft">
          A question can only depend on one above it. Add or move a question above this one first.
        </p>
      )}

      {rule !== null && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              className={selectStyles}
              aria-label={`The question “${label}” depends on`}
              value={trigger ? rule.field : ""}
              onChange={(event) => {
                const next = triggers.find((candidate) => candidate.key === event.target.value);
                if (next) onChange({ showIf: startingRule(next) });
              }}
            >
              {!trigger && <option value="">Choose a question…</option>}
              {triggers.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.label || "Untitled question"}
                </option>
              ))}
            </select>

            <select
              className={selectStyles}
              aria-label={`How the answer decides whether “${label}” shows`}
              value={rule.operator}
              disabled={!trigger}
              onChange={(event) => {
                const operator = event.target.value as ConditionOperator;
                const seeded = rule.value ?? (trigger?.type === "checkbox" ? "yes" : (choices[0] ?? ""));
                setRule({
                  operator,
                  value: operator === "one_of" || operator === "answered" ? undefined : seeded,
                  values:
                    operator === "one_of"
                      ? rule.values && rule.values.length > 0
                        ? rule.values
                        : rule.value
                          ? [rule.value]
                          : []
                      : undefined,
                });
              }}
            >
              {operatorsFor(trigger?.type).map((operator) => (
                <option key={operator} value={operator}>
                  {operatorWords(operator, trigger?.type)}
                </option>
              ))}
            </select>

            {trigger && rule.operator !== "answered" &&
              (trigger.type === "checkbox" ? (
                <select
                  className={selectStyles}
                  aria-label={`Whether “${trigger.label}” is ticked`}
                  value={rule.value === "no" ? "no" : "yes"}
                  onChange={(event) => setRule({ value: event.target.value })}
                >
                  <option value="yes">ticked</option>
                  <option value="no">not ticked</option>
                </select>
              ) : choices.length > 0 && rule.operator === "one_of" ? (
                <div className="grid gap-1.5 rounded-xl border border-hairline bg-white/[0.03] p-3 sm:col-span-3">
                  {choices.map((choice) => {
                    const picked = rule.values ?? [];
                    return (
                      <label key={choice} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
                        <input
                          type="checkbox"
                          className={checkboxStyles}
                          checked={picked.includes(choice)}
                          onChange={(event) =>
                            setRule({
                              values: event.target.checked
                                ? [...picked.filter((entry) => entry !== choice), choice]
                                : picked.filter((entry) => entry !== choice),
                            })
                          }
                        />
                        {choice}
                      </label>
                    );
                  })}
                </div>
              ) : choices.length > 0 ? (
                <select
                  className={selectStyles}
                  aria-label={`The answer to “${trigger.label}” that decides it`}
                  value={rule.value ?? ""}
                  onChange={(event) => setRule({ value: event.target.value })}
                >
                  {!choices.includes(rule.value ?? "") && (
                    <option value={rule.value ?? ""}>
                      {rule.value ? `${rule.value} (not a choice any more)` : "Choose an answer…"}
                    </option>
                  )}
                  {choices.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              ) : rule.operator === "one_of" ? (
                <Textarea
                  rows={3}
                  className="sm:col-span-3"
                  aria-label={`The answers to “${trigger.label}” that show it, one per line`}
                  value={(rule.values ?? []).join("\n")}
                  onChange={(event) =>
                    setRule({ values: event.target.value.split("\n").map((line) => line.trimStart()) })
                  }
                  placeholder={"One answer per line"}
                />
              ) : (
                <Input
                  aria-label={`The answer to “${trigger.label}” that decides it`}
                  value={rule.value ?? ""}
                  maxLength={200}
                  onChange={(event) => setRule({ value: event.target.value })}
                  placeholder="Type the answer"
                />
              ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">{ruleSummary(rule, trigger)}</p>
        </>
      )}
    </div>
  );
}

/* ── One question ───────────────────────────────────────────────────────── */

function FieldBlock({
  field,
  earlier,
  index,
  total,
  onChange,
  onMove,
  onDelete,
}: {
  field: FormField;
  /** The questions above this one — the only ones it may depend on. */
  earlier: FormField[];
  index: number;
  total: number;
  onChange: (changes: Partial<FormField>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const own = (field.contactField ?? "") !== "" &&
    !CONTACT_FIELD_CHOICES.some((choice) => choice.value === field.contactField);
  const knownFormat = FORMAT_CHOICES.some((choice) => choice.value === (field.pattern ?? ""));

  return (
    <li className="flex items-start gap-4 px-5 py-5">
      <div className="flex flex-col items-center gap-1 pt-1">
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={`Move “${field.label}” up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <span className="font-display text-sm text-ink-soft">{index + 1}</span>
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={`Move “${field.label}” down`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="What are you asking?" className="md:col-span-2">
            <div className="flex items-start gap-2">
              <Input
                value={field.label}
                aria-label={`Question ${index + 1}`}
                onChange={(event) => onChange({ label: event.target.value })}
                placeholder="What is your biggest challenge right now?"
              />
              <Button
                variant="dangerGhost"
                size="iconSm"
                aria-label={`Delete “${field.label}”`}
                onClick={onDelete}
              >
                <Trash2 />
              </Button>
            </div>
          </Field>

          <Field label="How do they answer?">
            <select
              className={selectStyles}
              aria-label={`How people answer “${field.label}”`}
              value={field.type}
              onChange={(event) => {
                const type = event.target.value as FieldType;
                onChange(
                  type === "file"
                    ? {
                        type,
                        // A file is attached to the contact, never written into a detail.
                        contactField: "",
                        fileTypes: field.fileTypes ?? [...DEFAULT_FILE_CATEGORIES],
                        maxSizeMb: field.maxSizeMb ?? DEFAULT_MAX_SIZE_MB,
                      }
                    : { type },
                );
              }}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </Field>

          {field.type === "file" ? (
            <Field label="Where the file goes">
              <p className="text-sm leading-relaxed text-ink-soft">
                Kept privately in your Media Library and attached to the person's contact record.
              </p>
            </Field>
          ) : (
          <Field label="Save this answer to">
            <select
              className={selectStyles}
              aria-label={`Where “${field.label}” is saved`}
              value={own ? OWN_DETAIL : (field.contactField ?? "")}
              onChange={(event) =>
                onChange({
                  contactField:
                    event.target.value === OWN_DETAIL
                      ? (field.label || "A detail of your own").slice(0, 60)
                      : event.target.value,
                })
              }
            >
              {CONTACT_FIELD_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
              <option value={OWN_DETAIL}>A detail of your own…</option>
            </select>
            {own && (
              <Input
                className="mt-2"
                aria-label={`The detail “${field.label}” is saved as`}
                value={field.contactField ?? ""}
                maxLength={60}
                onChange={(event) => onChange({ contactField: event.target.value })}
                placeholder="Practice size"
              />
            )}
          </Field>
          )}

          <Field label="A note under the question" hint="optional">
            <Input
              aria-label={`Note under “${field.label}”`}
              value={field.helpText ?? ""}
              onChange={(event) => onChange({ helpText: event.target.value })}
              placeholder="Two or three sentences is plenty."
            />
          </Field>

          {field.type !== "file" && (
          <Field label="Faint text inside the box" hint="optional">
            <Input
              aria-label={`Faint text inside “${field.label}”`}
              value={field.placeholder ?? ""}
              onChange={(event) => onChange({ placeholder: event.target.value })}
              placeholder="Type your answer here"
            />
          </Field>
          )}

          {field.type === "file" && (
            <>
              <Field label="Files they may send">
                <div className="space-y-1.5 rounded-xl border border-hairline bg-white/[0.03] p-3">
                  {FILE_CATEGORIES.map((category) => {
                    const chosen = field.fileTypes ?? DEFAULT_FILE_CATEGORIES;
                    return (
                      <label
                        key={category}
                        className="flex cursor-pointer items-center gap-2.5 text-sm text-ink"
                      >
                        <input
                          type="checkbox"
                          className={checkboxStyles}
                          checked={chosen.includes(category)}
                          onChange={(event) =>
                            onChange({
                              fileTypes: event.target.checked
                                ? [...chosen.filter((entry) => entry !== category), category]
                                : chosen.filter((entry) => entry !== category),
                            })
                          }
                        />
                        {FILE_CATEGORY_LABEL[category]}
                      </label>
                    );
                  })}
                </div>
              </Field>
              <Field label="Largest file they can send" hint={`${FORM_UPLOAD_HARD_CAP_MB} MB at most`}>
                <select
                  className={selectStyles}
                  aria-label={`Largest file for “${field.label}”`}
                  value={String(field.maxSizeMb ?? DEFAULT_MAX_SIZE_MB)}
                  onChange={(event) => onChange({ maxSizeMb: Number(event.target.value) })}
                >
                  {FILE_SIZE_CHOICES.map((mb) => (
                    <option key={mb} value={mb}>
                      {mb} MB
                    </option>
                  ))}
                  {!FILE_SIZE_CHOICES.includes(field.maxSizeMb ?? DEFAULT_MAX_SIZE_MB) && (
                    <option value={field.maxSizeMb}>{field.maxSizeMb} MB</option>
                  )}
                </select>
              </Field>
            </>
          )}

          {needsOptions(field.type) && (
            <Field
              label="The choices they pick from"
              hint="one per line"
              className="md:col-span-2"
            >
              <Textarea
                rows={4}
                aria-label={`Choices for “${field.label}”`}
                value={(field.options ?? []).join("\n")}
                onChange={(event) =>
                  onChange({
                    options: event.target.value.split("\n").map((line) => line.trimStart()),
                  })
                }
                placeholder={"Just me\nTwo to five of us\nMore than five"}
              />
            </Field>
          )}
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            className={checkboxStyles}
            checked={Boolean(field.required)}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          They have to answer this one
        </label>

        {field.type !== "file" && (
        <details className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">More rules</summary>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Shortest answer" hint="letters">
              <Input
                inputMode="numeric"
                aria-label={`Shortest answer for “${field.label}”`}
                value={field.minLength === null || field.minLength === undefined ? "" : String(field.minLength)}
                onChange={(event) => {
                  const raw = event.target.value.replace(/[^0-9]/g, "");
                  onChange({ minLength: raw === "" ? null : Number(raw) });
                }}
                placeholder="No minimum"
              />
            </Field>
            <Field label="Longest answer" hint="letters">
              <Input
                inputMode="numeric"
                aria-label={`Longest answer for “${field.label}”`}
                value={field.maxLength === null || field.maxLength === undefined ? "" : String(field.maxLength)}
                onChange={(event) => {
                  const raw = event.target.value.replace(/[^0-9]/g, "");
                  onChange({ maxLength: raw === "" ? null : Number(raw) });
                }}
                placeholder="No limit"
              />
            </Field>
            <Field label="What the answer may contain">
              <select
                className={selectStyles}
                aria-label={`What the answer to “${field.label}” may contain`}
                value={field.pattern ?? ""}
                onChange={(event) => onChange({ pattern: event.target.value })}
              >
                {FORMAT_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
                {!knownFormat && (
                  <option value={field.pattern}>The rule already set on this question</option>
                )}
              </select>
            </Field>
          </div>
        </details>
        )}

        <ShowIfEditor field={field} earlier={earlier} onChange={onChange} />
      </div>
    </li>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────── */

export default function FormBuilder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const openParam = searchParams.get("form");
  const openId = openParam !== null && /^\d+$/.test(openParam) ? Number(openParam) : null;
  // `?form=<id>&since=30d` opens the form with only the last 30 days' replies —
  // how the Marketing Overview links here. Without `since`, every reply.
  const sinceDays = sinceDaysFrom(searchParams.get("since"));

  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sequences, setSequences] = useState<SequenceSummary[]>([]);
  const [confirm, confirmDialog] = useConfirm();

  const [draft, setDraft] = useState<FormDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [replies, setReplies] = useState<FormSubmission[] | null>(null);
  const [downloading, setDownloading] = useState(false);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [askingField, setAskingField] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");

  const loadList = useCallback(() => {
    formsApi
      .list()
      .then((rows) => {
        setForms(rows);
        setError(null);
      })
      .catch(() => setError("We couldn’t load your forms. Try refreshing the page."));
  }, []);

  useEffect(loadList, [loadList]);

  useEffect(() => {
    contactsApi.tags().then(setTags).catch(() => setTags([]));
    marketingApi.sequences().then(setSequences).catch(() => setSequences([]));
  }, []);

  const loadReplies = useCallback(
    (id: number) => {
      formsApi
        .submissions(id, 0, sinceDays)
        .then((page) => setReplies(page.submissions))
        .catch(() => setReplies([]));
    },
    [sinceDays],
  );

  useEffect(() => {
    if (openId === null) {
      setDraft(null);
      setReplies(null);
      return;
    }
    setDraft(null);
    setDirty(false);
    setReplies(null);
    setError(null);
    formsApi
      .get(openId)
      .then(setDraft)
      .catch((err) => setError(friendlyError(err, "form")));
  }, [openId]);

  // The replies load on their own, so narrowing or clearing `since` refetches
  // them without throwing away an unsaved draft of the form above.
  useEffect(() => {
    if (openId === null) return;
    setReplies(null);
    loadReplies(openId);
  }, [openId, loadReplies]);

  function clearSince() {
    const next = new URLSearchParams(searchParams);
    next.delete("since");
    setSearchParams(next);
  }

  /* Not losing the draft ------------------------------------------------- */

  /**
   * The tab itself closing, reloading, or going somewhere off this app.
   *
   * A form saves as one piece, so an unsaved draft is the whole afternoon's
   * work — every question, every choice on every question — held in this
   * component and nowhere else. The "All forms" button asks before it discards
   * that; Cmd-R, the close box and the browser's own Back did not, and there is
   * no route back from either. Registered only while there is something to
   * lose, because a page that always warns is a page nobody reads the warning
   * on.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      // Both halves: `preventDefault` is the spec, `returnValue` is what Chrome
      // and Safari actually act on. The browser prints its own wording either
      // way — the copy below is only reachable from the in-app guard.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /**
   * A click on any link inside the admin — the sidebar, a breadcrumb, a card.
   *
   * `beforeunload` cannot see these: the router swaps the screen without the
   * document ever unloading, so a stray click on "Contacts" took the draft with
   * it in silence. React Router's own `useBlocker` is not available here —
   * entry-client mounts a `BrowserRouter`, not a data router, and the hook
   * throws outside one — so the navigation is caught where it starts, at the
   * anchor, in the capture phase before the router's own handler runs.
   */
  useEffect(() => {
    if (!dirty) return;

    const intercept = (event: MouseEvent) => {
      // Everything a browser treats as "open this somewhere else" is left
      // alone: a new tab does not discard the draft, so it is not a question
      // worth asking.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      // Another origin is a real page load, which `beforeunload` above already
      // covers; the same URL is not a navigation at all.
      if (destination.origin !== window.location.origin) return;
      const here = window.location.pathname + window.location.search;
      if (destination.pathname + destination.search === here) return;

      // Stopped rather than merely defaulted-away: the router listens on the
      // same click, and letting it through would navigate underneath the
      // dialog.
      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        const ok = await confirm({
          title: "Leave without saving?",
          description: "The changes you've made to this form will be lost.",
          confirmLabel: "Yes, leave it",
          destructive: true,
        });
        if (!ok) return;
        // Cleared first, so the effect unregisters before the navigation and
        // the same click is not intercepted a second time.
        setDirty(false);
        navigate(destination.pathname + destination.search + destination.hash);
      })();
    };

    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [dirty, confirm, navigate]);

  function openForm(id: number) {
    setSearchParams({ form: String(id) });
  }

  function closeForm() {
    setSearchParams({});
  }

  function change(changes: Partial<FormDetail>) {
    revision.current += 1;
    setDraft((current) => (current ? { ...current, ...changes } : current));
    setDirty(true);
    setSaveProblem(null);
  }

  // The form is one JSON document on the server, so edits are queued in order.
  // After a short pause the latest whole draft is stored; the Save-now button
  // is only an escape hatch, not a required second step after every question.
  useEffect(() => {
    if (!dirty || !draft) return;
    const snapshot = draft;
    const atRevision = revision.current;
    const timer = window.setTimeout(() => {
      void persist(snapshot, atRevision, false);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, dirty]);

  /* Creating ------------------------------------------------------------- */

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    try {
      const created = await formsApi.create({ name });
      setAdding(false);
      setNewName("");
      loadList();
      openForm(created.id);
    } catch (err) {
      toast.error(friendlyError(err, "form"));
    } finally {
      setCreating(false);
    }
  }

  const removeForm = useCallback(
    async (form: FormSummary) => {
      const ok = await confirm({
        title: `Delete the ${form.name} form?`,
        description:
          "Every reply people have sent through it goes too. Download them first if you need them.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await formsApi.remove(form.id);
        toast.success(`“${form.name}” is deleted.`);
        if (openId === form.id) closeForm();
        loadList();
      } catch (err) {
        toast.error(friendlyError(err, "form"));
      }
    },
    // `closeForm` only ever clears the query string, so the deps that matter are
    // the ones deciding whether this form is the one on screen.
    [confirm, loadList, openId, setSearchParams],
  );

  /* Questions ------------------------------------------------------------ */

  function addField(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const label = newLabel.trim();
    if (!label) return;

    // Worked out here, once, and never again: every answer already collected is
    // filed under this name, so regenerating it when she renames the question
    // would orphan the replies people have already sent.
    const taken = draft.fields.map((field) => field.key);
    const key = uniqueKey(fieldKey(label), taken);

    change({
      fields: [
        ...draft.fields,
        {
          key,
          label,
          type: newType,
          required: false,
          options: needsOptions(newType) ? [] : undefined,
          ...(newType === "file"
            ? { fileTypes: [...DEFAULT_FILE_CATEGORIES], maxSizeMb: DEFAULT_MAX_SIZE_MB }
            : {}),
        },
      ],
    });
    setAskingField(false);
    setNewLabel("");
    setNewType("text");
  }

  function changeField(index: number, changes: Partial<FormField>) {
    if (!draft) return;
    change({
      fields: draft.fields.map((field, at) => (at === index ? { ...field, ...changes } : field)),
    });
  }

  function moveField(index: number, direction: -1 | 1) {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.fields.length) return;
    const fields = [...draft.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    change({ fields });
  }

  async function deleteField(index: number) {
    if (!draft) return;
    const field = draft.fields[index];
    // Questions that only show depending on this one. Left pointing at a
    // question that is gone, they could never be saved; said out loud here, and
    // set back to always showing, they can.
    const dependents = draft.fields.filter((other) => other.showIf?.field === field.key);
    const ok = await confirm({
      title: `Delete the question “${field.label}”?`,
      description:
        dependents.length > 0
          ? `It comes off the form straight away, and ${dependents
              .map((other) => `“${other.label}”`)
              .join(", ")} will always show instead of depending on it. Answers people already gave stay in your replies.`
          : "It comes off the form straight away. Answers people already gave to it stay in your replies.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    change({
      fields: draft.fields
        .filter((_field, at) => at !== index)
        .map((other) => (other.showIf?.field === field.key ? { ...other, showIf: null } : other)),
    });
  }

  /* Saving --------------------------------------------------------------- */

  async function persist(snapshot: FormDetail, atRevision: number, announce: boolean) {
    const blank = snapshot.fields.findIndex((field) => !field.label.trim());
    if (blank >= 0) {
      if (atRevision === revision.current) {
        setSaveProblem(`Question ${blank + 1} has no wording yet — fill it in before saving.`);
      }
      return;
    }
    const emptyChoices = snapshot.fields.find(
      (field) => needsOptions(field.type) && (field.options ?? []).filter(Boolean).length === 0,
    );
    if (emptyChoices) {
      if (atRevision === revision.current) {
        setSaveProblem(`“${emptyChoices.label}” needs at least one choice to pick from.`);
      }
      return;
    }

    // The questions exactly as they will be stored, so the checks below judge
    // what the server will see — trimmed choices, not the ones mid-typing.
    const outgoingFields: FormField[] = snapshot.fields.map((field) => ({
      ...field,
      contactField:
        field.type === "file"
          ? undefined
          : !field.contactField ||
              CONTACT_FIELD_CHOICES.some((choice) => choice.value === field.contactField)
            ? field.contactField
            : fieldKey(field.contactField),
      options: field.options?.map((option) => option.trim()).filter(Boolean),
      showIf: field.showIf
        ? {
            ...field.showIf,
            value: field.showIf.value?.trim(),
            values: field.showIf.values?.map((entry) => entry.trim()).filter(Boolean),
          }
        : field.showIf,
    }));

    const noFileKinds = outgoingFields.find(
      (field) => field.type === "file" && (field.fileTypes ?? DEFAULT_FILE_CATEGORIES).length === 0,
    );
    const fileCount = outgoingFields.filter((field) => field.type === "file").length;
    // Said here, next to the form, rather than left to a save that fails in
    // the background: the same rules the server applies (formsV2.ts).
    const problem = noFileKinds
      ? `“${noFileKinds.label}” doesn't accept any kind of file yet. Tick at least one.`
      : fileCount > MAX_FILE_QUESTIONS
        ? `A form can ask for up to ${MAX_FILE_QUESTIONS} files.`
        : logicProblem(outgoingFields);
    if (problem) {
      if (atRevision === revision.current) setSaveProblem(problem);
      return;
    }

    setSaveProblem(null);
    setSaving(true);

    const request = saveQueue.current.then(() =>
      formsApi.update(snapshot.id, {
        name: snapshot.name,
        descriptionMd: snapshot.descriptionMd,
        fields: outgoingFields,
        submitLabel: snapshot.submitLabel,
        successMessage: snapshot.successMessage,
        postAction: snapshot.postAction,
        redirectUrl: snapshot.redirectUrl,
        applyTagIds: snapshot.applyTagIds,
        subscribeSequenceId: snapshot.subscribeSequenceId,
        published: snapshot.published,
      }),
    );
    saveQueue.current = request.catch(() => undefined);

    try {
      await request;
      if (atRevision === revision.current) {
        setDirty(false);
        if (announce) toast.success("Form saved");
      }
      loadList();
    } catch (err) {
      if (atRevision === revision.current) {
        toast.error(friendlyError(err, "form"));
      }
    } finally {
      if (atRevision === revision.current) setSaving(false);
    }
  }

  async function save() {
    if (!draft) return;
    await persist(draft, revision.current, true);
  }

  /* Replies -------------------------------------------------------------- */

  const deleteReply = useCallback(
    async (reply: FormSubmission) => {
      if (openId === null) return;
      const ok = await confirm({
        title: `Delete the reply from ${reply.contactName || reply.email}?`,
        description: "It disappears from this list and from your downloads. You can’t undo this.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await formsApi.removeSubmission(openId, reply.id);
        toast.success("Reply deleted");
        loadReplies(openId);
        loadList();
      } catch (err) {
        toast.error(friendlyError(err, "form"));
      }
    },
    [confirm, loadList, loadReplies, openId],
  );

  /**
   * The spreadsheet is fetched rather than linked to.
   *
   * The export route is behind the same sign-in as everything else, and a link
   * the browser follows on its own carries no credentials — so the honest
   * version asks for the file, then hands the bytes to the save dialog.
   */
  const downloadReplies = useCallback(async () => {
    if (!draft) return;
    setDownloading(true);
    try {
      const blob = await formsApi.exportCsv(draft.id);
      saveCsv(blob, `${draft.slug}-replies.csv`);
    } catch (err) {
      toast.error(friendlyError(err, "form"));
    } finally {
      setDownloading(false);
    }
  }, [draft]);

  const replyColumns = useMemo<ColumnDef<FormSubmission, unknown>[]>(() => {
    const fields = draft?.fields ?? [];
    return [
      {
        accessorKey: "createdAt",
        header: "Sent",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">{formatDateTime(row.original.createdAt)}</span>
        ),
      },
      {
        accessorKey: "email",
        header: "Who",
        cell: ({ row }) => (
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">
              {row.original.contactName || row.original.email || "No name given"}
            </span>
            {row.original.contactName && (
              <span className="block truncate text-xs text-ink-soft">{row.original.email}</span>
            )}
          </span>
        ),
      },
      ...fields.map<ColumnDef<FormSubmission, unknown>>((field) => ({
        id: field.key,
        header: field.label,
        accessorFn: (reply: FormSubmission) => answerText(reply.data?.[field.key]),
        cell: ({ row }) => {
          // A file opens through a private link minted when the replies loaded.
          const file =
            field.type === "file"
              ? row.original.files?.find((sent) => sent.fieldKey === field.key)
              : undefined;
          return file ? (
            <a
              href={file.previewUrl}
              target="_blank"
              rel="noreferrer"
              title="Opens a private link that works for two hours. Reload the page for a fresh one."
              className="block max-w-xs truncate text-sm font-semibold text-plum hover:underline"
            >
              {file.name}
              <span className="font-normal text-ink-soft"> · {formatBytes(file.sizeBytes)}</span>
            </a>
          ) : (
            <span className="block max-w-xs truncate text-sm text-ink">
              {answerText(row.original.data?.[field.key])}
            </span>
          );
        },
      })),
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete the reply from ${row.original.email}`}
              onClick={() => void deleteReply(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ];
  }, [draft, deleteReply]);

  const listColumns = useMemo<ColumnDef<FormSummary, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Form",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => openForm(row.original.id)}
            className="flex min-w-0 items-center gap-3 text-left hover:text-plum"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
              <ListChecks className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{row.original.name}</span>
              <span className="block truncate text-xs text-ink-soft">
                {row.original.description || "No description yet"}
              </span>
            </span>
          </button>
        ),
      },
      {
        accessorKey: "slug",
        header: "Web address",
        cell: ({ row }) => (
          <span className="text-xs text-ink-soft">{webAddress("f", row.original.slug)}</span>
        ),
      },
      {
        accessorKey: "fieldCount",
        header: "Questions",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.fieldCount === 0
              ? "None yet"
              : pluralize(row.original.fieldCount, "question")}
          </span>
        ),
      },
      {
        accessorKey: "submissionCount",
        header: "Replies",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.submissionCount === 0
              ? "None yet"
              : pluralize(row.original.submissionCount, "reply", "replies")}
          </span>
        ),
      },
      {
        accessorKey: "published",
        header: "On your site",
        cell: ({ row }) => (
          <Badge tone={row.original.published ? "green" : "slate"}>
            {publishLabel(row.original.published)}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Open ${row.original.name}`}
              onClick={() => openForm(row.original.id)}
            >
              <Pencil />
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete ${row.original.name}`}
              onClick={() => void removeForm(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    [removeForm],
  );

  /* ── The list ─────────────────────────────────────────────────────────── */

  if (openId === null) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Marketing"
          title="Forms"
          description="Ask people whatever you need to know, then tag them and start their emails automatically."
          actions={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus />
              Add a form
            </Button>
          }
        />

        {error && <ErrorNotice message={error} />}

        <DataTable
          columns={listColumns}
          data={forms}
          searchPlaceholder="Search your forms…"
          itemNoun={{ one: "form", many: "forms" }}
          minWidth="940px"
          emptyState={
            <EmptyState
              icon={<ListChecks />}
              title="No forms yet"
              description="Build one, share its web address, and every reply lands here ready to download."
              action={
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus />
                  Add your first form
                </Button>
              }
            />
          }
        />

        <Modal
          open={adding}
          onOpenChange={(open) => !open && setAdding(false)}
          title="Add a form"
          description="Name it now — the questions come next."
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" form="form-new" disabled={creating}>
                {creating ? "Creating…" : "Create and add questions"}
              </Button>
            </>
          }
        >
          <form id="form-new" onSubmit={create}>
            <Field label="What is this form called?" hint="people filling it in see this">
              <Input
                aria-label="What this form is called"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Work with me application"
                required
                autoFocus
              />
            </Field>
          </form>
        </Modal>

        {confirmDialog}
      </div>
    );
  }

  /* ── One form ─────────────────────────────────────────────────────────── */

  if (!draft) {
    return error ? (
      <div className="space-y-4">
        <ErrorNotice message={error} />
        <Button size="sm" variant="secondary" onClick={closeForm}>
          <ArrowLeft />
          All forms
        </Button>
      </div>
    ) : (
      <Skeleton className="h-96 rounded-2xl" />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Form"
        title={draft.name}
        description={`People fill it in at ${webAddress("f", draft.slug)}`}
        actions={
          <>
            <Badge tone={draft.published ? "green" : "slate"}>{publishLabel(draft.published)}</Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (
                  dirty &&
                  !(await confirm({
                    title: "Leave without saving?",
                    description: "The changes you've made to this form will be lost.",
                    confirmLabel: "Yes, leave it",
                    destructive: true,
                  }))
                ) {
                  return;
                }
                closeForm();
              }}
            >
              <ArrowLeft />
              All forms
            </Button>
            <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? "Saving automatically…" : dirty ? "Save now" : "Saved automatically"}
            </Button>
          </>
        }
      />

      {saveProblem && <ErrorNotice message={saveProblem} />}

      {/* ---------------------------------------------------------- basics */}

      <Card className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
        <Field label="What is this form called?" className="md:col-span-2">
          <Input
            aria-label="What this form is called"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </Field>
        <Field
          label="What people read above the questions"
          hint="optional"
          className="md:col-span-2"
        >
          <Textarea
            rows={3}
            aria-label="What people read above the questions"
            value={draft.descriptionMd}
            onChange={(event) => change({ descriptionMd: event.target.value })}
            placeholder="Tell me a little about your practice and I will come back to you within two days."
          />
        </Field>
        <Field label="Wording on the button they press">
          <Input
            aria-label="Wording on the button they press"
            value={draft.submitLabel}
            onChange={(event) => change({ submitLabel: event.target.value })}
            placeholder="Send it"
          />
        </Field>
        <div className="flex items-end">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              className={`mt-0.5 ${checkboxStyles}`}
              checked={draft.published}
              onChange={(event) => change({ published: event.target.checked })}
            />
            <span>
              Live on your site
              <span className="mt-0.5 block text-xs text-ink-soft">
                {draft.published
                  ? `Anyone can fill it in at ${webAddress("f", draft.slug)}.`
                  : "Nobody can fill it in yet."}
              </span>
            </span>
          </label>
        </div>
      </Card>

      {/* -------------------------------------------------------- questions */}

      <Card>
        <CardHeader
          title="Questions"
          subtitle="People answer these in order. Use the arrows to move one up or down."
          icon={<ListChecks />}
          action={
            <Button size="sm" onClick={() => setAskingField(true)}>
              <Plus />
              Add a question
            </Button>
          }
        />

        {draft.fields.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title="No questions yet"
            description="Add the first thing you want to ask. Each answer can be saved onto the person's record so you can use it later."
            action={
              <Button size="sm" onClick={() => setAskingField(true)}>
                <Plus />
                Add the first question
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {draft.fields.map((field, index) => (
              <FieldBlock
                key={field.key}
                field={field}
                earlier={draft.fields.slice(0, index)}
                index={index}
                total={draft.fields.length}
                onChange={(changes) => changeField(index, changes)}
                onMove={(direction) => moveField(index, direction)}
                onDelete={() => void deleteField(index)}
              />
            ))}
          </ol>
        )}
      </Card>

      {/* -------------------------------------------------- after they send */}

      <Card>
        <CardHeader
          title="After they send it"
          subtitle="What they see next, and what happens on your side."
          icon={<Inbox />}
        />

        <div className="grid gap-5 p-5">
          <fieldset className="grid gap-2.5">
            <legend className="mb-1.5 text-[0.8rem] font-semibold text-ink">
              What happens the moment they press the button?
            </legend>
            {POST_ACTIONS.map((action) => (
              <div
                key={action}
                className={`rounded-xl border p-3.5 transition-colors ${
                  draft.postAction === action
                    ? "border-gold/50 bg-gold/[0.08]"
                    : "border-hairline bg-white/[0.03] hover:border-white/20"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="radio"
                    name="post-action"
                    value={action}
                    checked={draft.postAction === action}
                    onChange={() => change({ postAction: action })}
                    className="size-4 border-hairline text-plum focus-visible:ring-plum/30"
                  />
                  <span className="text-sm font-semibold text-ink">
                    {POST_ACTION_LABEL[action]}
                  </span>
                </label>

                {/* Outside the label: a box nested inside one steals the click
                    that was meant for the box. */}
                {draft.postAction === action && action === "message" && (
                  <Textarea
                    rows={3}
                    className="mt-2.5"
                    aria-label="The thank-you message"
                    value={draft.successMessage}
                    onChange={(event) => change({ successMessage: event.target.value })}
                    placeholder="Thank you — I will come back to you within two working days."
                  />
                )}
                {draft.postAction === action && action === "redirect" && (
                  <Input
                    className="mt-2.5"
                    aria-label="The page to send them to"
                    value={draft.redirectUrl}
                    onChange={(event) => change({ redirectUrl: event.target.value })}
                    placeholder="/thank-you"
                  />
                )}
                {draft.postAction === action && action === "download" && (
                  <p className="mt-2.5 text-xs text-ink-soft">
                    {draft.downloadFileName
                      ? `They get ${draft.downloadFileName}.`
                      : "Pick the file in your Media Library and it will be attached here."}
                  </p>
                )}
              </div>
            ))}
          </fieldset>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Tags added when somebody replies" hint="tick as many as you need">
              {tags.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  You have no tags yet — make one under Contacts and it will show up here.
                </p>
              ) : (
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-hairline bg-white/[0.03] p-3">
                  {tags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2.5 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        className={checkboxStyles}
                        checked={draft.applyTagIds.includes(tag.id)}
                        onChange={(event) =>
                          change({
                            applyTagIds: event.target.checked
                              ? [...draft.applyTagIds, tag.id]
                              : draft.applyTagIds.filter((id) => id !== tag.id),
                          })
                        }
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Emails they start getting" hint="optional">
              <select
                className={selectStyles}
                aria-label="Emails they start getting"
                value={draft.subscribeSequenceId === null ? "" : String(draft.subscribeSequenceId)}
                onChange={(event) =>
                  change({
                    subscribeSequenceId: event.target.value ? Number(event.target.value) : null,
                  })
                }
              >
                <option value="">No emails</option>
                {sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>
                    {sequence.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------- replies */}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg text-ink">Replies</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Everything people have sent through this form, newest first.
            </p>
            {sinceDays !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="gold">
                  Showing replies from the last {sinceDays === 1 ? "day" : `${sinceDays} days`}
                </Badge>
                <Button size="sm" variant="ghost" onClick={clearSince}>
                  Show all replies
                </Button>
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void downloadReplies()}
            disabled={downloading}
          >
            <Download />
            {downloading ? "Getting it ready…" : "Download as a spreadsheet"}
          </Button>
        </div>

        <DataTable
          columns={replyColumns}
          data={replies}
          searchPlaceholder="Search the replies…"
          itemNoun={{ one: "reply", many: "replies" }}
          minWidth="900px"
          emptyState={
            <EmptyState
              icon={<Inbox />}
              title={
                sinceDays !== null
                  ? `No replies in the last ${sinceDays === 1 ? "day" : `${sinceDays} days`}`
                  : "No replies yet"
              }
              description="Once this form is live on your site, everything people send lands here and can be downloaded as a spreadsheet."
            />
          }
        />
      </div>

      {/* ----------------------------------------------------- add question */}

      <Modal
        open={askingField}
        onOpenChange={(open) => !open && setAskingField(false)}
        title="Add a question"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAskingField(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="field-new">
              Add it
            </Button>
          </>
        }
      >
        <form id="field-new" onSubmit={addField} className="grid gap-4">
          <Field label="What are you asking?">
            <Input
              aria-label="What you are asking"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="What is your biggest challenge right now?"
              required
              autoFocus
            />
          </Field>
          <Field label="How do they answer?">
            <select
              className={selectStyles}
              aria-label="How they answer this question"
              value={newType}
              onChange={(event) => setNewType(event.target.value as FieldType)}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}
