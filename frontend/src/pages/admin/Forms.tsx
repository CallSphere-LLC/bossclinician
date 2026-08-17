import { useCallback, useEffect, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  Inbox,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { AdminForm, FormField, FormSubmission } from "@/types/admin";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
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
import {
  PUBLISH_LABEL,
  fieldKey,
  friendlyError,
  humanizeKey,
  orNone,
  pluralize,
  shareLink,
  slugify,
  uniqueKey,
} from "@/pages/admin/ui/friendly";

/**
 * The kinds of answer a question can collect.
 *
 * `value` is the string the public form renderer and the database already
 * agree on and must never change; `label` is the only part she ever reads.
 */
const ANSWER_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Short answer" },
  { value: "email", label: "Email address" },
  { value: "textarea", label: "Long answer" },
  { value: "select", label: "Choose from a list" },
  { value: "checkbox", label: "Yes/no checkbox" },
];

const STARTER_FIELDS: FormField[] = [
  { key: "name", label: "Your name", type: "text", required: true },
  { key: "email", label: "Email address", type: "email", required: true },
];

/** The shape of a brand-new form, shared by both "create" buttons. */
function blankForm(): Partial<AdminForm> {
  return {
    name: "",
    fields: STARTER_FIELDS,
    submitLabel: "Send",
    successMessage: "Thanks — we got it.",
    createLead: true,
    published: true,
  };
}

/** The question she wrote, looked up from the key her answers are filed under. */
function questionLabel(form: AdminForm, key: string): string {
  return form.fields?.find((f) => f.key === key)?.label || humanizeKey(key);
}

/**
 * One saved answer, written the way she'd say it out loud.
 *
 * Replies arrive as whatever the public page posted — a word, a tick box, a
 * list of choices, occasionally a nested set of figures from a calculator — so
 * this walks the whole shape into readable text. It never prints braces.
 */
function readableAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not answered";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.length ? value.map(readableAnswer).join(", ") : "Not answered";
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([key, nested]) => `${humanizeKey(key)}: ${readableAnswer(nested)}`,
    );
    return parts.length ? parts.join(" · ") : "Not answered";
  }
  return String(value);
}

