import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ClipboardList,
  Flag,
  ListChecks,
  Plus,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import {
  OPEN_ENDED,
  QUESTION_KIND_LABEL,
  assessmentsApi,
  describeBand,
  type AnswerDraft,
  type AssessmentDetail,
  type AssessmentDraft,
  type EditableAnswer,
  type EditableQuestion,
  type EditableResult,
  type QuestionDraft,
  type QuestionKind,
  type QuizAttempt,
  type QuizReport,
  type ResultDraft,
} from "@/lib/quizApi";
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
import { DataTable } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize, publishLabel, webAddress } from "@/pages/admin/ui/friendly";

/**
 * One quiz: its questions, the results people are sorted into, and who has
 * taken it.
 *
 * The middle section is the one that earns its keep. A result is a band of
 * scores with a page, a tag and a sequence hanging off it, and every way of
 * showing that as a form ends up reading like a database row. So each one is
 * printed as the sentence it actually is — "if someone scores 8–14, show them
 * the Steady Grower page and tag them Steady Grower" — with the boxes that
 * change it underneath.
 */

const checkboxStyles =
  "size-4 rounded border-hairline text-plum focus-visible:ring-plum/30";

const QUESTION_KINDS: QuestionKind[] = ["single", "multiple", "scale", "text"];

/** "a, b and c" — the clauses of the result sentence, joined the way people talk. */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The biggest total the questions can currently produce.
 *
 * She sets score bands by hand, and the commonest way to strand somebody with
 * no result at all is to write bands that stop below what the answers can add
 * up to. Printing the ceiling next to the bands is what stops that happening
 * before anyone takes the quiz rather than after.
 */
function highestPossibleScore(questions: EditableQuestion[]): number {
  return questions.reduce((total, question) => {
    const weights = (question.answers ?? []).map((answer) => answer.weight);
    if (question.kind === "text" || weights.length === 0) return total;
    // Several answers can be ticked on a "pick any" question, so all of the
    // positive ones count; the others contribute their single best answer.
    if (question.kind === "multiple") {
      return total + weights.filter((weight) => weight > 0).reduce((sum, w) => sum + w, 0);
    }
    return total + Math.max(...weights, 0);
  }, 0);
}

/* ── Boxes that save themselves ─────────────────────────────────────────── */

/**
 * Everything on this screen saves when she moves on to the next box, so there
 * is no Save button per question to hunt for and nothing lost by navigating
 * away mid-edit. The draft is local until then so typing never fights a
 * refresh; it resyncs whenever the stored value changes underneath it.
 */
