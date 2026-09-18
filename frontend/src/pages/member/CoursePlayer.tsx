import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Lock,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton, LuxePill } from "@/components/luxe/LuxeButton";
import { MemberApiError } from "@/lib/memberApi";
import {
  lessonPath,
  libraryApi,
  productPath,
  type CourseOutlineData,
  type LessonResponse,
  type LibraryProduct,
  type OutlineModule,
  type ProgressResult,
} from "@/lib/libraryApi";
import { CertificateCard } from "@/components/player/CertificateCard";
import { CourseOutline } from "@/components/player/CourseOutline";
import { OutlineSheet } from "@/components/player/OutlineSheet";
import { LessonBody } from "@/components/player/LessonBody";
import { LessonNotes } from "@/components/player/LessonNotes";
import { LessonComments } from "@/components/player/LessonComments";
import { LockedNotice } from "@/components/player/LockedNotice";
import { TranscriptPanel } from "@/components/player/TranscriptPanel";
import { Attachments } from "@/components/player/Attachments";
import { ProgressRing } from "@/components/player/ProgressRing";
import { contentTypeLabel, lessonLengthLabel } from "@/components/player/lessonMeta";
import { cn } from "@/lib/cn";

/**
 * How long before a signed media link expires the player fetches a new one.
 *
 * Long enough to cover a slow request and a retry on a phone signal, short
 * enough that the renewed link still carries almost its whole life.
 */
const MEDIA_RENEW_MARGIN_MS = 2 * 60 * 1000;

/**
 * The course player, and the landing page for everything else that can be owned.
 *
 * One component for `/library/:productSlug` and `/library/:productSlug/lessons/:lessonSlug`
 * because they share the outline, the progress rollup and the entitlement
 * result, and splitting them would mean loading the same product twice on the
 * click between them.
 *
 * Two things this page will not do, both of them the classic mistakes in a drip
 * player. It never computes an unlock date — those arrive from the server, which
 * is the only place that knows when this member's access was granted. And it has
 * no code path that renders a locked lesson's body, because the API does not
 * send one; a component that could show it is a component somebody eventually
 * wires up "just for the preview".
 */
