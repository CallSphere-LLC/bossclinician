import { CalendarPlus } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { endInstant } from "@/components/booking/timezone";

/** `20260819T130000Z` — the basic-format UTC stamp Google's link expects. */
function googleStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Two ways to get the call into a calendar.
 *
 * The `.ics` link is the primary because it is the one that works everywhere —
 * Apple Calendar, Outlook, Fastmail, a phone with no Google account signed in.
 * It is a plain navigation, not a scripted download: the server answers with
 * `text/calendar` and an attachment disposition, which is what makes iOS hand
 * the file to Calendar instead of printing XML on the screen.
 *
 * The Google link is built here from the session's own fields, so it costs the
 * backend nothing and works even if the `.ics` route is having a bad day.
 */
export function AddToCalendar({
  icsUrl,
  title,
  startsAt,
  durationMinutes,
  meetingUrl,
  agenda,
}: {
  icsUrl: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  meetingUrl: string;
  agenda: string;
}) {
  const start = new Date(startsAt);
  const end = endInstant(startsAt, durationMinutes);

  const details = [agenda, meetingUrl && `Join here: ${meetingUrl}`].filter(Boolean).join("\n\n");
  const googleUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${googleStamp(start)}/${googleStamp(end)}` +
    `&details=${encodeURIComponent(details)}` +
    (meetingUrl ? `&location=${encodeURIComponent(meetingUrl)}` : "");

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {icsUrl && (
        <LuxeButton href={icsUrl} variant="glass" size="sm">
          <CalendarPlus aria-hidden className="size-4" />
          Add to calendar
        </LuxeButton>
      )}
      <LuxeButton href={googleUrl} target="_blank" variant="quiet">
        Add to Google Calendar
      </LuxeButton>
    </div>
  );
}
