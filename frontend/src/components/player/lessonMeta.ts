import { FileDown, FileText, Headphones, ListChecks, Puzzle, Video } from "lucide-react";
import type { LessonContentType } from "@/lib/libraryApi";

/**
 * How a lesson describes itself in a list.
 *
 * Shared by the outline, the shelf's continue band and the lesson header so the
 * same lesson is never a video in one place and a document in another.
 */

const ICONS: Record<LessonContentType, typeof FileText> = {
  video: Video,
  audio: Headphones,
  text: FileText,
  pdf: FileDown,
  embed: Puzzle,
  assessment: ListChecks,
};

const LABELS: Record<LessonContentType, string> = {
  video: "Video",
  audio: "Audio",
  text: "Reading",
  pdf: "PDF",
  embed: "Interactive",
  assessment: "Quiz",
};

/** Falls back to a document rather than throwing: `content_type` is a DB
 *  constraint, and a value added there before this file hears about it must not
 *  blank the whole outline. */
export function contentTypeIcon(type: LessonContentType): typeof FileText {
  return ICONS[type] ?? FileText;
}

export function contentTypeLabel(type: LessonContentType): string {
  return LABELS[type] ?? "Lesson";
}

/**
 * "48 min", "1 hr 12 min".
 *
 * The measured media length wins over the author's estimate when there is one —
 * a "10 minute" lesson whose video runs 23 minutes is the sort of thing people
 * plan a lunch break around.
 */
export function lessonLengthLabel(durationMinutes: number, videoDurationSeconds: number): string {
  const minutes =
    videoDurationSeconds > 0 ? Math.max(1, Math.round(videoDurationSeconds / 60)) : durationMinutes;
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
