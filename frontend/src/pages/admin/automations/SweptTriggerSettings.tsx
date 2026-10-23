import { useEffect, useState } from "react";
import { engagementApi, type EngagementLesson } from "@/lib/engagementApi";
import type { NamedOption } from "@/lib/marketingApi";
import { Field, Input, selectStyles } from "@/pages/admin/ui/primitives";

/**
 * The extra settings of the row-171 triggers, shown under "Which course" /
 * "Which community" in the automation builder.
 *
 * "A lesson video has not been watched": after how many days, counted from
 * when the lesson opened or from when they got the course; "not finished" or
 * "never pressed play"; one lesson, or whichever video they are up to.
 *
 * "Misses a live session" / "a replay is ready": who the session was for, and
 * optionally one webinar event instead of a community's meetups.
 *
 * Every change is saved as a merge into the trigger's settings, so picking the
 * course again never wipes the number of days.
 */

export const SWEPT_TRIGGER_TYPES = new Set([
  "lesson_not_watched",
  "live_session_missed",
  "live_session_replay_ready",
]);

type Config = Record<string, string | number | boolean | null>;

export function SweptTriggerSettings({
  triggerType,
  triggerConfig,
  events,
  onChange,
}: {
  triggerType: string;
  triggerConfig: Record<string, unknown> | null | undefined;
  /** Site-wide events, from the builder's options. */
  events: NamedOption[];
  onChange: (next: Config) => void;
}) {
  const config = (triggerConfig ?? {}) as Config;
  const merge = (patch: Config) => onChange({ ...config, ...patch });

  if (triggerType === "lesson_not_watched") {
    return <LessonSettings config={config} merge={merge} />;
  }
  if (!SWEPT_TRIGGER_TYPES.has(triggerType)) return null;

  return (
    <>
      <Field label="Who the session was for">
        <select
          className={selectStyles}
          value={String(config.audience ?? "registered")}
          onChange={(event) => merge({ audience: event.target.value })}
        >
          <option value="registered">People who RSVP’d or registered</option>
          <option value="members">Everyone in the community</option>
        </select>
      </Field>
      <Field label="Or one webinar event" hint="Choosing one means only that event">
        <select
          className={selectStyles}
          value={String(config.eventId ?? "")}
          onChange={(event) => merge({ eventId: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">Community sessions and every webinar</option>
          {events.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-ink-soft sm:col-span-2">
        Runs once a session has ended and you have added its replay link (Analytics → Engagement → Live
        sessions), for sessions that ended in the last 7 days. Use {"{{replayUrl}}"}, {"{{sessionTitle}}"} and{" "}
        {"{{sessionDate}}"} in the email.
      </p>
    </>
  );
}

function LessonSettings({ config, merge }: { config: Config; merge: (patch: Config) => void }) {
  const courseId = Number(config.courseId ?? 0);
  const [lessons, setLessons] = useState<EngagementLesson[]>([]);
  const [days, setDays] = useState(String(config.days ?? 3));

  useEffect(() => {
    setLessons([]);
    if (!(courseId > 0)) return;
    engagementApi
      .lessons(courseId)
      .then(setLessons)
      .catch(() => setLessons([]));
  }, [courseId]);

  return (
    <>
      <Field label="After how many days" hint="1 to 365">
        <Input
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          onBlur={() => {
            const value = Math.round(Number(days));
            if (Number.isFinite(value) && value >= 1 && value <= 365 && value !== Number(config.days)) {
              merge({ days: value });
            } else if (!(value >= 1 && value <= 365)) {
              setDays(String(config.days ?? 3));
            }
          }}
        />
      </Field>
      <Field label="Counted from">
        <select
          className={selectStyles}
          value={String(config.basis ?? "release")}
          onChange={(event) => merge({ basis: event.target.value })}
        >
          <option value="release">When the lesson opened for them</option>
          <option value="access">When they got the course</option>
        </select>
      </Field>
      <Field label="Which lesson">
        <select
          className={selectStyles}
          value={String(config.lessonId ?? "")}
          disabled={!(courseId > 0)}
          onChange={(event) => merge({ lessonId: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">Whichever video they’re up to</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.moduleTitle ? `${lesson.moduleTitle} — ` : ""}
              {lesson.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Counts as not watched">
        <select
          className={selectStyles}
          value={String(config.watch ?? "not_completed")}
          onChange={(event) => merge({ watch: event.target.value })}
        >
          <option value="not_completed">Not finished</option>
          <option value="not_started">Never pressed play</option>
        </select>
      </Field>
      <p className="text-xs text-ink-soft sm:col-span-2">
        Checked every half hour. Only people who become due after you turn this on are emailed — anyone
        already overdue can be reminded from Analytics → Engagement. Use {"{{lessonTitle}}"},{" "}
        {"{{lessonUrl}}"} and {"{{courseTitle}}"} in the email, and set the email step to “Course and
        product updates” so people who turned those off are skipped.
      </p>
    </>
  );
}