export default function CoursePlayer() {
  const params = useParams();
  const productSlug = params.productSlug ?? "";
  const lessonSlug = params.lessonSlug;

  const [product, setProduct] = useState<LibraryProduct | null>(null);
  const [productError, setProductError] = useState<{ message: string; missing: boolean } | null>(
    null,
  );

  const [lessonData, setLessonData] = useState<LessonResponse | null>(null);
  const [lessonError, setLessonError] = useState<{ message: string; missing: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setProductError(null);

    void libraryApi
      .getProduct(productSlug)
      .then((data) => {
        if (!cancelled) setProduct(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProductError(describeError(err, "We could not open that just now."));
      });

    return () => {
      cancelled = true;
    };
  }, [productSlug]);

  useEffect(() => {
    if (!lessonSlug) {
      setLessonData(null);
      setLessonError(null);
      return;
    }

    let cancelled = false;
    setLessonData(null);
    setLessonError(null);

    void libraryApi
      .getLesson(productSlug, lessonSlug)
      .then((data) => {
        if (!cancelled) setLessonData(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLessonError(describeError(err, "We could not open that lesson just now."));
      });

    return () => {
      cancelled = true;
    };
  }, [productSlug, lessonSlug]);

  /*
   * Renew the lesson's signed media URLs before they expire.
   *
   * Video, audio, captions and the PDF are served from links that die two hours
   * after they were minted, and the server says when in `mediaExpiresAt`. Left
   * alone, a lesson someone paused over lunch resumes into a 404: the element
   * has a src that no longer resolves, and the failure looks like a broken
   * course rather than an expired link.
   *
   * Only the media fields are folded back in. `progress` is deliberately left as
   * it was, exactly as `applyProgress` leaves it — it feeds `startAt`, and
   * changing it would restart the media hook and seek the member to wherever the
   * last ping landed. `useRenewableSource` handles the src swap itself.
   */
  const currentLesson = lessonData?.lesson;
  const lessonId = currentLesson?.id ?? null;
  const mediaExpiresAt =
    currentLesson && !currentLesson.locked ? currentLesson.mediaExpiresAt : null;

  useEffect(() => {
    if (!lessonSlug || lessonId === null || mediaExpiresAt === null) return;

    const expiresAt = new Date(mediaExpiresAt).getTime();
    if (Number.isNaN(expiresAt)) return;

    // Early enough that the refetch has time to land, and clamped at zero so a
    // link already inside the margin is renewed immediately rather than never.
    const delay = Math.max(0, expiresAt - Date.now() - MEDIA_RENEW_MARGIN_MS);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void libraryApi
        .getLesson(productSlug, lessonSlug)
        .then((fresh) => {
          if (cancelled || fresh.lesson.locked) return;
          const renewed = fresh.lesson;

          setLessonData((current) => {
            // The member may have moved on, or the lesson may have locked behind
            // them, while this was in flight.
            if (!current || current.lesson.locked || current.lesson.id !== renewed.id) {
              return current;
            }
            return {
              ...current,
              lesson: {
                ...current.lesson,
                videoUrl: renewed.videoUrl,
                audioUrl: renewed.audioUrl,
                captionsUrl: renewed.captionsUrl,
                attachmentUrl: renewed.attachmentUrl,
                mediaExpiresAt: renewed.mediaExpiresAt,
              },
            };
          });
        })
        // A failed renewal is silent: the member is still watching a link that
        // works, and the only thing to say would be about an expiry they cannot
        // act on. The next attempt is scheduled when this effect re-runs.
        .catch(() => undefined);
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [productSlug, lessonSlug, lessonId, mediaExpiresAt]);

  // The graded-test player runs in a same-origin frame. Once it records a pass,
  // re-read both views so the tick and the newly-unlocked next lesson appear
  // without asking the student to refresh the whole page.
  useEffect(() => {
    if (!lessonSlug) return;
    const passed = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!["boss-assessment-passed", "boss-assessment-completed"].includes((event.data as { type?: string } | null)?.type ?? "")) return;
      void Promise.all([
        libraryApi.getProduct(productSlug),
        libraryApi.getLesson(productSlug, lessonSlug),
      ]).then(([freshProduct, freshLesson]) => {
        setProduct(freshProduct);
        setLessonData(freshLesson);
        toast.success("Assessment saved. Your lesson progress is up to date.");
      }).catch(() => undefined);
    };
    window.addEventListener("message", passed);
    return () => window.removeEventListener("message", passed);
  }, [lessonSlug, productSlug]);

  /**
   * Folds a progress write back into what is on screen.
   *
   * The outline's ticks and the course rollup are updated, but the playing
   * lesson's `lastPositionSeconds` and `watchedPercent` deliberately are not:
   * they are what the player resumes from, and changing them mid-lesson would
   * restart the media hook and seek the member back to wherever the last ping
   * happened to land.
   */
  const applyProgress = useCallback((result: ProgressResult) => {
    setProduct((current) => {
      if (!current || current.kind !== "course") return current;
      return {
        ...current,
        course: {
          ...current.course,
          progress: result.courseProgress,
          modules: current.course.modules.map((module) => ({
            ...module,
            lessons: module.lessons.map((lesson) =>
              lesson.id === result.lessonId
                ? {
                    ...lesson,
                    completed: result.completed,
                    completedAt: result.completedAt,
                    lastPositionSeconds: result.lastPositionSeconds,
                    watchedPercent: Math.max(lesson.watchedPercent, result.watchedPercent),
                  }
                : lesson,
            ),
          })),
        },
      };
    });

    setLessonData((current) => {
      if (!current || current.lesson.locked || current.lesson.id !== result.lessonId) return current;
      return {
        ...current,
        course: { ...current.course, progress: result.courseProgress },
        lesson: {
          ...current.lesson,
          progress: {
            ...current.lesson.progress,
            completed: result.completed,
            completedAt: result.completedAt,
          },
        },
      };
    });
  }, []);

  const course = product?.kind === "course" ? product.course : null;
  const heading = lessonData?.lesson.title ?? product?.title ?? "Your library";
  const missing = productError?.missing || lessonError?.missing;

  const description = useMemo(() => {
    if (lessonData) return `${lessonData.course.title} · ${lessonData.lesson.moduleTitle}`;
    return product?.subtitle ?? undefined;
  }, [lessonData, product]);

  if (missing) {
    return <NotInLibrary />;
  }

  return (
    <MemberShell title={heading} description={description}>
      <Seo title={`${heading} | Boss Clinician`} />

      <div aria-live="polite">
        {(productError || lessonError) && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {(lessonError ?? productError)?.message}
          </p>
        )}
        {!productError && product === null && (
          <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Opening…
          </p>
        )}
      </div>

      {product && product.kind !== "course" && <NonCourseProduct product={product} />}

      {course && (
        <div className="flex flex-col gap-8 xl:flex-row xl:gap-10">
          {/* The outline is a real column only where there is room for one. Below
              `xl` the member rail is already taking 14rem, and a third column
              would leave the lesson itself about 300px wide. */}
          <aside className="hidden w-[19.5rem] shrink-0 xl:block">
            <div className="sticky top-28 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1">
              {/* Only while a lesson is open. On the course home the hero card
                  is already showing the same ring a few hundred pixels away,
                  and two of them on one screen reads as a bug. */}
              {lessonSlug && <CourseSummary course={course} productSlug={productSlug} compact />}
              <CourseOutline
                modules={course.modules}
                productSlug={productSlug}
                activeLessonSlug={lessonSlug}
                className={lessonSlug ? "mt-6" : undefined}
              />
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {lessonSlug ? (
              <>
                <div className="flex flex-col gap-3 xl:hidden">
                  <BackToCourse productSlug={productSlug} title={course.title} />
                  <OutlineSheet
                    modules={course.modules}
                    productSlug={productSlug}
                    courseTitle={course.title}
                    activeLessonSlug={lessonSlug}
                    progress={course.progress}
                  />
                </div>

                <div className="mt-6 xl:mt-0">
                  {lessonData ? (
                    <LessonView
                      data={lessonData}
                      productSlug={productSlug}
                      courseImage={course.image}
                      modules={course.modules}
                      onProgress={applyProgress}
                    />
                  ) : (
                    !lessonError && (
                      <p className="flex items-center gap-2.5 text-sm text-orchid-dim">
                        <Loader2 aria-hidden className="size-4 animate-spin" />
                        Loading the lesson…
                      </p>
                    )
                  )}
                </div>
              </>
            ) : (
              <CourseHome course={course} productSlug={productSlug} />
            )}
          </div>
        </div>
      )}
    </MemberShell>
  );
}

