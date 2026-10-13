import { useCallback, useEffect, useState } from "react";
import { Award, Lock } from "lucide-react";
import { toast } from "sonner";
import { Card, Field, Input, selectStyles } from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { courseReleaseApi, type CourseCertificateSettings } from "@/lib/courseReleaseApi";

/*
 * Kajabi-parity release controls for the course builder.
 *
 * Kajabi gives every lesson one status — Draft, Published, Scheduled or Drip —
 * and a separate "Lock" (wait for the previous lesson). The columns behind them
 * are `published`, `publish_at`, `drip_days` / `drip_date` and
 * `requires_previous_lesson`; the server enforces all of them for every lesson
 * read, video, attachment, progress write and quiz (services/curriculum.ts).
 */

export type LessonStatus = "draft" | "published" | "scheduled" | "drip";

export const LESSON_STATUS_OPTIONS: { value: LessonStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Draft", hint: "Hidden from students while you work on it." },
  { value: "published", label: "Published", hint: "Open to students as soon as they have the course." },
  {
    value: "scheduled",
    label: "Scheduled",
    hint: "Shown as “Opens …” and unavailable until the date and time you pick.",
  },
  {
    value: "drip",
    label: "Drip",
    hint: "Opens a number of days after each student gets the course, or on a set date.",
  },
];

/** The status a stored lesson is in, read the way the server resolves it. */
export function lessonStatusOf(lesson: {
  published?: boolean;
  publishAtLocal?: string | null;
  dripDays?: number | null;
  dripDateLocal?: string | null;
}): LessonStatus {
  if (lesson.published === false) return "draft";
  if (lesson.publishAtLocal) return "scheduled";
  if (lesson.dripDateLocal || (lesson.dripDays && lesson.dripDays > 0)) return "drip";
  return "published";
}

/** "Oct 20, 9:00 AM" from "2026-10-20T09:00", for the line under a lesson name. */
export function scheduledSummary(local: string | null | undefined): string | null {
  if (!local) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  // Built in UTC and printed in UTC: these are already the owner's wall-clock
  // figures, and letting the browser's zone shift them would show a time she
  // never typed.
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return `Opens ${at.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** The status select, plus the date-and-time box for Scheduled. */
export function LessonStatusField({
  status,
  onStatus,
  publishAtLocal,
  onPublishAt,
}: {
  status: LessonStatus;
  onStatus: (status: LessonStatus) => void;
  publishAtLocal: string;
  onPublishAt: (value: string) => void;
}) {
  const current = LESSON_STATUS_OPTIONS.find((option) => option.value === status);
  return (
    <Field label="Status" hint={current?.hint}>
      <div className="space-y-2.5">
        <select
          className={selectStyles}
          aria-label="Lesson status"
          value={status}
          onChange={(e) => onStatus(e.target.value as LessonStatus)}
        >
          {LESSON_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {status === "scheduled" && (
          <>
            <Input
              type="datetime-local"
              value={publishAtLocal}
              onChange={(e) => onPublishAt(e.target.value)}
              aria-label="Date and time this lesson opens"
            />
            <p className="text-xs text-ink-soft">
              In your site’s release time zone (Settings → Delivery).
            </p>
          </>
        )}
      </div>
    </Field>
  );
}

/**
 * Course-wide switches above the sections: "Lock all lessons in order", and the
 * certificate — whether finishing issues one, and whether every graded quiz has
 * to be passed first.
 */
export function CourseReleasePanel({
  courseId,
  lessonCount,
  lockedCount,
  onChanged,
}: {
  courseId: number;
  /** Lessons in the course; the first one has nothing before it to wait for. */
  lessonCount: number;
  /** Lessons after the first that are locked behind their predecessor. */
  lockedCount: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [certificate, setCertificate] = useState<CourseCertificateSettings | null>(null);
  const [savingCertificate, setSavingCertificate] = useState(false);

  const allLocked = lessonCount > 1 && lockedCount >= lessonCount - 1;

  const loadCertificate = useCallback(() => {
    courseReleaseApi
      .certificate(courseId)
      .then(setCertificate)
      .catch(() => setCertificate(null));
  }, [courseId]);

  useEffect(loadCertificate, [loadCertificate]);

  async function toggleLock() {
    if (busy) return;
    setBusy(true);
    try {
      await courseReleaseApi.lockSequence(courseId, !allLocked);
      toast.success(
        allLocked
          ? "Lessons are no longer locked in order."
          : "Every lesson now waits for the one before it.",
      );
      onChanged();
      loadCertificate();
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    } finally {
      setBusy(false);
    }
  }

  async function saveCertificate(changes: { enabled?: boolean; requirePass?: boolean }) {
    if (savingCertificate) return;
    setSavingCertificate(true);
    try {
      setCertificate(await courseReleaseApi.saveCertificate(courseId, changes));
      toast.success("Certificate settings saved");
    } catch (err) {
      toast.error(friendlyError(err, "course"));
    } finally {
      setSavingCertificate(false);
    }
  }

  const liveQuizzes = certificate?.gradedQuizzes.filter((quiz) => quiz.published) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum-deep">
            <Lock className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-ink">Lock all lessons in order</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Students must complete each lesson before the next one opens. Where a lesson has
                  a quiz that requires a pass, they must pass it first.
                </span>
              </span>
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 rounded border-hairline text-plum"
                checked={allLocked}
                disabled={busy || lessonCount < 2}
                onChange={() => void toggleLock()}
                aria-label="Lock all lessons in order"
              />
            </label>
            <p className="mt-2 text-xs text-ink-soft">
              {lessonCount < 2
                ? "Add a second lesson to lock lessons in order."
                : allLocked
                  ? "On for every lesson. You can still unlock a single lesson in its settings."
                  : lockedCount > 0
                    ? `${lockedCount} of ${lessonCount - 1} lessons are locked. Tick to lock them all.`
                    : "Off — students can open lessons in any order."}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum-deep">
            <Award className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-ink">
                  Give a certificate when they finish
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Issued and emailed the moment a student completes every lesson.
                </span>
              </span>
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 rounded border-hairline text-plum"
                checked={certificate?.enabled === true}
                disabled={certificate === null || savingCertificate}
                onChange={(e) => void saveCertificate({ enabled: e.target.checked })}
                aria-label="Give a certificate when they finish"
              />
            </label>
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-ink">
                  Require passing every quiz to earn the certificate
                </span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {liveQuizzes.length === 0
                    ? "This course has no live graded quizzes yet — add one with “Add quiz” in a section."
                    : `Applies to: ${liveQuizzes
                        .map((quiz) => `${quiz.lessonTitle}${quiz.passMark !== null ? ` (pass ${quiz.passMark}%)` : ""}`)
                        .join(", ")}.`}
                </span>
              </span>
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 rounded border-hairline text-plum"
                checked={certificate?.requirePass !== false}
                disabled={certificate === null || savingCertificate}
                onChange={(e) => void saveCertificate({ requirePass: e.target.checked })}
                aria-label="Require passing every quiz to earn the certificate"
              />
            </label>
            <p className="text-xs text-ink-soft">
              An evaluation form works as a survey lesson (“Add survey”): students must submit it
              to complete that lesson, so it is required for the certificate too — it has no pass
              mark.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
