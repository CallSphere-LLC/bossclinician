import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { fetchSessionIcs } from "@/lib/coachingApi";
import { endInstant } from "@/components/booking/timezone";

/** `20260819T130000Z` — the basic-format UTC stamp Google's link expects. */
function googleStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Two ways to get the call into a calendar.
 *
 * The `.ics` file is the primary because it is the one that works everywhere —
 * Apple Calendar, Outlook, Fastmail, a phone with no Google account signed in —
 * and because it carries the server's own `UID` and `SEQUENCE`, which is what
 * makes a later reschedule move the existing entry rather than leaving the
 * member with two contradictory appointments in the same diary.
 *
 * It is fetched rather than linked. `/api/member/*` authenticates on a bearer
 * token alone, so a plain navigation to the route would leave the app and land
 * on a 401; the file is pulled with the header attached and handed to the
 * browser as a blob instead.
 *
 * The Google link is built here from the event's own fields, so it costs the
 * backend nothing, still works if the `.ics` route is having a bad day, and is
 * the only offer for things with no `.ics` route at all — community events,
 * which have no per-member calendar file to fetch.
 */
export function AddToCalendar({
  sessionId,
  title,
  startsAt,
  durationMinutes,
  meetingUrl,
  agenda,
}: {
  /** A coaching session id. Omitted for anything with no `.ics` route. */
  sessionId?: number;
  title: string;
  startsAt: string;
  durationMinutes: number;
  meetingUrl: string;
  agenda: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const start = new Date(startsAt);
  const end = endInstant(startsAt, durationMinutes);

  const details = [agenda, meetingUrl && `Join here: ${meetingUrl}`].filter(Boolean).join("\n\n");
  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${googleStamp(start)}/${googleStamp(end)}` +
    `&details=${encodeURIComponent(details)}` +
    (meetingUrl ? `&location=${encodeURIComponent(meetingUrl)}` : "");

  const download = async () => {
    if (sessionId === undefined) return;
    setDownloading(true);
    setError("");
    try {
      const blob = await fetchSessionIcs(sessionId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `coaching-session-${sessionId}.ics`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Held for a while rather than revoked straight after the click: iOS
      // Safari opens a calendar file in a preview sheet and reads the blob when
      // the member taps "Add", which is long after this function returns.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError("We could not build that calendar file. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {sessionId !== undefined && (
          <LuxeButton
            type="button"
            variant="glass"
            size="sm"
            disabled={downloading}
            onClick={() => void download()}
          >
            {downloading ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <CalendarPlus aria-hidden className="size-4" />
            )}
            {downloading ? "Preparing" : "Add to calendar"}
          </LuxeButton>
        )}
        <LuxeButton href={googleUrl} target="_blank" variant="quiet">
          Add to Google Calendar
        </LuxeButton>
      </div>

      <div aria-live="polite" className="mt-2 empty:mt-0">
        {error && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
