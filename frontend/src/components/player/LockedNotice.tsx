import { Lock } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { GlassCard } from "@/components/luxe/GlassCard";

interface LockedNoticeProps {
  title: string;
  /** The server's own wording, e.g. "Unlocks Thursday, 22 January". */
  unlockLabel: string;
  unlocksAt: string | null;
  /** The zone the date above is quoted in, named so nobody has to guess. */
  timezone: string;
}

/**
 * A lesson that has not been released yet.
 *
 * The date is the whole content of this screen, and it is the server's sentence
 * rather than one composed here: the unlock instant depends on when this member's
 * access was granted, on the site-wide release hour and on the owner's timezone,
 * and a second implementation of that arithmetic in the browser would eventually
 * disagree with the one that actually decides.
 *
 * There is nothing else to render. The API sends a title and a date for a locked
 * lesson and no body at all, which is why this component takes no body — a
 * component that could display one is a component somebody will later wire up.
 */
export function LockedNotice({ title, unlockLabel, unlocksAt, timezone }: LockedNoticeProps) {
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
        <Lock className="size-6 text-gold" />
      </span>

      <h2 className="mt-5 text-balance font-display text-[1.45rem] leading-snug text-white sm:text-[1.7rem]">
        {title}
      </h2>

      <p className="mt-3 text-[0.95rem] font-medium text-gold-bright">
        {unlockLabel || "This lesson has not been released yet."}
      </p>

      {unlocksAt && (
        <p className="mt-1.5 text-xs uppercase tracking-[0.14em] text-orchid-faint">
          {formatRelative(unlocksAt)} · {timezone.replace(/_/g, " ")}
        </p>
      )}

      <p className="copy-luxe mt-5 max-w-md text-balance text-sm">
        This one is part of the course you own — it simply opens later, so the material arrives at a
        pace you can actually work through. We will email you the moment it does.
      </p>
    </GlassCard>
  );
}