/* ------------------------------------------------------------------ helpers */

/**
 * A 404 from these endpoints means "not in your library", which covers both a
 * product that does not exist and one this member has no grant for — the server
 * answers those identically on purpose, and this page must not undo that by
 * wording them differently.
 */
function describeError(err: unknown, fallback: string): { message: string; missing: boolean } {
  if (err instanceof MemberApiError) {
    return { message: err.message, missing: err.status === 404 };
  }
  return { message: fallback, missing: false };
}

function NotInLibrary() {
  return (
    <MemberShell title="Not in your library">
      <Seo title="Not in your library | Boss Clinician" />
      <GlassCard
        spotlight={false}
        interactive={false}
        className="flex flex-col items-center px-6 py-16 text-center sm:px-10"
      >
        <span
          aria-hidden
          className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
        >
          <Lock className="size-6 text-gold" />
        </span>
        <h2 className="mt-5 font-display text-[1.5rem] leading-snug text-white">
          We couldn&rsquo;t find that
        </h2>
        <p className="copy-luxe mt-3 max-w-md text-balance">
          It is not on your shelf. If you have just bought it, give the receipt a moment to arrive —
          otherwise your library has everything that is yours.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <LuxeButton to="/library">Back to your library</LuxeButton>
          <LuxeButton to="/courses" variant="glass">
            Browse the courses
          </LuxeButton>
        </div>
      </GlassCard>
    </MemberShell>
  );
}

