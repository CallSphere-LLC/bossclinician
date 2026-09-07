import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bold,
  Clock,
  Eye,
  Film,
  Italic,
  Layers,
  Link2,
  List,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { CourseLesson, CourseModule, MediaAsset } from "@/types/admin";
import type { Course } from "@/types";
import { formatBytes } from "@/lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  Select,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import {
  AddContentMenu,
  CourseOutline,
  type AddKind,
  type DragPayload,
  type MoveKind,
} from "@/pages/admin/ui/CourseOutline";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/*
 * A stored "module" is called a **section** everywhere she can see it — that's
 * the word a coaching product uses for a chunk of a course, and "module" is
 * software vocabulary. The API and the types still say module, so the two
 * spellings meet here and nowhere else.
 */

/** "45m" / "2h 30m" — a length she'd say out loud. */
function courseLength(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * A lesson's length, in whole minutes, from the video itself.
 *
 * Nobody should be typing this in. She knows how long the file is only by
 * watching it, the number is on the video already, and a wrong one shows on the
 * sales page and in every "2h 30m in total" beside it. Rounded up from anything
 * over zero, because a fifty-second welcome video is "1 min", not "0 min".
 */
function minutesFromSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Whether a stored video reference is already an address a player can load.
 *
 * A pasted Vimeo link and a public upload are; `protected:abc.mp4` is a storage
 * reference and has to be traded for a signed link first.
 */
function isPlayableUrl(reference: string): boolean {
  return /^(https?:\/\/|\/)/i.test(reference.trim());
}

export default function CourseBuilder() {
  const { id } = useParams();
  const courseId = Number(id);

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openModules, setOpenModules] = useState<Set<number>>(new Set());
  const [addingModule, setAddingModule] = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");
  const [lessonDraft, setLessonDraft] = useState<{
    moduleId: number;
    lesson: Partial<CourseLesson>;
  } | null>(null);
  const [picking, setPicking] = useState(false);
  // Pasting a link is the escape hatch for video hosted somewhere else; it stays
  // out of the way until she asks for it, so the normal path is "choose a file".
  const [pastingLink, setPastingLink] = useState(false);
  /*
   * The video the editor can actually play.
   *
   * `lesson.videoUrl` is what gets stored, and for a file only buyers can open
   * that is `protected:abc.mp4` — a reference, not an address. Pointed at a
   * <video> it draws an empty box, which is how a lesson ends up shipping with
   * the wrong file in it. This holds the signed link that plays.
   */
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  /* Only the newest request may set the src: opening two lessons quickly must
     not leave the second one showing the first one's video. */
  const videoRequest = useRef(0);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [confirm, confirmDialog] = useConfirm();
  const navigate = useNavigate();
  const [addingQuiz, setAddingQuiz] = useState<number | null>(null);
  /** Set when content was added from the header and needs a module. */
  const [choosingModule, setChoosingModule] = useState<{ kind: AddKind } | null>(null);
  /** The item just created — scrolled to and briefly highlighted. */
  const [highlightId, setHighlightId] = useState<string | null>(null);

  /**
   * Mark something as just-created.
   *
   * The outline scrolls it into view and rings it; the ring clears itself
   * after a few seconds so it does not become permanent decoration.
   */
  function flag(key: string) {
    setHighlightId(key);
    window.setTimeout(() => setHighlightId((current) => (current === key ? null : current)), 2600);
  }
  const [quizTitle, setQuizTitle] = useState("");
  const [quizKind, setQuizKind] = useState<"quiz" | "graded">("quiz");
  const [renamingModule, setRenamingModule] = useState<{ id: number; title: string } | null>(null);

  /**
   * The §A "+ Add Content" menu, routed to whichever thing was chosen.
   *
   * "Upload multiple videos" reuses the existing media picker one file at a
   * time rather than pretending to a bulk pipeline that does not exist —
   * §I rules out controls that look functional and are not.
   */
  /**
   * The + Add Content menu.
   *
   * Where a new item lands is deliberate: a Module added from the header goes
   * *after* the last one, and content added from a Module's own + Add goes
   * into that Module. Nothing is ever inserted at the top, because the admin
   * is rarely working there and being thrown back to it loses their place.
   * The backend already appends (`MAX(sort) + 1`), so this only has to pass
   * the right container.
   */
  function handleAdd(kind: AddKind, moduleId?: number) {
    if (kind === "module") return setAddingModule(true);

    // Content needs a home. From a Module's + Add we have one; from the header
    // we ask, rather than guessing a module the admin was not looking at.
    const target = moduleId ?? (modules?.length === 1 ? Number(modules[0].id) : null);
    if (target === null) {
      if (!modules || modules.length === 0) {
        return toast.error("Add a module first, then put content inside it.");
      }
      return setChoosingModule({ kind });
    }

    if (kind === "quiz") {
      setQuizTitle("");
      setQuizKind("quiz");
      return setAddingQuiz(target);
    }

    // Lesson, video, audio and resource are all lessons — the content type is
    // what differs, and `course_lessons.content_type` already carries it.
    const contentType =
      kind === "video" ? "video" : kind === "audio" ? "audio" : kind === "resource" ? "pdf" : "text";
    openLesson(target, { published: true, contentType });
    if (kind === "video" || kind === "audio" || kind === "resource") setPicking(true);
  }

  /** The list one item sits in. */
  function siblingIds(kind: MoveKind, parentId: number | null): number[] {
    if (!modules) return [];
    if (kind === "module") return modules.map((m) => Number(m.id));
    const container = modules.find((m) => Number(m.id) === parentId);
    const list = kind === "lesson" ? (container?.lessons ?? []) : (container?.quizzes ?? []);
    return list.map((item) => Number(item.id));
  }

  /**
   * Save a new ordering.
   *
   * The whole list is renumbered and sent as one request, so a failure leaves
   * the outline exactly as it was rather than half-applied.
   */
  async function persistOrder(kind: MoveKind, ids: number[]) {
    try {
      await adminApi.curriculumReorder(courseId, {
        [`${kind}s`]: ids.map((id, index) => ({ id, sort: index })),
      });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "order"));
    }
  }

  /** Drop: move the held item to `toIndex` among its siblings. */
  async function reorder(payload: DragPayload, toIndex: number) {
    const ids = siblingIds(payload.kind, payload.parentId);
    const from = ids.indexOf(payload.id);
    if (from < 0 || from === toIndex) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(toIndex, 0, payload.id);
    await persistOrder(payload.kind, next);
  }

  /** Keyboard: swap with the neighbour in that direction. */
  async function nudge(payload: DragPayload, direction: -1 | 1) {
    const ids = siblingIds(payload.kind, payload.parentId);
    const from = ids.indexOf(payload.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[from], next[to]] = [next[to], next[from]];
    await persistOrder(payload.kind, next);
  }

  async function createQuiz(e: FormEvent) {
    e.preventDefault();
    if (!quizTitle.trim() || addingQuiz === null) return;
    try {
      const quiz = await adminApi.courseQuizCreate(addingQuiz, {
        title: quizTitle.trim(),
        kind: quizKind,
      });
      toast.success("Quiz added — open it to write the questions.");
      setAddingQuiz(null);
      await load();
      // Deliberately staying put: navigating straight to the quiz editor threw
      // the admin out of the course they were building. The new quiz is
      // highlighted where it landed, and one click opens it.
      flag(`quiz-${quiz.id}`);
    } catch (err) {
      toast.error(friendlyError(err, "quiz"));
    }
  }

  async function renameModule(e: FormEvent) {
    e.preventDefault();
    if (!renamingModule?.title.trim()) return;
    try {
      await adminApi.moduleUpdate(renamingModule.id, { title: renamingModule.title.trim() });
      toast.success("Renamed");
      setRenamingModule(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "module"));
    }
  }

  const load = useCallback(() => {
    if (!courseId) return;
    adminApi
      .curriculum(courseId)
      .then((mods) => {
        setModules(mods);
        setError(null);
        // Open everything on first load; a collapsed wall of sections is useless.
        // Submodules are containers too. Seeding only the top level left
        // every subsection collapsed on load, hiding the lessons inside them.
        setOpenModules(
          new Set(
            mods.flatMap((m) => [
              Number(m.id),
              ...(m.submodules ?? []).map((sub) => Number(sub.id)),
            ]),
          ),
        );
      })
      .catch(() => setError("We couldn't load this course. Try refreshing the page."));
  }, [courseId]);

  useEffect(load, [load]);

  useEffect(() => {
    adminApi
      .coursesList()
      .then((list) => setCourse(list.find((c) => Number(c.id) === courseId) ?? null))
      .catch(() => undefined);
  }, [courseId]);

  /*
   * Counted across the whole outline, subsections included.
   *
   * These summed only the top-level sections, so a course whose lessons all
   * sit inside subsections reported "0 lessons" while showing them on screen.
   */
  const flatSections = modules ?? [];
  const lessonCount = flatSections.reduce((sum, m) => sum + m.lessons.length, 0);
  const quizCount = flatSections.reduce((sum, m) => sum + (m.quizzes?.length ?? 0), 0);
  const totalMinutes = flatSections.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + (l.durationMinutes || 0), 0),
    0,
  );

  async function addModule(e: FormEvent) {
    e.preventDefault();
    if (!moduleTitle.trim()) return;
    try {
      // The API appends (`MAX(sort) + 1`), so a new module lands after the
      // last one rather than at the top.
      const created = await adminApi.moduleCreate(courseId, { title: moduleTitle.trim() });
      toast.success("Module added");
      setModuleTitle("");
      setAddingModule(false);
      await load();
      setOpenModules((prev) => new Set(prev).add(Number(created.id)));
      flag(`module-${created.id}`);
    } catch (err) {
      toast.error(friendlyError(err, "module"));
    }
  }

  async function removeModule(mod: CourseModule) {
    const ok = await confirm({
      title: `Delete “${mod.title}”?`,
      description: `${pluralize(mod.lessons.length, "lesson")} inside will go with it, and you can't undo this.`,
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.moduleDelete(mod.id);
      toast.success("Module deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "module"));
    }
  }

  async function saveLesson(e: FormEvent) {
    e.preventDefault();
    if (!lessonDraft?.lesson.title?.trim()) return;

    const { moduleId, lesson } = lessonDraft;
    const payload = {
      title: lesson.title,
      // Set when the item was created from Video / Audio / Resource, so the
      // outline can show it with the right icon and label.
      contentType: lesson.contentType ?? "text",
      bodyMd: lesson.bodyMd ?? "",
      videoUrl: lesson.videoUrl ?? "",
      attachmentUrl: lesson.attachmentUrl ?? "",
      durationMinutes: lesson.durationMinutes ?? 0,
      preview: lesson.preview ?? false,
      published: lesson.published ?? true,
    };

    try {
      let createdId: number | null = null;
      if (lesson.id) {
        await adminApi.lessonUpdate(lesson.id, payload);
      } else {
        const created = await adminApi.lessonCreate(moduleId, payload);
        createdId = Number(created.id);
      }
      toast.success(lesson.id ? "Lesson saved" : "Content added");
      setLessonDraft(null);
      await load();
      if (createdId !== null) flag(`lesson-${createdId}`);
    } catch (err) {
      toast.error(friendlyError(err, "lesson"));
    }
  }

  async function removeLesson(lesson: CourseLesson) {
    const ok = await confirm({
      title: `Delete “${lesson.title}”?`,
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.lessonDelete(lesson.id);
      toast.success("Lesson deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "lesson"));
    }
  }

  function toggleModule(moduleId: number) {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  function openLesson(moduleId: number, lesson: Partial<CourseLesson>) {
    setLessonDraft({ moduleId, lesson });
    setPastingLink(false);
    showVideo(lesson.videoUrl ?? "");
  }

  /**
   * Points the preview at whatever the lesson is holding.
   *
   * A file only buyers can open has no address of its own, so the admin asks the
   * server to sign a short-lived one. Anything already an address — a pasted
   * Vimeo link, a public upload — is used as it is, without a round trip.
   */
  function showVideo(reference: string, alreadyPlayable?: string) {
    const ticket = (videoRequest.current += 1);
    const trimmed = reference.trim();

    if (alreadyPlayable !== undefined) {
      setVideoSrc(alreadyPlayable);
      return;
    }
    if (trimmed === "") {
      setVideoSrc(null);
      return;
    }
    if (isPlayableUrl(trimmed)) {
      setVideoSrc(trimmed);
      return;
    }

    setVideoSrc(null);
    adminApi
      .mediaPreview(trimmed)
      .then((link) => {
        if (videoRequest.current === ticket) setVideoSrc(link.url);
      })
      .catch(() => {
        if (videoRequest.current === ticket) setVideoSrc(null);
      });
  }

  function updateLesson(changes: Partial<CourseLesson>) {
    setLessonDraft((d) => (d ? { ...d, lesson: { ...d.lesson, ...changes } } : d));
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/admin/courses">
          <ArrowLeft />
          All courses
        </Link>
      </Button>

      <PageHeader
        eyebrow="Courses"
        title={course?.title ?? "Course content"}
        description="Build your course from modules, then add lessons, videos and quizzes inside each one."
        actions={
          <>
            <Badge tone="neutral">
              {pluralize(modules?.length ?? 0, "module")} · {pluralize(lessonCount, "lesson")}
              {quizCount > 0 && ` · ${pluralize(quizCount, "quiz", "quizzes")}`}
            </Badge>
            {totalMinutes > 0 && (
              <Badge tone="plum">
                <Clock className="size-3" />
                {courseLength(totalMinutes)} in total
              </Badge>
            )}
            {/* Recommended header actions: Preview | Course Settings | + Add
                Content. Preview opens in a new tab so the builder keeps its
                place. */}
            <Button variant="secondary" size="sm" asChild>
              <a
                href={`/admin/courses/${courseId}/preview`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye />
                Preview
              </a>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/admin/courses">Course Settings</Link>
            </Button>
            <AddContentMenu onAdd={handleAdd} label="Add Content" />
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {modules === null ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <CourseOutline
          modules={modules}
          openIds={openModules}
          onToggle={toggleModule}
          handlers={{
            onAdd: handleAdd,
            onEditModule: (mod) => setRenamingModule({ id: Number(mod.id), title: mod.title }),
            onDeleteModule: removeModule,
            onEditLesson: (moduleId, lesson) => openLesson(moduleId, lesson),
            onDeleteLesson: removeLesson,
            onEditQuiz: (quiz) => navigate(`/admin/marketing/quizzes/${quiz.id}`),
            onReorder: reorder,
            onNudge: nudge,
            highlightId,
          }}
        />
      )}

      {/* Add a section */}
      <Modal
        open={addingModule}
        onOpenChange={setAddingModule}
        title="Add a module"
        description="A module is a major part of your course — a week, a phase, a theme."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddingModule(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-module">
              Add module
            </Button>
          </>
        }
      >
        <form id="new-module" onSubmit={addModule}>
          <Field label="Module name">
            <Input
              value={moduleTitle}
              onChange={(e) => setModuleTitle(e.target.value)}
              placeholder="Part one — Foundations"
              required
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      {/* Which module should this go in? — only asked when the add came from
          the header and there is more than one module to choose between. */}
      <Modal
        open={choosingModule !== null}
        onOpenChange={(open) => !open && setChoosingModule(null)}
        title="Which module?"
        description="Pick where this should go. You can move it afterwards."
      >
        <ul className="space-y-1.5">
          {(modules ?? []).map((mod) => (
            <li key={mod.id}>
              <button
                type="button"
                onClick={() => {
                  const kind = choosingModule?.kind;
                  setChoosingModule(null);
                  if (kind) handleAdd(kind, Number(mod.id));
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-hairline bg-raise px-3.5 py-3 text-left transition-colors hover:border-accent/45"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                  <Layers aria-hidden className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.88rem] font-medium text-ink">
                    {mod.title}
                  </span>
                  <span className="block truncate text-[0.72rem] text-ink-soft">
                    {pluralize(mod.lessons.length + (mod.quizzes?.length ?? 0), "item")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* Rename a section */}
      <Modal
        open={renamingModule !== null}
        onOpenChange={(open) => !open && setRenamingModule(null)}
        title="Rename module"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRenamingModule(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="rename-module">
              Save
            </Button>
          </>
        }
      >
        <form id="rename-module" onSubmit={renameModule}>
          <Field label="Name">
            <Input
              value={renamingModule?.title ?? ""}
              onChange={(e) =>
                setRenamingModule((current) =>
                  current ? { ...current, title: e.target.value } : current,
                )
              }
              required
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      {/* Add a quiz, without leaving the course (§C) */}
      <Modal
        open={addingQuiz !== null}
        onOpenChange={(open) => !open && setAddingQuiz(null)}
        title="Add a quiz"
        description="It goes into this section, and you'll write the questions next."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddingQuiz(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-quiz">
              Add quiz
            </Button>
          </>
        }
      >
        <form id="new-quiz" onSubmit={createQuiz} className="space-y-4">
          <Field label="Quiz name">
            <Input
              value={quizTitle}
              onChange={(e) => setQuizTitle(e.target.value)}
              placeholder="Check what you've learned"
              required
              autoFocus
            />
          </Field>
          <Field
            label="What kind"
            hint="a graded test has a pass mark; a quiz just gives a result"
          >
            <Select
              value={quizKind}
              onChange={(e) => setQuizKind(e.target.value as "quiz" | "graded")}
            >
              <option value="quiz">Quiz</option>
              <option value="graded">Graded test</option>
            </Select>
          </Field>
        </form>
      </Modal>

      {/* Lesson editor */}
      <Modal
        open={lessonDraft !== null}
        onOpenChange={(open) => !open && setLessonDraft(null)}
        title={lessonDraft?.lesson.id ? "Edit this lesson" : "Add a lesson"}
        size="lg"
        footer={
          <>
            {/* Preview inside the lesson editor. Only for a saved lesson —
                an unsaved draft has no id for the preview to open, and
                previewing what is on screen rather than what is stored would
                be a preview of something that does not exist yet. */}
            {lessonDraft?.lesson.id && (
              <Button variant="secondary" size="sm" asChild className="mr-auto">
                <a
                  href={`/admin/courses/${courseId}/preview?step=lesson-${lessonDraft.lesson.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Eye />
                  Preview lesson
                </a>
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setLessonDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="lesson-form">
              Save lesson
            </Button>
          </>
        }
      >
        {lessonDraft && (
          <form id="lesson-form" onSubmit={saveLesson} className="space-y-4">
            <Field label="Lesson name">
              <Input
                value={lessonDraft.lesson.title ?? ""}
                onChange={(e) => updateLesson({ title: e.target.value })}
                placeholder="Why your rates feel stuck"
                required
                autoFocus
              />
            </Field>

            <Field label="Video" hint="students watch this at the top of the lesson">
              <div className="space-y-2.5">
                {lessonDraft.lesson.videoUrl ? (
                  videoSrc ? (
                    <div className="overflow-hidden rounded-xl border border-hairline">
                      <video
                        // Keyed on the source: React reuses one <video> element
                        // across lessons otherwise, and it keeps playing the
                        // last file while the new src loads.
                        key={videoSrc}
                        src={videoSrc}
                        controls
                        preload="metadata"
                        onLoadedMetadata={(e) =>
                          updateLesson({
                            durationMinutes: minutesFromSeconds(e.currentTarget.duration),
                          })
                        }
                        className="max-h-56 w-full bg-ink/5"
                      />
                    </div>
                  ) : (
                    <div className="grid h-24 place-items-center rounded-xl border border-hairline bg-cream text-sm text-ink-soft">
                      Getting your video ready…
                    </div>
                  )
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPicking(true)}>
                    <Film />
                    {lessonDraft.lesson.videoUrl ? "Choose a different one" : "Choose a video"}
                  </Button>
                  {lessonDraft.lesson.videoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        updateLesson({ videoUrl: "", durationMinutes: 0 });
                        showVideo("");
                      }}
                    >
                      Remove it
                    </Button>
                  )}
                  {!pastingLink && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPastingLink(true)}
                    >
                      <Link2 />
                      Or paste a link
                    </Button>
                  )}
                </div>

                {pastingLink && (
                  <Input
                    value={lessonDraft.lesson.videoUrl ?? ""}
                    onChange={(e) => {
                      updateLesson({ videoUrl: e.target.value });
                      showVideo(e.target.value);
                    }}
                    aria-label="Link to a video hosted somewhere else"
                    placeholder="Paste a link to your video, e.g. from Vimeo"
                  />
                )}
              </div>
            </Field>

            <Field label="Lesson notes" hint="what students read under the video">
              <FormattingToolbar
                onFormat={(kind) => {
                  const el = notesRef.current;
                  if (el) applyFormat(el, kind, (value) => updateLesson({ bodyMd: value }));
                }}
              />
              <Textarea
                ref={notesRef}
                rows={6}
                className="rounded-t-none"
                value={lessonDraft.lesson.bodyMd ?? ""}
                onChange={(e) => updateLesson({ bodyMd: e.target.value })}
                placeholder="A short recap, the homework, anything they should have to hand."
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              {/*
               * Read out, never typed in. The length is a fact about the file
               * she just chose, and asking for it invites a number that is
               * wrong on the sales page and in the course total beside it.
               */}
              <div>
                <span className="mb-1.5 block text-[0.8rem] font-semibold text-ink">
                  How long is it?
                </span>
                <p className="rounded-xl border border-hairline bg-cream px-3.5 py-2.5 text-sm text-ink-soft">
                  {lessonDraft.lesson.durationMinutes
                    ? `${lessonDraft.lesson.durationMinutes} min`
                    : "We take this from the video"}
                </p>
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={Boolean(lessonDraft.lesson.preview)}
                    onChange={(e) => updateLesson({ preview: e.target.checked })}
                    className="size-4 rounded border-hairline text-plum"
                  />
                  Free taster
                </label>
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={lessonDraft.lesson.published !== false}
                    onChange={(e) => updateLesson({ published: e.target.checked })}
                    className="size-4 rounded border-hairline text-plum"
                  />
                  Students can see this
                </label>
              </div>
            </div>
          </form>
        )}
      </Modal>

      <VideoPickerModal
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset, seconds) => {
          // The picker already loaded each video's metadata to draw the grid, so
          // the length is known before anything else is fetched.
          updateLesson({
            videoUrl: asset.url,
            ...(seconds === undefined ? {} : { durationMinutes: minutesFromSeconds(seconds) }),
          });
          showVideo(asset.url, asset.previewUrl);
          setPicking(false);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/* ------------------------------------------------------ Formatting toolbar */

type Format = "bold" | "italic" | "bullets" | "link";

/**
 * The marks each button writes. She types words; the buttons add the asterisks
 * and brackets that make them come out bold, italic or as a link.
 */
const MARKS = {
  bold: { prefix: "**", suffix: "**", placeholder: "bold words" },
  italic: { prefix: "*", suffix: "*", placeholder: "italic words" },
  link: { prefix: "[", suffix: "](https://example.com)", placeholder: "link text" },
} as const;

function applyFormat(
  el: HTMLTextAreaElement,
  kind: Format,
  onChange: (value: string) => void,
): void {
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end);

  let inserted: string;
  let bodyStart: number;
  let bodyLength: number;

  if (kind === "bullets") {
    const body = selected || "First point";
    inserted = body
      .split("\n")
      .map((line) => (line.trimStart().startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    bodyStart = start + 2;
    bodyLength = body.length;
  } else {
    const mark = MARKS[kind];
    const body = selected || mark.placeholder;
    inserted = `${mark.prefix}${body}${mark.suffix}`;
    bodyStart = start + mark.prefix.length;
    bodyLength = body.length;
  }

  onChange(value.slice(0, start) + inserted + value.slice(end));

  // React repaints the box before the caret can move, so put it back on the next
  // frame — otherwise every click dumps her at the end of what she's written.
  // With nothing selected we select the sample text, so typing replaces it.
  requestAnimationFrame(() => {
    el.focus();
    if (selected) el.setSelectionRange(start + inserted.length, start + inserted.length);
    else el.setSelectionRange(bodyStart, bodyStart + bodyLength);
  });
}

function FormattingToolbar({ onFormat }: { onFormat: (kind: Format) => void }) {
  const tools: { kind: Format; label: string; icon: ReactNode }[] = [
    { kind: "bold", label: "Make it bold", icon: <Bold /> },
    { kind: "italic", label: "Make it italic", icon: <Italic /> },
    { kind: "bullets", label: "Make a bullet list", icon: <List /> },
    { kind: "link", label: "Add a link", icon: <Link2 /> },
  ];

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-xl border border-b-0 border-hairline bg-raise px-1.5 py-1">
      {tools.map((tool) => (
        <Button
          key={tool.kind}
          type="button"
          variant="ghost"
          size="iconSm"
          title={tool.label}
          aria-label={tool.label}
          onClick={() => onFormat(tool.kind)}
        >
          {tool.icon}
        </Button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- Video chooser */

function VideoPickerModal({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `seconds` is the video's own length, once the browser has read it. */
  onSelect: (asset: MediaAsset, seconds?: number) => void;
}) {
  const [videos, setVideos] = useState<MediaAsset[] | null>(null);
  /* Filled in as each thumbnail reports its metadata, so picking one can set
     the lesson's length without a second look at the file. */
  const [lengths, setLengths] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    adminApi
      .mediaList("video")
      .then(setVideos)
      .catch(() => setVideos([]));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Choose a video"
      description="Pick one you've already added, or drop in a new one."
      size="xl"
    >
      <div className="space-y-5">
        {/* Lesson video is the thing being sold, so it goes to the protected
            root and is delivered only through a signed link. */}
        <UploadDropzone
          compact
          accept="video/*"
          visibility="protected"
          onUploaded={(asset) => setVideos((prev) => (prev ? [asset, ...prev] : [asset]))}
        />

        {videos === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-video w-full" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <EmptyState
            icon={<Film />}
            title="No videos yet"
            description="Drop a video above and it'll be ready to use here."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {videos.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset, lengths[String(asset.id)])}
                className="group overflow-hidden rounded-xl border border-hairline text-left transition-all hover:border-plum hover:shadow-[0_12px_28px_-14px_rgba(15,30,58,0.4)]"
              >
                <span className="relative block aspect-video bg-ink/5">
                  {/* previewUrl, not url: a course video has no public address,
                      and `protected:abc.mp4` in a src draws an empty box. */}
                  <video
                    src={asset.previewUrl}
                    preload="metadata"
                    muted
                    onLoadedMetadata={(e) => {
                      const seconds = e.currentTarget.duration;
                      if (!Number.isFinite(seconds) || seconds <= 0) return;
                      setLengths((prev) => ({ ...prev, [String(asset.id)]: seconds }));
                    }}
                    className="size-full object-cover"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-ink/25 transition-colors group-hover:bg-ink/40">
                    <span className="grid size-9 place-items-center rounded-full bg-night-deep/85 text-gold ring-1 ring-white/20">
                      <Play className="size-4 translate-x-0.5 fill-current" />
                    </span>
                  </span>
                </span>
                <span className="block p-2.5">
                  <span className="block truncate text-xs font-semibold text-ink">
                    {asset.title || asset.originalName}
                  </span>
                  <span className="block text-[0.66rem] text-ink-soft">
                    {lengths[String(asset.id)]
                      ? `${minutesFromSeconds(lengths[String(asset.id)] as number)} min · `
                      : ""}
                    {formatBytes(Number(asset.sizeBytes))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
