import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
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
import { formatDateTime } from "@/lib/format";
import {
  CONTACT_FIELD_CHOICES,
  FIELD_TYPE_LABEL,
  POST_ACTION_LABEL,
  formsApi,
  needsOptions,
  saveCsv,
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
  return String(value);
}

/* ── One question ───────────────────────────────────────────────────────── */

function FieldBlock({
  field,
  index,
  total,
  onChange,
  onMove,
  onDelete,
}: {
  field: FormField;
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
        <div className="grid gap-4 md:grid-cols-2">
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
              onChange={(event) => onChange({ type: event.target.value as FieldType })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </Field>

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

          <Field label="A note under the question" hint="optional">
            <Input
              aria-label={`Note under “${field.label}”`}
              value={field.helpText ?? ""}
              onChange={(event) => onChange({ helpText: event.target.value })}
              placeholder="Two or three sentences is plenty."
            />
          </Field>

          <Field label="Faint text inside the box" hint="optional">
            <Input
              aria-label={`Faint text inside “${field.label}”`}
              value={field.placeholder ?? ""}
              onChange={(event) => onChange({ placeholder: event.target.value })}
              placeholder="Type your answer here"
            />
          </Field>

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

        <details className="rounded-xl border border-hairline bg-raise px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink">More rules</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
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
      </div>
    </li>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────── */

export default function FormBuilder() {
  const [searchParams, setSearchParams] = useSearchParams();
  const openParam = searchParams.get("form");
  const openId = openParam !== null && /^\d+$/.test(openParam) ? Number(openParam) : null;

  const [forms, setForms] = useState<FormSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sequences, setSequences] = useState<SequenceSummary[]>([]);
  const [confirm, confirmDialog] = useConfirm();

  const [draft, setDraft] = useState<FormDetail | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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

  const loadReplies = useCallback((id: number) => {
    formsApi
      .submissions(id)
      .then((page) => setReplies(page.submissions))
      .catch(() => setReplies([]));
  }, []);

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
    loadReplies(openId);
  }, [openId, loadReplies]);

  function openForm(id: number) {
    setSearchParams({ form: String(id) });
  }

  function closeForm() {
    setSearchParams({});
  }

  function change(changes: Partial<FormDetail>) {
    setDraft((current) => (current ? { ...current, ...changes } : current));
    setDirty(true);
    setSaveProblem(null);
  }

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
        { key, label, type: newType, required: false, options: needsOptions(newType) ? [] : undefined },
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
    const ok = await confirm({
      title: `Delete the question “${field.label}”?`,
      description:
        "It comes off the form straight away. Answers people already gave to it stay in your replies.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    change({ fields: draft.fields.filter((_field, at) => at !== index) });
  }

  /* Saving --------------------------------------------------------------- */

  async function save() {
    if (!draft) return;

    const blank = draft.fields.findIndex((field) => !field.label.trim());
    if (blank >= 0) {
      setSaveProblem(`Question ${blank + 1} has no wording yet — fill it in before saving.`);
      return;
    }
    const emptyChoices = draft.fields.find(
      (field) => needsOptions(field.type) && (field.options ?? []).filter(Boolean).length === 0,
    );
    if (emptyChoices) {
      setSaveProblem(`“${emptyChoices.label}” needs at least one choice to pick from.`);
      return;
    }
    setSaveProblem(null);

    setSaving(true);
    try {
      await formsApi.update(draft.id, {
        name: draft.name,
        descriptionMd: draft.descriptionMd,
        fields: draft.fields.map((field) => ({
          ...field,
          // "Save this answer to → a detail of your own" prefills with the
          // question's own wording, which the server refuses: a stored detail is
          // a single word. Turned into one here rather than making her guess.
          contactField:
            !field.contactField ||
            CONTACT_FIELD_CHOICES.some((choice) => choice.value === field.contactField)
              ? field.contactField
              : fieldKey(field.contactField),
          options: field.options?.map((option) => option.trim()).filter(Boolean),
        })),
        submitLabel: draft.submitLabel,
        successMessage: draft.successMessage,
        postAction: draft.postAction,
        redirectUrl: draft.redirectUrl,
        applyTagIds: draft.applyTagIds,
        subscribeSequenceId: draft.subscribeSequenceId,
        published: draft.published,
      });
      toast.success("Form saved");
      setDirty(false);
      // Read back rather than trusting the reply: the tag and sequence names the
      // screen prints come from the full record, not from the save.
      const fresh = await formsApi.get(draft.id);
      setDraft(fresh);
      loadList();
    } catch (err) {
      toast.error(friendlyError(err, "form"));
    } finally {
      setSaving(false);
    }
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
        cell: ({ row }) => (
          <span className="block max-w-xs truncate text-sm text-ink">
            {answerText(row.original.data?.[field.key])}
          </span>
        ),
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
            className="flex min-w-0 items-center gap-3 text-left hover:text-accent"
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
          description="Create forms to collect sign-ups, applications, registrations, enquiries, and other information from your audience."
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
              {saving ? "Saving…" : dirty ? "Save form" : "Saved"}
            </Button>
          </>
        }
      />

      {saveProblem && <ErrorNotice message={saveProblem} />}

      {/* ---------------------------------------------------------- basics */}

      <Card className="grid gap-4 p-5 md:grid-cols-2">
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
                    : "border-hairline bg-raise hover:border-ink-soft/35"
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

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Tags added when somebody replies" hint="tick as many as you need">
              {tags.length === 0 ? (
                <p className="text-sm text-ink-soft">
                  You have no tags yet — make one under Contacts and it will show up here.
                </p>
              ) : (
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-hairline bg-raise p-3">
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
              title="No replies yet"
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
