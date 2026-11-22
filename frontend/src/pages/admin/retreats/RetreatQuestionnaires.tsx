import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Archive, ClipboardList, Download, History, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { sessionFetch } from "@/lib/adminTransport";
import {
  AUDIENCE_LABEL,
  QUESTION_TYPES,
  QUESTION_TYPE_LABEL,
  adminRetreatsApi,
  formatRetreatDate,
  type AdminQuestionnaire,
  type QuestionAudience,
  type QuestionDefinition,
  type QuestionnaireDefinition,
  type QuestionType,
  type SectionDefinition,
} from "@/lib/retreatsApi";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
  legibleDisabledStyles,
} from "@/pages/admin/ui/primitives";
import {
  blankQuestion,
  blankSection,
  conditionTargets,
  isChoice,
  moveItem,
  parseOptions,
  sameDefinition,
  tidyDefinition,
  usedIds,
  validateDefinition,
} from "./questionnaireEditor";

/**
 * Admin › Retreats › one retreat › Questionnaires (Yvette's item 7).
 *
 * The owner writes, reorders and removes questions herself. Every save of
 * changed wording becomes a new numbered version on the server; nothing a
 * guest has already answered is rewritten, and removing a question never
 * deletes an answer.
 */

const FIGURE = "font-sans font-bold tabular-nums";

