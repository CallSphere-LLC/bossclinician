import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { TimezoneNotice } from "@/components/booking/TimezoneNotice";
import { detectTimezone, isValidTimezone, sameClock } from "@/components/booking/timezone";
import { useMember } from "@/hooks/useMember";
import { memberApi, MemberApiError } from "@/lib/memberApi";
import { cn } from "@/lib/cn";

const DISMISSED_KEY = "bc_member_tz_prompt_dismissed";

/** One dismissal covers one disagreement: a new trip, or a new saved zone, asks again. */
function pairKey(saved: string, device: string): string {
  return `${saved}|${device}`;
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    // Private mode, storage disabled. The prompt simply comes back next visit.
    return null;
  }
}

function writeDismissed(value: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, value);
  } catch {
    // Nothing to do; see above.
  }
}

/**
 * "Your device and your account disagree about the time."
 *
 * Every unlock date, event and session in the member area is quoted in the zone
 * saved on the profile. When the device says something else — a move, a trip, a
 * profile that defaulted to the wrong coast at sign-up — the member is the last
 * to find out, usually by missing something. So the shell raises it once,
 * everywhere, with the one-tap fix the booking screens already offer.
 *
 * Silent in every other case: zones that agree, no saved zone to compare, an
 * admin viewing as the member (whose device says nothing about the member's),
 * and the coaching screens, which carry this same notice themselves and do not
 * need two.
 *
 * The device zone is read in an effect rather than during render so the first
 * paint is the same on the server and in the browser.
 */
export function TimezonePrompt({ className }: { className?: string }) {
  const { member, setMember } = useMember();
  const { pathname } = useLocation();
  const [deviceTimezone, setDeviceTimezone] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDeviceTimezone(detectTimezone());
    setDismissed(readDismissed());
  }, []);

  if (!member || member.impersonatedBy != null || deviceTimezone === null) return null;
  if (pathname === "/coaching" || pathname.startsWith("/coaching/")) return null;

  const saved = member.timezone;
  if (!saved || !isValidTimezone(saved)) return null;
  if (sameClock(deviceTimezone, saved)) return null;
  if (dismissed === pairKey(saved, deviceTimezone)) return null;

  const change = async (timezone: string) => {
    if (saving || !isValidTimezone(timezone)) return;
    setSaving(true);
    try {
      setMember(await memberApi.updateProfile({ timezone }));
      toast.success("Saved. Your dates and times now use that time zone.");
    } catch (err) {
      toast.error(
        err instanceof MemberApiError
          ? err.message
          : "We could not save your time zone just now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const keep = () => {
    const key = pairKey(saved, deviceTimezone);
    writeDismissed(key);
    setDismissed(key);
  };

  return (
    <div className={cn("flex flex-col gap-1", saving && "opacity-70", className)}>
      <TimezoneNotice
        timezone={saved}
        deviceTimezone={deviceTimezone}
        onChange={(timezone) => void change(timezone)}
      />
      <button
        type="button"
        onClick={keep}
        className={cn(
          "inline-flex min-h-[2.75rem] items-center self-end rounded-full px-4",
          "text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-orchid-dim",
          "transition-colors duration-300 hover:text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        )}
      >
        Keep my saved time zone
      </button>
    </div>
  );
}