function BackToCourse({ productSlug, title }: { productSlug: string; title: string }) {
  return (
    <Link
      to={productPath(productSlug)}
      className={cn(
        "inline-flex min-h-[2.75rem] items-center gap-2 self-start rounded-full pr-3",
        "text-sm text-orchid transition-colors duration-300 hover:text-gold",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      <ArrowLeft aria-hidden className="size-4" />
      <span className="truncate">{title}</span>
    </Link>
  );
}

/* -------------------------------------------------------------- course home */

function CourseSummary({
  course,
  productSlug,
  compact,
}: {
  course: CourseOutlineData;
  productSlug: string;
  compact?: boolean;
}) {
  const { progress } = course;

  return (
    <div className={cn("flex items-start gap-4", compact && "pr-1")}>
      <ProgressRing
        percent={progress.percent}
        size={compact ? 46 : 58}
        label={`${progress.lessonsCompleted} of ${progress.lessonsTotal} lessons finished`}
      />
      <div className="min-w-0">
        <Link
          to={productPath(productSlug)}
          className={cn(
            "block truncate font-display text-white transition-colors duration-300 hover:text-gold-bright",
            compact ? "text-[1.05rem]" : "text-xl",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          )}
        >
          {course.title}
        </Link>
        <p className="mt-1 text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
          {progress.lessonsCompleted} of {progress.lessonsTotal} lessons
          {progress.completedAt && " · Finished"}
        </p>
      </div>
    </div>
  );
}

function CourseHome({ course, productSlug }: { course: CourseOutlineData; productSlug: string }) {
  const cta = course.continueLesson;
  const started = course.progress.lessonsCompleted > 0 || course.progress.percent > 0;
  // `percent` is floored on the server, so 100 means every lesson, not "nearly".
  const finished = course.progress.completedAt !== null || course.progress.percent >= 100;

  return (
    <div className="flex flex-col gap-8">
      <GlassCard accent="gold" spotlight={false} className="overflow-hidden">
        {course.image && (
          <img
            src={course.image}
            alt=""
            className="aspect-[21/9] w-full object-cover"
            loading="lazy"
          />
        )}

        <div className="p-5 sm:p-7">
          <CourseSummary course={course} productSlug={productSlug} />

          {course.description && (
            <p className="copy-luxe mt-5 max-w-2xl text-balance">{course.description}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {cta ? (
              <LuxeButton to={cta.href}>
                <Play aria-hidden className="size-4" />
                {started ? "Keep going" : "Start the course"}
              </LuxeButton>
            ) : (
              course.progress.lessonsTotal > 0 && (
                <LuxePill accent="green">Every open lesson is finished</LuxePill>
              )
            )}
          </div>
        </div>
      </GlassCard>

      {finished && <CertificateCard courseId={course.courseId} />}

      {/* On the course home the outline is the page, not a sidebar — so it is
          rendered here too rather than only in the `xl` rail, which does not
          exist on a phone. */}
      <section aria-labelledby="outline-heading" className="xl:hidden">
        <h2 id="outline-heading" className="font-display text-xl text-white">
          What&rsquo;s inside
        </h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
          <CourseOutline modules={course.modules} productSlug={productSlug} />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- lesson view */

interface LessonViewProps {
  data: LessonResponse;
  productSlug: string;
  courseImage: string;
  /** The outline already on screen — the only place a lesson's module is named. */
  modules: OutlineModule[];
  onProgress: (result: ProgressResult) => void;
}

function LessonView({ data, productSlug, courseImage, modules, onProgress }: LessonViewProps) {
  const { lesson } = data;

  /*
   * "Just finished" is the false → true edge of `completed` on the lesson that
   * is open, which is why it is watched here rather than raised by the tick
   * button: the player's own auto-complete at 90% arrives through `onProgress`,
   * and a passed assessment through a re-read of the lesson, and nobody pressed
   * anything for either. Arriving on a
   * lesson that was already complete is not an edge and shows nothing, and
   * un-ticking takes the panel away again.
   */
  const completed = lesson.locked ? false : lesson.progress.completed;
  const seen = useRef<{ id: number; completed: boolean } | null>(null);
  const [justFinished, setJustFinished] = useState(false);

  useEffect(() => {
    const before = seen.current;
    if (before !== null && before.id === lesson.id) {
      if (!before.completed && completed) setJustFinished(true);
      if (!completed) setJustFinished(false);
    } else {
      setJustFinished(false);
    }
    seen.current = { id: lesson.id, completed };
  }, [lesson.id, completed]);

  const breadcrumb = (
    <LessonBreadcrumb
      productSlug={productSlug}
      courseTitle={data.course.title}
      moduleTitle={lesson.moduleTitle}
      lessonTitle={lesson.title}
    />
  );

  if (lesson.locked) {
    return (
      <div className="flex flex-col gap-8">
        {breadcrumb}
        <LockedNotice
          title={lesson.title}
          unlockLabel={lesson.unlockLabel}
          unlocksAt={lesson.unlocksAt}
          timezone={data.course.timezone}
        />
        <LessonNav data={data} productSlug={productSlug} />
      </div>
    );
  }

  const length = lessonLengthLabel(lesson.durationMinutes, lesson.videoDurationSeconds);

  return (
    <div className="flex flex-col gap-8">
      <div>
        {breadcrumb}
        <p className="mt-2 text-xs uppercase tracking-[0.14em] text-orchid-faint">
          {contentTypeLabel(lesson.contentType)}
          {length && ` · ${length}`}
        </p>
      </div>

      {/* Keyed on the lesson so moving to the next one builds a fresh media
          element. Reusing it would swap `src` underneath the progress hook, and
          the write that fires as the old lesson unmounts would read the new
          media's position and file it against the old lesson. */}
      <LessonBody
        key={lesson.id}
        lesson={lesson}
        courseImage={courseImage}
        onSaved={onProgress}
      />

      {lesson.files.length > 0 && <Attachments files={lesson.files} kind="lesson" />}

      <TranscriptPanel transcript={lesson.transcript} />

      <CompleteBar lessonId={lesson.id} completed={lesson.progress.completed} onSaved={onProgress} />

      {justFinished && (
        <NicelyDone
          data={data}
          productSlug={productSlug}
          currentModuleId={lesson.moduleId}
          modules={modules}
        />
      )}

      <LessonNav data={data} productSlug={productSlug} />

      {lesson.notesEnabled && <LessonNotes lessonId={lesson.id} />}

      {lesson.commentsEnabled && <LessonComments lessonId={lesson.id} />}
    </div>
  );
}

/**
 * Course › Module › Lesson.
 *
 * Only the course is a link: a module has no page of its own, and the lesson is
 * where the member already is. It replaces the bare module title that used to
 * sit here, so nothing is said twice.
 */
function LessonBreadcrumb({
  productSlug,
  courseTitle,
  moduleTitle,
  lessonTitle,
}: {
  productSlug: string;
  courseTitle: string;
  moduleTitle: string;
  lessonTitle: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em]">
        <li className="flex min-w-0 items-center gap-1.5">
          <Link
            to={productPath(productSlug)}
            className={cn(
              "truncate text-orchid transition-colors duration-300 hover:text-gold",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
            )}
          >
            {courseTitle}
          </Link>
          <ChevronRight aria-hidden className="size-3 shrink-0 text-orchid-faint" />
        </li>
        {moduleTitle && (
          <li className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-gold">{moduleTitle}</span>
            <ChevronRight aria-hidden className="size-3 shrink-0 text-orchid-faint" />
          </li>
        )}
        <li aria-current="page" className="min-w-0 truncate text-white/70">
          {lessonTitle}
        </li>
      </ol>
    </nav>
  );
}

/**
 * What comes after the tick.
 *
 * The toast says the lesson is saved; this says where to go now, which is the
 * question a finished lesson actually leaves. Four endings, and each one points
 * somewhere real: the next lesson, the next module (named, because starting a
 * new module is a small milestone of its own), a next lesson that has not opened
 * yet, or the course home — where a finished course's certificate is waiting.
 */
function NicelyDone({
  data,
  productSlug,
  currentModuleId,
  modules,
}: {
  data: LessonResponse;
  productSlug: string;
  currentModuleId: number;
  modules: OutlineModule[];
}) {
  const { next } = data;
  const courseFinished =
    data.course.progress.completedAt !== null || data.course.progress.percent >= 100;

  const nextModule = next
    ? (modules.find((module) => module.lessons.some((row) => row.slug === next.slug)) ?? null)
    : null;
  const newModule = nextModule !== null && nextModule.id !== currentModuleId ? nextModule : null;

  let message: string;
  let action: { to: string; label: string };

  if (courseFinished) {
    message = "Nicely done — that is the whole course finished. Congratulations.";
    action = { to: productPath(productSlug), label: "Back to the course" };
  } else if (next && next.unlocked) {
    message = newModule
      ? `Nicely done — that is this module finished. Next module: ${newModule.title}, starting with ${next.title}.`
      : `Nicely done — next: ${next.title}`;
    action = {
      to: lessonPath(productSlug, next.slug),
      label: newModule ? "Start the next module" : "Next lesson",
    };
  } else if (next) {
    message = `Nicely done. The next lesson, ${next.title}, is not open yet — we will let you know when it is.`;
    action = { to: productPath(productSlug), label: "Back to the course" };
  } else {
    message = "Nicely done — that was the last lesson. There are still a few earlier ones to finish.";
    action = { to: productPath(productSlug), label: "See what is left" };
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-2xl border border-gold/25 bg-gold/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
    >
      <p className="flex min-w-0 items-start gap-3 text-sm leading-relaxed text-white">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-gold" />
        <span className="min-w-0 text-balance">{message}</span>
      </p>
      <LuxeButton to={action.to} size="sm" className="shrink-0 self-start sm:self-auto">
        {action.label}
        <ChevronRight aria-hidden className="size-4" />
      </LuxeButton>
    </div>
  );
}

/**
 * The manual tick.
 *
 * It stays available on a lesson the player already auto-completed, because
 * un-ticking is the only way back for somebody who wants to work through it
 * again — and the server treats that as an instruction, not a glitch, clearing
 * the watched figure so the next ping cannot immediately re-complete it.
 */
function CompleteBar({
  lessonId,
  completed,
  onSaved,
}: {
  lessonId: number;
  completed: boolean;
  onSaved: (result: ProgressResult) => void;
}) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      onSaved(await libraryApi.toggleComplete(lessonId, !completed));
      toast.success(completed ? "Marked as not finished." : "Lesson complete.");
    } catch (err) {
      toast.error(
        err instanceof MemberApiError ? err.message : "We could not save that. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 sm:px-5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={completed}
        className={cn(
          "inline-flex min-h-[2.75rem] items-center gap-2.5 rounded-full border px-5",
          "text-[0.72rem] font-semibold uppercase tracking-[0.16em] transition-colors duration-300",
          completed
            ? "border-gold/40 bg-gold/[0.12] text-gold"
            : "border-white/20 text-white/85 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Check aria-hidden className="size-4" />
        )}
        {completed ? "Completed" : "Mark complete"}
      </button>

      <p aria-live="polite" className="text-xs text-orchid-faint">
        {completed
          ? "Ticked off. Press again if you want to come back to it."
          : "This ticks itself once you have watched 90%."}
      </p>
    </div>
  );
}

function LessonNav({ data, productSlug }: { data: LessonResponse; productSlug: string }) {
  const { prev, next } = data;
  if (!prev && !next) return null;

  return (
    <nav aria-label="Lessons" className="grid gap-3 sm:grid-cols-2">
      <NavCard neighbour={prev} productSlug={productSlug} direction="prev" />
      <NavCard neighbour={next} productSlug={productSlug} direction="next" />
    </nav>
  );
}

function NavCard({
  neighbour,
  productSlug,
  direction,
}: {
  neighbour: LessonResponse["prev"];
  productSlug: string;
  direction: "prev" | "next";
}) {
  const label = direction === "prev" ? "Previous" : "Next";
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;

  if (!neighbour) {
    // An empty cell rather than a collapsed grid, so "next" stays on the right
    // of the row at the start of a course and at the end of it.
    return <span aria-hidden className="hidden sm:block" />;
  }

  const inner = (
    <>
      <span
        className={cn(
          "flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.16em]",
          direction === "next" && "justify-end",
        )}
      >
        {direction === "prev" && <Icon aria-hidden className="size-3.5" />}
        {label}
        {direction === "next" && <Icon aria-hidden className="size-3.5" />}
      </span>
      <span
        className={cn(
          "mt-1.5 block text-sm leading-snug",
          direction === "next" && "text-right",
          neighbour.unlocked ? "text-white/85" : "text-white/45",
        )}
      >
        {neighbour.title}
      </span>
      {!neighbour.unlocked && (
        <span
          className={cn(
            "mt-1 flex items-center gap-1.5 text-[0.68rem] text-gold/80",
            direction === "next" && "justify-end",
          )}
        >
          <Lock aria-hidden className="size-3" />
          Not open yet
        </span>
      )}
    </>
  );

  const shell = cn(
    "flex min-h-[2.75rem] flex-col rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3.5",
    direction === "prev" ? "text-orchid" : "text-orchid sm:col-start-2",
  );

  if (!neighbour.unlocked) {
    return <span className={cn(shell, "cursor-default")}>{inner}</span>;
  }

  return (
    <Link
      to={lessonPath(productSlug, neighbour.slug)}
      className={cn(
        shell,
        "transition-colors duration-300 hover:border-gold/40 hover:bg-white/[0.05]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      {inner}
    </Link>
  );
}

/* --------------------------------------------------- everything not a course */

/**
 * A download, a bundle, or a pass to somewhere else on the site.
 *
 * The library grants access per product, and only a `course` product has lessons
 * — so these land on the same URL and need somewhere to go. A download shows its
 * files; a bundle shows the grants it actually produced; the rest point at the
 * surface that owns them rather than pretending to be it.
 */
function NonCourseProduct({ product }: { product: LibraryProduct }) {
  if (product.kind === "download") {
    return (
      <div className="flex flex-col gap-6">
        <ProductIntro title={product.title} description={product.description} />
        {product.instructions && <section className="rounded-xl border border-white/10 p-5"><h2 className="mb-2 font-semibold text-white">Instructions</h2><p className="whitespace-pre-wrap text-sm text-orchid-dim">{product.instructions}</p></section>}
        {product.files.length > 0 ? (
          <Attachments files={product.files} kind="product" heading="Your files" />
        ) : (
          <p className="text-sm text-orchid-dim">
            The files for this are being prepared. Contact support if you need help accessing your purchase.
          </p>
        )}
      </div>
    );
  }

  if (product.kind === "bundle") {
    return (
      <div className="flex flex-col gap-6">
        <ProductIntro title={product.title} description={product.description} />
        <ul className="grid gap-3 sm:grid-cols-2">
          {product.contents.map((entry) => (
            <li key={entry.slug}>
              <Link
                to={entry.href}
                className={cn(
                  "flex min-h-[2.75rem] flex-col rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5",
                  "transition-colors duration-300 hover:border-gold/40 hover:bg-white/[0.06]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                )}
              >
                <span className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-gold">
                  {entry.kindLabel}
                </span>
                <span className="mt-1.5 text-sm font-medium text-white">{entry.title}</span>
                {entry.subtitle && (
                  <span className="mt-1 line-clamp-2 text-xs text-orchid-dim">{entry.subtitle}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const destination =
    product.kind === "community"
      ? { to: "/community", label: "Open the community", icon: Users }
      : product.kind === "coaching"
        ? { to: "/coaching", label: "Open your coaching", icon: Sparkles }
        : null;

  return (
    <div className="flex flex-col gap-6">
      <ProductIntro title={product.title} description={product.description} />
      {destination ? (
        <LuxeButton to={destination.to} className="self-start">
          <destination.icon aria-hidden className="size-4" />
          {destination.label}
        </LuxeButton>
      ) : (
        <p className="text-sm text-orchid-dim">
          This one is delivered outside the library — check your email for the details, or ask us any
          time.
        </p>
      )}
    </div>
  );
}

function ProductIntro({ title, description }: { title: string; description: string }) {
  return (
    <GlassCard spotlight={false} interactive={false} className="p-5 sm:p-7">
      <h2 className="font-display text-xl text-white">{title}</h2>
      {description && <p className="copy-luxe mt-3 max-w-2xl text-balance">{description}</p>}
    </GlassCard>
  );
}
