import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { assessmentsApi, type AssessmentSummary, type QuizKind } from "@/lib/quizApi";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
} from "@/pages/admin/ui/primitives";
import { DataTable, RowActions } from "@/pages/admin/ui/DataTable";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize, publishLabel, webAddress } from "@/pages/admin/ui/friendly";

/**
 * Every quiz and test, in one list.
 *
 * The two kinds are the whole story of this screen: a quiz adds points up and
 * shows people the result that matches their score, a test has right answers
 * and a pass mark. Which one it is decides what the editor shows next, so it is
 * asked once, here, in those words rather than as a setting to find later.
 */

const KIND_LABEL: Record<QuizKind, string> = {
  quiz: "Quiz",
  graded: "Graded test",
};

const KIND_HINT: Record<QuizKind, string> = {
  quiz: "Points add up to a score, and the score decides which result page they see.",
  graded: "Questions have right answers, and a pass mark decides who passes.",
};

export default function Assessments() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<QuizKind>("quiz");
  const [saving, setSaving] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    assessmentsApi
      .list()
      .then((rows) => {
        setQuizzes(rows);
        setError(null);
      })
      .catch(() => setError("We couldn’t load your quizzes. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  function startNew() {
    setTitle("");
    setKind("quiz");
    setAdding(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;

    setSaving(true);
    try {
      const created = await assessmentsApi.create({ title: name, kind });
      setAdding(false);
      // Straight into the editor: a quiz with no questions is not something to
      // come back to from a list, it is the next thing she is going to do.
      navigate(`/admin/marketing/quizzes/${created.id}`);
    } catch (err) {
      toast.error(friendlyError(err, "quiz"));
    } finally {
      setSaving(false);
    }
  }

  const remove = useCallback(
    async (quiz: AssessmentSummary) => {
      const ok = await confirm({
        title: `Delete the ${quiz.title} quiz?`,
        description:
          "Its questions, its result pages and everyone’s answers go with it. You can’t undo this.",
        confirmLabel: "Yes, delete it",
        destructive: true,
      });
      if (!ok) return;

      try {
        await assessmentsApi.remove(quiz.id);
        toast.success(`“${quiz.title}” is deleted.`);
        load();
      } catch (err) {
        toast.error(friendlyError(err, "quiz"));
      }
    },
    [confirm, load],
  );

  const columns = useMemo<ColumnDef<AssessmentSummary, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Quiz",
        cell: ({ row }) => (
          <Link
            to={`/admin/marketing/quizzes/${row.original.id}`}
            className="flex min-w-0 items-center gap-3 hover:text-plum"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum">
              <ClipboardList className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{row.original.title}</span>
              <span className="block truncate text-xs text-ink-soft">
                {KIND_HINT[row.original.kind]}
              </span>
            </span>
          </Link>
        ),
      },
      {
        accessorKey: "kind",
        header: "What it is",
        cell: ({ row }) => (
          <Badge tone={row.original.kind === "graded" ? "plum" : "blue"}>
            {KIND_LABEL[row.original.kind]}
          </Badge>
        ),
      },
      {
        accessorKey: "questionCount",
        header: "Questions",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.questionCount === 0
              ? "None yet"
              : pluralize(row.original.questionCount, "question")}
          </span>
        ),
      },
      {
        accessorKey: "resultCount",
        header: "Results",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.resultCount === 0
              ? "None yet"
              : pluralize(row.original.resultCount, "result")}
          </span>
        ),
      },
      {
        accessorKey: "attemptCount",
        header: "Taken by",
        cell: ({ row }) => (
          <span className="text-sm text-ink-soft">
            {row.original.attemptCount === 0
              ? "Nobody yet"
              : pluralize(row.original.attemptCount, "person", "people")}
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
        accessorKey: "slug",
        header: "Web address",
        cell: ({ row }) => (
          <span className="text-xs text-ink-soft">{webAddress("quiz", row.original.slug)}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions>
            <Button asChild variant="ghost" size="iconSm" aria-label={`Edit ${row.original.title}`}>
              <Link to={`/admin/marketing/quizzes/${row.original.id}`}>
                <Pencil />
              </Link>
            </Button>
            <Button
              variant="dangerGhost"
              size="iconSm"
              aria-label={`Delete ${row.original.title}`}
              onClick={() => void remove(row.original)}
            >
              <Trash2 />
            </Button>
          </RowActions>
        ),
      },
    ],
    [remove],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Quizzes"
        description="Ask people a few questions, add up their answers, and send each of them the result that fits."
        actions={
          <Button size="sm" onClick={startNew}>
            <Plus />
            Add a quiz
          </Button>
        }
      />

      {error && <ErrorNotice message={error} />}

      <DataTable
        columns={columns}
        data={quizzes}
        searchPlaceholder="Search your quizzes…"
        itemNoun={{ one: "quiz", many: "quizzes" }}
        minWidth="1040px"
        emptyState={
          <EmptyState
            icon={<ClipboardList />}
            title="No quizzes yet"
            description="Add one, write your questions, then set the result each score should land on. Everyone who takes it appears in the editor."
            action={
              <Button size="sm" onClick={startNew}>
                <Plus />
                Add your first quiz
              </Button>
            }
          />
        }
      />

      <Modal
        open={adding}
        onOpenChange={(open) => !open && setAdding(false)}
        title="Add a quiz"
        description="Two questions now, the rest in the editor."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="quiz-form" disabled={saving}>
              {saving ? "Creating…" : "Create and start writing"}
            </Button>
          </>
        }
      >
        <form id="quiz-form" onSubmit={create} className="grid gap-5">
          <Field label="What is this quiz called?" hint="people taking it see this">
            <Input
              aria-label="What this quiz is called"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What kind of practice owner are you?"
              required
              autoFocus
            />
          </Field>

          <fieldset className="grid gap-2.5">
            <legend className="mb-1.5 text-[0.8rem] font-semibold text-ink">
              What sort of quiz is it?
            </legend>
            {(["quiz", "graded"] as const).map((choice) => (
              <label
                key={choice}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors ${
                  kind === choice
                    ? "border-gold/50 bg-gold/[0.08]"
                    : "border-hairline bg-white/[0.03] hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="quiz-kind"
                  value={choice}
                  checked={kind === choice}
                  onChange={() => setKind(choice)}
                  className="mt-0.5 size-4 border-hairline text-plum focus-visible:ring-plum/30"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{KIND_LABEL[choice]}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{KIND_HINT[choice]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}