export function RetreatQuestionnaires({ retreatId }: { retreatId: number }) {
  const [list, setList] = useState<AdminQuestionnaire[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await adminRetreatsApi.questionnaires(retreatId)).questionnaires);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the questionnaires.");
    }
  }, [retreatId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const title = newTitle.trim();
    if (!title) {
      toast.error("Give the new questionnaire a title.");
      return;
    }
    setBusy(true);
    try {
      const result = await adminRetreatsApi.createQuestionnaire(retreatId, title);
      setList(result.questionnaires);
      setNewTitle("");
      setOpenId(result.id);
      toast.success("Questionnaire added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the questionnaire.");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, delta: number) {
    if (!list) return;
    const next = moveItem(list, index, delta);
    if (next.every((q, i) => q.id === list[i].id)) return;
    setList(next);
    try {
      setList((await adminRetreatsApi.reorderQuestionnaires(retreatId, next.map((q) => q.id))).questionnaires);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reorder.");
      void load();
    }
  }

  const open = list?.find((q) => q.id === openId) ?? null;

  if (open) {
    return (
      <QuestionnaireEditor
        key={`${open.id}-${open.version}-${open.updatedAt}`}
        retreatId={retreatId}
        questionnaire={open}
        onList={setList}
        onClose={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNotice message={error} />}
      <Card>
        <CardHeader
          icon={<ClipboardList />}
          title="Questionnaires"
          subtitle="Each appears on the guest dashboard in this order; guests can save progress and update their answers later"
        />
        <div className="space-y-3 border-b border-hairline/60 px-5 py-4 text-sm text-ink-soft">
          <p>
            Saving changed questions creates a new version. Answers already given keep the wording they answered; removing a question
            never deletes an answer.
          </p>
        </div>
        {list === null && !error ? (
          <div className="p-5">
            <Skeleton className="h-24" />
          </div>
        ) : list && list.length === 0 ? (
          <EmptyState icon={<ClipboardList />} title="No questionnaires yet" description="Add one below." />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {(list ?? []).map((q, index) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{q.title}</p>
                    {q.archived && <Badge tone="neutral">Archived</Badge>}
                    {!q.archived && q.inChecklist && <Badge tone="green">On checklist</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    Version <span className={FIGURE}>{q.version}</span> · <span className={FIGURE}>{q.responses.submitted}</span> submitted ·{" "}
                    <span className={FIGURE}>{q.responses.drafts}</span> in progress
                    {q.dueDate ? ` · Due ${formatRetreatDate(q.dueDate)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="iconSm" variant="ghost" aria-label={`Move ${q.title} up`} disabled={index === 0} onClick={() => void move(index, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    aria-label={`Move ${q.title} down`}
                    disabled={index === (list?.length ?? 0) - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setOpenId(q.id)}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3 border-t border-hairline/60 px-5 py-4">
          <Field label="New questionnaire" className="min-w-[16rem] flex-1">
            <Input value={newTitle} placeholder="e.g. Content Day Preparation" onChange={(e) => setNewTitle(e.target.value)} />
          </Field>
          <Button disabled={busy} onClick={() => void add()}>
            <Plus aria-hidden /> Add questionnaire
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ───────────────────────────────── editor ─────────────────────────────── */

function QuestionnaireEditor({
  retreatId,
  questionnaire,
  onList,
  onClose,
}: {
  retreatId: number;
  questionnaire: AdminQuestionnaire;
  onList: (list: AdminQuestionnaire[]) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(questionnaire.title);
  const [dueDate, setDueDate] = useState(questionnaire.dueDate ?? "");
  const [inChecklist, setInChecklist] = useState(questionnaire.inChecklist);
  const [definition, setDefinition] = useState<QuestionnaireDefinition>(questionnaire.definition);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const answered = questionnaire.responses.drafts + questionnaire.responses.submitted;
  const dirty =
    title !== questionnaire.title ||
    (dueDate || null) !== questionnaire.dueDate ||
    inChecklist !== questionnaire.inChecklist ||
    !sameDefinition(definition, questionnaire.definition);

  const ids = useMemo(() => usedIds(definition), [definition]);

  const setSection = (index: number, patch: Partial<SectionDefinition>) =>
    setDefinition((d) => ({ ...d, sections: d.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));

  const setQuestion = (sectionIndex: number, questionIndex: number, patch: Partial<QuestionDefinition>) =>
    setDefinition((d) => ({
      ...d,
      sections: d.sections.map((s, i) =>
        i === sectionIndex ? { ...s, questions: s.questions.map((q, j) => (j === questionIndex ? { ...q, ...patch } : q)) } : s,
      ),
    }));

  function moveQuestionToSection(from: number, questionIndex: number, to: number) {
    setDefinition((d) => {
      const question = d.sections[from].questions[questionIndex];
      return {
        ...d,
        sections: d.sections.map((s, i) => {
          if (i === from) return { ...s, questions: s.questions.filter((_, j) => j !== questionIndex) };
          if (i === to) return { ...s, questions: [...s.questions, question] };
          return s;
        }),
      };
    });
  }

  async function removeSection(index: number) {
    const section = definition.sections[index];
    if (section.questions.length > 0) {
      const ok = await confirm({
        title: "Remove this section and its questions?",
        description: "Guests will no longer see these questions. Answers already given are kept with the wording they answered.",
        confirmLabel: "Yes, remove it",
        destructive: true,
      });
      if (!ok) return;
    }
    setDefinition((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== index) }));
  }

  async function save() {
    const tidy = tidyDefinition(definition);
    const found = validateDefinition(tidy);
    if (!title.trim()) found.unshift("Give the questionnaire a title.");
    setProblems(found);
    if (found.length) {
      toast.error("Fix the items listed above before saving.");
      return;
    }
    setBusy(true);
    try {
      const result = await adminRetreatsApi.updateQuestionnaire(retreatId, questionnaire.id, {
        title: title.trim(),
        inChecklist,
        dueDate: dueDate || null,
        definition: tidy,
      });
      onList(result.questionnaires);
      toast.success(result.newVersion ? `Saved as version ${result.version}` : "Saved — no changes to the questions");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchived() {
    const next = !questionnaire.archived;
    const ok = await confirm(
      next
        ? {
            title: "Archive this questionnaire?",
            description: "Guests will no longer see it. Every answer already given is kept and stays visible to you.",
            confirmLabel: "Yes, archive it",
          }
        : { title: "Show this questionnaire to guests again?", confirmLabel: "Yes, restore it" },
    );
    if (!ok) return;
    try {
      onList((await adminRetreatsApi.updateQuestionnaire(retreatId, questionnaire.id, { archived: next })).questionnaires);
      toast.success(next ? "Archived" : "Restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change it.");
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this questionnaire?",
      description: "Nobody has answered it yet, so nothing is lost. This can't be undone.",
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      onList((await adminRetreatsApi.deleteQuestionnaire(retreatId, questionnaire.id)).questionnaires);
      toast.success("Questionnaire deleted");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete it.");
    }
  }

  async function download(sensitive: boolean) {
    try {
      const response = await sessionFetch(adminRetreatsApi.questionnaireCsvUrl(retreatId, questionnaire.id, sensitive));
      if (!response.ok) throw new Error("Could not download the answers.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${questionnaire.key}${sensitive ? "-with-health" : ""}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not download the answers.");
    }
  }

  async function close() {
    if (dirty) {
      const ok = await confirm({
        title: "Leave without saving?",
        description: "Your unsaved changes to this questionnaire will be lost.",
        confirmLabel: "Yes, leave",
        destructive: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  let questionNumber = 0;

  return (
    <div className="space-y-5">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => void close()}>
          <X aria-hidden /> Back to all questionnaires
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? <Badge tone="gold">Unsaved changes</Badge> : <Badge tone="neutral">Saved · version {questionnaire.version}</Badge>}
          <Button size="sm" variant="secondary" onClick={() => setShowVersions(true)}>
            <History aria-hidden /> Version history
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void download(false)}>
            <Download aria-hidden /> Download answers (CSV)
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void download(true)}>
            <Download aria-hidden /> …including health answers
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader icon={<ClipboardList />} title={questionnaire.title} subtitle={`Version ${questionnaire.version} · ${answered} guest${answered === 1 ? "" : "s"} answered`} />
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-hairline p-4 text-sm text-ink-soft">
            <p>
              Saving creates a new version. Answers already given keep the wording they answered; removing a question never deletes an
              answer.
            </p>
            <p className="mt-1.5">
              Write <code className="text-ink">{"{{destination}}"}</code> and <code className="text-ink">{"{{dates}}"}</code> anywhere
              in the wording: they are filled in from this retreat (for example “Ubud, Bali” and “June 15–20, 2027”).
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title (shown to guests and on the checklist)">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Please complete by" hint="Optional; shown in Important dates">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink sm:col-span-2">
              <input type="checkbox" className="size-4 accent-[var(--accent,#d4af37)]" checked={inChecklist} onChange={(e) => setInChecklist(e.target.checked)} />
              Show on the guest's preparation checklist
            </label>
            <Field label="Introduction" className="sm:col-span-2">
              <Textarea rows={4} value={definition.intro} onChange={(e) => setDefinition((d) => ({ ...d, intro: e.target.value }))} />
            </Field>
          </div>
        </div>
      </Card>

      {definition.sections.map((section, sectionIndex) => (
        <Card key={section.id}>
          <CardHeader
            title={section.title || `Section ${sectionIndex + 1}`}
            subtitle={`${section.questions.length} question${section.questions.length === 1 ? "" : "s"}`}
            action={
              <div className="flex items-center gap-1">
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label="Move section up"
                  disabled={sectionIndex === 0}
                  onClick={() => setDefinition((d) => ({ ...d, sections: moveItem(d.sections, sectionIndex, -1) }))}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label="Move section down"
                  disabled={sectionIndex === definition.sections.length - 1}
                  onClick={() => setDefinition((d) => ({ ...d, sections: moveItem(d.sections, sectionIndex, 1) }))}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button size="iconSm" variant="dangerGhost" aria-label="Remove section" onClick={() => void removeSection(sectionIndex)}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            }
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Section heading">
                <Input value={section.title} onChange={(e) => setSection(sectionIndex, { title: e.target.value })} />
              </Field>
              <Field label="Section note" hint="Optional, shown above the questions">
                <Textarea rows={2} value={section.description} onChange={(e) => setSection(sectionIndex, { description: e.target.value })} />
              </Field>
            </div>
            {section.questions.map((question, questionIndex) => {
              questionNumber += 1;
              return (
                <QuestionEditor
                  key={question.id}
                  number={questionNumber}
                  question={question}
                  definition={definition}
                  sectionIndex={sectionIndex}
                  isFirst={questionIndex === 0}
                  isLast={questionIndex === section.questions.length - 1}
                  onChange={(patch) => setQuestion(sectionIndex, questionIndex, patch)}
                  onMove={(delta) => setSection(sectionIndex, { questions: moveItem(section.questions, questionIndex, delta) })}
                  onMoveToSection={(to) => moveQuestionToSection(sectionIndex, questionIndex, to)}
                  onRemove={() => setSection(sectionIndex, { questions: section.questions.filter((_, j) => j !== questionIndex) })}
                />
              );
            })}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSection(sectionIndex, { questions: [...section.questions, blankQuestion(ids)] })}
            >
              <Plus aria-hidden /> Add a question
            </Button>
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setDefinition((d) => ({ ...d, sections: [...d.sections, blankSection(ids)] }))}>
          <Plus aria-hidden /> Add a section
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => void toggleArchived()}>
            <Archive aria-hidden /> {questionnaire.archived ? "Restore for guests" : "Archive"}
          </Button>
          {answered === 0 ? (
            <Button variant="dangerGhost" onClick={() => void remove()}>
              <Trash2 aria-hidden /> Delete
            </Button>
          ) : (
            <span className="max-w-xs text-xs text-ink-soft">Guests have answered this questionnaire, so it can only be archived, not deleted.</span>
          )}
        </div>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold">Before saving:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-4 z-10 flex justify-end">
        <Button className={legibleDisabledStyles} disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : dirty ? "Save questionnaire" : "Saved"}
        </Button>
      </div>

      {showVersions && <VersionsModal retreatId={retreatId} questionnaireId={questionnaire.id} onClose={() => setShowVersions(false)} />}
    </div>
  );
}

/* ───────────────────────────────── one question ───────────────────────── */

function QuestionEditor({
  number,
  question,
  definition,
  sectionIndex,
  isFirst,
  isLast,
  onChange,
  onMove,
  onMoveToSection,
  onRemove,
}: {
  number: number;
  question: QuestionDefinition;
  definition: QuestionnaireDefinition;
  sectionIndex: number;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<QuestionDefinition>) => void;
  onMove: (delta: number) => void;
  onMoveToSection: (to: number) => void;
  onRemove: () => void;
}) {
  const [optionsText, setOptionsText] = useState(question.options.join("\n"));
  const targets = conditionTargets(definition, question.id);
  const target = question.showIf ? targets.find((t) => t.id === question.showIf!.questionId) ?? null : null;

  return (
    <div className="rounded-xl border border-hairline p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs text-ink-soft ${FIGURE}`}>Q{number}</span>
          {question.required && <Badge tone="gold">Required</Badge>}
          {question.showTo !== "all" && <Badge tone="plum">{AUDIENCE_LABEL[question.showTo]}</Badge>}
          {question.showIf && <Badge tone="blue">Conditional</Badge>}
          {question.sensitive && <Badge tone="red">Health / sensitive</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="iconSm" variant="ghost" aria-label="Move question up" disabled={isFirst} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden />
          </Button>
          <Button size="iconSm" variant="ghost" aria-label="Move question down" disabled={isLast} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden />
          </Button>
          {definition.sections.length > 1 && (
            <Select
              aria-label="Move to section"
              className="h-10 w-auto min-w-[9rem] text-xs"
              value=""
              onChange={(e) => {
                if (e.target.value !== "") onMoveToSection(Number(e.target.value));
              }}
            >
              <option value="">Move to section…</option>
              {definition.sections.map((s, i) =>
                i === sectionIndex ? null : (
                  <option key={s.id} value={i}>
                    {s.title || `Section ${i + 1}`}
                  </option>
                ),
              )}
            </Select>
          )}
          <Button size="iconSm" variant="dangerGhost" aria-label="Remove question" onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label="Question" className="sm:col-span-2">
          <Textarea rows={2} value={question.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
        <Field label="Help text" hint="Optional, shown under the question" className="sm:col-span-2">
          <Textarea rows={2} value={question.help} onChange={(e) => onChange({ help: e.target.value })} />
        </Field>
        <Field label="Answer type">
          <Select value={question.type} onChange={(e) => onChange({ type: e.target.value as QuestionType })}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Who sees it">
          <Select value={question.showTo} onChange={(e) => onChange({ showTo: e.target.value as QuestionAudience })}>
            {(Object.keys(AUDIENCE_LABEL) as QuestionAudience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        {isChoice(question.type) && (
          <Field label="Options" hint="One per line" className="sm:col-span-2">
            <Textarea
              rows={Math.min(10, Math.max(3, optionsText.split("\n").length))}
              value={optionsText}
              onChange={(e) => {
                setOptionsText(e.target.value);
                onChange({ options: parseOptions(e.target.value) });
              }}
            />
          </Field>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Toggle checked={question.required} onChange={(v) => onChange({ required: v })} label="Required to submit (guests can always save progress)" />
          <Toggle
            checked={question.sensitive}
            onChange={(v) => onChange({ sensitive: v })}
            label="Health or sensitive answer: organizer-only, never shown to other guests, left out of the standard CSV"
          />
        </div>
        <Field label="Show only if" hint="Optional" className="sm:col-span-2">
          <Select
            value={question.showIf?.questionId ?? ""}
            onChange={(e) => onChange({ showIf: e.target.value ? { questionId: e.target.value, anyOf: [] } : null })}
          >
            <option value="">Always show</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {(t.label || "Untitled question").slice(0, 90)}
              </option>
            ))}
          </Select>
        </Field>
        {question.showIf && target && (
          <div className="sm:col-span-2 rounded-lg border border-hairline/70 p-3 text-sm">
            {isChoice(target.type) && target.options.length > 0 ? (
              <>
                <p className="text-xs text-ink-soft">Show when the answer is any of (none ticked = when it has any answer):</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {target.options.map((option) => {
                    const checked = question.showIf!.anyOf.includes(option);
                    return (
                      <label key={option} className="flex items-center gap-2 text-ink">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--accent,#d4af37)]"
                          checked={checked}
                          onChange={(e) =>
                            onChange({
                              showIf: {
                                questionId: target.id,
                                anyOf: e.target.checked ? [...question.showIf!.anyOf, option] : question.showIf!.anyOf.filter((v) => v !== option),
                              },
                            })
                          }
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-soft">Shown once that question has any answer{target.type === "checkbox" ? " (the box is ticked)" : ""}.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink">
      <input type="checkbox" className="size-4 accent-[var(--accent,#d4af37)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ───────────────────────────────── versions ───────────────────────────── */

function VersionsModal({ retreatId, questionnaireId, onClose }: { retreatId: number; questionnaireId: number; onClose: () => void }) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof adminRetreatsApi.questionnaireVersions>>["versions"] | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    adminRetreatsApi
      .questionnaireVersions(retreatId, questionnaireId)
      .then((r) => {
        setVersions(r.versions);
        setShown(r.versions[0]?.version ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the versions."));
  }, [retreatId, questionnaireId]);

  const current = versions?.find((v) => v.version === shown) ?? null;

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Version history" description="Every saved version is kept exactly as it was." size="xl">
      {error && <ErrorNotice message={error} />}
      {!versions && !error && <Skeleton className="h-32" />}
      {versions && (
        <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
          <ul className="space-y-1">
            {versions.map((v) => (
              <li key={v.version}>
                <button
                  type="button"
                  onClick={() => setShown(v.version)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${v.version === shown ? "bg-gold/[0.14] text-gold" : "text-ink hover:bg-white/[0.05]"}`}
                >
                  <span className={FIGURE}>Version {v.version}</span>
                  <span className="block text-xs text-ink-soft">
                    {new Date(v.createdAt).toLocaleString()}
                    {v.createdBy ? ` · ${v.createdBy}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <div className="space-y-4 text-sm">
              {current.definition.intro && <p className="whitespace-pre-wrap text-ink-soft">{current.definition.intro}</p>}
              {current.definition.sections.map((s) => (
                <div key={s.id}>
                  {s.title && <h3 className="font-display text-base text-ink">{s.title}</h3>}
                  <ol className="mt-1 list-decimal space-y-1.5 pl-5">
                    {s.questions.map((q) => (
                      <li key={q.id} className="text-ink">
                        {q.label}
                        <span className="text-xs text-ink-soft">
                          {" "}
                          · {QUESTION_TYPE_LABEL[q.type]}
                          {q.required ? " · required" : ""}
                          {q.showTo !== "all" ? ` · ${AUDIENCE_LABEL[q.showTo]}` : ""}
                          {q.showIf ? " · conditional" : ""}
                          {q.sensitive ? " · health/sensitive" : ""}
                        </span>
                        {q.options.length > 0 && <span className="block text-xs text-ink-soft">{q.options.join(" · ")}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
