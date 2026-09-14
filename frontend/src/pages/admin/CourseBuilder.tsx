import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  ChevronDown,
  Clock,
  Film,
  Italic,
  Layers,
  Link2,
  List,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { assessmentsApi, type AssessmentSummary } from "@/lib/quizApi";
import type { CourseLesson, CourseModule, LessonFile, MediaAsset } from "@/types/admin";
import type { Course } from "@/types";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  selectStyles,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { UploadDropzone } from "@/pages/admin/ui/Uploader";
import { PUBLISH_LABEL, friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/*
 * A stored "module" is called a **section** everywhere she can see it — that's
 * the word a coaching product uses for a chunk of a course, and "module" is
 * software vocabulary. The API and the types still say module, so the two
 * spellings meet here and nowhere else.
 */

/**
 * The release schedule, as the API hands it over.
 *
 * `dripDate` is a UTC instant and `dripDateLocal` is the day that instant means
 * in the release time zone from Settings → Delivery. The date box reads the
 * second one: taking the day out of the instant here would show 28 February for
 * a launch the owner set to 1 March, because the browser is not in her zone.
 *
 * Kept local to this screen because the shared row types in `@/types/admin`
 * still describe the course builder as it was before it could set any of this.
 */
interface Drip {
  dripDays?: number | null;
  dripDate?: string | null;
  dripDateLocal?: string | null;
}

/**
 * The lesson columns the member player already reads and the shared row type
 * has never carried — because until the admin allowlist was widened, nothing
 * could write them and there was nothing for the screen to hold.
 */
interface LessonExtras {
  contentType?: string;
  commentsEnabled?: boolean;
  audioUrl?: string;
  thumbnailUrl?: string;
  requiresPreviousLesson?: boolean;
  assessmentId?: number | null;
  assessmentSlug?: string | null;
  assessmentTitle?: string | null;
}

type BuilderLesson = CourseLesson & Drip & LessonExtras;
type BuilderModule = Omit<CourseModule, "lessons"> & Drip & { lessons: BuilderLesson[] };

/** The three shapes a schedule can take, as the dropdown offers them. */
type DripMode = "immediately" | "days" | "date";

interface DripChoice {
  mode: DripMode;
  /** Only read in "days" mode; kept while she flips between modes. */
  days: string;
  /** "YYYY-MM-DD". Only read in "date" mode. */
  date: string;
}

function dripChoice(item: Drip): DripChoice {
  // A date beats a day count, the same way the server resolves a row that
  // somehow holds both, so the screen can never disagree with the unlock the
  // member actually gets.
  if (item.dripDateLocal) return { mode: "date", days: "", date: item.dripDateLocal };
  if (item.dripDays && item.dripDays > 0) {
    return { mode: "days", days: String(item.dripDays), date: "" };
  }
  return { mode: "immediately", days: "", date: "" };
}

/**
 * The schedule half of a save.
 *
 * Both keys go on every request, including the nulls: leaving one out would let
 * a section keep a stale launch date after being switched to "7 days after they
 * buy", and the date is the one the engine would honour.
 */
function dripBody(choice: DripChoice): { dripDays: number | null; dripDate: string | null } {
  if (choice.mode === "days") {
    const days = Number(choice.days);
    return { dripDays: Number.isFinite(days) && days > 0 ? days : null, dripDate: null };
  }
  if (choice.mode === "date") return { dripDays: null, dripDate: choice.date || null };
  return { dripDays: null, dripDate: null };
}

/** "Opens 7 days after they buy" — the line under a section or lesson name. */
function dripSummary(item: Drip): string | null {
  if (item.dripDateLocal) {
    const [year, month, day] = item.dripDateLocal.split("-").map(Number);
    // Built from the parts at midday: `new Date("2026-03-01")` is midnight UTC
    // and prints as 28 February for anybody west of Greenwich.
    const at = new Date(Date.UTC(year, month - 1, day, 12));
    return `Opens ${at.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  if (item.dripDays && item.dripDays > 0) {
    return `Opens ${pluralize(item.dripDays, "day")} after they buy`;
  }
  return null;
}

/**
 * What a lesson is, in the words the outline and the player already use.
 *
 * The column is CHECK-constrained to exactly these six and the member player
 * switches on it to decide what to draw, so a video lesson left at the "text"
 * default shows students the notes and no player at all. Assessment is accepted
 * by the API for the future graded-test player, but is deliberately not offered
 * here until that player and pass gating are complete — a dead Quiz choice is
 * worse than an honest missing feature.
 */
const LESSON_KINDS: { value: string; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "text", label: "Reading" },
  { value: "pdf", label: "PDF" },
  { value: "embed", label: "Something embedded" },
  { value: "assessment", label: "Quiz or survey" },
];

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
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<BuilderModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openModules, setOpenModules] = useState<Set<number>>(new Set());
  const [addingModule, setAddingModule] = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");
  /** The section being renamed or rescheduled; null when nothing is open. */
  const [moduleDraft, setModuleDraft] = useState<{
    id: number;
    title: string;
    drip: DripChoice;
  } | null>(null);
  const [lessonDraft, setLessonDraft] = useState<{
    moduleId: number;
    lesson: Partial<BuilderLesson>;
    newAssessmentKind?: "graded" | "survey";
    drip: DripChoice;
  } | null>(null);
  const [savingLesson, setSavingLesson] = useState(false);
  const [picking, setPicking] = useState(false);
  const [lessonFiles, setLessonFiles] = useState<LessonFile[]>([]);
  const [gradedTests, setGradedTests] = useState<AssessmentSummary[]>([]);
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

  const load = useCallback(() => {
    if (!courseId) return;
    adminApi
      .curriculum(courseId)
      .then((mods) => {
        setModules(mods);
        setError(null);
        // Open everything on first load; a collapsed wall of sections is useless.
        setOpenModules(new Set(mods.map((m) => m.id)));
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

  useEffect(() => {
    assessmentsApi.list()
      .then((rows) => setGradedTests(rows.filter((assessment) => assessment.kind === "graded" || assessment.kind === "survey")))
      .catch(() => setGradedTests([]));
  }, []);

  const lessonCount = (modules ?? []).reduce((sum, m) => sum + m.lessons.length, 0);
  const totalMinutes = (modules ?? []).reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + (l.durationMinutes || 0), 0),
    0,
  );

  async function addModule(e: FormEvent) {
    e.preventDefault();
    if (!moduleTitle.trim()) return;
    try {
      await adminApi.moduleCreate(courseId, { title: moduleTitle.trim() });
      toast.success("Section added");
      setModuleTitle("");
      setAddingModule(false);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "section"));
    }
  }

  async function saveModule(e: FormEvent) {
    e.preventDefault();
    if (!moduleDraft?.title.trim()) return;
    try {
      await adminApi.moduleUpdate(moduleDraft.id, {
        title: moduleDraft.title.trim(),
        ...dripBody(moduleDraft.drip),
      });
      toast.success("Section saved");
      setModuleDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "section"));
    }
  }

  /**
   * Moves a section one place up or down the course.
   *
   * Every row whose position changed is written, not only the pair that swapped.
   * `sort` defaults to 0 and nothing has ever been able to reorder a course, so
   * a live course has runs of sections all sitting on the same number — swapping
   * two identical values there moves nothing, and the arrow looks broken.
   *
   * The list is reordered on screen before the writes land, because an arrow
   * that takes two round trips to move the row gets clicked again.
   */
  async function moveModule(index: number, direction: -1 | 1) {
    if (!modules) return;
    const target = index + direction;
    if (target < 0 || target >= modules.length) return;

    const reordered = [...modules];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setModules(reordered);

    try {
      await Promise.all(
        reordered
          .map((mod, position) => ({ mod, position }))
          .filter(({ mod, position }) => mod.sort !== position)
          .map(({ mod, position }) => adminApi.moduleUpdate(Number(mod.id), { sort: position })),
      );
    } catch (err) {
      toast.error(friendlyError(err, "section"));
    }
    // Reloaded either way: on success to pick up the stored sort, and on failure
    // so the screen stops showing an order the server never accepted.
    load();
  }

  async function removeModule(mod: BuilderModule) {
    const ok = await confirm({
      title: `Delete “${mod.title}”?`,
      description: `${pluralize(mod.lessons.length, "lesson")} inside will go with it, and you can't undo this.`,
      confirmLabel: "Yes, delete it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi.moduleDelete(mod.id);
      toast.success("Section deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "section"));
    }
  }

  async function saveLesson(e: FormEvent) {
    e.preventDefault();
    if (!lessonDraft?.lesson.title?.trim() || savingLesson) return;
    setSavingLesson(true);

    const { moduleId, lesson } = lessonDraft;
    const payload = {
      title: lesson.title,
      bodyMd: lesson.bodyMd ?? "",
      videoUrl: lesson.videoUrl ?? "",
      audioUrl: lesson.audioUrl ?? "",
      attachmentUrl: lesson.attachmentUrl ?? "",
      thumbnailUrl: lesson.thumbnailUrl ?? "",
      durationMinutes: lesson.durationMinutes ?? 0,
      preview: lesson.preview ?? false,
      published: lesson.published ?? true,
      contentType: lesson.contentType || "text",
      commentsEnabled: lesson.commentsEnabled !== false,
      requiresPreviousLesson: lesson.requiresPreviousLesson === true,
      ...dripBody(lessonDraft.drip),
    };

    try {
      const saved = lesson.id
        ? await adminApi.lessonUpdate(lesson.id, payload)
        : await adminApi.lessonCreate(moduleId, payload);
      // Retain the saved lesson if linking fails so retry never creates a duplicate.
      setLessonDraft(current => current ? { ...current, lesson: { ...current.lesson, id: Number(saved.id) } } : current);
      if (lessonDraft.newAssessmentKind && lesson.contentType === "assessment") {
        const assessment = await assessmentsApi.create({
          title: lesson.title!, kind: lessonDraft.newAssessmentKind,
          lessonId: Number(saved.id), requireEmail: false, published: false,
          passMark: lessonDraft.newAssessmentKind === "graded" ? 70 : null,
          requirePass: lessonDraft.newAssessmentKind === "graded",
        });
        setLessonDraft(null);
        toast.success("Lesson added. Add your questions, then publish when ready.");
        navigate(`/admin/marketing/quizzes/${assessment.id}`);
        return;
      }
      const selectedAssessmentId = lesson.contentType === "assessment"
        ? Number(lesson.assessmentId) || null
        : null;
      const linkedBefore = lesson.id
        ? modules?.flatMap((section) => section.lessons).find((item) => item.id === lesson.id)?.assessmentId
        : null;
      if (linkedBefore && Number(linkedBefore) !== selectedAssessmentId) {
        await assessmentsApi.update(Number(linkedBefore), { lessonId: null });
      }
      if (selectedAssessmentId) {
        await assessmentsApi.update(selectedAssessmentId, {
          lessonId: Number(saved.id),
          requireEmail: false,
        });
      }
      toast.success(lesson.id ? "Lesson saved" : "Lesson added");
      setLessonDraft(null);
      load();
    } catch (err) {
      toast.error(friendlyError(err, "lesson"));
    } finally {
      setSavingLesson(false);
    }
  }

  async function removeLesson(lesson: BuilderLesson) {
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

  async function moveLesson(moduleId: number, index: number, direction: -1 | 1) {
    if (!modules) return;
    const moduleIndex = modules.findIndex((mod) => mod.id === moduleId);
    if (moduleIndex < 0) return;
    const lessons = [...modules[moduleIndex].lessons];
    const target = index + direction;
    if (target < 0 || target >= lessons.length) return;
    [lessons[index], lessons[target]] = [lessons[target], lessons[index]];
    const optimistic = modules.map((mod, at) => (at === moduleIndex ? { ...mod, lessons } : mod));
    setModules(optimistic);

    try {
      await Promise.all(
        lessons
          .map((lesson, position) => ({ lesson, position }))
          .filter(({ lesson, position }) => lesson.sort !== position)
          .map(({ lesson, position }) => adminApi.lessonUpdate(lesson.id, { sort: position })),
      );
    } catch (err) {
      toast.error(friendlyError(err, "lesson"));
    }
    load();
  }

  function toggleModule(moduleId: number) {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  function openLesson(moduleId: number, lesson: Partial<BuilderLesson>) {
    setLessonDraft({ moduleId, lesson, drip: dripChoice(lesson) });
    setPastingLink(false);
    showVideo(lesson.videoUrl ?? "");
    if (lesson.id) adminApi.lessonFiles(lesson.id).then(setLessonFiles).catch(() => setLessonFiles([]));
    else setLessonFiles([]);
  }

  function openAssessment(moduleId: number, kind: "graded" | "survey") {
    openLesson(moduleId, { title: "", published: false, durationMinutes: 0, contentType: "assessment" });
    setLessonDraft(current => current ? { ...current, newAssessmentKind: kind } : current);
  }

  async function attachLessonFile(asset: MediaAsset) {
    const lessonId = lessonDraft?.lesson.id;
    if (!lessonId) return;
    try {
      const file = await adminApi.lessonFileAdd(lessonId, {
        mediaId: asset.id,
        title: asset.title || asset.originalName,
        storagePath: asset.url,
        filename: asset.originalName,
        mime: asset.mime,
        sizeBytes: Number(asset.sizeBytes),
        sort: lessonFiles.length,
      });
      setLessonFiles((files) => [...files, file]);
      toast.success("Download attached");
    } catch (err) {
      toast.error(friendlyError(err, "file"));
    }
  }

  async function removeLessonFile(file: LessonFile) {
    const lessonId = lessonDraft?.lesson.id;
    if (!lessonId) return;
    try {
      await adminApi.lessonFileDelete(lessonId, file.id);
      setLessonFiles((files) => files.filter((entry) => entry.id !== file.id));
      toast.success("Download removed");
    } catch (err) {
      toast.error(friendlyError(err, "file"));
    }
  }

  function updateDrip(drip: DripChoice) {
    setLessonDraft((d) => (d ? { ...d, drip } : d));
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

  function updateLesson(changes: Partial<BuilderLesson>) {
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
        description="Break your course into sections, then add the lessons that go inside each one."
        actions={
          <>
            <Badge tone="neutral">
              {pluralize(modules?.length ?? 0, "section")} · {pluralize(lessonCount, "lesson")}
            </Badge>
            {totalMinutes > 0 && (
              <Badge tone="plum">
                <Clock className="size-3" />
                {courseLength(totalMinutes)} in total
              </Badge>
            )}
            <Button size="sm" onClick={() => setAddingModule(true)}>
              <Plus />
              Add a section
            </Button>
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
      ) : modules.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers />}
            title="Nothing in this course yet"
            description="Start with your first section — something like “Getting started” — then fill it with lessons."
            action={
              <Button size="sm" onClick={() => setAddingModule(true)}>
                <Plus />
                Add a section
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {modules.map((mod, index) => {
            const open = openModules.has(mod.id);
            return (
              <Card key={mod.id} className="overflow-hidden">
                <div className="flex items-center gap-3 border-b border-hairline/60 px-4 py-3.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-lilac-tint text-xs font-bold text-plum-deep">
                    {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleModule(mod.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-display text-base text-ink">
                        {mod.title}
                      </span>
                      <span className="block text-xs text-ink-soft">
                        {mod.lessons.length === 0
                          ? "No lessons yet"
                          : pluralize(mod.lessons.length, "lesson")}
                        {dripSummary(mod) ? ` · ${dripSummary(mod)}` : ""}
                      </span>
                    </span>
                    <motion.span animate={{ rotate: open ? 180 : 0 }} className="ml-auto shrink-0">
                      <ChevronDown className="size-4 text-ink-soft" />
                    </motion.span>
                  </button>
                  {/* Order is the order students meet the course in, so it is
                      changed here rather than being an implicit fact about when
                      each section happened to be created. */}
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={`Move ${mod.title} up`}
                    disabled={index === 0}
                    onClick={() => moveModule(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={`Move ${mod.title} down`}
                    disabled={index === modules.length - 1}
                    onClick={() => moveModule(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Edit ${mod.title} and its release schedule`}
                    onClick={() =>
                      setModuleDraft({
                        id: Number(mod.id),
                        title: mod.title,
                        drip: dripChoice(mod),
                      })
                    }
                  >
                    <Pencil />
                    Edit section
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Delete ${mod.title}`}
                    onClick={() => removeModule(mod)}
                  >
                    <Trash2 />
                  </Button>
                </div>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      {mod.lessons.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-ink-soft">
                          Nothing in this section yet — add your first lesson below.
                        </p>
                      ) : (
                        <ul className="divide-y divide-hairline/60">
                          {mod.lessons.map((lesson, lessonIndex) => (
                            <li
                              key={lesson.id}
                              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-lilac-tint/25"
                            >
                              <span
                                className={cn(
                                  "grid size-8 shrink-0 place-items-center rounded-lg",
                                  lesson.videoUrl
                                    ? "bg-plum/10 text-plum"
                                    : "bg-cream text-ink-soft",
                                )}
                              >
                                {lesson.videoUrl ? (
                                  <Play className="size-3.5 fill-current" />
                                ) : (
                                  <Film className="size-3.5" />
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => openLesson(mod.id, lesson)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate text-sm font-medium text-ink">
                                  {lesson.title}
                                </span>
                                <span className="block text-xs text-ink-soft">
                                  {lesson.durationMinutes
                                    ? `${lesson.durationMinutes} min`
                                    : "Length not set"}
                                  {lesson.videoUrl ? " · has a video" : " · no video yet"}
                                  {dripSummary(lesson) ? ` · ${dripSummary(lesson)}` : ""}
                                </span>
                              </button>
                              {lesson.preview && <Badge tone="gold">Free taster</Badge>}
                              {!lesson.published && <Badge tone="slate">{PUBLISH_LABEL.draft}</Badge>}
                              <Button
                                variant="ghost"
                                size="iconSm"
                                aria-label={`Move ${lesson.title} up`}
                                disabled={lessonIndex === 0}
                                onClick={() => moveLesson(mod.id, lessonIndex, -1)}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                variant="ghost"
                                size="iconSm"
                                aria-label={`Move ${lesson.title} down`}
                                disabled={lessonIndex === mod.lessons.length - 1}
                                onClick={() => moveLesson(mod.id, lessonIndex, 1)}
                              >
                                <ArrowDown />
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => openLesson(mod.id, lesson)}
                              >
                                <Pencil />
                                Edit &amp; schedule
                              </Button>
                              <Button
                                variant="dangerGhost"
                                size="iconSm"
                                aria-label={`Delete ${lesson.title}`}
                                onClick={() => removeLesson(lesson)}
                              >
                                <Trash2 />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="flex flex-wrap gap-2 border-t border-hairline/60 p-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() =>
                            openLesson(mod.id, { title: "", published: true, durationMinutes: 0 })
                          }
                        >
                          <Plus />
                          Add a lesson
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => openAssessment(mod.id, "graded")}><Plus />Add quiz</Button>
                        <Button variant="secondary" size="sm" onClick={() => openAssessment(mod.id, "survey")}><Plus />Add survey</Button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add a section */}
      <Modal
        open={addingModule}
        onOpenChange={setAddingModule}
        title="Add a section"
        description="A section is a chunk of your course — a week, a phase, a theme."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddingModule(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="new-module">
              Add section
            </Button>
          </>
        }
      >
        <form id="new-module" onSubmit={addModule}>
          <Field label="Section name">
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

      {/* Rename a section, and say when it opens */}
      <Modal
        open={moduleDraft !== null}
        onOpenChange={(open) => !open && setModuleDraft(null)}
        title="Edit this section"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setModuleDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="edit-module">
              Save section
            </Button>
          </>
        }
      >
        {moduleDraft && (
          <form id="edit-module" onSubmit={saveModule} className="space-y-4">
            <Field label="Section name">
              <Input
                value={moduleDraft.title}
                onChange={(e) => setModuleDraft({ ...moduleDraft, title: e.target.value })}
                placeholder="Part one — Foundations"
                required
                autoFocus
              />
            </Field>

            <DripFields
              value={moduleDraft.drip}
              onChange={(drip) => setModuleDraft({ ...moduleDraft, drip })}
              noun="section"
            />
          </form>
        )}
      </Modal>

      {/* Lesson editor */}
      <Modal
        open={lessonDraft !== null}
        onOpenChange={(open) => !open && setLessonDraft(null)}
        title={lessonDraft?.newAssessmentKind ? (lessonDraft.newAssessmentKind === "graded" ? "Add quiz" : "Add survey") : lessonDraft?.lesson.id ? "Edit this lesson" : "Add a lesson"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setLessonDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="lesson-form" disabled={savingLesson}>
              {savingLesson ? "Saving…" : lessonDraft?.newAssessmentKind ? "Save and add questions" : "Save lesson"}
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

            <Field
              label="What is this lesson?"
              hint="decides what students get shown — a player, reading, PDF, embed or graded test"
            >
              <select
                className={selectStyles}
                value={lessonDraft.lesson.contentType || "text"}
                disabled={!!lessonDraft.newAssessmentKind}
                onChange={(e) => updateLesson({ contentType: e.target.value })}
              >
                {LESSON_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </Field>

            {lessonDraft.newAssessmentKind && <p className="rounded-xl border border-hairline bg-panel p-4 text-sm text-ink-soft">
              {lessonDraft.newAssessmentKind === "graded"
                ? "Add questions and correct answers next. This quiz starts with a 70% pass mark and keeps the next lesson locked until the student passes. You can change these rules in the quiz editor."
                : "Add choice, rating or written questions next. Survey responses are saved for each student, without a pass mark."}
              {" "}The lesson and assessment start as drafts so you can finish them before publishing.
            </p>}
            {lessonDraft.lesson.contentType === "assessment" && !lessonDraft.newAssessmentKind && (
              <Field
                label="Quiz or survey students take"
                hint="Choose an assessment or create one here. Required-pass quizzes keep the next lesson locked. Set pass rules and messages in Edit questions and results."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={cn(selectStyles, "min-w-0 flex-1")}
                    value={lessonDraft.lesson.assessmentId ?? ""}
                    onChange={(event) => updateLesson({
                      assessmentId: event.target.value ? Number(event.target.value) : null,
                    })}
                    required
                  >
                    <option value="">Choose a quiz or survey</option>
                    {gradedTests.filter(assessment => !assessment.lessonId || assessment.lessonId === lessonDraft.lesson.id).map((assessment) => (
                      <option key={assessment.id} value={assessment.id}>
                        {assessment.title} — {assessment.kind === "survey" ? "Survey" : `pass ${assessment.passMark ?? 70}%`}{assessment.published ? "" : " (draft)"}
                      </option>
                    ))}
                  </select>
                  <Button asChild type="button" variant="secondary" size="sm">
                    <Link to={lessonDraft.lesson.assessmentId ? `/admin/marketing/quizzes/${lessonDraft.lesson.assessmentId}` : "/admin/marketing/quizzes"}>Edit questions and results</Link>
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["graded", "survey"] as const).map(kind => <Button key={kind} type="button" size="sm" variant="secondary" onClick={() => {
                    void assessmentsApi.create({ title: `${lessonDraft.lesson.title || "New lesson"} ${kind === "survey" ? "survey" : "quiz"}`, kind, requireEmail: false, published: false }).then(created => {
                      setGradedTests(current => [...current, created as AssessmentSummary]);
                      updateLesson({ assessmentId: created.id });
                      toast.success("Assessment created. Save this lesson, then open Edit questions and results.");
                    }).catch(() => toast.error("The assessment could not be created."));
                  }}>Create {kind === "survey" ? "survey" : "quiz"} for this lesson</Button>)}
                </div>
                {gradedTests.length === 0 && (
                  <p className="mt-2 text-sm text-ink-soft">Create a quiz or survey using the buttons above.</p>
                )}
              </Field>
            )}

            {lessonDraft.lesson.contentType === "video" && <Field label="Video" hint="students watch this at the top of the lesson">
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
                      updateLesson({
                        videoUrl: e.target.value,
                        ...(e.target.value.trim()
                          ? kindForChosenVideo(lessonDraft.lesson.contentType)
                          : {}),
                      });
                      showVideo(e.target.value);
                    }}
                    aria-label="Link to a video hosted somewhere else"
                    placeholder="Paste a link to your video, e.g. from Vimeo"
                  />
                )}
              </div>
            </Field>}

            {lessonDraft.lesson.contentType === "audio" && <Field label="Audio" hint="use this for a podcast-style lesson or an audio alternative">
              <div className="space-y-2">
                <Input
                  value={lessonDraft.lesson.audioUrl ?? ""}
                  onChange={(e) => updateLesson({ audioUrl: e.target.value, contentType: e.target.value ? "audio" : lessonDraft.lesson.contentType })}
                  placeholder="Paste an audio link, or upload below"
                />
                {/* Named per lesson: an upload that finishes after she has
                    moved on to the next lesson must not drop its audio into
                    that one. Unclaimed, it waits for this lesson to be opened
                    again. */}
                <UploadDropzone
                  compact
                  accept="audio/*"
                  visibility="protected"
                  scope={`lesson-audio:${lessonDraft.lesson.id ?? "new"}`}
                  onUploaded={(asset) => updateLesson({ audioUrl: asset.url, contentType: "audio" })}
                />
              </div>
            </Field>}

            <Field label="Lesson thumbnail" hint="the image students see in the outline">
              <div className="space-y-2">
                {lessonDraft.lesson.thumbnailUrl && (
                  <img src={lessonDraft.lesson.thumbnailUrl} alt="Lesson thumbnail preview" className="h-28 w-44 rounded-xl object-cover" />
                )}
                <Input
                  value={lessonDraft.lesson.thumbnailUrl ?? ""}
                  onChange={(e) => updateLesson({ thumbnailUrl: e.target.value })}
                  placeholder="Paste an image link, or upload below"
                />
                <UploadDropzone
                  compact
                  accept="image/*"
                  visibility="public"
                  scope={`lesson-thumbnail:${lessonDraft.lesson.id ?? "new"}`}
                  onUploaded={(asset) => updateLesson({ thumbnailUrl: asset.url })}
                />
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

            <Field label="Downloads" hint="attach as many worksheets, templates or resources as this lesson needs">
              {lessonDraft.lesson.id ? (
                <div className="space-y-3">
                  <UploadDropzone
                    compact
                    visibility="protected"
                    scope={`lesson-files:${lessonDraft.lesson.id}`}
                    onUploaded={(asset) => void attachLessonFile(asset)}
                  />
                  {lessonFiles.length > 0 && (
                    <ul className="space-y-2">
                      {lessonFiles.map((file) => (
                        <li key={file.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-hairline px-3 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{file.title || file.filename}</span>
                          <span className="text-xs text-ink-soft">{formatBytes(Number(file.sizeBytes))}</span>
                          <Button type="button" variant="dangerGhost" size="iconSm" aria-label={`Remove ${file.title || file.filename}`} onClick={() => void removeLessonFile(file)}><Trash2 /></Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-soft">Save the lesson once, then reopen it to attach downloads.</p>
              )}
            </Field>

            <DripFields value={lessonDraft.drip} onChange={updateDrip} noun="lesson" />

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
              <div className="flex items-end sm:col-span-2">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={lessonDraft.lesson.requiresPreviousLesson === true}
                    onChange={(e) => updateLesson({ requiresPreviousLesson: e.target.checked })}
                    className="size-4 rounded border-hairline text-plum"
                  />
                  Require the previous lesson to be completed first
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
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={lessonDraft.lesson.commentsEnabled !== false}
                    onChange={(e) => updateLesson({ commentsEnabled: e.target.checked })}
                    className="size-4 rounded border-hairline text-plum"
                  />
                  Let students comment
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
            ...kindForChosenVideo(lessonDraft?.lesson.contentType),
          });
          showVideo(asset.url, asset.previewUrl);
          setPicking(false);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/* --------------------------------------------------------- Release schedule */

/**
 * Picking a video makes it a video lesson.
 *
 * `content_type` defaults to "text" and the player switches on it, so a lesson
 * built the ordinary way here — add a lesson, choose a video, save — showed
 * students the notes and no player at all. Only a lesson still sitting on that
 * default is moved; anything she set herself is left alone.
 */
function kindForChosenVideo(current: string | undefined): { contentType?: string } {
  return current && current !== "text" ? {} : { contentType: "video" };
}

/**
 * When a section or a lesson opens up.
 *
 * Three shapes, because that is all the engine can express: open now, open N
 * days after they bought it, or open on a fixed date. The hour is deliberately
 * missing — it is one site-wide setting rather than one per lesson, which is
 * the whole reason "unlocks on the 3rd" means the same thing to every student,
 * so the copy says where it lives instead of offering a box that would lie.
 */
function DripFields({
  value,
  onChange,
  noun,
}: {
  value: DripChoice;
  onChange: (value: DripChoice) => void;
  noun: "section" | "lesson";
}) {
  return (
    <Field
      label="When does this open?"
      hint="The time of day comes from Settings → Delivery, and covers your whole site."
    >
      <div className="space-y-2.5">
        <select
          className={selectStyles}
          aria-label={`When this ${noun} opens`}
          value={value.mode}
          onChange={(e) => onChange({ ...value, mode: e.target.value as DripMode })}
        >
          <option value="immediately">As soon as they buy</option>
          <option value="days">A set number of days after they buy</option>
          <option value="date">On a date</option>
        </select>

        {value.mode === "days" && (
          <Input
            type="number"
            min={1}
            step={1}
            value={value.days}
            onChange={(e) => onChange({ ...value, days: e.target.value })}
            aria-label={`Days after buying before this ${noun} opens`}
            placeholder="7"
          />
        )}

        {value.mode === "date" && (
          <Input
            type="date"
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
            aria-label={`The date this ${noun} opens`}
          />
        )}
      </div>
    </Field>
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
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-xl border border-b-0 border-hairline bg-white/[0.03] px-1.5 py-1">
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
          scope="course-video-picker"
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
                    <span className="grid size-9 place-items-center rounded-full bg-night-deep/85 text-gold ring-1 ring-white/15">
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
