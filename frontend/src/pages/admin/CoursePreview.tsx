import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Headphones,
  HelpCircle,
  Lock,
  Play,
} from "lucide-react";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import type { Course } from "@/types";
import type { CourseLesson, CourseModule, CourseQuiz } from "@/types/admin";
import { Badge, Button, ErrorNotice, Skeleton } from "@/pages/admin/ui/primitives";
import { pluralize } from "@/pages/admin/ui/friendly";

/**
 * Course Preview — Course Builder Hierarchy UX Prompt, "Course Preview
 * Requirements".
 *
 * Shows the course as a student meets it, from the current draft, without the
 * course needing to be published.
 *
 * **How the sandbox guarantee is met.** The requirement is absolute: previewing
 * must not create or modify progress, completion, quiz attempts, scores,
 * analytics or engagement. Rather than reuse the member player and try to
 * suppress its writes, this screen never calls a member endpoint at all. The
 * member library route inserts a `lesson_progress` row the moment a lesson is
 * opened (`routes/member/library.ts`), so any preview built on it would record
 * a view for whoever was signed in.
 *
 * Everything here comes from two admin reads — `GET /admin/curriculum/:id` and
 * `POST /admin/media/preview` for a signed media URL. Neither writes. There is
 * no member identity in play, so there is nothing for a write to attach to.
 *
 * Quizzes are shown as a student would first see them — title, kind, question
 * count, pass mark — and deliberately cannot be *taken* here, because taking
 * one is what creates an attempt.
 */

type Step =
  | { kind: "lesson"; lesson: CourseLesson; module: CourseModule }
  | { kind: "quiz"; quiz: CourseQuiz; module: CourseModule };

/** The outline flattened into the order a student moves through it. */
function toSteps(modules: CourseModule[]): Step[] {
  const out: Step[] = [];
  const walk = (mod: CourseModule) => {
    for (const lesson of mod.lessons) out.push({ kind: "lesson", lesson, module: mod });
    for (const quiz of mod.quizzes ?? []) out.push({ kind: "quiz", quiz, module: mod });
    for (const sub of mod.submodules ?? []) walk(sub);
  };
  modules.forEach(walk);
  return out;
}

function stepId(step: Step): string {
  return step.kind === "lesson" ? `lesson-${step.lesson.id}` : `quiz-${step.quiz.id}`;
}

