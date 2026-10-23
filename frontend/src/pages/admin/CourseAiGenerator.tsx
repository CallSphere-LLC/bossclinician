import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  COURSE_AI_LIMITS,
  cleanOutline,
  courseAiApi,
  outlineProblem,
  type CourseOutline,
  type OutlineModule,
} from "@/lib/courseAiApi";
import { Button, Field, Input, Select, Textarea } from "@/pages/admin/ui/primitives";
import { Modal } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * "Build with AI" — Kajabi's course outline generator.
 *
 * Two steps in one dialog. First she names the course (and, if she likes, says
 * who it's for and what it should cover); the AI drafts sections and lessons
 * with a short starter body each. Then she reviews that outline — renames,
 * rewrites, removes or adds anything — and only "Create course" writes it.
 * Everything is created as a draft and she lands in the course builder to
 * finish it, so nothing the AI wrote reaches a member until she says so.
 */

const MODULE_CHOICES = Array.from({ length: COURSE_AI_LIMITS.maxModules }, (_, i) => i + 1);
const LESSON_CHOICES = Array.from({ length: COURSE_AI_LIMITS.maxLessonsPerModule }, (_, i) => i + 1);

const EMPTY_LESSON = { title: "", bodyMd: "" };

/**
 * The AI routes answer a slow or failed generation with a sentence she can act
 * on ("Try fewer sections…") under a 5xx, which `friendlyError` would replace
 * with "something went wrong on our end". Those are kept; the rest go through
 * the usual wording.
 */
function generationError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  const said = err instanceof Error ? err.message.trim() : "";
  if (status && [502, 503, 504, 524].includes(status) && said && said.length <= 200) return said;
  return friendlyError(err, "course outline");
}

