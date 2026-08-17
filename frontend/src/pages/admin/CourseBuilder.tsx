import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Bold,
  ChevronDown,
  Clock,
  Film,
  GripVertical,
  Italic,
  Layers,
  Link2,
  List,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { CourseLesson, CourseModule, MediaAsset } from "@/types/admin";
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

/** "45m" / "2h 30m" — a length she'd say out loud. */
function courseLength(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
      toast.success("Section deleted");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "section"));
    }
  }

  async function saveLesson(e: FormEvent) {
    e.preventDefault();
    if (!lessonDraft?.lesson.title?.trim()) return;

    const { moduleId, lesson } = lessonDraft;
    const payload = {
      title: lesson.title,
      bodyMd: lesson.bodyMd ?? "",
      videoUrl: lesson.videoUrl ?? "",
      attachmentUrl: lesson.attachmentUrl ?? "",
      durationMinutes: lesson.durationMinutes ?? 0,
      preview: lesson.preview ?? false,
      published: lesson.published ?? true,
    };

    try {
      if (lesson.id) await adminApi.lessonUpdate(lesson.id, payload);
      else await adminApi.lessonCreate(moduleId, payload);
      toast.success(lesson.id ? "Lesson saved" : "Lesson added");
      setLessonDraft(null);
      load();
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
                      </span>
                    </span>
                    <motion.span animate={{ rotate: open ? 180 : 0 }} className="ml-auto shrink-0">
                      <ChevronDown className="size-4 text-ink-soft" />
                    </motion.span>
                  </button>
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
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      {mod.lessons.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-ink-soft">
                          Nothing in this section yet — add your first lesson below.
                        </p>
                      ) : (
                        <ul className="divide-y divide-hairline/60">
                          {mod.lessons.map((lesson) => (
                            <li
                              key={lesson.id}
                              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-lilac-tint/25"
                            >
                              <GripVertical className="size-4 shrink-0 text-ink-soft/40" />
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
                                </span>
                              </button>
                              {lesson.preview && <Badge tone="gold">Free taster</Badge>}
                              {!lesson.published && <Badge tone="slate">{PUBLISH_LABEL.draft}</Badge>}
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

                      <div className="border-t border-hairline/60 p-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          onClick={() =>
                            openLesson(mod.id, { title: "", published: true, durationMinutes: 0 })
                          }
                        >
                          <Plus />
                          Add a lesson
                        </Button>
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

      {/* Lesson editor */}
      <Modal
        open={lessonDraft !== null}
        onOpenChange={(open) => !open && setLessonDraft(null)}
        title={lessonDraft?.lesson.id ? "Edit this lesson" : "Add a lesson"}
        size="lg"
        footer={
          <>
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
                  <div className="overflow-hidden rounded-xl border border-hairline">
                    <video
                      src={lessonDraft.lesson.videoUrl}
                      controls
                      preload="metadata"
                      className="max-h-56 w-full bg-ink/5"
                    />
                  </div>
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
                      onClick={() => updateLesson({ videoUrl: "" })}
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
                    onChange={(e) => updateLesson({ videoUrl: e.target.value })}
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
              <Field label="How long is it?" hint="in minutes">
                <Input
                  type="number"
                  min={0}
                  value={lessonDraft.lesson.durationMinutes ?? 0}
                  onChange={(e) =>
                    updateLesson({ durationMinutes: Number(e.target.value) || 0 })
                  }
                />
              </Field>
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
        onSelect={(asset) => {
          updateLesson({ videoUrl: asset.url });
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
  onSelect: (asset: MediaAsset) => void;
}) {
  const [videos, setVideos] = useState<MediaAsset[] | null>(null);

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
                onClick={() => onSelect(asset)}
                className="group overflow-hidden rounded-xl border border-hairline text-left transition-all hover:border-plum hover:shadow-[0_12px_28px_-14px_rgba(15,30,58,0.4)]"
              >
                <span className="relative block aspect-video bg-ink/5">
                  <video src={asset.url} preload="metadata" muted className="size-full object-cover" />
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