export default function Forms() {
  const [forms, setForms] = useState<AdminForm[] | null>(null);
  const [active, setActive] = useState<AdminForm | null>(null);
  const [submissions, setSubmissions] = useState<FormSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<AdminForm> | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    adminApi
      .growthList<AdminForm>("forms")
      .then((list) => {
        setForms(list);
        setActive((prev) => (prev ? list.find((f) => f.id === prev.id) ?? list[0] : list[0]) ?? null);
      })
      .catch(() => setError("We couldn't load your forms. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!active) return;
    setSubmissions(null);
    adminApi.formSubmissions(active.id).then(setSubmissions).catch(() => setSubmissions([]));
  }, [active]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft?.name?.trim()) return;

    // The web address is worked out from the name rather than typed. A form
    // that already exists keeps the address it was given, so every link she
    // has already sent out carries on working.
    const takenAddresses = (forms ?? []).filter((f) => f.id !== draft.id).map((f) => f.slug);
    const slug = draft.slug || uniqueKey(slugify(draft.name) || "form", takenAddresses, "-");

    // Answers are filed under a question's key, so a key is worked out once —
    // when the question is first added — and never touched again on rename.
    // Regenerating it would orphan every reply already collected.
    const takenKeys = new Set((draft.fields ?? []).map((f) => f.key).filter(Boolean));
    const fields = (draft.fields ?? []).map((field) => {
      const options = field.options?.map((o) => o.trim()).filter(Boolean);
      const named = options ? { ...field, options } : field;
      if (named.key) return named;
      const key = uniqueKey(fieldKey(named.label), takenKeys);
      takenKeys.add(key);
      return { ...named, key };
    });

    try {
      const payload = { ...draft, slug, fields };
      if (draft.id) await adminApi.growthUpdate("forms", draft.id, payload);
      else await adminApi.growthCreate("forms", payload);
      toast.success("Form saved.");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "form"));
    }
  }

  function updateField(index: number, patch: Partial<FormField>) {
    setDraft((d) => {
      if (!d) return d;
      const fields = [...(d.fields ?? [])];
      fields[index] = { ...fields[index], ...patch };
      return { ...d, fields };
    });
  }

  /**
   * Moves a question up or down the form. Each question travels with its own
   * key, so reordering is safe in a way that deleting and re-adding isn't:
   * a re-added question gets a fresh key and loses the replies already filed
   * under the old one.
   */
  function moveField(index: number, direction: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const fields = [...(d.fields ?? [])];
      const target = index + direction;
      if (target < 0 || target >= fields.length) return d;
      [fields[index], fields[target]] = [fields[target], fields[index]];
      return { ...d, fields };
    });
  }

  const conversionRate =
    active && active.views > 0 && submissions
      ? Math.round((submissions.length / active.views) * 1000) / 10
      : null;

  const publicLink = active ? shareLink("f", active.slug) : "";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Forms"
        description="Build a form, share the link, and everyone who fills it in lands in your enquiries."
        actions={
          <Button size="sm" onClick={() => setDraft(blankForm())}>
            <Plus />
            New form
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      {forms === null ? (
        <Skeleton className="h-64 w-full" />
      ) : forms.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet />}
            title="No forms yet"
            description="Make a form for anything you need to ask people — an application, a waitlist, a few questions before a call."
            action={
              <Button size="sm" onClick={() => setDraft(blankForm())}>
                Create a form
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Your forms" />
            <ul className="space-y-0.5 p-2">
              {forms.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setActive(f)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      active?.id === f.id
                        ? "bg-lilac-tint font-semibold text-plum-deep"
                        : "text-ink-soft hover:bg-cream",
                    )}
                  >
                    <FileSpreadsheet className="size-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {!f.published && (
                      <span className="shrink-0 text-[0.6rem] font-bold uppercase text-ink-soft/60">
                        {PUBLISH_LABEL.draft}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-5">
            {active && (
              <>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Card className="p-5">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                      Times viewed
                    </p>
                    <p className="mt-2 font-display text-[1.6rem] leading-none text-ink">
                      {formatNumber(active.views)}
                    </p>
                  </Card>
                  <Card className="p-5">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                      People who filled it in
                    </p>
                    <p className="mt-2 font-display text-[1.6rem] leading-none text-ink">
                      {orNone(submissions?.length)}
                    </p>
                  </Card>
                  <Card className="p-5">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft">
                      How many who saw it filled it in
                    </p>
                    <p className="mt-2 font-display text-[1.6rem] leading-none text-plum">
                      {conversionRate !== null ? `${conversionRate}%` : "None yet"}
                    </p>
                    <p className="mt-1.5 text-[0.7rem] text-ink-soft">
                      Out of everyone who opened the form.
                    </p>
                  </Card>
                </div>

                <Card>
                  <CardHeader
                    title={active.name}
                    subtitle={pluralize(active.fields?.length ?? 0, "question")}
                    action={
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setDraft(active)}>
                          Edit this form
                        </Button>
                        <Button
                          variant="dangerGhost"
                          size="iconSm"
                          aria-label="Delete this form"
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Delete “${active.name}”?`,
                              description: "Everything people have sent through it goes too.",
                              confirmLabel: "Yes, delete it",
                              destructive: true,
                            });
                            if (!ok) return;
                            try {
                              await adminApi.growthDelete("forms", active.id);
                              setActive(null);
                              load();
                            } catch (err) {
                              toast.error(friendlyError(err, "form"));
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    }
                  />
                  <div className="p-5">
                    {/* The link she can actually send to a person is the whole
                        story here. A form that isn't live has no page yet, so
                        it says so rather than offering a dead link. */}
                    <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                      Share this form
                    </p>
                    {active.published ? (
                      <>
                        <div className="mt-2 flex items-center gap-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                            {publicLink}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label="Copy the link to this form"
                            onClick={() =>
                              navigator.clipboard
                                .writeText(publicLink)
                                .then(() => toast.success("Link copied."))
                                .catch(() =>
                                  toast.error("We couldn't copy that. Try selecting it by hand."),
                                )
                            }
                          >
                            <Copy />
                          </Button>
                          <Button variant="secondary" size="sm" asChild>
                            <a href={`/f/${active.slug}`} target="_blank" rel="noreferrer">
                              <ExternalLink />
                              Open
                            </a>
                          </Button>
                        </div>
                        <p className="mt-1.5 text-xs text-ink-soft">
                          Send this to anyone — they can fill it in on their phone or computer.
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 rounded-xl border border-hairline bg-cream/60 px-3 py-2.5 text-xs text-ink-soft">
                        This form isn't live yet. Turn on “Live on my site” and you'll get a link
                        you can send to anyone.
                      </p>
                    )}

                    {/* Live preview of the built form */}
                    <div className="mt-5 rounded-xl border border-hairline bg-cream/40 p-5">
                      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-soft">
                        How it looks
                      </p>
                      <div className="space-y-3">
                        {(active.fields ?? []).map((f) => (
                          <div key={f.key}>
                            <label className="mb-1.5 block text-[0.8rem] font-semibold text-ink">
                              {f.label}
                              {f.required && <span className="ml-1 text-red-300">*</span>}
                            </label>
                            {f.type === "textarea" ? (
                              <Textarea rows={3} disabled placeholder={f.label} />
                            ) : f.type === "checkbox" ? (
                              <input type="checkbox" disabled className="size-4 rounded" />
                            ) : f.type === "select" ? (
                              <select
                                disabled
                                className="h-11 w-full rounded-xl border border-hairline bg-surface px-3 text-sm"
                              >
                                {(f.options ?? []).length === 0 ? (
                                  <option>No choices added yet</option>
                                ) : (
                                  (f.options ?? []).map((o) => <option key={o}>{o}</option>)
                                )}
                              </select>
                            ) : (
                              <Input disabled type={f.type} placeholder={f.label} />
                            )}
                          </div>
                        ))}
                        <Button disabled className="w-full">
                          {active.submitLabel}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="Replies"
                    subtitle={
                      submissions ? pluralize(submissions.length, "reply", "replies") : undefined
                    }
                    icon={<Inbox className="size-4" />}
                  />
                  {submissions === null ? (
                    <Skeleton className="m-5 h-20" />
                  ) : submissions.length === 0 ? (
                    <EmptyState
                      icon={<Inbox />}
                      title="No replies yet"
                      description="They'll appear here as people fill in your form."
                    />
                  ) : (
                    <ul className="divide-y divide-hairline/60">
                      {submissions.map((s) => (
                        <motion.li
                          key={s.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="px-5 py-3.5"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                              {s.email || "No email given"}
                            </span>
                            <span className="text-xs text-ink-soft">
                              {formatDateTime(s.createdAt)}
                            </span>
                          </div>
                          <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                            {Object.entries(s.data ?? {}).map(([key, value]) => (
                              <div key={key} className="flex gap-2 text-xs">
                                <dt className="shrink-0 font-semibold text-ink-soft">
                                  {questionLabel(active, key)}:
                                </dt>
                                <dd className="min-w-0 truncate text-ink-soft">
                                  {readableAnswer(value)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title={draft?.id ? "Edit this form" : "Create a form"}
        size="xl"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="form-builder">
              Save form
            </Button>
          </>
        }
      >
        {draft && (
          <form id="form-builder" onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name this form" hint="just so you can find it">
                <Input
                  value={draft.name ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Application form"
                  required
                  autoFocus
                />
              </Field>
              <Field label="Button text" hint="what the button at the bottom says">
                <Input
                  value={draft.submitLabel ?? "Send"}
                  onChange={(e) => setDraft((d) => ({ ...d, submitLabel: e.target.value }))}
                />
              </Field>
            </div>

            {/* This is the paragraph that opens her own form page, and the
                summary Google shows for it — the one bit of writing on the
                form that isn't a question. */}
            <Field
              label="What should people read at the top?"
              hint="a line or two before the questions — leave it empty if the questions speak for themselves"
            >
              <Textarea
                rows={2}
                value={draft.description ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Tell me a little about your practice and I'll come back to you within two working days."
              />
            </Field>

            <Field label="Thank-you message" hint="what people see after they send it">
              <Input
                value={draft.successMessage ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, successMessage: e.target.value }))}
              />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[0.8rem] font-semibold text-ink">Questions</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      // No key yet on purpose: it's worked out from her wording
                      // when she saves, so the answers file under something she
                      // would recognise rather than "field_3".
                      fields: [...(d?.fields ?? []), { key: "", label: "New question", type: "text" }],
                    }))
                  }
                >
                  <Plus />
                  Add a question
                </Button>
              </div>

              <div className="space-y-2">
                {(draft.fields ?? []).map((field, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-end gap-2 rounded-xl border border-hairline p-3"
                  >
                    <div className="mb-1.5 flex shrink-0 flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="iconSm"
                        className="h-6"
                        aria-label={`Move “${field.label}” up`}
                        disabled={i === 0}
                        onClick={() => moveField(i, -1)}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="iconSm"
                        className="h-6"
                        aria-label={`Move “${field.label}” down`}
                        disabled={i === (draft.fields ?? []).length - 1}
                        onClick={() => moveField(i, 1)}
                      >
                        <ChevronDown />
                      </Button>
                    </div>
                    <Field label="Question" className="min-w-[8rem] flex-1">
                      <Input
                        value={field.label}
                        onChange={(e) => updateField(i, { label: e.target.value })}
                      />
                    </Field>
                    <Field label="What kind of answer?" className="w-44">
                      <select
                        value={field.type}
                        onChange={(e) => updateField(i, { type: e.target.value })}
                        className="h-11 w-full rounded-xl border border-hairline bg-surface px-2 text-sm outline-none focus-visible:border-plum"
                      >
                        {ANSWER_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <label className="mb-3 flex cursor-pointer items-center gap-1.5 text-xs font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={Boolean(field.required)}
                        onChange={(e) => updateField(i, { required: e.target.checked })}
                        className="size-4 rounded border-hairline text-plum"
                      />
                      Must answer
                    </label>
                    <Button
                      type="button"
                      variant="dangerGhost"
                      size="iconSm"
                      className="mb-2"
                      aria-label={`Remove “${field.label}”`}
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          fields: (d?.fields ?? []).filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      <Trash2 />
                    </Button>
                    {field.type === "select" && (
                      // The choices only mean anything for a pick-one question,
                      // so they appear with it rather than sitting empty above.
                      // Blank lines are kept while she types and tidied on save.
                      <Field label="The choices" hint="one per line" className="w-full">
                        <Textarea
                          rows={3}
                          value={(field.options ?? []).join("\n")}
                          onChange={(e) =>
                            updateField(i, { options: e.target.value.split("\n") })
                          }
                          placeholder={"Yes\nNo\nNot sure"}
                        />
                      </Field>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 border-t border-hairline/70 pt-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={draft.createLead !== false}
                  onChange={(e) => setDraft((d) => ({ ...d, createLead: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum"
                />
                Add everyone who fills this in to my enquiries
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={draft.published !== false}
                  onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
                  className="size-4 rounded border-hairline text-plum"
                />
                Live on my site
              </label>
              <p className="text-xs text-ink-soft">
                {draft.published !== false
                  ? "Anyone with the link can fill this in."
                  : "Not visible yet — nobody can open it until you tick this."}
              </p>
            </div>

            <p className="rounded-xl bg-cream px-3.5 py-2.5 text-xs text-ink-soft">
              We'll use the first email question on this form to reach the person, and add them to
              your enquiries.
            </p>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