function InlineText({
  value,
  onCommit,
  label,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Input
      aria-label={label}
      className={className}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function InlineArea({
  value,
  onCommit,
  label,
  placeholder,
  rows = 4,
}: {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  placeholder?: string;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Textarea
      aria-label={label}
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function InlineNumber({
  value,
  onCommit,
  label,
  className,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const next = Number(draft);
    // Half-typed or nonsense goes back to what was stored: saving it as a zero
    // would quietly change the score without her noticing.
    if (draft.trim() === "" || !Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (Math.round(next) !== value) onCommit(Math.round(next));
  }

  return (
    <Input
      aria-label={label}
      className={className}
      inputMode="numeric"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/* ── Questions ──────────────────────────────────────────────────────────── */

function QuestionBlock({
  question,
  index,
  total,
  graded,
  onPatch,
  onMove,
  onDelete,
  onAnswerPatch,
  onAnswerAdd,
  onAnswerDelete,
}: {
  question: EditableQuestion;
  index: number;
  total: number;
  graded: boolean;
  onPatch: (draft: QuestionDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onAnswerPatch: (answerId: number, draft: AnswerDraft) => void;
  onAnswerAdd: () => void;
  onAnswerDelete: (answer: EditableAnswer) => void;
}) {
  const answers = question.answers ?? [];
  const typedAnswer = question.kind === "text";

  return (
    <li className="flex items-start gap-4 px-5 py-5">
      <div className="flex flex-col items-center gap-1 pt-1">
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={`Move question ${index + 1} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <span className="font-display text-sm text-ink-soft">{index + 1}</span>
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={`Move question ${index + 1} down`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[16rem] flex-1">
            <InlineText
              label={`Question ${index + 1}`}
              value={question.prompt}
              placeholder="What do you want to ask?"
              className="font-semibold"
              onCommit={(prompt) => onPatch({ prompt })}
            />
          </div>
          <div className="w-52">
            <select
              className={selectStyles}
              aria-label={`How people answer question ${index + 1}`}
              value={question.kind}
              onChange={(event) => onPatch({ kind: event.target.value as QuestionKind })}
            >
              {QUESTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {QUESTION_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="dangerGhost"
            size="iconSm"
            aria-label={`Delete question ${index + 1}`}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>

        <InlineText
          label={`Note under question ${index + 1}`}
          value={question.helpText}
          placeholder="A note under the question, if it needs one"
          onCommit={(helpText) => onPatch({ helpText })}
        />

        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(event) => onPatch({ required: event.target.checked })}
            className={checkboxStyles}
          />
          They have to answer this one
        </label>

        {typedAnswer ? (
          <p className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3 text-sm text-ink-soft">
            People type their own answer here, so there is nothing to score. You will see what they
            wrote further down the page.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_5rem_auto] items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.1em] text-ink-soft">
              <span>Answer</span>
              <span>Points</span>
              <span className="sr-only">Remove</span>
            </div>

            {answers.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No answers yet — add the choices people pick from.
              </p>
            ) : (
              answers.map((answer) => (
                <div key={answer.id} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2">
                  <InlineText
                    label={`Answer for question ${index + 1}`}
                    value={answer.label}
                    placeholder="An answer they can pick"
                    onCommit={(value) => onAnswerPatch(answer.id, { label: value })}
                  />
                  <InlineNumber
                    label={`Points for “${answer.label}”`}
                    value={answer.weight}
                    onCommit={(weight) => onAnswerPatch(answer.id, { weight })}
                  />
                  <div className="flex items-center gap-1">
                    {graded && (
                      <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-xs text-ink-soft">
                        <input
                          type="checkbox"
                          checked={answer.isCorrect}
                          onChange={(event) =>
                            onAnswerPatch(answer.id, { isCorrect: event.target.checked })
                          }
                          className={checkboxStyles}
                        />
                        This is the right answer
                      </label>
                    )}
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label={`Delete the answer “${answer.label}”`}
                      onClick={() => onAnswerDelete(answer)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            )}

            <Button variant="secondary" size="sm" onClick={onAnswerAdd}>
              <Plus />
              Add an answer
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/* ── Results ────────────────────────────────────────────────────────────── */

function ResultBlock({
  result,
  index,
  total,
  tags,
  sequences,
  onPatch,
  onMove,
  onDelete,
}: {
  result: EditableResult;
  index: number;
  total: number;
  tags: Tag[];
  sequences: SequenceSummary[];
  onPatch: (draft: ResultDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [rangeError, setRangeError] = useState<string | null>(null);
  const openEnded = result.maxScore >= OPEN_ENDED;

  const clauses = [`show them the ${result.title || "untitled"} page`];
  if (result.tagName) clauses.push(`tag them ${result.tagName}`);
  if (result.sequenceName) clauses.push(`start them on ${result.sequenceName}`);

  function commitRange(minScore: number, maxScore: number) {
    if (maxScore < minScore) {
      setRangeError("The lowest score has to be below the highest.");
      return;
    }
    setRangeError(null);
    onPatch({ minScore, maxScore });
  }

  return (
    <li className="flex items-start gap-4 px-5 py-5">
      <div className="flex flex-col items-center gap-1 pt-1">
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={`Move ${result.title || "this result"} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </Button>
        <span className="font-display text-sm text-ink-soft">{index + 1}</span>
        <Button
          size="iconSm"
          variant="ghost"
          aria-label={`Move ${result.title || "this result"} down`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </Button>
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 rounded-xl border border-gold/25 bg-gold/[0.07] px-4 py-3 text-sm leading-relaxed text-ink">
            If someone scores {describeBand(result.minScore, result.maxScore)},{" "}
            {joinClauses(clauses)}.
          </p>
          <div className="flex items-center gap-2">
            {result.attemptCount > 0 && (
              <Badge tone="neutral">
                {pluralize(result.attemptCount, "person", "people")} so far
              </Badge>
            )}
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete the ${result.title || "untitled"} result`}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="What is this result called?" className="md:col-span-2">
            <InlineText
              label="What is this result called?"
              value={result.title}
              placeholder="Steady Grower"
              onCommit={(title) => onPatch({ title })}
            />
          </Field>

          <Field
            label="Scores that land here"
            hint="the total of their answers"
            error={rangeError ?? undefined}
          >
            <div className="flex items-center gap-2">
              <InlineNumber
                label="Lowest score for this result"
                value={result.minScore}
                onCommit={(minScore) => commitRange(minScore, result.maxScore)}
                className="w-24"
              />
              <span className="text-sm text-ink-soft">to</span>
              {openEnded ? (
                <span className="text-sm text-ink-soft">anything above</span>
              ) : (
                <InlineNumber
                  label="Highest score for this result"
                  value={result.maxScore}
                  onCommit={(maxScore) => commitRange(result.minScore, maxScore)}
                  className="w-24"
                />
              )}
            </div>
            <label className="mt-2 flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={openEnded}
                onChange={(event) => {
                  setRangeError(null);
                  onPatch({
                    minScore: result.minScore,
                    maxScore: event.target.checked ? OPEN_ENDED : result.minScore + 10,
                  });
                }}
                className={checkboxStyles}
              />
              and anything above
            </label>
          </Field>

          <Field label="Tag everyone who gets this result" hint="optional">
            <select
              className={selectStyles}
              aria-label={`Tag for everyone who gets the ${result.title || "untitled"} result`}
              value={result.applyTagId === null ? "" : String(result.applyTagId)}
              onChange={(event) =>
                onPatch({ applyTagId: event.target.value ? Number(event.target.value) : null })
              }
            >
              <option value="">Don’t tag them</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Emails they start getting" hint="optional">
            <select
              className={selectStyles}
              aria-label={`Emails started by the ${result.title || "untitled"} result`}
              value={result.subscribeSequenceId === null ? "" : String(result.subscribeSequenceId)}
              onChange={(event) =>
                onPatch({
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

          <Field label="Button on the result page" hint="optional">
            <InlineText
              label="Button on the result page"
              value={result.ctaLabel}
              placeholder="Book a call with me"
              onCommit={(ctaLabel) => onPatch({ ctaLabel })}
            />
          </Field>

          <Field label="Where the button goes" hint="optional">
            <InlineText
              label="Where the button goes"
              value={result.ctaUrl}
              placeholder="/apply"
              onCommit={(ctaUrl) => onPatch({ ctaUrl })}
            />
          </Field>

          <Field
            label="What this result says"
            hint="what they read when they get it"
            className="md:col-span-2"
          >
            <InlineArea
              label="What this result says"
              value={result.bodyMd}
              rows={5}
              placeholder="You are building steadily. Here is what to work on next…"
              onCommit={(bodyMd) => onPatch({ bodyMd })}
            />
          </Field>
        </div>
      </div>
    </li>
  );
}

/* ── The screen ─────────────────────────────────────────────────────────── */

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-white/[0.03] px-4 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
    </div>
  );
}

export default function AssessmentEditor() {
  const params = useParams<{ id: string }>();
  const quizId = Number(params.id);

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [attempts, setAttempts] = useState<QuizAttempt[] | null>(null);
  const [report, setReport] = useState<QuizReport | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [sequences, setSequences] = useState<SequenceSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AssessmentDraft | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    if (!Number.isFinite(quizId)) {
      setError("We couldn’t find that quiz.");
      return;
    }
    assessmentsApi
      .get(quizId)
      .then((row) => {
        setDetail(row);
        setError(null);
      })
      .catch(() => setError("We couldn’t load this quiz just now."));
    assessmentsApi.attempts(quizId).then(setAttempts).catch(() => setAttempts([]));
    assessmentsApi.report(quizId).then(setReport).catch(() => setReport(null));
  }, [quizId]);

  useEffect(load, [load]);

  useEffect(() => {
    contactsApi.tags().then(setTags).catch(() => setTags([]));
    marketingApi.sequences().then(setSequences).catch(() => setSequences([]));
  }, []);

  /* Questions ------------------------------------------------------------ */

  const patchQuestion = useCallback(
    async (questionId: number, draft: QuestionDraft) => {
      try {
        await assessmentsApi.updateQuestion(questionId, draft);
        // Applied from the draft rather than the answer: the update replies with
        // the question alone, and dropping its answers back into state would
        // empty every card on screen.
        setDetail((current) =>
          current
            ? {
                ...current,
                questions: current.questions.map((question) =>
                  question.id === questionId ? { ...question, ...draft } : question,
                ),
              }
            : current,
        );
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
        load();
      }
    },
    [load],
  );

  const addQuestion = useCallback(async () => {
    try {
      await assessmentsApi.addQuestion(quizId, {});
      load();
    } catch (err) {
      toast.error(friendlyError(err, "quiz"));
    }
  }, [quizId, load]);

  const deleteQuestion = useCallback(
    async (question: EditableQuestion) => {
      const ok = await confirm({
        title: `Delete “${question.prompt || "this question"}”?`,
        description: "Its answers go with it, and anyone part-way through simply skips it.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await assessmentsApi.removeQuestion(question.id);
        toast.success("Question deleted");
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [confirm, load],
  );

  const moveQuestion = useCallback(
    async (index: number, direction: -1 | 1) => {
      if (!detail) return;
      const order = detail.questions.map((question) => question.id);
      const target = index + direction;
      if (target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];

      try {
        await assessmentsApi.reorderQuestions(quizId, order);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [detail, quizId, load],
  );

  /* Answers -------------------------------------------------------------- */

  const patchAnswer = useCallback(
    async (answerId: number, draft: AnswerDraft) => {
      try {
        await assessmentsApi.updateAnswer(answerId, draft);
        setDetail((current) =>
          current
            ? {
                ...current,
                questions: current.questions.map((question) => ({
                  ...question,
                  answers: question.answers.map((answer) =>
                    answer.id === answerId ? { ...answer, ...draft } : answer,
                  ),
                })),
              }
            : current,
        );
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
        load();
      }
    },
    [load],
  );

  const addAnswer = useCallback(
    async (questionId: number) => {
      try {
        await assessmentsApi.addAnswer(questionId, {});
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [load],
  );

  const deleteAnswer = useCallback(
    async (answer: EditableAnswer) => {
      const ok = await confirm({
        title: `Delete the answer “${answer.label || "this answer"}”?`,
        description: "Anyone who already picked it keeps the score they were given.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await assessmentsApi.removeAnswer(answer.id);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [confirm, load],
  );

  /* Results -------------------------------------------------------------- */

  const patchResult = useCallback(
    async (resultId: number, draft: ResultDraft) => {
      try {
        await assessmentsApi.updateResult(resultId, draft);
        // Reloaded rather than merged: a tag or sequence change has to come back
        // with its name, which is what the sentence above the boxes reads from.
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [load],
  );

  const addResult = useCallback(async () => {
    try {
      await assessmentsApi.addResult(quizId, {});
      load();
    } catch (err) {
      toast.error(friendlyError(err, "quiz"));
    }
  }, [quizId, load]);

  const deleteResult = useCallback(
    async (result: EditableResult) => {
      const ok = await confirm({
        title: `Delete the ${result.title || "untitled"} result?`,
        description:
          "Anyone whose score lands in this range afterwards will be shown no result at all, so check your other ranges cover it.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await assessmentsApi.removeResult(result.id);
        toast.success("Result deleted");
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [confirm, load],
  );

  const moveResult = useCallback(
    async (index: number, direction: -1 | 1) => {
      if (!detail) return;
      const order = detail.results.map((result) => result.id);
      const target = index + direction;
      if (target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];

      try {
        await assessmentsApi.reorderResults(quizId, order);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [detail, quizId, load],
  );

  /* Settings ------------------------------------------------------------- */

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;

    setSavingSettings(true);
    try {
      await assessmentsApi.update(quizId, settings);
      toast.success("Quiz saved");
      setSettings(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "quiz"));
    } finally {
      setSavingSettings(false);
    }
  }

  const attemptColumns = useMemo<ColumnDef<QuizAttempt, unknown>[]>(
    () => [
      {
        accessorKey: "email",
        header: "Who",
        cell: ({ row }) => (
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">
              {row.original.contactName || row.original.email}
            </span>
            {row.original.contactName && (
              <span className="block truncate text-xs text-ink-soft">{row.original.email}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "completedAt",
        header: "When",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">{formatDateTime(row.original.completedAt)}</span>
        ),
      },
      {
        accessorKey: "score",
        header: "Their score",
        cell: ({ row }) => (
          <span className="text-sm text-ink">
            {row.original.score} out of {row.original.maxScore}
            {row.original.passed !== null && (
              <Badge tone={row.original.passed ? "green" : "red"} className="ml-2">
                {row.original.passed ? "Passed" : "Did not pass"}
              </Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "resultTitle",
        header: "What they were shown",
        cell: ({ row }) =>
          row.original.resultTitle ? (
            <span className="text-sm text-ink">{row.original.resultTitle}</span>
          ) : (
            <span className="text-sm text-red-300">No result matched their score</span>
          ),
      },
    ],
    [],
  );

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorNotice message={error} />
        <Button asChild size="sm" variant="secondary">
          <Link to="/admin/marketing/quizzes">
            <ArrowLeft />
            All quizzes
          </Link>
        </Button>
      </div>
    );
  }
  if (!detail) return <Skeleton className="h-96 rounded-2xl" />;

  const graded = detail.kind === "graded";
  const ceiling = highestPossibleScore(detail.questions);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={graded ? "Graded test" : "Quiz"}
        title={detail.title}
        description={`People take it at ${webAddress("quiz", detail.slug)}`}
        actions={
          <>
            <Badge tone={detail.published ? "green" : "slate"}>
              {publishLabel(detail.published)}
            </Badge>
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/marketing/quizzes">
                <ArrowLeft />
                All quizzes
              </Link>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setSettings({
                  title: detail.title,
                  introMd: detail.introMd,
                  requireEmail: detail.requireEmail,
                  showFeedback: detail.showFeedback,
                  passMark: detail.passMark,
                  published: detail.published,
                })
              }
            >
              <Settings />
              Settings
            </Button>
          </>
        }
      />

      <Card className="border-gold/25 p-4">
        <p className="text-sm leading-relaxed text-ink-soft">
          Every answer is worth some points. Add up the points from everything somebody picks and
          that total is their score — and their score is what decides which result they are shown.
          Changes here save themselves as soon as you move on to the next box.
        </p>
      </Card>

      {/* ------------------------------------------------------- questions */}

      <Card>
        <CardHeader
          title="Questions"
          subtitle="People answer these in order. Set the points each answer is worth."
          icon={<ClipboardList />}
          action={
            <Button size="sm" onClick={() => void addQuestion()}>
              <Plus />
              Add a question
            </Button>
          }
        />

        {detail.questions.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No questions yet"
            description="Add your first question and the answers people can pick from. Each answer carries the points that make up their score."
            action={
              <Button size="sm" onClick={() => void addQuestion()}>
                <Plus />
                Add the first question
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {detail.questions.map((question, index) => (
              <QuestionBlock
                key={question.id}
                question={question}
                index={index}
                total={detail.questions.length}
                graded={graded}
                onPatch={(draft) => void patchQuestion(question.id, draft)}
                onMove={(direction) => void moveQuestion(index, direction)}
                onDelete={() => void deleteQuestion(question)}
                onAnswerPatch={(answerId, draft) => void patchAnswer(answerId, draft)}
                onAnswerAdd={() => void addAnswer(question.id)}
                onAnswerDelete={(answer) => void deleteAnswer(answer)}
              />
            ))}
          </ol>
        )}
      </Card>

      {/* --------------------------------------------------------- results */}

      <Card>
        <CardHeader
          title="Results"
          subtitle={
            ceiling > 0
              ? `The most anyone can score right now is ${ceiling}, so your ranges need to cover 0 to ${ceiling}.`
              : "Each result covers a range of scores. Everyone who lands in that range sees the same page."
          }
          icon={<ListChecks />}
          action={
            <Button size="sm" onClick={() => void addResult()}>
              <Plus />
              Add a result
            </Button>
          }
        />

        {detail.results.length > 1 && (
          <p className="border-b border-hairline/60 px-5 py-3 text-sm text-ink-soft">
            The order matters: if two ranges overlap, whichever is nearer the top wins. Use the
            arrows to move one above another.
          </p>
        )}

        {detail.results.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title="No results yet"
            description="Add the pages people can land on — one per range of scores. Without one, somebody can finish the quiz and be shown nothing at all."
            action={
              <Button size="sm" onClick={() => void addResult()}>
                <Plus />
                Add the first result
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {detail.results.map((result, index) => (
              <ResultBlock
                key={result.id}
                result={result}
                index={index}
                total={detail.results.length}
                tags={tags}
                sequences={sequences}
                onPatch={(draft) => void patchResult(result.id, draft)}
                onMove={(direction) => void moveResult(index, direction)}
                onDelete={() => void deleteResult(result)}
              />
            ))}
          </ol>
        )}
      </Card>

      {/* -------------------------------------------------- who's taken it */}

      <div className="space-y-4">
        <div>
          <h2 className="font-display text-lg text-ink">Who’s taken it</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Everyone who finished, what they scored, and which result they were shown.
          </p>
        </div>

        {report && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Finished it" value={String(report.attempts)} />
            <StatTile label="Average score" value={`${report.averagePercent}%`} />
            <StatTile
              label={graded ? "Passed" : "Shown a result"}
              value={String(graded ? report.passed : report.attempts - report.unmatched)}
            />
            <StatTile label="Shown nothing" value={String(report.unmatched)} />
          </div>
        )}

        {report && report.unmatched > 0 && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-200"
          >
            <Flag className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {pluralize(report.unmatched, "person", "people")} finished this quiz and were shown no
              result at all — their score fell outside every range above. Widen a range, or add one
              that covers the scores you are missing.
            </span>
          </div>
        )}

        <DataTable
          columns={attemptColumns}
          data={attempts}
          searchPlaceholder="Search by name or email…"
          itemNoun={{ one: "person", many: "people" }}
          minWidth="820px"
          emptyState={
            <EmptyState
              icon={<Users />}
              title="Nobody has taken it yet"
              description="Once this quiz is live on your site, everyone who finishes it shows up here with their score."
            />
          }
        />
      </div>

      {/* -------------------------------------------------------- settings */}

      <Modal
        open={settings !== null}
        onOpenChange={(open) => !open && setSettings(null)}
        title="Quiz settings"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSettings(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="quiz-settings" disabled={savingSettings}>
              {savingSettings ? "Saving…" : "Save settings"}
            </Button>
          </>
        }
      >
        {settings && (
          <form id="quiz-settings" onSubmit={saveSettings} className="grid gap-4">
            <Field label="What is this quiz called?" hint="people taking it see this">
              <Input
                aria-label="What this quiz is called"
                value={settings.title ?? ""}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, title: event.target.value }))
                }
                required
                autoFocus
              />
            </Field>

            <Field label="What people read before they start" hint="optional">
              <Textarea
                rows={4}
                aria-label="What people read before they start"
                value={settings.introMd ?? ""}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, introMd: event.target.value }))
                }
                placeholder="Six quick questions. You will get your result straight away."
              />
            </Field>

            {graded && (
              <Field label="Pass mark" hint="out of 100">
                <Input
                  inputMode="numeric"
                  aria-label="Pass mark out of 100"
                  value={settings.passMark === null ? "" : String(settings.passMark ?? "")}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9]/g, "");
                    setSettings((current) => ({
                      ...current,
                      passMark: raw === "" ? null : Number(raw),
                    }));
                  }}
                  placeholder="70"
                />
              </Field>
            )}

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={Boolean(settings.requireEmail)}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, requireEmail: event.target.checked }))
                }
                className={`mt-0.5 ${checkboxStyles}`}
              />
              <span>
                Ask for an email address before showing the result
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Turn this off and more people finish, but you will not know who they were.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={Boolean(settings.showFeedback)}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, showFeedback: event.target.checked }))
                }
                className={`mt-0.5 ${checkboxStyles}`}
              />
              <span>
                Show people which answers they got right
                <span className="mt-0.5 block text-xs text-ink-soft">
                  They see this on the result page, question by question.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={Boolean(settings.published)}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, published: event.target.checked }))
                }
                className={`mt-0.5 ${checkboxStyles}`}
              />
              <span>
                Live on your site
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {settings.published
                    ? `Anyone can take it at ${webAddress("quiz", detail.slug)}.`
                    : "Nobody can take it yet."}
                </span>
              </span>
            </label>
          </form>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
