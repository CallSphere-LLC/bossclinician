import { useCallback, useEffect, useState } from "react";
import { useMember } from "@/hooks/useMember";
import { detectTimezone, isValidTimezone } from "@/components/booking/timezone";

/**
 * Which clock the coaching screens are drawn in.
 *
 * Order of preference: an override the member picked in this sitting, then the
 * timezone saved on their profile, then whatever the device says. The device is
 * last on purpose — a member travelling for a week should not find their calls
 * silently redrawn in a hotel's timezone, but the banner does offer the switch.
 *
 * The override is held in a module variable rather than storage, so it follows
 * the member from /coaching into a session and back without quietly outliving
 * the visit. A stored override would keep contradicting the profile for months
 * after the trip that caused it.
 */
let sessionOverride: string | null = null;

export function useDisplayTimezone(): {
  timezone: string;
  setTimezone: (timezone: string) => void;
  deviceTimezone: string;
} {
  const { member } = useMember();
  const deviceTimezone = detectTimezone();

  const preferred = member?.timezone && isValidTimezone(member.timezone) ? member.timezone : null;
  const [timezone, setLocal] = useState(sessionOverride ?? preferred ?? deviceTimezone);

  // The profile can land after the first render — `useMember` bootstraps from a
  // refresh call — so adopt it once it does, unless the member has already said
  // otherwise on this visit.
  useEffect(() => {
    if (sessionOverride === null && preferred) setLocal(preferred);
  }, [preferred]);

  const setTimezone = useCallback((next: string) => {
    if (!isValidTimezone(next)) return;
    sessionOverride = next;
    setLocal(next);
  }, []);

  return { timezone, setTimezone, deviceTimezone };
}