export default function CoursePreview() {
  const { id } = useParams();
  const courseId = Number(id);
  const [params, setParams] = useSearchParams();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    adminApi
      .curriculum(courseId)
      .then((mods) => {
        setModules(mods);
        setOpenIds(
          new Set(
            mods.flatMap((m) => [Number(m.id), ...(m.submodules ?? []).map((s) => Number(s.id))]),
          ),
        );
      })
      .catch(() => setError("We couldn't load this course. Try refreshing the page."));
    adminApi
      .coursesList()
      .then((list) => setCourse(list.find((c) => Number(c.id) === courseId) ?? null))
      .catch(() => undefined);
  }, [courseId]);

  const steps = useMemo(() => toSteps(modules ?? []), [modules]);
  const activeId = params.get("step");
  const index = Math.max(
    0,
    steps.findIndex((s) => stepId(s) === activeId),
  );
  const step = steps[index] ?? steps[0] ?? null;

  const select = useCallback(
    (next: Step) => {
      setParams({ step: stepId(next) }, { replace: true });
    },
    [setParams],
  );

  /* A protected file has no address of its own; the admin signs a short-lived
     one. This is a read: signing grants nothing and records nothing. */
  useEffect(() => {
    setMediaUrl(null);
    if (!step || step.kind !== "lesson") return;
    const reference = (step.lesson.contentType === "audio"
      ? step.lesson.audioUrl
      : step.lesson.videoUrl) ?? "";
    if (!reference.trim()) return;

    let cancelled = false;
    adminApi
      .mediaPreview(reference)
      .then((r) => !cancelled && setMediaUrl(r.url))
      .catch(() => !cancelled && setMediaUrl(null));
    return () => {
      cancelled = true;
    };
  }, [step]);

  const toggle = (moduleId: number) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

  return (
    <div className="min-h-screen bg-cream">
      {/* The banner is not dismissible: everything below it is a simulation,
          and that must never be in doubt. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-accent/30 bg-accent-soft px-4 py-2.5 lg:px-8">
        <p className="flex items-center gap-2 text-[0.84rem] font-medium text-accent">
          <Eye aria-hidden className="size-4 shrink-0" />
          Preview — this is how the course looks to a student. Nothing you do here is recorded.
        </p>
        <Button variant="secondary" size="sm" asChild>
          <Link to={`/admin/courses/${courseId}/curriculum`}>
            <ArrowLeft />
            Back to the builder
          </Link>
        </Button>
      </div>

      <div className="mx-auto max-w-[86rem] px-4 py-6 lg:px-8">
        {error && <ErrorNotice message={error} />}

        <header className="mb-6">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Course
          </p>
          <h1 className="mt-1 font-display text-[1.9rem] leading-tight text-ink">
            {course?.title ?? "Course"}
          </h1>
          {modules && (
            <p className="mt-1.5 text-sm text-ink-soft">
              {pluralize(steps.length, "lesson or quiz")} across{" "}
              {pluralize(modules.length, "section")}
            </p>
          )}
        </header>

        {modules === null ? (
          <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        ) : steps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline px-6 py-16 text-center">
            <p className="font-display text-lg text-ink">There's nothing to preview yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-soft">
              Add a lesson or a quiz in the builder and it will appear here as a student would see
              it.
            </p>
            <div className="mt-5 flex justify-center">
              <Button size="sm" asChild>
                <Link to={`/admin/courses/${courseId}/curriculum`}>Back to the builder</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            {/* ── Course navigation, as a student sees it ─────────────── */}
            <nav aria-label="Course contents" className="lg:sticky lg:top-[4.5rem] lg:self-start">
              <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-console">
                <p className="border-b border-hairline/60 px-4 py-3 text-[0.8rem] font-semibold text-ink">
                  Course contents
                </p>
                <div className="max-h-[70vh] overflow-y-auto p-2">
                  {modules.map((mod) => (
                    <NavSection
                      key={mod.id}
                      mod={mod}
                      depth={0}
                      open={openIds}
                      onToggle={toggle}
                      activeId={step ? stepId(step) : null}
                      onSelect={select}
                    />
                  ))}
                </div>
              </div>
            </nav>

            {/* ── The step itself ─────────────────────────────────────── */}
            <div className="min-w-0">
              {step && (
                <article className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-console">
                  <div className="border-b border-hairline/60 px-6 py-5">
                    <p className="text-[0.74rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                      {step.module.title}
                    </p>
                    <h2 className="mt-1 font-display text-[1.4rem] leading-tight text-ink">
                      {step.kind === "lesson" ? step.lesson.title : step.quiz.title}
                    </h2>
                    {!(step.kind === "lesson" ? step.lesson.published : step.quiz.published) && (
                      <p className="mt-2">
                        <Badge tone="gold">
                          Draft — a student would not see this yet
                        </Badge>
                      </p>
                    )}
                  </div>

                  {step.kind === "lesson" ? (
                    <LessonView lesson={step.lesson} mediaUrl={mediaUrl} />
                  ) : (
                    <QuizView quiz={step.quiz} />
                  )}

                  <div className="flex items-center justify-between gap-3 border-t border-hairline/60 px-6 py-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => steps[index - 1] && select(steps[index - 1])}
                    >
                      <ArrowLeft />
                      Previous
                    </Button>
                    {/* A student would mark this complete here. In preview it
                        is shown disabled rather than hidden, so the admin sees
                        the real shape of the screen — and it writes nothing. */}
                    <span
                      className="hidden items-center gap-1.5 text-[0.76rem] text-ink-soft sm:flex"
                      title="Completion is not recorded in preview"
                    >
                      <CheckCircle2 aria-hidden className="size-4" />
                      Mark complete
                    </span>
                    <Button
                      size="sm"
                      disabled={index >= steps.length - 1}
                      onClick={() => steps[index + 1] && select(steps[index + 1])}
                    >
                      Next
                      <ArrowRight />
                    </Button>
                  </div>
                </article>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Navigation */

function NavSection({
  mod,
  depth,
  open,
  onToggle,
  activeId,
  onSelect,
}: {
  mod: CourseModule;
  depth: number;
  open: Set<number>;
  onToggle: (id: number) => void;
  activeId: string | null;
  onSelect: (step: Step) => void;
}) {
  const isOpen = open.has(Number(mod.id));

  return (
    <div className={cn(depth > 0 && "ml-3 border-l border-hairline/60 pl-2")}>
      <button
        type="button"
        onClick={() => onToggle(Number(mod.id))}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-raise"
      >
        <span className="min-w-0 flex-1 truncate text-[0.82rem] font-semibold text-ink">
          {mod.title}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-ink-soft transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen && (
        <>
          <ul className="space-y-0.5">
            {mod.lessons.map((lesson) => (
              <NavItem
                key={`lesson-${lesson.id}`}
                icon={
                  lesson.contentType === "audio" ? (
                    <Headphones aria-hidden className="size-3.5" />
                  ) : lesson.videoUrl || lesson.contentType === "video" ? (
                    <Play aria-hidden className="size-3.5" />
                  ) : (
                    <FileText aria-hidden className="size-3.5" />
                  )
                }
                label={lesson.title}
                active={activeId === `lesson-${lesson.id}`}
                muted={!lesson.published}
                onClick={() => onSelect({ kind: "lesson", lesson, module: mod })}
              />
            ))}
            {(mod.quizzes ?? []).map((quiz) => (
              <NavItem
                key={`quiz-${quiz.id}`}
                icon={<HelpCircle aria-hidden className="size-3.5" />}
                label={quiz.title}
                active={activeId === `quiz-${quiz.id}`}
                muted={!quiz.published}
                onClick={() => onSelect({ kind: "quiz", quiz, module: mod })}
              />
            ))}
          </ul>
          {(mod.submodules ?? []).map((sub) => (
            <NavSection
              key={sub.id}
              mod={sub}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
              activeId={activeId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  muted,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  muted: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8rem] transition-colors",
          active ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-raise",
        )}
      >
        <span className="shrink-0 text-ink-soft">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {muted && <Lock aria-hidden className="size-3 shrink-0 text-ink-soft" />}
      </button>
    </li>
  );
}

/* --------------------------------------------------------------- The step */

function LessonView({ lesson, mediaUrl }: { lesson: CourseLesson; mediaUrl: string | null }) {
  const type = lesson.contentType || (lesson.videoUrl ? "video" : "text");
  const files = lesson.files ?? [];

  return (
    <div className="space-y-6 px-6 py-6">
      {type === "video" && (
        <div className="overflow-hidden rounded-xl border border-hairline bg-black">
          {mediaUrl ? (
            <video src={mediaUrl} controls className="aspect-video w-full" />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-white/60">
              {lesson.videoUrl ? "Loading the video…" : "No video on this lesson yet"}
            </div>
          )}
        </div>
      )}

      {type === "audio" && (
        <div className="rounded-xl border border-hairline bg-raise px-4 py-4">
          {mediaUrl ? (
            <audio src={mediaUrl} controls className="w-full" />
          ) : (
            <p className="text-sm text-ink-soft">
              {lesson.audioUrl ? "Loading the audio…" : "No audio on this lesson yet"}
            </p>
          )}
        </div>
      )}

      {lesson.bodyMd?.trim() ? (
        // Rendered as pre-wrapped text rather than parsed markdown: the member
        // player has its own renderer, and a second one here could disagree
        // with it — which would make the preview a poor guide to the real thing.
        <div className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-ink">
          {lesson.bodyMd}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">No written content on this lesson yet.</p>
      )}

      {files.length > 0 && (
        <section>
          <h3 className="mb-2.5 text-[0.84rem] font-semibold text-ink">Resources</h3>
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-raise px-3.5 py-2.5"
              >
                <Download aria-hidden className="size-4 shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.85rem] font-medium text-ink">
                    {file.title || file.filename}
                  </span>
                  <span className="block truncate text-[0.72rem] text-ink-soft">
                    {[file.mime, file.sizeBytes ? formatBytes(file.sizeBytes) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {/* Downloading is a member action against a signed, member-bound
                    link. In preview it is shown, not wired. */}
                <span className="shrink-0 text-[0.72rem] text-ink-soft">Download</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QuizView({ quiz }: { quiz: CourseQuiz }) {
  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-md rounded-2xl border border-hairline bg-raise px-6 py-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/10 text-accent">
          <HelpCircle aria-hidden className="size-5" />
        </span>
        <p className="mt-3.5 font-display text-lg text-ink">{quiz.title}</p>
        <p className="mt-1.5 text-sm text-ink-soft">
          {quiz.kind === "graded" ? "Graded test" : "Quiz"} ·{" "}
          {pluralize(quiz.questionCount, "question")}
        </p>
        <p className="mt-5 rounded-lg border border-hairline bg-surface px-3 py-2.5 text-[0.78rem] text-ink-soft">
          A student would start the quiz here. It can&rsquo;t be taken in preview — an attempt
          would be a real one, with a real score.
        </p>
      </div>
    </div>
  );
}
