import { LessonAssessment } from "./LessonAssessment";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProgressResult, UnlockedLesson } from "@/lib/libraryApi";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { AudioPlayer } from "@/components/player/AudioPlayer";
import { EmbedFrame } from "@/components/player/EmbedFrame";

interface LessonBodyProps {
  lesson: UnlockedLesson;
  /** Falls back to the course artwork when an audio lesson has none of its own. */
  courseImage: string;
  onSaved: (result: ProgressResult) => void;
}

/**
 * One lesson, rendered as whatever it actually is.
 *
 * The switch is on `contentType` rather than on which field happens to be
 * non-empty. Guessing from "is video_url blank" is how a text lesson with a
 * stray URL in it becomes a broken player, and it is precisely the guessing that
 * the typed column added in migration 003 exists to end.
 *
 * `bodyMd` is rendered alongside every media type, not only for `text`. On a
 * video lesson it is the lesson notes underneath — the worksheet instructions,
 * the reading list — and dropping it would silently lose content the author
 * wrote.
 */
export function LessonBody({ lesson, courseImage, onSaved }: LessonBodyProps) {
  const notes = lesson.bodyMd.trim() ? <Markdown body={lesson.bodyMd} /> : null;

  switch (lesson.contentType) {
    case "video":
      return (
        <div className="flex flex-col gap-6">
          <VideoPlayer
            lessonId={lesson.id}
            src={lesson.videoUrl}
            captionsUrl={lesson.captionsUrl}
            poster={courseImage}
            title={lesson.title}
            startAt={lesson.progress.lastPositionSeconds}
            initialPercent={lesson.progress.watchedPercent}
            onSaved={onSaved}
          />
          {notes}
        </div>
      );

    case "audio":
      return (
        <div className="flex flex-col gap-6">
          <AudioPlayer
            lessonId={lesson.id}
            src={lesson.audioUrl}
            captionsUrl={lesson.captionsUrl}
            title={lesson.title}
            moduleTitle={lesson.moduleTitle}
            artwork={courseImage}
            startAt={lesson.progress.lastPositionSeconds}
            initialPercent={lesson.progress.watchedPercent}
            onSaved={onSaved}
          />
          {notes}
        </div>
      );

    case "pdf":
      return (
        <div className="flex flex-col gap-6">
          <PdfPane url={lesson.attachmentUrl} title={lesson.title} />
          {notes}
        </div>
      );

    case "embed":
      return (
        <div className="flex flex-col gap-6">
          <EmbedFrame html={lesson.embedHtml} title={lesson.title} />
          {notes}
        </div>
      );

    case "assessment":
      return (
        <div className="flex flex-col gap-6">
          {lesson.assessmentSlug ? (
            <LessonAssessment slug={lesson.assessmentSlug} />
          ) : (
            <p className="rounded-2xl border border-gold/25 bg-gold/[0.06] px-5 py-6 text-sm text-orchid">
              This assessment is not live yet. Please check back shortly.
            </p>
          )}
          {notes}
        </div>
      );

    case "text":
    default:
      return (
        notes ?? (
          <p className="text-sm text-orchid-dim">
            This lesson has no written content yet. Please check back shortly.
          </p>
        )
      );
  }
}

/**
 * Author-supplied Markdown, on a column that cannot be pushed sideways.
 *
 * Long URLs break rather than widen the page, and a GFM table scrolls inside
 * itself — on a 360px screen a three-column table is otherwise enough to make
 * the whole document scroll horizontally, which breaks every other lesson too.
 */
function Markdown({ body, className }: { body: string; className?: string }) {
  return (
    <div className={cn("prose-boss break-words [&_table]:block [&_table]:overflow-x-auto", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

/**
 * Only http(s) and root-relative URLs are ever put in an `href` or a frame.
 *
 * `attachment_url` is a free-text column the admin types into, and `javascript:`
 * in it would otherwise become a working script the moment a member clicks the
 * lesson.
 */
function isSafeUrl(url: string): boolean {
  const value = url.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A PDF lesson.
 *
 * Inline where the browser will do it, and a plain link where it will not — iOS
 * Safari renders only the first page of a framed PDF and gives no way to reach
 * the rest, so the escape hatch is not a fallback for old browsers, it is the
 * path a large share of this audience will take.
 */
function PdfPane({ url, title }: { url: string; title: string }) {
  if (!url || !isSafeUrl(url)) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-orchid-dim">
        The document for this lesson is in the downloads below.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[34rem] max-h-[78vh] w-full overflow-hidden rounded-2xl border border-white/10 bg-night-raised shadow-glass">
        <iframe title={`${title} (PDF)`} src={url} className="size-full border-0" />
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex min-h-[2.75rem] items-center gap-2 self-start rounded-full",
          "border border-white/20 px-5 text-sm text-white/85 transition-colors duration-300",
          "hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        <FileDown aria-hidden className="size-4" />
        Open the document
        <ExternalLink aria-hidden className="size-3.5 text-orchid-dim" />
      </a>
    </div>
  );
}