export default function CourseAiGenerator({
  open,
  onOpenChange,
  initialTitle = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What she had already typed into "Add a course", if she came from there. */
  initialTitle?: string;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(initialTitle);
  const [audience, setAudience] = useState("");
  const [about, setAbout] = useState("");
  const [moduleCount, setModuleCount] = useState(4);
  const [lessonsPerModule, setLessonsPerModule] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [outline, setOutline] = useState<CourseOutline | null>(null);
  const [openLesson, setOpenLesson] = useState<string | null>(null);
  const [publishLessons, setPublishLessons] = useState(false);
  const [creating, setCreating] = useState(false);
  // A reply that lands after she closed the dialog (or asked again) is dropped.
  const requestRef = useRef(0);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setOutline(null);
      setOpenLesson(null);
      setPublishLessons(false);
    } else {
      requestRef.current += 1;
      setGenerating(false);
    }
  }, [open, initialTitle]);

  const tooMany = moduleCount * lessonsPerModule > COURSE_AI_LIMITS.maxGeneratedLessons;

  async function generate(e?: FormEvent) {
    e?.preventDefault();
    if (!title.trim() || tooMany || generating) return;
    const token = ++requestRef.current;
    setGenerating(true);
    try {
      const result = await courseAiApi.generateOutline({
        title: title.trim(),
        audience: audience.trim(),
        description: about.trim(),
        moduleCount,
        lessonsPerModule,
      });
      if (token !== requestRef.current) return;
      setOutline(result);
      setOpenLesson(null);
      toast.success("Here's a first draft of your course. Change anything you like.");
    } catch (err) {
      if (token !== requestRef.current) return;
      toast.error(generationError(err));
    } finally {
      if (token === requestRef.current) setGenerating(false);
    }
  }

  async function create() {
    if (!outline || creating) return;
    const cleaned = cleanOutline(outline);
    const problem = outlineProblem(cleaned);
    if (problem) {
      toast.error(problem);
      return;
    }
    setCreating(true);
    try {
      const created = await courseAiApi.createFromOutline(cleaned, publishLessons);
      toast.success(
        `Course created as a draft with ${created.moduleCount} section${created.moduleCount === 1 ? "" : "s"} and ${created.lessonCount} lesson${created.lessonCount === 1 ? "" : "s"}.`,
      );
      onOpenChange(false);
      navigate(`/admin/courses/${created.courseId}/curriculum`);
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    } finally {
      setCreating(false);
    }
  }

  /* ------------------------------ outline edits ----------------------------- */

  function patchModule(index: number, patch: Partial<OutlineModule>) {
    setOutline((o) => o && { ...o, modules: o.modules.map((m, i) => (i === index ? { ...m, ...patch } : m)) });
  }

  function moveModule(index: number, by: -1 | 1) {
    setOutline((o) => {
      if (!o) return o;
      const target = index + by;
      if (target < 0 || target >= o.modules.length) return o;
      const modules = [...o.modules];
      [modules[index], modules[target]] = [modules[target], modules[index]];
      return { ...o, modules };
    });
    setOpenLesson(null);
  }

  function patchLesson(moduleIndex: number, lessonIndex: number, patch: Partial<typeof EMPTY_LESSON>) {
    const mod = outline?.modules[moduleIndex];
    if (!mod) return;
    patchModule(moduleIndex, {
      lessons: mod.lessons.map((l, i) => (i === lessonIndex ? { ...l, ...patch } : l)),
    });
  }

  const lessonTotal = outline?.modules.reduce((sum, m) => sum + m.lessons.length, 0) ?? 0;

  /* --------------------------------- render -------------------------------- */

  const footer = outline ? (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOutline(null)} disabled={creating}>
        Back
      </Button>
      <Button variant="secondary" size="sm" onClick={() => generate()} disabled={generating || creating}>
        {generating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {generating ? "Rebuilding…" : "Build it again"}
      </Button>
      <Button size="sm" onClick={create} disabled={creating || generating}>
        {creating ? "Creating…" : "Create course"}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button size="sm" type="submit" form="course-ai-form" disabled={generating || !title.trim() || tooMany}>
        {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {generating ? "Building your outline…" : "Build my course"}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !creating && onOpenChange(next)}
      title={outline ? "Review your course outline" : "Build a course with AI"}
      description={
        outline
          ? `${outline.modules.length} sections, ${lessonTotal} lessons. Edit anything below — nothing is saved until you click Create course, and it's created as a draft.`
          : "Type the course name and the AI drafts the sections and lessons for you to review."
      }
      size="xl"
      footer={footer}
    >
      {!outline ? (
        <form id="course-ai-form" onSubmit={generate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Course name" className="sm:col-span-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leaving Insurance Panels"
              maxLength={300}
              required
              autoFocus
              disabled={generating}
            />
          </Field>
          <Field label="Who it's for" hint="optional" className="sm:col-span-2">
            <Input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Solo therapists in their first two years of private practice"
              maxLength={500}
              disabled={generating}
            />
          </Field>
          <Field label="What it should cover" hint="optional" className="sm:col-span-2">
            <Textarea
              rows={3}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Pricing, telling current clients, the paperwork, and filling the gap while panels wind down."
              maxLength={2000}
              disabled={generating}
            />
          </Field>
          <Field label="Sections">
            <Select
              value={moduleCount}
              onChange={(e) => setModuleCount(Number(e.target.value))}
              disabled={generating}
            >
              {MODULE_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Lessons per section"
            error={
              tooMany
                ? `That's more than ${COURSE_AI_LIMITS.maxGeneratedLessons} lessons in one go — you can add more afterwards.`
                : undefined
            }
          >
            <Select
              value={lessonsPerModule}
              onChange={(e) => setLessonsPerModule(Number(e.target.value))}
              disabled={generating}
            >
              {LESSON_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          {generating && (
            <p className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2" role="status">
              <Loader2 className="size-4 animate-spin" />
              Writing {moduleCount * lessonsPerModule} lessons. This usually takes under a minute; keep this
              window open.
            </p>
          )}
        </form>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Course name" className="sm:col-span-2">
              <Input
                value={outline.title}
                onChange={(e) => setOutline({ ...outline, title: e.target.value })}
                maxLength={300}
              />
            </Field>
            <Field label="One-line summary" className="sm:col-span-2">
              <Input
                value={outline.subtitle}
                onChange={(e) => setOutline({ ...outline, subtitle: e.target.value })}
                maxLength={300}
              />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={outline.description}
                onChange={(e) => setOutline({ ...outline, description: e.target.value })}
                maxLength={2000}
              />
            </Field>
          </div>

          <ol className="space-y-4">
            {outline.modules.map((mod, mi) => (
              <li key={mi} className="rounded-xl border border-hairline bg-white/[0.03] p-4">
                <div className="flex items-start gap-2">
                  <span className="mt-3 w-6 shrink-0 text-sm font-bold tabular-nums text-ink-soft">{mi + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Field label="Section title">
                      <Input
                        value={mod.title}
                        onChange={(e) => patchModule(mi, { title: e.target.value })}
                        maxLength={300}
                      />
                    </Field>
                    <Field label="Section summary">
                      <Textarea
                        rows={2}
                        value={mod.summary}
                        onChange={(e) => patchModule(mi, { summary: e.target.value })}
                        maxLength={2000}
                      />
                    </Field>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Move section ${mi + 1} up`}
                      disabled={mi === 0}
                      onClick={() => moveModule(mi, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Move section ${mi + 1} down`}
                      disabled={mi === outline.modules.length - 1}
                      onClick={() => moveModule(mi, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label={`Remove section ${mi + 1}`}
                      onClick={() => {
                        setOutline({ ...outline, modules: outline.modules.filter((_, i) => i !== mi) });
                        setOpenLesson(null);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <ul className="mt-3 space-y-2 pl-8">
                  {mod.lessons.map((lesson, li) => {
                    const key = `${mi}:${li}`;
                    const expanded = openLesson === key;
                    return (
                      <li key={li} className="rounded-lg border border-hairline/70 p-2.5">
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label={`Lesson ${li + 1} title`}
                            value={lesson.title}
                            onChange={(e) => patchLesson(mi, li, { title: e.target.value })}
                            maxLength={300}
                            className="min-w-0 flex-1"
                          />
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-expanded={expanded}
                            onClick={() => setOpenLesson(expanded ? null : key)}
                          >
                            {expanded ? "Hide draft" : "Edit draft"}
                          </Button>
                          <Button
                            variant="dangerGhost"
                            size="iconSm"
                            aria-label={`Remove lesson ${li + 1} from section ${mi + 1}`}
                            onClick={() =>
                              patchModule(mi, { lessons: mod.lessons.filter((_, i) => i !== li) })
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        {expanded && (
                          <Textarea
                            aria-label={`Lesson ${li + 1} draft`}
                            rows={8}
                            className="mt-2 font-mono text-xs"
                            value={lesson.bodyMd}
                            onChange={(e) => patchLesson(mi, li, { bodyMd: e.target.value })}
                          />
                        )}
                      </li>
                    );
                  })}
                  <li>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        patchModule(mi, { lessons: [...mod.lessons, { ...EMPTY_LESSON }] });
                        setOpenLesson(`${mi}:${mod.lessons.length}`);
                      }}
                    >
                      <Plus />
                      Add a lesson
                    </Button>
                  </li>
                </ul>
              </li>
            ))}
          </ol>

          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setOutline({
                ...outline,
                modules: [...outline.modules, { title: "", summary: "", lessons: [{ ...EMPTY_LESSON }] }],
              })
            }
          >
            <Plus />
            Add a section
          </Button>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-hairline p-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={publishLessons}
              onChange={(e) => setPublishLessons(e.target.checked)}
              className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
            />
            <span>
              <span className="font-medium">Mark the lessons as published</span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {publishLessons
                  ? "The lessons will be ready to show as soon as you make the course live. The course itself still starts as a draft."
                  : "Lessons start as drafts, so you can finish each one in the course builder before it's seen. The course itself is a draft either way."}
              </span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
