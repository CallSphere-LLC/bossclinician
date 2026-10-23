import type {
  ProgressRow,
  SendResult,
  SessionPerson,
  WatchStatus,
} from "@/lib/engagementApi";
import { personKey } from "@/lib/engagementApi";

/**
 * The Engagement page's decisions that do not need a browser: what each status
 * is called, who is ticked by default, and what to say after a send.
 */

export const WATCH_STATUS_LABEL: Record<WatchStatus, string> = {
  not_started: "Not started",
  partial: "Partly watched",
  completed: "Completed",
};

export const WATCH_STATUS_TONE: Record<WatchStatus, "neutral" | "gold" | "green"> = {
  not_started: "neutral",
  partial: "gold",
  completed: "green",
};

/** One table row: a person and a lesson. */
export function progressRowKey(row: Pick<ProgressRow, "memberId" | "lessonId">): string {
  return `${row.memberId}:${row.lessonId}`;
}

/**
 * Who "Send reminder" starts with ticked: everyone in view who has not
 * finished the video and has not already been reminded about it today.
 */
export function defaultReminderSelection(
  rows: ProgressRow[],
  now: Date = new Date()
): Set<string> {
  const today = now.toISOString().slice(0, 10);
  return new Set(
    rows
      .filter(
        (row) =>
          row.status !== "completed" &&
          !(row.lastRemindedAt && row.lastRemindedAt.slice(0, 10) === today)
      )
      .map(progressRowKey)
  );
}

/**
 * A reminder is about one lesson. Ticked rows across several lessons cannot go
 * in one press; the page asks her to narrow to one lesson first.
 */
export function reminderTarget(
  rows: ProgressRow[],
  selected: Set<string>
): { lessonId: number; lessonTitle: string; memberIds: number[] } | { problem: string } {
  const chosen = rows.filter((row) => selected.has(progressRowKey(row)));
  if (chosen.length === 0) return { problem: "Tick the people to remind first." };
  const lessons = new Set(chosen.map((row) => row.lessonId));
  if (lessons.size > 1) {
    return { problem: "A reminder is about one lesson. Choose a lesson in the filter above, then tick people." };
  }
  return {
    lessonId: chosen[0].lessonId,
    lessonTitle: chosen[0].lessonTitle,
    memberIds: [...new Set(chosen.map((row) => row.memberId))],
  };
}

/**
 * Who "Email the replay" starts with ticked: invited, not seen in the room, not
 * sent it yet. "Not seen" includes unknown — a meetup on an external link has
 * no attendance, and the replay is still for everyone who RSVP'd.
 */
export function defaultReplaySelection(people: SessionPerson[], includeAttendees = false): Set<string> {
  return new Set(
    people
      .filter(
        (person) =>
          !person.replaySentAt &&
          (includeAttendees ? person.invited || person.attended === true : person.invited && person.attended !== true)
      )
      .map(personKey)
  );
}

export const INVITED_AS_LABEL: Record<SessionPerson["invitedAs"], string> = {
  going: "Said going",
  maybe: "Said maybe",
  member: "Member",
  registered: "Registered",
  walk_in: "Came without RSVP",
};

/** The toast after a press, in plain words. */
export function describeSendResult(result: SendResult, noun = "email"): string {
  const parts: string[] = [];
  parts.push(
    result.queued === 1 ? `1 ${noun} is on its way` : `${result.queued} ${noun}s are on their way`
  );
  if (result.alreadySent > 0) {
    parts.push(`${result.alreadySent} already had one today, so were skipped`);
  }
  if (result.noContact > 0) parts.push(`${result.noContact} have no contact record`);
  if (result.notEligible > 0) parts.push(`${result.notEligible} could not be sent to`);
  return `${parts.join(". ")}.`;
}

/** "42 min" / "1 h 5 min" for the minutes someone spent in the room. */
export function describeMinutes(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

/** The merge tags each email can use, shown under the body field. */
export const LESSON_TOKENS = "{{firstName}} {{lessonTitle}} {{courseTitle}} {{lessonUrl}}";
export const REPLAY_TOKENS = "{{firstName}} {{sessionTitle}} {{sessionDate}} {{replayUrl}}";
