import { CalendarClock, Lock } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import type { LessonLockReason } from "@/lib/libraryApi";

interface LockedNoticeProps {
  title: string;
  /**
   * The server's own wording: "Unlocks Thursday, 22 January", "Opens Tuesday,
   * October 20, 9:00 AM EDT", "Complete “Intro” to unlock", "Pass the quiz in
   * “Phase 1” to unlock".
   */
  unlockLabel: string;
  unlocksAt: string | null;
  /** The zone the date above is quoted in, named so nobody has to guess. */
  timezone: string;
  /** Why it is shut; decides the explanation under the headline. */
  lockReason?: LessonLockReason | null;
  /** Where to go to open it — the previous lesson, for a sequence lock. */
  action?: { to: string; label: string } | null;
}

/** The sentence under the headline, for each kind of lock. */
function explanation(reason: LessonLockReason | null | undefined): string {
  switch (reason) {
    case "previous_incomplete":
      return "This course is taken in order. Finish the lesson before this one and it opens straight away.";
    case "previous_quiz_not_passed":
      return "This course is taken in order. Pass the quiz in the lesson before this one — at the pass mark it shows — and this lesson opens straight away.";
    case "scheduled":
      return "This lesson is part of the course you own and is scheduled to open at the time above. Check back then.";
    default:
      return "This one is part of the course you own — it simply opens later, so the material arrives at a pace you can actually work through. We will email you the moment it does.";
  }
}

/**
 * A lesson that is not open to this member yet.
 *
 * The headline is the server's sentence rather than one composed here: an unlock
 * instant depends on when this member's access was granted, on the site-wide
 * release hour and on the owner's timezone, and whether a lock holds depends on
 * their progress and quiz results — a second implementation of any of that in
 * the browser would eventually disagree with the one that actually decides.
 *
 * There is nothing else to render. The API sends a title and a reason for a
 * locked lesson and no body at all, which is why this component takes no body —
 * a component that could display one is a component somebody will later wire up.
 */
export function LockedNotice({
  title,
  unlockLabel,
  unlocksAt,
  timezone,
  lockReason,
  action,
}: LockedNoticeProps) {
  const dated = lockReason === "drip" || lockReason === "scheduled" || (!lockReason && unlocksAt);
  const Icon = lockReason === "scheduled" ? CalendarClock : Lock;

  return (
    <GlassCard
      spotlight={false}
      interactive={false}
      className="flex flex-col items-center px-6 py-14 text-center sm:px-10"
    >
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-full border border-gold/25 bg-gold/[0.08]"
      >
        <Icon className="size-6 text-gold" />
      </span>

      <h2 className="mt-5 text-balance font-display text-[1.45rem] leading-snug text-white sm:text-[1.7rem]">
        {title}
      </h2>

      <p className="mt-3 text-balance text-[0.95rem] font-medium text-gold-bright">
        {unlockLabel || "This lesson has not been released yet."}
      </p>

      {dated && unlocksAt && (
        <p className="mt-1.5 text-xs uppercase tracking-[0.14em] text-orchid-faint">
          {formatRelative(unlocksAt)} · {timezone.replace(/_/g, " ")}
        </p>
      )}

      <p className="copy-luxe mt-5 max-w-md text-balance text-sm">{explanation(lockReason)}</p>

      {action && (
        <div className="mt-6">
          <LuxeButton to={action.to} size="sm">
            {action.label}
          </LuxeButton>
        </div>
      )}
    </GlassCard>
  );
}
