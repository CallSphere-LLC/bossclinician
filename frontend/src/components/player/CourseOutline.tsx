import { Link } from "react-router";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { lessonPath, type OutlineLesson, type OutlineModule } from "@/lib/libraryApi";
import { contentTypeIcon, contentTypeLabel, lessonLengthLabel } from "@/components/player/lessonMeta";

interface CourseOutlineProps {
  modules: OutlineModule[];
  productSlug: string;
  /** The lesson being played, if any. Marked `aria-current`, not just coloured. */
  activeLessonSlug?: string;
  /** Fires after a lesson is chosen, so the mobile sheet can close itself. */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Modules and lessons, with the locked ones still on the list.
 *
 * A dripped lesson is shown with the date it opens rather than hidden. Hiding it
 * makes a 12-lesson course look like a 4-lesson course to somebody who bought it
 * yesterday, and the first thing that produces is a refund request. The date is
 * the answer to the question they were about to ask.
 *
 * Locked rows are `<span>` and not a disabled `<Link>`: there is nowhere for them
 * to go, and a link that refuses to navigate is worse than no link at all for
 * anyone driving this by keyboard.
 */
export function CourseOutline({
  modules,
  productSlug,
  activeLessonSlug,
  onNavigate,
  className,
}: CourseOutlineProps) {
  if (modules.length === 0) {
    return (
      <p className={cn("text-sm text-orchid-dim", className)}>
        The lessons for this course are being prepared. You will get an email the moment the first
        one is ready.
      </p>
    );
  }

  return (
    <nav aria-label="Course outline" className={className}>
      <ol className="flex flex-col gap-6">
        {modules.map((module, index) => (
          <li key={module.id}>
            <ModuleHeading module={module} index={index} />

            <ol className="mt-2 flex flex-col">
              {module.lessons.map((lesson) => (
                <li key={lesson.id}>
                  <LessonRow
                    lesson={lesson}
                    productSlug={productSlug}
                    active={lesson.slug === activeLessonSlug}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ModuleHeading({ module, index }: { module: OutlineModule; index: number }) {
  const done = module.lessons.filter((lesson) => lesson.completed).length;

  return (
    <div className="flex items-start gap-3 px-1">
      <span
        aria-hidden
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.04] font-body text-[0.65rem] font-semibold text-orchid"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-balance font-display text-[0.98rem] leading-snug text-white">
          {module.title}
        </h3>
        {module.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-orchid-dim">
            {module.summary}
          </p>
        )}
        <p className="mt-1 text-[0.7rem] uppercase tracking-[0.14em] text-orchid-faint">
          {module.lessons.length > 0 && (
            <span>
              {done} of {module.lessons.length} done
            </span>
          )}
          {!module.unlocked && module.unlockLabel && (
            <span className="text-gold/80">
              {module.lessons.length > 0 && " · "}
              {module.unlockLabel}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

interface LessonRowProps {
  lesson: OutlineLesson;
  productSlug: string;
  active: boolean;
  onNavigate?: () => void;
}

function LessonRow({ lesson, productSlug, active, onNavigate }: LessonRowProps) {
  const Icon = contentTypeIcon(lesson.contentType);
  const length = lessonLengthLabel(lesson.durationMinutes, lesson.videoDurationSeconds);
  const inProgress = !lesson.completed && lesson.watchedPercent > 0 && lesson.watchedPercent < 100;

  const shell = cn(
    "relative flex min-h-[2.75rem] w-full items-start gap-3 rounded-xl py-2.5 pl-4 pr-3",
    "text-left transition-colors duration-300",
  );

  const body = (
    <>
      {/* The active rule is a sibling rather than a border so the row's own
          geometry does not shift by a pixel as you move down the list. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-0 w-px bg-rule-gold transition-transform duration-500 ease-luxe",
          active ? "scale-y-100" : "scale-y-0",
        )}
      />

      <span
        aria-hidden
        className={cn(
          "mt-px grid size-5 shrink-0 place-items-center rounded-full border",
          lesson.completed
            ? "border-gold/40 bg-gold/[0.14] text-gold"
            : lesson.unlocked
              ? "border-white/12 bg-white/[0.04] text-orchid-dim"
              : "border-white/10 bg-transparent text-orchid-faint",
        )}
      >
        {lesson.completed ? (
          <Check className="size-3" strokeWidth={3} />
        ) : lesson.unlocked ? (
          <Icon className="size-3" />
        ) : (
          <Lock className="size-3" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[0.9rem] leading-snug",
            active ? "font-semibold text-white" : lesson.unlocked ? "text-white/85" : "text-white/45",
          )}
        >
          {lesson.title}
        </span>

        <span className="mt-1 block text-[0.7rem] text-orchid-faint">
          {lesson.unlocked ? (
            <>
              {contentTypeLabel(lesson.contentType)}
              {length && ` · ${length}`}
              {lesson.completed && " · Finished"}
            </>
          ) : (
            <span className="text-gold/80">{lesson.unlockLabel || "Not open yet"}</span>
          )}
        </span>

        {inProgress && (
          <span
            aria-hidden
            className="mt-2 block h-[3px] w-full overflow-hidden rounded-full bg-orchid-dim/20"
          >
            <span
              className="block h-full rounded-full bg-gold-foil"
              style={{ width: `${lesson.watchedPercent}%` }}
            />
          </span>
        )}
      </span>
    </>
  );

  if (!lesson.unlocked) {
    return (
      // The visible meta line already carries the unlock date, so this adds only
      // the word the icon is carrying visually rather than repeating the date.
      <span className={cn(shell, "cursor-default")}>
        <span className="sr-only">Locked. </span>
        {body}
      </span>
    );
  }

  return (
    <Link
      to={lessonPath(productSlug, lesson.slug)}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        shell,
        "hover:bg-white/[0.05]",
        active && "bg-orchid-dim/[0.12]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
      )}
    >
      {body}
    </Link>
  );
}
